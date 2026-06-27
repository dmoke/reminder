const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  session,
} = require("electron");
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");

const Config = require("./config");
const Storage = require("./storage");
const Scheduler = require("./scheduler");
const { createTray } = require("./tray");

const appIcon = path.join(__dirname, "assets", "icon.ico");
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';";
app.setAppUserModelId("com.reminder.app");
console.log("main: starting");
let tray = null;
let mainWindow = null;
let addWindow = null;
let storage = null;
let scheduler = null;
let config = {};
let isQuitting = false;

function notifyRefresh() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("refresh-reminders");
  }
}

function initApp() {
  config = Config.load();
  if (!config.dataPath) return false;
  storage = new Storage(config.dataPath, notifyRefresh);
  scheduler = new Scheduler(storage);
  scheduler.start();
  return true;
}

function createTrayInstance() {
  tray = createTray(openMainWindow, openAddWindow);
}

function hardenWebContents(win) {
  // This app only ever loads its own bundled local pages. Block any attempt to
  // open new windows or navigate away from them.
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault();
  });
}

function openMainWindow() {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 860,
    minWidth: 900,
    minHeight: 780,
    icon: appIcon,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  hardenWebContents(mainWindow);
  mainWindow.loadFile(path.join(__dirname, "..", "ui", "index.html"));
  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }
  mainWindow.on("close", (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on("closed", () => (mainWindow = null));
}

function openAddWindow() {
  if (addWindow && !addWindow.isDestroyed()) {
    addWindow.show();
    addWindow.focus();
    return;
  }
  // A modal window must have a visible parent to actually block interaction.
  if (!mainWindow) openMainWindow();
  addWindow = new BrowserWindow({
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
  hardenWebContents(addWindow);
  addWindow.loadFile(path.join(__dirname, "..", "ui", "add.html"));
  if (!app.isPackaged) {
    addWindow.webContents.openDevTools({ mode: "detach" });
  }
  addWindow.once("ready-to-show", () => {
    addWindow.show();
  });
  addWindow.on("closed", () => (addWindow = null));
}

async function firstLaunchSetup() {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory"],
    title: "Select folder for reminders",
  });
  if (result.canceled) return false;
  config.dataPath = result.filePaths[0];
  Config.save(config);
  return true;
}

function applyLoginItemSetting() {
  // Only register a startup entry for the installed app; in development
  // app.getPath("exe") points at node_modules/electron and would pollute the
  // user's startup list.
  if (!app.isPackaged) return;
  const openAtLogin = config.openAtLogin !== false; // default on
  app.setLoginItemSettings({ openAtLogin, path: process.execPath, args: [] });
}

// Build a stored reminder from untrusted renderer input. Returns null if the
// payload is unusable. IPC is a trust boundary, so never persist raw input.
function sanitizeNewReminder(input) {
  if (!input || typeof input !== "object") return null;
  const text = typeof input.text === "string" ? input.text.trim() : "";
  if (!text) return null;
  const time = new Date(input.time);
  if (isNaN(time.getTime())) return null;
  return { text, time: time.toISOString(), done: false };
}

function sanitizeUpdates(updates) {
  if (!updates || typeof updates !== "object") return null;
  const clean = {};
  if (typeof updates.text === "string" && updates.text.trim()) {
    clean.text = updates.text.trim();
  }
  if (updates.time !== undefined) {
    const time = new Date(updates.time);
    if (isNaN(time.getTime())) return null;
    clean.time = time.toISOString();
  }
  return Object.keys(clean).length ? clean : null;
}

ipcMain.handle("get-reminders", () => storage.getActive());
ipcMain.handle("get-history", () => storage.getHistory());
ipcMain.handle("add-reminder", (event, reminder) => {
  const clean = sanitizeNewReminder(reminder);
  if (!clean) throw new Error("Invalid reminder");
  clean.id = uuidv4();
  storage.add(clean); // notifyRefresh fires via Storage onChange
  return clean.id;
});
ipcMain.handle("update-reminder", (event, id, updates) => {
  const clean = sanitizeUpdates(updates);
  if (!clean) throw new Error("Invalid update");
  return storage.update(id, clean);
});
ipcMain.handle("archive-reminder", (event, id) => storage.archive(id));
ipcMain.handle("delete-reminder", (event, id) => storage.delete(id));
ipcMain.handle("open-add-window", () => openAddWindow());
ipcMain.handle("get-config", () => ({
  dataPath: config.dataPath || "",
  openAtLogin: config.openAtLogin !== false,
}));
ipcMain.handle("set-login-item", (event, enabled) => {
  config.openAtLogin = !!enabled;
  Config.save(config);
  applyLoginItemSetting();
  return config.openAtLogin;
});
ipcMain.handle("choose-folder", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory"],
    title: "Select folder for reminders",
  });
  if (result.canceled) return null;
  config.dataPath = result.filePaths[0];
  Config.save(config);
  storage = new Storage(config.dataPath, notifyRefresh);
  scheduler.stop();
  scheduler = new Scheduler(storage);
  scheduler.start();
  notifyRefresh();
  return config.dataPath;
});
ipcMain.handle("open-folder", async () => {
  if (!config.dataPath || !fs.existsSync(config.dataPath)) return false;
  await shell.openPath(config.dataPath);
  return true;
});

app.whenReady().then(async () => {
  console.log("main: app ready");
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [CSP],
      },
    });
  });
  if (!initApp()) {
    const chosen = await firstLaunchSetup();
    if (!chosen || !initApp()) {
      app.quit();
      return;
    }
  }
  createTrayInstance();
  openMainWindow();
  applyLoginItemSetting();
});

// Intentionally empty: this is a tray app. Keep the process (tray icon +
// scheduler) alive when all windows are closed/hidden. Quitting happens via the
// tray menu, which sets isQuitting in before-quit.
app.on("window-all-closed", () => {});
app.on("before-quit", () => {
  isQuitting = true;
});

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    } else {
      openMainWindow();
    }
  });
}
