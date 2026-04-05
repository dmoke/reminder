const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  dialog,
  Notification,
  ipcMain,
  shell,
} = require("electron");
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");

const Config = require("./config");
const Storage = require("./storage");
const Scheduler = require("./scheduler");
const { createTray } = require("./tray");

const appIcon = path.join(__dirname, "assets", "icon.png");
app.setAppUserModelId("com.reminder.app");
console.log("main: starting");
let tray = null;
let mainWindow = null;
let storage = null;
let scheduler = null;
let config = {};

function initApp() {
  config = Config.load();
  if (!config.dataPath) return false;
  storage = new Storage(config.dataPath);
  scheduler = new Scheduler(storage, openMainWindow);
  scheduler.start();
  return true;
}

function createTrayInstance() {
  tray = createTray(openMainWindow);
}

function openMainWindow() {
  if (mainWindow) {
    mainWindow.show();
    return;
  }
  mainWindow = new BrowserWindow({
    width: 860,
    height: 860,
    minWidth: 780,
    minHeight: 780,
    icon: appIcon,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, "..", "ui", "index.html"));
  mainWindow.webContents.openDevTools({ mode: "detach" });
  mainWindow.on("closed", () => (mainWindow = null));
}

function openAddWindow() {
  const addWindow = new BrowserWindow({
    width: 580,
    height: 590,
    minWidth: 580,
    minHeight: 580,
    icon: appIcon,
    show: false,
    modal: true,
    parent: mainWindow,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  addWindow.loadFile(path.join(__dirname, "..", "ui", "add.html"));
  addWindow.webContents.openDevTools({ mode: "detach" });
  addWindow.once("ready-to-show", () => {
    addWindow.show();
  });
}

async function firstLaunchSetup() {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory"],
    title: "Select folder for reminders",
  });
  if (result.canceled) {
    app.quit();
    return;
  }
  config.dataPath = result.filePaths[0];
  Config.save(config);
}

ipcMain.handle("get-reminders", () => {
  console.log("get-reminders");
  return storage.getActive();
});
ipcMain.handle("get-history", () => {
  console.log("get-history");
  return storage.getHistory();
});
ipcMain.handle("add-reminder", (event, reminder) => {
  console.log("add-reminder", reminder);
  reminder.id = uuidv4();
  storage.add(reminder);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("refresh-reminders");
  }
});
ipcMain.handle("update-reminder", (event, id, updates) => {
  console.log("update-reminder", id, updates);
  return storage.update(id, updates);
});
ipcMain.handle("archive-reminder", (event, id) => {
  console.log("archive-reminder", id);
  return storage.archive(id);
});
ipcMain.handle("delete-reminder", (event, id) => {
  console.log("delete-reminder", id);
  return storage.delete(id);
});
ipcMain.handle("open-add-window", () => {
  console.log("open-add-window");
  openAddWindow();
});
ipcMain.handle("get-config", () => {
  console.log("get-config", config);
  return { dataPath: config.dataPath || "" };
});
ipcMain.handle("choose-folder", async () => {
  console.log("choose-folder");
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory"],
    title: "Select folder for reminders",
  });
  if (result.canceled) return null;
  config.dataPath = result.filePaths[0];
  Config.save(config);
  storage = new Storage(config.dataPath);
  scheduler.stop();
  scheduler = new Scheduler(storage);
  scheduler.start();
  return config.dataPath;
});
ipcMain.handle("open-folder", async () => {
  console.log("open-folder", config.dataPath);
  if (!config.dataPath) return false;
  await shell.openPath(config.dataPath);
  return true;
});

app.whenReady().then(async () => {
  console.log("main: app ready");
  if (!initApp()) {
    await firstLaunchSetup();
    initApp();
  }
  createTrayInstance();
  openMainWindow();
  app.setLoginItemSettings({ openAtLogin: true });
});

app.on("window-all-closed", () => {});

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) mainWindow.show();
  });
}
