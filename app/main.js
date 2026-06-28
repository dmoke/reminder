const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  session,
  screen,
} = require("electron");
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");

const Config = require("./config");
const Storage = require("./storage");
const Backup = require("./backup");
const Scheduler = require("./scheduler");
const { createTray } = require("./tray");
const { nextOccurrence, RECURRENCES } = require("./recurrence");

// Read straight from the app's package.json so the version stamped into backups
// is the real app version (and unambiguous in dev, where app.getVersion() can
// report Electron's version instead).
const APP_VERSION = require("../package.json").version;
const appIcon = path.join(__dirname, "assets", "icon.ico");
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; media-src 'self' data:;";
const DISMISS_SNOOZE_MS = 5 * 60 * 1000;
const RAISE_THROTTLE_MS = 20 * 1000;
// The main window auto-fits its height to the reminder list: it shrinks down to
// roughly the page chrome when nearly empty and grows up to a per-display cap
// (mainWindowMaxHeight, chosen on launch), after which the list scrolls
// internally. (Renderer mirrors the cap via getLayoutMetrics.)
const WIN_MAX_HEIGHT = 920; // desktop design height; fallback if display probing fails
const WIN_MIN_HEIGHT = 360;
const DESIGN_WIDTH = 1140; // window width on a roomy display
const DESIGN_MIN_WIDTH = 1020;

// ---- Adaptive scaling ------------------------------------------------------
// On launch the whole UI is scaled (Electron content zoom) to the monitor so it
// fits comfortably on small laptops instead of rendering at a fixed desktop
// size. The zoom is picked so the tallest view — the month calendar — fits the
// display's work area without scrolling. REFERENCE_CONTENT_HEIGHT is the CSS-px
// content height we reserve for that calendar view (CSS px are zoom invariant).
// The grid is always 6 week-rows, but a day cell grows with up to 3 event pills,
// so the real height ranges ~1100 (light month) to ~1330 (every row packed). We
// reserve enough for light-through-busy months to fit with no scroll; an
// exceptionally packed month falls back to a small page scroll.
const REFERENCE_CONTENT_HEIGHT = 1180;
const WORK_AREA_MARGIN = 24; // gap kept between the window and the work-area edges
const MIN_ZOOM = 0.5; // never shrink the UI past this (keeps text legible)
const MAX_ZOOM = 1.0; // never enlarge past the native design size
const APPROX_FRAME = 44; // title bar + borders estimate, used only for the first paint

// User-facing strings for the alert window (the main process owns this window,
// so it localizes it directly from the persisted language preference).
const ALERT_STRINGS = {
  en: {
    title: "Reminder",
    "due-now": "Due now",
    "overdue-by": "Overdue by",
    complete: "✔ Complete",
    snooze: "Snooze",
    dismiss: "Dismiss",
    "open-app": "Open app",
    "snooze-10m": "10 min",
    "snooze-1h": "1 hour",
    "snooze-3h": "3 hours",
    "snooze-tomorrow": "Tomorrow",
    "snooze-2d": "2 days",
    "snooze-1w": "1 week",
    "snooze-1mo": "1 month",
    "snooze-1y": "1 year",
    "snooze-custom": "Custom…",
    "snooze-all": "Snooze all",
    "complete-all": "Complete all",
    recurring: "Repeats",
  },
  uk: {
    title: "Нагадування",
    "due-now": "Час настав",
    "overdue-by": "Прострочено на",
    complete: "✔ Виконати",
    snooze: "Відкласти",
    dismiss: "Закрити",
    "open-app": "Відкрити застосунок",
    "snooze-10m": "10 хв",
    "snooze-1h": "1 год",
    "snooze-3h": "3 год",
    "snooze-tomorrow": "Завтра",
    "snooze-2d": "2 дні",
    "snooze-1w": "1 тиждень",
    "snooze-1mo": "1 місяць",
    "snooze-1y": "1 рік",
    "snooze-custom": "Свій час…",
    "snooze-all": "Відкласти всі",
    "complete-all": "Виконати всі",
    recurring: "Повторюється",
  },
};

app.setAppUserModelId("com.reminder.app");
console.log("main: starting");

// Last-resort guards so a transient error (e.g. during a BrowserWindow/IPC
// call inside the per-second scheduler tick) is logged rather than crashing
// the tray process with an uncaught-exception dialog.
process.on("uncaughtException", (err) => {
  console.error("uncaughtException:", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("unhandledRejection:", reason);
});
let tray = null;
let mainWindow = null;
let mainWindowZoom = 1; // content zoom factor chosen for the current display
let mainWindowMaxHeight = WIN_MAX_HEIGHT; // auto-fit growth cap (DIP) for this display
let mainWindowDisplayId = null; // id of the display the window was last sized for
let alertWindow = null;
let alertReady = false;
let storage = null;
let scheduler = null;
let config = {};
let isQuitting = false;

let currentDue = [];
let lastDueKey = "";
let lastRaise = 0;
// While the user is rescheduling a reminder via the in-app edit modal (opened
// from the alert's "Custom…" button), don't pop the always-on-top alert over it
// — not even for other reminders that come due meanwhile.
let suppressAlert = false;

function notifyRefresh() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("refresh-reminders");
  }
}

function lang() {
  return config.language === "uk" ? "uk" : "en";
}

function initApp() {
  config = Config.load();
  if (!config.dataPath) return false;
  // Start with Windows is on by default; persist it explicitly on first run.
  if (config.openAtLogin === undefined) {
    config.openAtLogin = true;
    Config.save(config);
  }
  // Snapshot the on-disk data BEFORE Storage opens it. This is the safety net
  // for "I lost my stuff after the update": a separate, shareable, versioned
  // backup of the exact bytes the previous version left — including a corrupt
  // file (which Storage would otherwise rename away on construction). Forced
  // whenever the app version changed, so every update is captured.
  Backup.safeBackupOnStartup(config.dataPath, APP_VERSION);
  storage = new Storage(config.dataPath, notifyRefresh);
  scheduler = new Scheduler(storage, handleDue);
  scheduler.start();
  return true;
}

function createTrayInstance() {
  tray = createTray(openMainWindow, openAddModal);
}

function hardenWebContents(win) {
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault();
  });
}

function clampZoom(z) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

// The display the app is opening on — the one under the cursor, falling back to
// the primary display.
function targetDisplay() {
  try {
    return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  } catch (err) {
    console.error("display probe failed; using primary", err);
    return screen.getPrimaryDisplay();
  }
}

// True if the window's center sits within some display's work area (i.e. it
// isn't stranded off-screen after a monitor was unplugged).
function isWindowVisibleOnScreen(win) {
  const b = win.getBounds();
  const cx = b.x + Math.round(b.width / 2);
  const cy = b.y + Math.round(b.height / 2);
  return screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return cx >= a.x && cx < a.x + a.width && cy >= a.y && cy < a.y + a.height;
  });
}

// Measure the real OS frame, scale the UI so the calendar's reference content
// fits the current display's work area, and size + center the window to that
// scaled content. Records the display it was tuned for so reopening on another
// monitor can detect the change and re-fit. Does NOT apply the zoom to the
// renderer — callers do that at the right moment (after load, or immediately on
// reopen).
function applyWindowLayout(win) {
  const display = targetDisplay();
  const wa = display.workArea;
  const budgetH = Math.max(WIN_MIN_HEIGHT, wa.height - WORK_AREA_MARGIN);
  const maxWidth = Math.max(480, wa.width - WORK_AREA_MARGIN);
  const width = Math.min(DESIGN_WIDTH, maxWidth);
  const [, totalProbe] = win.getSize();
  const [, contentProbe] = win.getContentSize();
  const frame = Math.max(0, totalProbe - contentProbe);
  const availContent = Math.max(1, budgetH - frame);
  const zoom = clampZoom(availContent / REFERENCE_CONTENT_HEIGHT);
  const contentDip = Math.min(
    availContent,
    Math.round(REFERENCE_CONTENT_HEIGHT * zoom),
  );
  const totalH = contentDip + frame;
  mainWindowZoom = zoom;
  mainWindowMaxHeight = totalH;
  mainWindowDisplayId = display.id;
  win.setSize(width, totalH, false);
  win.setPosition(
    Math.round(wa.x + (wa.width - width) / 2),
    Math.round(wa.y + (wa.height - totalH) / 2),
  );
}

function openMainWindow() {
  if (mainWindow) {
    // Closing only hides the window (the tray app keeps running), so reopening
    // reuses it. If the active monitor changed since we last sized it (e.g. the
    // laptop was undocked) or it would surface off-screen, re-fit to the current
    // display; otherwise leave the user's size/position alone.
    if (
      targetDisplay().id !== mainWindowDisplayId ||
      !isWindowVisibleOnScreen(mainWindow)
    ) {
      applyWindowLayout(mainWindow);
      mainWindow.webContents.setZoomFactor(mainWindowZoom);
      mainWindow.webContents.send("layout-changed");
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  const display = targetDisplay();
  const wa = display.workArea;
  const budgetH = Math.max(WIN_MIN_HEIGHT, wa.height - WORK_AREA_MARGIN);
  const maxWidth = Math.max(480, wa.width - WORK_AREA_MARGIN);
  const width = Math.min(DESIGN_WIDTH, maxWidth);

  mainWindow = new BrowserWindow({
    width,
    height: budgetH,
    minWidth: Math.min(DESIGN_MIN_WIDTH, maxWidth),
    minHeight: Math.min(WIN_MIN_HEIGHT, budgetH),
    icon: appIcon,
    // Hide Electron's default File/Edit/View menu bar — a tray app has no use for
    // it, it wastes ~26px of height, and it skews the content-frame measurement.
    // Alt still reveals it, so edit accelerators remain available.
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      // Rough scale for the first paint; applyWindowLayout sets the exact value
      // once the real window frame is known (reasserted on the renderer after load).
      zoomFactor: clampZoom((budgetH - APPROX_FRAME) / REFERENCE_CONTENT_HEIGHT),
    },
  });

  applyWindowLayout(mainWindow);

  hardenWebContents(mainWindow);
  mainWindow.loadFile(path.join(__dirname, "..", "ui", "index.html"));
  // Reassert the content zoom after load — some Electron builds reset the
  // webPreferences zoomFactor once the page finishes navigating.
  mainWindow.webContents.on("did-finish-load", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.setZoomFactor(mainWindowZoom);
    }
  });
  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }
  // Keep the visible list fresh whenever the user brings the window forward.
  mainWindow.on("focus", notifyRefresh);
  mainWindow.on("show", notifyRefresh);
  mainWindow.on("close", (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
  // If the window goes away while an alert-initiated edit was in progress,
  // resume alerts so they can never get stuck suppressed.
  mainWindow.on("hide", () => (suppressAlert = false));
  mainWindow.on("closed", () => {
    suppressAlert = false;
    mainWindow = null;
  });
}

// Open the in-window add/edit modal, creating/showing the main window first.
function openAddModal() {
  const fresh = !mainWindow;
  openMainWindow();
  const send = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("open-add-modal");
    }
  };
  if (fresh) {
    mainWindow.webContents.once("did-finish-load", send);
  } else {
    send();
  }
}

// Open the in-window EDIT modal for a specific reminder (from the alert's
// "Custom…" reschedule button).
function openEditModalFor(reminder) {
  const fresh = !mainWindow;
  openMainWindow();
  const send = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("open-edit-modal", reminder);
    }
  };
  if (fresh) {
    mainWindow.webContents.once("did-finish-load", send);
  } else {
    send();
  }
}

// ---- Alert window (reliable, always-on-top notification) -------------------

function ensureAlertWindow() {
  if (alertWindow && !alertWindow.isDestroyed()) return;
  alertReady = false;
  const win = new BrowserWindow({
    width: 460,
    height: 560,
    resizable: true,
    minimizable: true,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: false,
    alwaysOnTop: true,
    icon: appIcon,
    show: false,
    title: "Reminder",
    autoHideMenuBar: true, // no default menu bar on the notification popup
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  alertWindow = win;
  hardenWebContents(win);
  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true);
  win.loadFile(path.join(__dirname, "..", "ui", "alert.html"));
  win.webContents.on("did-finish-load", () => {
    // Ignore a late load event from a window we have already replaced.
    if (alertWindow !== win) return;
    alertReady = true;
    // Now that the page is loaded, perform the first send + raise (avoids
    // briefly flashing a blank always-on-top window before content paints).
    if (currentDue.length) pushAlert(currentDue);
  });
  win.on("closed", () => {
    // A "closed" from a window we already superseded must not clobber its
    // successor's state — only react if this is still the live window.
    if (alertWindow !== win) return;
    alertWindow = null;
    alertReady = false;
    // The window that was showing `lastDueKey` is gone. Closing it (e.g. with
    // the OS "X") does NOT resolve the reminders, so they stay due and a fresh
    // window is recreated on the next tick. Clear the cache so pushAlert()
    // treats the still-due set as new and re-sends `alert:data`; otherwise the
    // unchanged key short-circuits sendAlertData() and the new window renders
    // empty.
    lastDueKey = "";
  });
}

function alertPayload(due, isNew) {
  return {
    isNew: !!isNew,
    lang: lang(),
    strings: ALERT_STRINGS[lang()],
    reminders: due.map((r) => ({
      id: r.id,
      text: r.text,
      emoji: r.emoji || "",
      time: r.time,
      tags: r.tags || [],
      favorite: !!r.favorite,
      recurrence: r.recurrence || "none",
    })),
  };
}

function sendAlertData(due, isNew) {
  if (!alertWindow || alertWindow.isDestroyed() || !alertReady) return;
  alertWindow.webContents.send("alert:data", alertPayload(due, isNew));
}

function raiseAlert(focus) {
  if (!alertWindow || alertWindow.isDestroyed()) return;
  if (alertWindow.isMinimized()) alertWindow.restore();
  alertWindow.setAlwaysOnTop(true, "screen-saver");
  alertWindow.show();
  alertWindow.moveTop();
  if (focus) {
    alertWindow.focus();
    alertWindow.flashFrame(true);
  }
  lastRaise = Date.now();
}

function closeAlertWindow() {
  if (alertWindow && !alertWindow.isDestroyed()) alertWindow.close();
  alertWindow = null;
  alertReady = false;
}

// Called by the scheduler every second with the currently-due reminders.
function handleDue(due) {
  currentDue = due;
  if (!due.length) {
    lastDueKey = "";
    closeAlertWindow();
    return;
  }
  // Editing a reminder from the alert: keep tracking due reminders but don't
  // raise the alert window over the edit modal.
  if (suppressAlert) return;
  ensureAlertWindow();
  // If the window is still loading, the did-finish-load handler performs the
  // first send + raise once content has painted.
  if (!alertReady) return;
  pushAlert(due);
}

function pushAlert(due) {
  const key = due
    .map((r) => `${r.id}@${r.time}`)
    .sort()
    .join("|");
  const ids = new Set(due.map((r) => r.id));
  const prevIds = new Set(
    lastDueKey ? lastDueKey.split("|").map((s) => s.split("@")[0]) : [],
  );
  const gainedNew = [...ids].some((id) => !prevIds.has(id));

  if (key !== lastDueKey) {
    lastDueKey = key;
    // Beep + flash only when a genuinely new reminder appears, not when the
    // set merely shrinks (one completed/snoozed) or the language changes.
    sendAlertData(due, gainedNew);
    raiseAlert(gainedNew);
  } else if (Date.now() - lastRaise > RAISE_THROTTLE_MS) {
    // Keep it on top even if the user clicked elsewhere.
    raiseAlert(false);
  }
}

// ---- Reminder operations ---------------------------------------------------

// expectedTime: the reminder time the caller saw. If provided and it no longer
// matches (e.g. a rapid double-click already advanced a recurring reminder),
// the completion is rejected so we don't double-record / skip an occurrence.
function completeReminder(id, expectedTime) {
  const reminder = storage.getActive().find((r) => r.id === id);
  if (!reminder) return false;
  if (expectedTime && reminder.time !== expectedTime) return false;
  const recurrence =
    reminder.recurrence && reminder.recurrence !== "none"
      ? reminder.recurrence
      : null;
  if (recurrence) {
    // Advance exactly one period from this occurrence. Use the reminder's own
    // time as the floor when it is still in the future so an early "Complete"
    // doesn't skip the imminent occurrence; for overdue reminders fall back to
    // "now" so genuinely missed occurrences collapse to the next future slot.
    const floor =
      new Date(reminder.time) > new Date() ? reminder.time : undefined;
    const next = nextOccurrence(reminder.time, recurrence, floor);
    if (next) return storage.recurComplete(id, next);
  }
  return storage.archive(id);
}

function sanitizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  return [
    ...new Set(tags.map((t) => String(t).trim()).filter(Boolean)),
  ].slice(0, 20);
}

function sanitizeRecurrence(value) {
  return RECURRENCES.includes(value) ? value : "none";
}

// Optional decorative emoji. Kept short so a stray paste can't bloat the file;
// empty string means "no emoji" (the default).
function sanitizeEmoji(value) {
  if (typeof value !== "string") return "";
  const v = value.trim();
  return v.length <= 16 ? v : "";
}

function sanitizeNewReminder(input) {
  if (!input || typeof input !== "object") return null;
  const text = typeof input.text === "string" ? input.text.trim() : "";
  if (!text) return null;
  const time = new Date(input.time);
  if (isNaN(time.getTime())) return null;
  return {
    text,
    time: time.toISOString(),
    done: false,
    emoji: sanitizeEmoji(input.emoji),
    tags: sanitizeTags(input.tags),
    favorite: !!input.favorite,
    recurrence: sanitizeRecurrence(input.recurrence),
    createdAt: new Date().toISOString(),
  };
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
  if (updates.emoji !== undefined) clean.emoji = sanitizeEmoji(updates.emoji);
  if (updates.tags !== undefined) clean.tags = sanitizeTags(updates.tags);
  if (updates.favorite !== undefined) clean.favorite = !!updates.favorite;
  if (updates.recurrence !== undefined) {
    clean.recurrence = sanitizeRecurrence(updates.recurrence);
  }
  return Object.keys(clean).length ? clean : null;
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
  if (!app.isPackaged) return;
  const openAtLogin = config.openAtLogin !== false;
  app.setLoginItemSettings({ openAtLogin, path: process.execPath, args: [] });
}

// ---- IPC -------------------------------------------------------------------

ipcMain.handle("get-reminders", () => storage.getActive());
ipcMain.handle("get-history", () => storage.getHistory());
// Renderer asks the window to match its content height; we clamp to the window
// min/max and translate the content height into a total (frame-inclusive) size.
// The renderer measures in CSS px (post-zoom), so scale back to the window's
// device-independent px before sizing.
ipcMain.handle("fit-window-height", (event, contentHeight) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMaximized() || mainWindow.isFullScreen()) return;
  const css = Number(contentHeight);
  if (!Number.isFinite(css) || css <= 0) return;
  const [w, totalH] = mainWindow.getSize();
  const [, contentH] = mainWindow.getContentSize();
  const frame = totalH - contentH; // title bar + borders (DIP)
  const contentDip = Math.round(css * mainWindowZoom);
  const target = Math.max(
    WIN_MIN_HEIGHT,
    Math.min(mainWindowMaxHeight, contentDip + frame),
  );
  if (Math.abs(target - totalH) > 1) mainWindow.setSize(w, target, false);
});
// The renderer mirrors the window's content-height cap (CSS px) and the launch
// zoom so its auto-fit math matches the per-display window size chosen above.
ipcMain.handle("get-layout-metrics", () => {
  let frame = APPROX_FRAME;
  if (mainWindow && !mainWindow.isDestroyed()) {
    const [, totalH] = mainWindow.getSize();
    const [, contentH] = mainWindow.getContentSize();
    frame = Math.max(0, totalH - contentH);
  }
  const maxContentDip = Math.max(0, mainWindowMaxHeight - frame);
  return {
    zoomFactor: mainWindowZoom,
    maxContentHeight: Math.round(maxContentDip / mainWindowZoom),
  };
});
ipcMain.handle("add-reminder", (event, reminder) => {
  const clean = sanitizeNewReminder(reminder);
  if (!clean) throw new Error("Invalid reminder");
  clean.id = uuidv4();
  storage.add(clean);
  return clean.id;
});
ipcMain.handle("update-reminder", (event, id, updates) => {
  const clean = sanitizeUpdates(updates);
  if (!clean) throw new Error("Invalid update");
  return storage.update(id, clean);
});
ipcMain.handle("archive-reminder", (event, id, expectedTime) =>
  completeReminder(id, expectedTime),
);
ipcMain.handle("delete-reminder", (event, id) => storage.delete(id));
ipcMain.handle("delete-tag", (event, tag) =>
  typeof tag === "string" && tag ? storage.removeTag(tag) : false,
);
ipcMain.handle("open-add-window", () => openAddModal());
ipcMain.handle("get-config", () => ({
  dataPath: config.dataPath || "",
  openAtLogin: config.openAtLogin !== false,
  language: lang(),
}));
ipcMain.handle("set-language", (event, value) => {
  config.language = value === "uk" ? "uk" : "en";
  Config.save(config);
  // Refresh any open alert window in the new language (no beep/flash).
  if (currentDue.length) sendAlertData(currentDue, false);
  return config.language;
});
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
  // Apply the standard backup policy to the newly-chosen folder: a brand-new
  // folder gets an "initial" snapshot; one that already holds a recent
  // same-version backup is left as-is (it is already protected).
  Backup.safeBackupOnStartup(config.dataPath, APP_VERSION);
  storage = new Storage(config.dataPath, notifyRefresh);
  scheduler.stop();
  scheduler = new Scheduler(storage, handleDue);
  scheduler.start();
  notifyRefresh();
  return config.dataPath;
});
ipcMain.handle("open-folder", async () => {
  if (!config.dataPath || !fs.existsSync(config.dataPath)) return false;
  await shell.openPath(config.dataPath);
  return true;
});
ipcMain.handle("open-backups-folder", async () => {
  if (!config.dataPath) return false;
  const dir = path.join(config.dataPath, "backups");
  // The folder normally exists (a backup is taken on launch); ensure it anyway
  // so the button always lands somewhere useful, falling back to the data folder.
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // ignore — handled by the existence check below
  }
  const target = fs.existsSync(dir) ? dir : config.dataPath;
  if (!fs.existsSync(target)) return false;
  await shell.openPath(target);
  return true;
});

// Alert-window actions
ipcMain.handle("alert:complete", (event, id, expectedTime) =>
  completeReminder(id, expectedTime),
);
ipcMain.handle("alert:snooze", (event, id, isoTime) => {
  const time = new Date(isoTime);
  if (isNaN(time.getTime())) return false;
  return storage.update(id, { time: time.toISOString() });
});
ipcMain.handle("alert:dismiss", () => {
  // Snooze every currently-due reminder briefly so the window closes but the
  // user is reminded again shortly (constant reminding until resolved).
  const until = new Date(Date.now() + DISMISS_SNOOZE_MS).toISOString();
  currentDue.forEach((r) => storage.update(r.id, { time: until }));
  closeAlertWindow();
  return true;
});
ipcMain.handle("alert:open-app", () => openMainWindow());
// "Custom…" reschedule: open the edit modal for this reminder and suppress the
// alert (so it can't float over the modal) until editing finishes.
ipcMain.handle("alert:edit", (event, id) => {
  const reminder = storage.getActive().find((r) => r.id === id);
  if (!reminder) return false;
  suppressAlert = true;
  closeAlertWindow();
  openEditModalFor(reminder);
  return true;
});
ipcMain.handle("alert:edit-done", () => {
  suppressAlert = false;
  // Force a fresh raise on the next scheduler tick if anything is still due.
  lastDueKey = "";
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

// Intentionally empty: tray app — keep the process alive (tray + scheduler)
// when all windows are hidden. Quit happens via the tray menu (before-quit).
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
