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
  fitWindowHeight: (h) => ipcRenderer.invoke("fit-window-height", h),
  getLayoutMetrics: () => ipcRenderer.invoke("get-layout-metrics"),
  onLayoutChanged: (callback) => ipcRenderer.on("layout-changed", callback),
  openAddWindow: () => ipcRenderer.invoke("open-add-window"),
  getConfig: () => ipcRenderer.invoke("get-config"),
  chooseFolder: () => ipcRenderer.invoke("choose-folder"),
  openFolder: () => ipcRenderer.invoke("open-folder"),
  openBackupsFolder: () => ipcRenderer.invoke("open-backups-folder"),
  importReminders: () => ipcRenderer.invoke("import-reminders"),
  setLoginItem: (enabled) => ipcRenderer.invoke("set-login-item", enabled),
  setLanguage: (lang) => ipcRenderer.invoke("set-language", lang),
  setCollapseReopen: (minutes) =>
    ipcRenderer.invoke("set-collapse-reopen", minutes),
  onRefreshReminders: (callback) =>
    ipcRenderer.on("refresh-reminders", callback),
  onOpenAddModal: (callback) => ipcRenderer.on("open-add-modal", callback),
  onOpenEditModal: (callback) =>
    ipcRenderer.on("open-edit-modal", (event, reminder) => callback(reminder)),
  alertEditDone: () => ipcRenderer.invoke("alert:edit-done"),
});

// Always-on-top alert window API
contextBridge.exposeInMainWorld("alertAPI", {
  onData: (callback) =>
    ipcRenderer.on("alert:data", (event, data) => callback(data)),
  complete: (id, expectedTime) =>
    ipcRenderer.invoke("alert:complete", id, expectedTime),
  snooze: (id, isoTime) => ipcRenderer.invoke("alert:snooze", id, isoTime),
  edit: (id) => ipcRenderer.invoke("alert:edit", id),
  dismiss: () => ipcRenderer.invoke("alert:dismiss"),
  openApp: () => ipcRenderer.invoke("alert:open-app"),
});

// Collapsed "mini" alert window API
contextBridge.exposeInMainWorld("miniAPI", {
  onData: (callback) =>
    ipcRenderer.on("mini:data", (event, data) => callback(data)),
  expand: () => ipcRenderer.invoke("mini:expand"),
  minimize: () => ipcRenderer.invoke("mini:minimize"),
});
