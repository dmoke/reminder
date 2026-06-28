const fs = require("fs");
const path = require("path");

class Storage {
  constructor(dataPath, onChange) {
    this.dataPath = dataPath;
    this.activePath = path.join(dataPath, "reminders.json");
    this.historyPath = path.join(dataPath, "history.json");
    this.onChange = typeof onChange === "function" ? onChange : () => {};
    // Keep active reminders in memory so the scheduler does not re-read and
    // re-parse the file from disk every second.
    this.active = this.readFile(this.activePath);
  }

  readFile(filePath) {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      // Valid JSON that is not an array (e.g. `null`, an object, a hand-edited
      // or legacy file) would otherwise flow through getActive()/getHistory()
      // and crash the scheduler on the first push/findIndex. Treat it as corrupt
      // so it is quarantined and replaced with a usable empty list.
      if (!Array.isArray(parsed)) throw new Error("expected a JSON array");
      return parsed;
    } catch (err) {
      if (err.code === "ENOENT") {
        this.writeFile(filePath, []);
        return [];
      }
      // The file exists but is unreadable/corrupt. Preserve it under a unique
      // name (never clobbering an earlier backup) and surface the failure
      // instead of silently discarding the user's data.
      console.error(`storage: failed to read ${filePath}: ${err.message}`);
      const backupPath = `${filePath}.${Date.now()}.bak`;
      try {
        fs.renameSync(filePath, backupPath);
        console.error(`storage: corrupt file moved to ${backupPath}`);
      } catch {
        // ignore – nothing more we can do
      }
      this.writeFile(filePath, []);
      return [];
    }
  }

  writeFile(filePath, data) {
    // The configured data folder may be missing (deleted, moved, or on an
    // unmounted drive). Recreate it rather than crashing on launch.
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tempPath = filePath + ".tmp";
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
    fs.renameSync(tempPath, filePath);
  }

  notify() {
    try {
      this.onChange();
    } catch {
      // a failing listener must not corrupt a successful write
    }
  }

  getActive() {
    return this.active;
  }

  getHistory() {
    return this.readFile(this.historyPath);
  }

  add(reminder) {
    this.active.push(reminder);
    this.writeFile(this.activePath, this.active);
    this.notify();
  }

  update(id, updates) {
    const index = this.active.findIndex((r) => r.id === id);
    if (index === -1) return false;
    Object.assign(this.active[index], updates);
    this.writeFile(this.activePath, this.active);
    this.notify();
    return true;
  }

  delete(id) {
    const history = this.getHistory().filter((r) => r.id !== id);
    this.active = this.active.filter((r) => r.id !== id);
    this.writeFile(this.activePath, this.active);
    this.writeFile(this.historyPath, history);
    this.notify();
  }

  archive(id, updates = {}) {
    const index = this.active.findIndex((r) => r.id === id);
    if (index === -1) return false;
    const reminder = Object.assign({}, this.active[index], updates, {
      done: true,
      completedAt: new Date().toISOString(),
    });
    this.active.splice(index, 1);
    const history = this.getHistory();
    history.unshift(reminder);
    this.writeFile(this.activePath, this.active);
    this.writeFile(this.historyPath, history);
    this.notify();
    return true;
  }

  // Remove a tag from every active and history reminder (global tag delete).
  removeTag(tag) {
    let changed = false;
    this.active.forEach((r) => {
      if (Array.isArray(r.tags) && r.tags.includes(tag)) {
        r.tags = r.tags.filter((x) => x !== tag);
        changed = true;
      }
    });
    if (changed) this.writeFile(this.activePath, this.active);

    const history = this.getHistory();
    let historyChanged = false;
    history.forEach((r) => {
      if (Array.isArray(r.tags) && r.tags.includes(tag)) {
        r.tags = r.tags.filter((x) => x !== tag);
        historyChanged = true;
      }
    });
    if (historyChanged) this.writeFile(this.historyPath, history);

    if (changed || historyChanged) this.notify();
    return changed || historyChanged;
  }

  // Complete one occurrence of a recurring reminder: push a completed snapshot
  // to history AND advance the still-active reminder to its next occurrence.
  recurComplete(id, nextTime) {
    const index = this.active.findIndex((r) => r.id === id);
    if (index === -1) return false;
    const snapshot = Object.assign({}, this.active[index], {
      done: true,
      completedAt: new Date().toISOString(),
    });
    const history = this.getHistory();
    history.unshift(snapshot);
    this.active[index].time = nextTime;
    this.writeFile(this.activePath, this.active);
    this.writeFile(this.historyPath, history);
    this.notify();
    return true;
  }
}

module.exports = Storage;
