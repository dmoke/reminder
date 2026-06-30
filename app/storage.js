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

  // Bulk-import reminders (e.g. from another app). Each item is added as-is, so
  // the caller is responsible for shaping it like a reminder (id, text, time, …).
  // Re-importing is safe: any item whose `importId` already exists — in either
  // the active list or history — is skipped rather than duplicated, and the batch
  // is de-duplicated against itself too. Completed items (done) go to history;
  // the rest to the active list. Returns a summary of what happened.
  importReminders(reminders) {
    const list = Array.isArray(reminders) ? reminders : [];
    const history = this.getHistory();
    const seen = new Set();
    for (const r of this.active) if (r.importId) seen.add(r.importId);
    for (const r of history) if (r.importId) seen.add(r.importId);

    let added = 0;
    let completed = 0;
    let skipped = 0;
    for (const r of list) {
      const key = r && r.importId;
      if (key && seen.has(key)) {
        skipped += 1;
        continue;
      }
      if (key) seen.add(key);
      if (r.done) {
        history.unshift(r);
        completed += 1;
      } else {
        this.active.push(r);
        added += 1;
      }
    }

    if (added) this.writeFile(this.activePath, this.active);
    if (completed) this.writeFile(this.historyPath, history);
    if (added || completed) this.notify();
    return { added, completed, skipped, total: list.length };
  }

  // Merge reminders from a backup envelope's `data` into the live store WITHOUT
  // overwriting anything: only entries whose `id` is not already present (in the
  // active list OR history) are added, so re-loading the same backup — or loading
  // one that overlaps the current data — is safe and idempotent. Active and
  // completed entries keep the active/history split the snapshot captured them in
  // (backup.data.reminders → active, backup.data.history → history), and the batch
  // is de-duplicated against itself too. Non-array sources (a raw/odd-shape
  // envelope from a corrupt snapshot) and non-object entries are ignored.
  //
  // Pass { dryRun: true } to compute the same summary WITHOUT writing — used to
  // preview "loading this backup would add N reminders" before committing.
  mergeFromBackup(backupData, opts = {}) {
    const data = backupData && typeof backupData === "object" ? backupData : {};
    const incomingActive = Array.isArray(data.reminders) ? data.reminders : [];
    const incomingHistory = Array.isArray(data.history) ? data.history : [];
    const history = this.getHistory();

    // Every id already on disk — adding one of these would duplicate it.
    const seen = new Set();
    for (const r of this.active) if (r && r.id != null) seen.add(r.id);
    for (const r of history) if (r && r.id != null) seen.add(r.id);

    const toActive = [];
    const toHistory = [];
    let skipped = 0;
    const collect = (list, dest) => {
      for (const r of list) {
        if (!r || typeof r !== "object") {
          skipped += 1;
          continue;
        }
        if (r.id != null && seen.has(r.id)) {
          skipped += 1; // already present (or a duplicate within this batch)
          continue;
        }
        if (r.id != null) seen.add(r.id);
        dest.push(r);
      }
    };
    collect(incomingActive, toActive);
    collect(incomingHistory, toHistory);

    const summary = {
      addedActive: toActive.length,
      addedHistory: toHistory.length,
      added: toActive.length + toHistory.length,
      skipped,
      total: incomingActive.length + incomingHistory.length,
    };
    if (opts.dryRun) return summary;

    if (toActive.length) {
      this.active = this.active.concat(toActive);
      this.writeFile(this.activePath, this.active);
    }
    if (toHistory.length) {
      // Prepend the snapshot's history (already newest-first) ahead of the
      // current history, preserving each side's order.
      this.writeFile(this.historyPath, toHistory.concat(history));
    }
    if (summary.added) this.notify();
    return summary;
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
