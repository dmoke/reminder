const { contextBridge, ipcRenderer } = require("electron");

console.log("preload: loaded");

contextBridge.exposeInMainWorld("electronAPI", {
  addReminder: (reminder) => ipcRenderer.invoke("add-reminder", reminder),
  getReminders: () => ipcRenderer.invoke("get-reminders"),
  getHistory: () => ipcRenderer.invoke("get-history"),
  updateReminder: (id, updates) =>
    ipcRenderer.invoke("update-reminder", id, updates),
  archiveReminder: (id) => ipcRenderer.invoke("archive-reminder", id),
  deleteReminder: (id) => ipcRenderer.invoke("delete-reminder", id),
  openAddWindow: () => ipcRenderer.invoke("open-add-window"),
  getConfig: () => ipcRenderer.invoke("get-config"),
  chooseFolder: () => ipcRenderer.invoke("choose-folder"),
  openFolder: () => ipcRenderer.invoke("open-folder"),
  onRefreshReminders: (callback) =>
    ipcRenderer.on("refresh-reminders", callback),
});
