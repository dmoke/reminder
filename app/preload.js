const { contextBridge, ipcRenderer } = require("electron");

console.log("preload: loaded");

// Main-window / renderer API
contextBridge.exposeInMainWorld("electronAPI", {
  addReminder: (reminder) => ipcRenderer.invoke("add-reminder", reminder),
  getReminders: () => ipcRenderer.invoke("get-reminders"),
  getHistory: () => ipcRenderer.invoke("get-history"),
  updateReminder: (id, updates) =>
    ipcRenderer.invoke("update-reminder", id, updates),
  archiveReminder: (id, expectedTime) =>
    ipcRenderer.invoke("archive-reminder", id, expectedTime),
  deleteReminder: (id) => ipcRenderer.invoke("delete-reminder", id),
  deleteTag: (tag) => ipcRenderer.invoke("delete-tag", tag),
  openAddWindow: () => ipcRenderer.invoke("open-add-window"),
  getConfig: () => ipcRenderer.invoke("get-config"),
  chooseFolder: () => ipcRenderer.invoke("choose-folder"),
  openFolder: () => ipcRenderer.invoke("open-folder"),
  setLoginItem: (enabled) => ipcRenderer.invoke("set-login-item", enabled),
  setLanguage: (lang) => ipcRenderer.invoke("set-language", lang),
  onRefreshReminders: (callback) =>
    ipcRenderer.on("refresh-reminders", callback),
  onOpenAddModal: (callback) => ipcRenderer.on("open-add-modal", callback),
});

// Always-on-top alert window API
contextBridge.exposeInMainWorld("alertAPI", {
  onData: (callback) =>
    ipcRenderer.on("alert:data", (event, data) => callback(data)),
  complete: (id, expectedTime) =>
    ipcRenderer.invoke("alert:complete", id, expectedTime),
  snooze: (id, isoTime) => ipcRenderer.invoke("alert:snooze", id, isoTime),
  dismiss: () => ipcRenderer.invoke("alert:dismiss"),
  openApp: () => ipcRenderer.invoke("alert:open-app"),
});
