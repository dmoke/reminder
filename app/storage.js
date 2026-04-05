const fs = require("fs");
const path = require("path");

class Storage {
  constructor(dataPath) {
    this.dataPath = dataPath;
    this.activePath = path.join(dataPath, "reminders.json");
    this.historyPath = path.join(dataPath, "history.json");
  }

  readFile(filePath) {
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (err) {
      if (err.code === "ENOENT") {
        this.writeFile(filePath, []);
        return [];
      }
      const backupPath = filePath + ".bak";
      try {
        fs.renameSync(filePath, backupPath);
      } catch (renameErr) {
        // ignore
      }
      this.writeFile(filePath, []);
      return [];
    }
  }

  writeFile(filePath, data) {
    const tempPath = filePath + ".tmp";
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
    fs.renameSync(tempPath, filePath);
  }

  getActive() {
    return this.readFile(this.activePath);
  }

  getHistory() {
    return this.readFile(this.historyPath);
  }

  add(reminder) {
    const data = this.getActive();
    data.push(reminder);
    this.writeFile(this.activePath, data);
  }

  update(id, updates) {
    const data = this.getActive();
    const index = data.findIndex((r) => r.id === id);
    if (index !== -1) {
      Object.assign(data[index], updates);
      this.writeFile(this.activePath, data);
    }
  }

  delete(id) {
    const active = this.getActive();
    const history = this.getHistory();
    const newActive = active.filter((r) => r.id !== id);
    const newHistory = history.filter((r) => r.id !== id);
    this.writeFile(this.activePath, newActive);
    this.writeFile(this.historyPath, newHistory);
  }

  archive(id, updates = {}) {
    const active = this.getActive();
    const index = active.findIndex((r) => r.id === id);
    if (index === -1) return;
    const reminder = Object.assign({}, active[index], updates, {
      done: true,
      completedAt: new Date().toISOString(),
    });
    active.splice(index, 1);
    const history = this.getHistory();
    history.unshift(reminder);
    this.writeFile(this.activePath, active);
    this.writeFile(this.historyPath, history);
  }
}

module.exports = Storage;
