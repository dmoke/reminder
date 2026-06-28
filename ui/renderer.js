var electronAPI = window.electronAPI;

if (!electronAPI) {
  console.error("renderer: electronAPI is not available");
  electronAPI = {
    getReminders: async () => [],
    getHistory: async () => [],
    openAddWindow: async () => {},
    getConfig: async () => ({ dataPath: "", openAtLogin: true, language: "en" }),
    chooseFolder: async () => null,
    openFolder: async () => false,
    openBackupsFolder: async () => false,
    addReminder: async () => {},
    updateReminder: async () => {},
    archiveReminder: async () => {},
    deleteReminder: async () => {},
    setLoginItem: async () => true,
    setLanguage: async () => "en",
    onRefreshReminders: () => {},
    onOpenAddModal: () => {},
    onOpenEditModal: () => {},
    alertEditDone: async () => {},
    fitWindowHeight: () => {},
    getLayoutMetrics: async () => ({ zoomFactor: 1, maxContentHeight: 920 }),
    onLayoutChanged: () => {},
  };
}

const activeList = document.getElementById("activeList");
const historyList = document.getElementById("historyList");
const overdueCount = document.getElementById("overdueCount");
const upcomingCount = document.getElementById("upcomingCount");
const completedCount = document.getElementById("completedCount");
const viewButtons = Array.from(document.querySelectorAll(".view-button"));

let allReminders = [];
let allHistory = [];
let currentLang = localStorage.getItem("language") || "en";
let viewMode = localStorage.getItem("viewMode") || "list";
let favFilter = false;
let recurFilter = false;
let tagFilterValue = "";
// Calendar view has its own independent copy of the same filters.
let calFav = false;
let calRecur = false;
let calTagValue = "";
// Completed tab mirrors the active filters with its own state.
let histFav = false;
let histRecur = false;
let histTagValue = "";
// Completed-tab multi-select: ids ticked for deletion + the currently rendered
// (filtered + sorted) history list, so "Select all" knows what's on screen.
const historySelection = new Set();
let historyView = [];
// Sort state per list (key: "due" | "created" | "title").
let activeSort = { key: "due", dir: "asc" };
let histSort = { key: "due", dir: "desc" };
let currentView = "activePanel";
let modalMode = "create"; // 'create' | 'edit' | 'duplicate'
let modalEditId = null;
let modalSelectedTags = new Set();
let modalFavorite = false;
let modalEmoji = "";
// True when the edit modal was opened from the alert's "Custom…" button, so the
// main process knows to resume alerts once we're done.
let modalFromAlert = false;

// ---- tags: defaults + colors -----------------------------------------------

// Always-available starter tags so a fresh install isn't a blank slate.
const DEFAULT_TAGS = ["work", "home", "urgent"];

// Hand-picked colors for the defaults; everything else hashes into the palette.
const TAG_COLORS = {
  work: { bg: "#dbeafe", fg: "#1e40af", dot: "#3b82f6" },
  home: { bg: "#dcfce7", fg: "#166534", dot: "#22c55e" },
  urgent: { bg: "#fee2e2", fg: "#b91c1c", dot: "#ef4444" },
};
const TAG_PALETTE = [
  { bg: "#ede9fe", fg: "#6d28d9", dot: "#8b5cf6" },
  { bg: "#fce7f3", fg: "#be185d", dot: "#ec4899" },
  { bg: "#ffedd5", fg: "#c2410c", dot: "#f97316" },
  { bg: "#cffafe", fg: "#0e7490", dot: "#06b6d4" },
  { bg: "#fef9c3", fg: "#854d0e", dot: "#eab308" },
  { bg: "#e0e7ff", fg: "#4338ca", dot: "#6366f1" },
  { bg: "#fae8ff", fg: "#a21caf", dot: "#d946ef" },
  { bg: "#d1fae5", fg: "#047857", dot: "#10b981" },
];

function tagColor(tag) {
  const key = String(tag).toLowerCase();
  if (TAG_COLORS[key]) return TAG_COLORS[key];
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return TAG_PALETTE[h % TAG_PALETTE.length];
}

// Custom tags persist in localStorage so they stay pickable before they are
// attached to any reminder (the popup can create them ahead of time).
function getCustomTags() {
  try {
    const arr = JSON.parse(localStorage.getItem("customTags") || "[]");
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
function setCustomTags(arr) {
  localStorage.setItem("customTags", JSON.stringify([...new Set(arr)]));
}
function addCustomTag(tag) {
  const arr = getCustomTags();
  if (!arr.includes(tag)) {
    arr.push(tag);
    setCustomTags(arr);
  }
}
function removeCustomTag(tag) {
  setCustomTags(getCustomTags().filter((x) => x !== tag));
}

// Localized name tables for the date hints + the month dropdown.
const MONTH_NAMES = {
  en: ["January", "February", "March", "April", "May", "June", "July",
    "August", "September", "October", "November", "December"],
  uk: ["Січень", "Лютий", "Березень", "Квітень", "Травень", "Червень", "Липень",
    "Серпень", "Вересень", "Жовтень", "Листопад", "Грудень"],
};
const WEEKDAY_NAMES = {
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
  uk: ["Неділя", "Понеділок", "Вівторок", "Середа", "Четвер", "П'ятниця", "Субота"],
};
function monthName(i) {
  return (MONTH_NAMES[currentLang] || MONTH_NAMES.en)[i] || "";
}
function weekdayName(i) {
  return (WEEKDAY_NAMES[currentLang] || WEEKDAY_NAMES.en)[i] || "";
}

// ---- small helpers ---------------------------------------------------------

function activeSearchValue() {
  return document.getElementById("activeSearch")?.value || "";
}
function historySearchValue() {
  return document.getElementById("historySearch")?.value || "";
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function defaultModalTime() {
  const d = new Date();
  d.setHours(d.getHours() + 1, 0, 0, 0);
  return d;
}

function quickDate(kind) {
  const d = new Date();
  d.setSeconds(0, 0);
  if (kind === "today") {
    d.setHours(18, 0, 0, 0);
    if (d <= new Date()) {
      const h = new Date();
      h.setHours(h.getHours() + 1, 0, 0, 0);
      return h;
    }
  } else if (kind === "tomorrow") {
    d.setDate(d.getDate() + 1);
    d.setHours(12, 0, 0, 0);
  } else if (kind === "weekend") {
    let add = (6 - d.getDay() + 7) % 7;
    if (add === 0) add = 7; // upcoming Saturday
    d.setDate(d.getDate() + add);
    d.setHours(12, 0, 0, 0);
  } else if (kind === "nextweek") {
    let add = (1 - d.getDay() + 7) % 7;
    if (add === 0) add = 7; // next Monday
    d.setDate(d.getDate() + add);
    d.setHours(12, 0, 0, 0);
  }
  return d;
}

function parseTags(value) {
  return [
    ...new Set(
      String(value || "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    ),
  ];
}

function makeEmptyState(message) {
  const el = document.createElement("div");
  el.className = "empty-state";
  el.textContent = message;
  return el;
}

// ---- reminder preview modal -------------------------------------------------
// Titles are truncated to one line; clicking a card/pill opens this read-only
// preview so the full text + details are reachable, with just Close / Edit.

let previewReminder = null;

function buildPreviewBody(reminder) {
  const body = document.getElementById("previewBody");
  if (!body) return;
  body.innerHTML = "";
  const done = !!(reminder.done || reminder.completedAt);

  const title = document.createElement("h3");
  title.className = "preview-title";
  title.textContent =
    (reminder.emoji ? reminder.emoji + " " : "") + (reminder.text || "");
  body.appendChild(title);

  const when = document.createElement("p");
  when.className = "preview-when";
  if (done) {
    when.textContent = reminder.completedAt
      ? `${t("card-badge-completed")} · ${formatDate(reminder.completedAt)}`
      : t("card-badge-completed");
  } else {
    when.textContent = `${t("card-due-prefix")} ${formatDate(reminder.time)}`;
  }
  body.appendChild(when);

  if (reminder.createdAt) {
    const created = document.createElement("p");
    created.className = "preview-created";
    created.textContent = `${t("preview-created")} · ${formatDate(reminder.createdAt)}`;
    body.appendChild(created);
  }

  const recurrence = reminder.recurrence || "none";
  if (recurrence !== "none") {
    const rec = document.createElement("p");
    rec.className = "preview-recur";
    rec.textContent = "🗘 " + t("recur-" + recurrence);
    body.appendChild(rec);
  }

  if (reminder.favorite) {
    const fav = document.createElement("p");
    fav.className = "preview-fav";
    fav.textContent = "★ " + t("filter-favorites").replace("★ ", "");
    body.appendChild(fav);
  }

  const tags = reminder.tags || [];
  if (tags.length) {
    const tagsEl = document.createElement("div");
    tagsEl.className = "preview-tags";
    tags.forEach((tag) => {
      const chip = document.createElement("span");
      chip.className = "tag-chip";
      chip.textContent = "#" + tag;
      const c = tagColor(tag);
      chip.style.background = c.bg;
      chip.style.color = c.fg;
      tagsEl.appendChild(chip);
    });
    body.appendChild(tagsEl);
  }
}

function openPreview(reminder) {
  if (!reminder) return;
  previewReminder = reminder;
  buildPreviewBody(reminder);
  const editBtn = document.getElementById("previewEdit");
  if (editBtn) {
    const done = !!(reminder.done || reminder.completedAt);
    editBtn.textContent = done ? t("card-btn-duplicate") : t("card-btn-edit");
  }
  previewModal?.classList.remove("hidden");
}

function closePreview() {
  previewModal?.classList.add("hidden");
  previewReminder = null;
}

function formatDate(value) {
  return new Date(value).toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Date without the time-of-day — used for the completed list rows (the preview
// popup still shows the full date + time). Adds the year only if not this one.
function formatDateOnly(value) {
  const d = new Date(value);
  if (isNaN(d.getTime())) return "";
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(
    [],
    sameYear
      ? { weekday: "short", month: "short", day: "numeric" }
      : { weekday: "short", year: "numeric", month: "short", day: "numeric" },
  );
}

// Compact date (no time) for the "created" line; adds the year only if not this one.
function formatCreated(value) {
  const d = new Date(value);
  if (isNaN(d.getTime())) return "";
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(
    [],
    sameYear
      ? { month: "short", day: "numeric" }
      : { year: "numeric", month: "short", day: "numeric" },
  );
}

function formatRemainingTime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

// Relative time bucket for the card badge / left-border color.
// Returns: "overdue" | "today" | "week" | "month" | "year" | "later".
function timeBucket(date, now) {
  if (date < now) return "overdue";
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);
  if (date <= endOfToday) return "today";
  // Current week ends Sunday (the app treats weeks as Monday-start).
  const endOfWeek = new Date(now);
  const mondayIndex = (endOfWeek.getDay() + 6) % 7; // 0=Mon … 6=Sun
  endOfWeek.setDate(endOfWeek.getDate() + (6 - mondayIndex));
  endOfWeek.setHours(23, 59, 59, 999);
  if (date <= endOfWeek) return "week";
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  if (date <= endOfMonth) return "month";
  const endOfYear = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
  if (date <= endOfYear) return "year";
  return "later";
}

// ---- sorting ---------------------------------------------------------------

// Comparator for the sortable list headers. "due" orders by reminder time,
// which is exactly the today→week→month→year→later layer order.
function compareReminders(a, b, sort) {
  let cmp = 0;
  if (sort.key === "title") {
    cmp = (a.text || "").localeCompare(b.text || "");
  } else if (sort.key === "created") {
    cmp = new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
  } else {
    cmp = new Date(a.time) - new Date(b.time);
  }
  return sort.dir === "desc" ? -cmp : cmp;
}

const SORT_COLUMNS = [
  ["due", "sort-due"],
  ["created", "sort-created"],
  ["title", "sort-title"],
];

// Builds the clickable "column header" sort row for a list.
function renderSortHeader(containerId, sort, onChange) {
  const wrap = document.getElementById(containerId);
  if (!wrap) return;
  wrap.innerHTML = "";
  SORT_COLUMNS.forEach(([key, labelKey]) => {
    const btn = document.createElement("button");
    btn.type = "button";
    const active = sort.key === key;
    btn.className = "sort-col" + (active ? " active" : "");
    const arrow = active ? (sort.dir === "asc" ? " ▲" : " ▼") : "";
    btn.textContent = t(labelKey) + arrow;
    btn.addEventListener("click", () => {
      if (sort.key === key) {
        sort.dir = sort.dir === "asc" ? "desc" : "asc";
      } else {
        sort.key = key;
        sort.dir = "asc";
      }
      onChange();
    });
    wrap.appendChild(btn);
  });
}

// Sort headers only make sense in list view.
function syncSortHeaders() {
  const show = viewMode === "list";
  document.getElementById("activeSortHeader")?.classList.toggle("hidden", !show);
  document
    .getElementById("historySortHeader")
    ?.classList.toggle("hidden", !show);
}

function getSnoozeTime(baseDate, type) {
  const date = new Date(baseDate);
  switch (type) {
    case "10m":
      date.setMinutes(date.getMinutes() + 10);
      break;
    case "1d":
      date.setDate(date.getDate() + 1);
      break;
    case "2d":
      date.setDate(date.getDate() + 2);
      break;
    case "1w":
      date.setDate(date.getDate() + 7);
      break;
    case "1m":
      date.setMonth(date.getMonth() + 1);
      break;
  }
  return date.toISOString();
}

// ---- translations ----------------------------------------------------------

const translations = {
  en: {
    "eyebrow-title": "Your reminders",
    "main-title": "Reminders",
    "add-btn": "+ Add Reminder",
    "status-upcoming": "Upcoming",
    "status-overdue": "Overdue",
    "status-completed": "Completed",
    "nav-upcoming": "Upcoming",
    "nav-calendar": "Calendar",
    "nav-completed": "Completed",
    "nav-settings": "Settings",
    "panel-upcoming-title": "Planned reminders",
    "panel-upcoming-desc": "Manage your upcoming tasks and reschedule quickly.",
    "panel-calendar-title": "Calendar",
    "panel-calendar-desc": "See everything you have planned at a glance.",
    "search-active": "Search reminders...",
    "filter-all-tags": "All tags",
    "filter-favorites": "★ Favorites",
    "filter-repeating": "🗘 Repeating",
    "view-list": "☰ List",
    "view-grid": "▦ Grid",
    "panel-history-title": "Completed reminders",
    "panel-history-desc":
      "Archived reminders are stored separately for performance.",
    "search-history": "Search completed...",
    "delete-history-title": "Delete history",
    "delete-btn": "Delete in range",
    "delete-selected-btn": "Delete selected",
    "select-all": "Select all",
    "select-row": "Select",
    "delete-confirm-msg": "Are you sure? This action cannot be undone.",
    "delete-confirm-btn": "Confirm delete",
    "delete-cancel-btn": "Cancel",
    "filter-last-hour": "Last hour",
    "filter-today": "Today",
    "filter-last-week": "Last 7 days",
    "filter-all-time": "All time",
    "panel-settings-title": "Settings",
    "panel-settings-desc":
      "Control where reminders are stored and keep the folder visible.",
    "storage-label": "Data folder:",
    "storage-not-set": "Not set",
    "change-path-btn": "Change",
    "open-path-btn": "Open",
    "backup-label": "Backups:",
    "backup-desc":
      "Latest snapshot (reminder-backup-<date>.json), refreshed on launch and " +
      "after updates. Share it to restore your reminders.",
    "open-backups-btn": "Open backups folder",
    "language-label": "Language:",
    "lang-en": "English",
    "lang-uk": "Українська",
    "startup-label": "Start with Windows:",
    "card-due-now": "Due now",
    "card-due-prefix": "Due",
    "card-remains-prefix": "in",
    "card-badge-overdue": "Overdue",
    "card-badge-upcoming": "Upcoming",
    "card-badge-completed": "Completed",
    "bucket-overdue": "Overdue",
    "bucket-today": "Today",
    "bucket-week": "This week",
    "bucket-month": "This month",
    "bucket-year": "This year",
    "bucket-later": "Later",
    "card-created-prefix": "Created",
    "card-btn-edit": "Edit",
    "card-btn-complete": "Complete",
    "card-btn-duplicate": "Duplicate",
    "card-snooze-label": "Snooze",
    "card-btn-delete": "Delete",
    "card-btn-remove": "Remove",
    "confirm-delete": "Click to confirm",
    "snooze-10m": "10m",
    "snooze-1d": "1d",
    "snooze-2d": "2d",
    "snooze-1w": "1w",
    "snooze-1m": "1mo",
    "recur-none": "Does not repeat",
    "recur-daily": "Daily",
    "recur-weekdays": "Every weekday",
    "recur-weekly": "Weekly",
    "recur-monthly": "Monthly",
    "recur-yearly": "Yearly",
    "modal-add-title": "Add reminder",
    "modal-edit-title": "Edit reminder",
    "modal-dup-title": "Duplicate reminder",
    "modal-text-label": "Reminder text",
    "modal-text-ph": "Reminder text",
    "modal-when-label": "Date & time",
    "modal-repeat-label": "Repeat",
    "modal-tags-label": "Tags",
    "modal-tags-ph": "work, home, urgent",
    "modal-favorite-label": "Mark as favorite",
    "modal-newtag-ph": "New tag",
    "modal-addtag": "Add",
    "modal-managetags": "＋ New / manage",
    "modal-close": "Close",
    "tags-none": "No tags yet",
    "tag-mgr-title": "Manage tags",
    "tag-mgr-done": "Done",
    "tag-default-note": "Built-in tag",
    "modal-cancel": "Cancel",
    "modal-save": "Save",
    "preview-title": "Reminder",
    "preview-close": "Close",
    "preview-created": "Created",
    "sort-due": "Due",
    "sort-created": "Created",
    "sort-title": "Title",
    "dt-year": "Year",
    "dt-month": "Month",
    "dt-day": "Day",
    "dt-hour": "Hour",
    "dt-minute": "Min",
    "dt-calendar": "Calendar",
    "dt-calendar-title": "Pick from a calendar",
    "dt-now": "Now",
    "dt-now-title": "Set to the current time",
    "dt-hint-invalid": "Pick a valid date",
    "emoji-choose": "Choose emoji",
    "emoji-none": "No emoji",
    "quick-day-cap": "Jump to a day",
    "quick-time-cap": "Time of day",
    "quick-today": "Later today",
    "quick-tomorrow": "Tomorrow",
    "quick-weekend": "This weekend",
    "quick-nextweek": "Next week",
    "quick-morning": "☼ Morning",
    "quick-midday": "☀ Midday",
    "quick-afternoon": "☽ Afternoon",
    "quick-evening": "☾ Evening",
    "snooze-tomorrow": "Tomorrow",
    "calendar-today": "Today",
    "calendar-more": "+{n} more",
    "empty-active": "No reminders yet. Add one to get started.",
    "empty-completed": "No completed reminders yet.",
    "empty-no-results": "No reminders match your filters.",
    "alert-empty-text": "Please enter a reminder text.",
    "alert-invalid-date": "Please choose a valid date and time.",
    "alert-past-time": "Reminder time must be in the future.",
    "alert-save-failed": "Unable to save reminder. Please try again.",
    "toast-created": "✅ Created",
  },
  uk: {
    "eyebrow-title": "Ваші нагадування",
    "main-title": "Нагадування",
    "add-btn": "+ Додати нагадування",
    "status-upcoming": "Майбутні",
    "status-overdue": "Прострочені",
    "status-completed": "Завершені",
    "nav-upcoming": "Майбутні",
    "nav-calendar": "Календар",
    "nav-completed": "Завершені",
    "nav-settings": "Налаштування",
    "panel-upcoming-title": "Заплановані нагадування",
    "panel-upcoming-desc":
      "Керуйте майбутніми завданнями та швидко переносьте їх.",
    "panel-calendar-title": "Календар",
    "panel-calendar-desc": "Перегляньте всі свої плани одним поглядом.",
    "search-active": "Пошук нагадувань...",
    "filter-all-tags": "Усі теги",
    "filter-favorites": "★ Обрані",
    "filter-repeating": "🗘 З повтором",
    "view-list": "☰ Список",
    "view-grid": "▦ Сітка",
    "panel-history-title": "Завершені нагадування",
    "panel-history-desc":
      "Архівні нагадування зберігаються окремо для швидкодії.",
    "search-history": "Пошук завершених...",
    "delete-history-title": "Очистити історію",
    "delete-btn": "Видалити за період",
    "delete-selected-btn": "Видалити вибрані",
    "select-all": "Вибрати всі",
    "select-row": "Вибрати",
    "delete-confirm-msg": "Ви впевнені? Цю дію неможливо скасувати.",
    "delete-confirm-btn": "Підтвердити видалення",
    "delete-cancel-btn": "Скасувати",
    "filter-last-hour": "За останню годину",
    "filter-today": "Сьогодні",
    "filter-last-week": "За останні 7 днів",
    "filter-all-time": "За весь час",
    "panel-settings-title": "Налаштування",
    "panel-settings-desc":
      "Виберіть, де зберігати нагадування, і відкрийте цю папку.",
    "storage-label": "Папка з даними:",
    "storage-not-set": "Не вказано",
    "change-path-btn": "Змінити",
    "open-path-btn": "Відкрити",
    "backup-label": "Резервні копії:",
    "backup-desc":
      "Останній знімок (reminder-backup-<дата>.json), оновлюється під час " +
      "запуску та після оновлень. Поділіться ним, щоб відновити нагадування.",
    "open-backups-btn": "Відкрити папку резервних копій",
    "language-label": "Мова:",
    "lang-en": "English",
    "lang-uk": "Українська",
    "startup-label": "Запускати разом із Windows:",
    "card-due-now": "Час настав",
    "card-due-prefix": "Настане",
    "card-remains-prefix": "через",
    "card-badge-overdue": "Прострочено",
    "card-badge-upcoming": "Заплановано",
    "card-badge-completed": "Завершено",
    "bucket-overdue": "Прострочено",
    "bucket-today": "Сьогодні",
    "bucket-week": "Цього тижня",
    "bucket-month": "Цього місяця",
    "bucket-year": "Цього року",
    "bucket-later": "Пізніше",
    "card-created-prefix": "Створено",
    "card-btn-edit": "Редагувати",
    "card-btn-complete": "Виконати",
    "card-btn-duplicate": "Дублювати",
    "card-snooze-label": "Відкласти",
    "card-btn-delete": "Видалити",
    "card-btn-remove": "Видалити",
    "confirm-delete": "Натисніть, щоб підтвердити",
    "snooze-10m": "10 хв",
    "snooze-1d": "1 д",
    "snooze-2d": "2 д",
    "snooze-1w": "1 тиж",
    "snooze-1m": "1 міс",
    "recur-none": "Не повторювати",
    "recur-daily": "Щодня",
    "recur-weekdays": "Щобудня",
    "recur-weekly": "Щотижня",
    "recur-monthly": "Щомісяця",
    "recur-yearly": "Щороку",
    "modal-add-title": "Додати нагадування",
    "modal-edit-title": "Редагувати нагадування",
    "modal-dup-title": "Дублювати нагадування",
    "modal-text-label": "Текст нагадування",
    "modal-text-ph": "Текст нагадування",
    "modal-when-label": "Дата та час",
    "modal-repeat-label": "Повторення",
    "modal-tags-label": "Теги",
    "modal-tags-ph": "робота, дім, терміново",
    "modal-favorite-label": "Позначити як обране",
    "modal-newtag-ph": "Новий тег",
    "modal-addtag": "Додати",
    "modal-managetags": "＋ Новий / керувати",
    "modal-close": "Закрити",
    "tags-none": "Поки що немає тегів",
    "tag-mgr-title": "Керування тегами",
    "tag-mgr-done": "Готово",
    "tag-default-note": "Вбудований тег",
    "modal-cancel": "Скасувати",
    "modal-save": "Зберегти",
    "preview-title": "Нагадування",
    "preview-close": "Закрити",
    "preview-created": "Створено",
    "sort-due": "Термін",
    "sort-created": "Створено",
    "sort-title": "Назва",
    "dt-year": "Рік",
    "dt-month": "Місяць",
    "dt-day": "День",
    "dt-hour": "Год",
    "dt-minute": "Хв",
    "dt-calendar": "Календар",
    "dt-calendar-title": "Вибрати з календаря",
    "dt-now": "Зараз",
    "dt-now-title": "Встановити поточний час",
    "dt-hint-invalid": "Виберіть коректну дату",
    "emoji-choose": "Вибрати емодзі",
    "emoji-none": "Без емодзі",
    "quick-day-cap": "Обрати день",
    "quick-time-cap": "Час доби",
    "quick-today": "Сьогодні",
    "quick-tomorrow": "Завтра",
    "quick-weekend": "Вихідні",
    "quick-nextweek": "Наст. тиждень",
    "quick-morning": "☼ Ранок",
    "quick-midday": "☀ Опівдні",
    "quick-afternoon": "☽ Пополудні",
    "quick-evening": "☾ Увечері",
    "snooze-tomorrow": "Завтра",
    "calendar-today": "Сьогодні",
    "calendar-more": "+{n} ще",
    "empty-active": "Поки що немає нагадувань. Додайте перше.",
    "empty-completed": "Поки що немає завершених нагадувань.",
    "empty-no-results": "Немає нагадувань, що відповідають фільтрам.",
    "alert-empty-text": "Будь ласка, введіть текст нагадування.",
    "alert-invalid-date": "Будь ласка, виберіть коректні дату й час.",
    "alert-past-time": "Час нагадування має бути в майбутньому.",
    "alert-save-failed": "Не вдалося зберегти нагадування. Спробуйте ще раз.",
    "toast-created": "✅ Створено",
  },
};

function t(key) {
  return translations[currentLang]?.[key] || translations.en[key] || key;
}

// ---- card rendering --------------------------------------------------------

function createCard(reminder, isHistory) {
  const tags = reminder.tags || [];
  const recurrence = reminder.recurrence || "none";
  const now = new Date();
  const reminderTime = new Date(reminder.time);
  const overdue = !isHistory && reminderTime < now;

  const card = document.createElement("div");
  card.className = "card";
  if (isHistory) card.classList.add("card--done", "priority-low");

  const head = document.createElement("div");
  head.className = "card-head";

  if (!isHistory) {
    const fav = document.createElement("button");
    fav.className = "fav-btn" + (reminder.favorite ? " active" : "");
    fav.textContent = reminder.favorite ? "★" : "☆";
    fav.title = t("filter-favorites");
    fav.addEventListener("click", async () => {
      await electronAPI.updateReminder(reminder.id, {
        favorite: !reminder.favorite,
      });
      reload();
    });
    head.appendChild(fav);
  }

  if (isHistory) {
    // A tick box for multi-select delete on the Completed tab.
    const sel = document.createElement("input");
    sel.type = "checkbox";
    sel.className = "select-box";
    sel.title = t("select-row");
    sel.checked = historySelection.has(reminder.id);
    sel.addEventListener("change", () => {
      if (sel.checked) historySelection.add(reminder.id);
      else historySelection.delete(reminder.id);
      updateHistSelectionUI();
    });
    head.appendChild(sel);
  }

  const info = document.createElement("div");
  info.className = "card-info";

  const titleRow = document.createElement("div");
  titleRow.className = "card-title-row";
  const title = document.createElement("h3");
  title.className = "card-title card-title--clickable";
  title.textContent =
    (reminder.emoji ? reminder.emoji + " " : "") + reminder.text;
  title.title = reminder.text; // full text on hover; card stays compact
  // Click the (possibly truncated) title to read it in full + details.
  title.addEventListener("click", (e) => {
    e.stopPropagation();
    openPreview(reminder);
  });
  titleRow.appendChild(title);
  if (recurrence !== "none") {
    const recur = document.createElement("span");
    recur.className = "recur-badge";
    recur.textContent = "🗘 " + t("recur-" + recurrence);
    titleRow.appendChild(recur);
  }
  info.appendChild(titleRow);

  const when = document.createElement("p");
  when.className = "card-when";
  if (isHistory) {
    when.textContent = reminder.completedAt
      ? `${t("card-badge-completed")} · ${formatDateOnly(reminder.completedAt)}`
      : t("card-badge-completed");
  } else if (overdue) {
    when.textContent = `${t("card-badge-overdue")} · ${t("card-due-prefix")} ${formatDate(reminder.time)}`;
  } else {
    const remainingMs = Math.max(0, reminderTime - now);
    const rel =
      remainingMs === 0
        ? t("card-due-now")
        : `${t("card-remains-prefix")} ${formatRemainingTime(remainingMs)}`;
    when.textContent = `${t("card-due-prefix")} ${formatDate(reminder.time)} · ${rel}`;
  }
  info.appendChild(when);

  if (reminder.createdAt) {
    const created = document.createElement("p");
    created.className = "card-created";
    created.textContent = `${t("card-created-prefix")} ${formatCreated(reminder.createdAt)}`;
    info.appendChild(created);
  }
  head.appendChild(info);

  const badge = document.createElement("span");
  badge.className = "badge";
  if (isHistory) {
    badge.classList.add("completed");
    badge.textContent = t("card-badge-completed");
  } else {
    // Relative bucket — drives both the badge and the card's left-border color.
    const bucket = timeBucket(reminderTime, now);
    badge.classList.add("bucket-" + bucket);
    badge.textContent = t("bucket-" + bucket);
    card.classList.add("bucket-" + bucket);
  }
  head.appendChild(badge);
  card.appendChild(head);

  if (tags.length) {
    const tagsEl = document.createElement("div");
    tagsEl.className = "card-tags";
    tags.forEach((tag) => {
      const chip = document.createElement("button");
      chip.className = "tag-chip";
      chip.textContent = "#" + tag;
      const c = tagColor(tag);
      chip.style.background = c.bg;
      chip.style.color = c.fg;
      chip.addEventListener("click", () => {
        const sel = document.getElementById("tagFilter");
        if (sel) {
          tagFilterValue = tag;
          sel.value = tag;
        }
        setView("activePanel");
      });
      tagsEl.appendChild(chip);
    });
    card.appendChild(tagsEl);
  }

  const actions = document.createElement("div");
  actions.className = "button-group";

  if (!isHistory) {
    const complete = document.createElement("button");
    complete.className = "card-action";
    complete.textContent = t("card-btn-complete");
    complete.addEventListener("click", async () => {
      complete.disabled = true; // guard against rapid double-click
      await electronAPI.archiveReminder(reminder.id, reminder.time);
      reload();
    });

    const edit = document.createElement("button");
    edit.className = "card-action";
    edit.textContent = t("card-btn-edit");
    edit.addEventListener("click", () => openModal("edit", reminder));

    actions.append(complete, edit);

    const snoozeGroup = document.createElement("div");
    snoozeGroup.className = "snooze-group";
    const snoozeLabel = document.createElement("span");
    snoozeLabel.className = "snooze-label";
    snoozeLabel.textContent = t("card-snooze-label");
    snoozeGroup.appendChild(snoozeLabel);
    ["10m", "1d", "2d", "1w", "1m"].forEach((type) => {
      const btn = document.createElement("button");
      btn.className = "card-action snooze-chip";
      btn.textContent = t("snooze-" + type);
      btn.addEventListener("click", async () => {
        const baseMs = isNaN(reminderTime.getTime())
          ? Date.now()
          : Math.max(Date.now(), reminderTime.getTime());
        await electronAPI.updateReminder(reminder.id, {
          time: getSnoozeTime(new Date(baseMs), type),
        });
        reload();
      });
      snoozeGroup.appendChild(btn);
    });
    // "Tomorrow (same time)" — tomorrow at the reminder's own time-of-day.
    const tomChip = document.createElement("button");
    tomChip.className = "card-action snooze-chip";
    tomChip.textContent = t("snooze-tomorrow");
    tomChip.addEventListener("click", async () => {
      const src = isNaN(reminderTime.getTime()) ? new Date() : reminderTime;
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(src.getHours(), src.getMinutes(), 0, 0);
      await electronAPI.updateReminder(reminder.id, { time: d.toISOString() });
      reload();
    });
    snoozeGroup.appendChild(tomChip);
    actions.appendChild(snoozeGroup);
  } else {
    const dup = document.createElement("button");
    dup.className = "card-action";
    dup.textContent = t("card-btn-duplicate");
    dup.addEventListener("click", () => openModal("duplicate", reminder));
    actions.appendChild(dup);
  }

  const remove = document.createElement("button");
  remove.className = "card-action danger";
  const removeLabel = isHistory ? t("card-btn-remove") : t("card-btn-delete");
  remove.textContent = removeLabel;
  let armed = false;
  let armTimer = null;
  remove.addEventListener("click", async () => {
    if (!armed) {
      armed = true;
      remove.textContent = t("confirm-delete");
      remove.classList.add("armed");
      armTimer = setTimeout(() => {
        armed = false;
        remove.textContent = removeLabel;
        remove.classList.remove("armed");
      }, 3000);
      return;
    }
    if (armTimer) clearTimeout(armTimer);
    await electronAPI.deleteReminder(reminder.id);
    reload();
  });
  actions.appendChild(remove);

  card.appendChild(actions);

  // List view: a click on the row body (not a button/chip) expands it to reveal
  // the actions. In grid view the actions are always shown, so this is inert.
  card.addEventListener("click", (e) => {
    if (e.target.closest("button") || e.target.closest("input")) return;
    const expanded = card.classList.toggle("card--expanded");
    // The list is height-capped in list view; make sure the freshly revealed
    // actions scroll into view rather than hiding below the fold.
    if (expanded) card.scrollIntoView({ block: "nearest" });
  });

  return card;
}

// ---- list loading + filtering ----------------------------------------------

// --- window auto-fit --------------------------------------------------------
// The window grows/shrinks to fit the current list: short when there are only a
// few reminders (down to just the page chrome), capped at the window's max
// content height. Once the content would exceed the cap, the window stays put
// and the list itself scrolls (with a faded bottom edge — `.is-capped`).
//
// `maxContentHeight` (CSS px) is the cap the window can grow to on this display.
// The main process derives it from the monitor's work area + the launch zoom and
// hands it over via getLayoutMetrics(); until then we use a generous default so
// early layout passes don't over-shrink the window.
let maxContentHeight = 920;
const MIN_LIST_HEIGHT = 96; // never collapse the list below this when capped
// Stays false until the first real data load, so the early (empty-list) layout
// passes only cap the list and don't shrink the window before content exists.
let autoFitReady = false;
// True while the add/edit form modal is open: the window is pinned to its full
// height (the modal is sized in vh, so a shrunk window would crop it) and the
// auto-fit is suppressed so background reloads can't shrink it out from under.
let windowHeightLocked = false;

function visiblePanelList() {
  if (currentView === "activePanel") return activeList;
  if (currentView === "historyPanel") return historyList;
  return null; // calendar / settings have no scrolling list
}

function shellVMargin(shell) {
  const cs = getComputedStyle(shell);
  return (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0);
}

// `scrollHeight` reports a list's full content height even while it's capped, so
// we can measure (and re-cap) without ever uncapping — which means the user's
// scroll position is preserved and there's no flicker.
//
// `chrome` is the height of everything on the page except the list itself:
//   chrome = shell box + vertical margins − list's *visible* height
// and the full document height is then chrome + the list's full content.
function chromeHeight(shell, list) {
  return shell.offsetHeight + shellVMargin(shell) - list.clientHeight;
}

// Cap `list` so it occupies at most (availContent − chrome) and toggle the
// scroll-fade. No-op visual change when the content already fits.
function capListTo(list, availContent, chrome) {
  const prevScroll = list.scrollTop;
  const avail = availContent - chrome;
  if (list.scrollHeight > avail + 1) {
    list.style.maxHeight = Math.max(MIN_LIST_HEIGHT, Math.round(avail)) + "px";
    list.classList.add("is-capped");
    list.scrollTop = prevScroll; // keep position across a re-cap
  } else {
    list.style.maxHeight = "";
    list.classList.remove("is-capped");
  }
}

// Re-cap the visible list to the CURRENT window size (used on manual resize —
// does not resize the window, so it never fights the user's drag).
function capVisibleListToViewport() {
  const shell = document.querySelector(".page-shell");
  const list = visiblePanelList();
  if (!shell || !list || !list.offsetParent) return;
  capListTo(list, window.innerHeight, chromeHeight(shell, list));
}

// Size the window to fit the current content (clamped to the max), capping the
// visible list only when the content would overflow that max.
function relayout() {
  const shell = document.querySelector(".page-shell");
  if (!shell) return;
  // The calendar mounts only after its data loads, so the active/history load
  // passes run while its panel is still empty — don't shrink the window to that
  // blank panel. renderCalendar's onRendered callback re-fits once it's mounted.
  // (Skip this guard while the modal lock is active — the window must stay full.)
  if (
    !windowHeightLocked &&
    currentView === "calendarPanel" &&
    (document.getElementById("calendarContainer")?.childElementCount || 0) === 0
  ) {
    return;
  }
  const maxContent = maxContentHeight;
  const list = visiblePanelList();
  const hasList = list && list.offsetParent;
  const chrome = hasList ? chromeHeight(shell, list) : 0;

  let target;
  if (windowHeightLocked) {
    // Form modal open → keep the window full-height regardless of the list.
    target = maxContent;
  } else if (hasList) {
    target = Math.min(chrome + list.scrollHeight, maxContent); // uncapped doc height
  } else {
    target = Math.min(shell.offsetHeight + shellVMargin(shell), maxContent);
  }

  if (hasList) {
    capListTo(list, target, chrome);
  } else if (list) {
    list.style.maxHeight = "";
    list.classList.remove("is-capped");
  }

  if (autoFitReady || windowHeightLocked) {
    electronAPI.fitWindowHeight?.(Math.ceil(target));
  }
}

// Keep the list filling the window on any resize (manual drag, or the
// programmatic resize our own relayout triggers). This only re-caps the list —
// it never calls back into fitWindowHeight, so there's no resize feedback loop.
let resizeRaf = null;
window.addEventListener("resize", () => {
  if (resizeRaf) cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(capVisibleListToViewport);
});

function applyViewMode() {
  [activeList, historyList].forEach((list) => {
    if (!list) return;
    list.classList.toggle("grid-view", viewMode === "grid");
    list.classList.toggle("list-view", viewMode === "list");
  });
  const listBtn = document.getElementById("viewListBtn");
  const gridBtn = document.getElementById("viewGridBtn");
  if (listBtn) listBtn.classList.toggle("active", viewMode === "list");
  if (gridBtn) gridBtn.classList.toggle("active", viewMode === "grid");
  syncSortHeaders();
  relayout();
}

function populateTagFilter() {
  const sel = document.getElementById("tagFilter");
  if (!sel) return;
  const tags = new Set();
  allReminders.forEach((r) => (r.tags || []).forEach((tag) => tags.add(tag)));
  const sorted = [...tags].sort((a, b) => a.localeCompare(b));
  const prev = tagFilterValue;
  sel.innerHTML = "";
  const allOpt = document.createElement("option");
  allOpt.value = "";
  allOpt.textContent = t("filter-all-tags");
  sel.appendChild(allOpt);
  sorted.forEach((tag) => {
    const opt = document.createElement("option");
    opt.value = tag;
    opt.textContent = "#" + tag;
    sel.appendChild(opt);
  });
  sel.value = sorted.includes(prev) ? prev : "";
  tagFilterValue = sel.value;
}

// Calendar's own tag dropdown — same tag set, independent selection.
function populateCalTagFilter() {
  const sel = document.getElementById("calTagFilter");
  if (!sel) return;
  const tags = new Set();
  allReminders.forEach((r) => (r.tags || []).forEach((tag) => tags.add(tag)));
  allHistory.forEach((r) => (r.tags || []).forEach((tag) => tags.add(tag)));
  const sorted = [...tags].sort((a, b) => a.localeCompare(b));
  const prev = calTagValue;
  sel.innerHTML = "";
  const allOpt = document.createElement("option");
  allOpt.value = "";
  allOpt.textContent = t("filter-all-tags");
  sel.appendChild(allOpt);
  sorted.forEach((tag) => {
    const opt = document.createElement("option");
    opt.value = tag;
    opt.textContent = "#" + tag;
    sel.appendChild(opt);
  });
  sel.value = sorted.includes(prev) ? prev : "";
  calTagValue = sel.value;
}

// Completed tab's own tag dropdown.
function populateHistTagFilter() {
  const sel = document.getElementById("histTagFilter");
  if (!sel) return;
  const tags = new Set();
  allHistory.forEach((r) => (r.tags || []).forEach((tag) => tags.add(tag)));
  const sorted = [...tags].sort((a, b) => a.localeCompare(b));
  const prev = histTagValue;
  sel.innerHTML = "";
  const allOpt = document.createElement("option");
  allOpt.value = "";
  allOpt.textContent = t("filter-all-tags");
  sel.appendChild(allOpt);
  sorted.forEach((tag) => {
    const opt = document.createElement("option");
    opt.value = tag;
    opt.textContent = "#" + tag;
    sel.appendChild(opt);
  });
  sel.value = sorted.includes(prev) ? prev : "";
  histTagValue = sel.value;
}

async function loadActiveFiltered() {
  if (!activeList) return;
  allReminders = await electronAPI.getReminders();
  populateTagFilter();
  const now = new Date();
  const term = activeSearchValue().toLowerCase();

  const filtered = allReminders.filter((r) => {
    if (favFilter && !r.favorite) return false;
    if (recurFilter && (!r.recurrence || r.recurrence === "none")) return false;
    if (tagFilterValue && !(r.tags || []).includes(tagFilterValue)) return false;
    if (term && !(r.text || "").toLowerCase().includes(term)) return false;
    return true;
  });

  const sorted = filtered
    .slice()
    .sort((a, b) => compareReminders(a, b, activeSort));
  renderSortHeader("activeSortHeader", activeSort, loadActiveFiltered);
  syncSortHeaders();
  activeList.innerHTML = "";
  let overdue = 0;
  let upcoming = 0;
  sorted.forEach((reminder) => {
    if (new Date(reminder.time) < now) overdue += 1;
    else upcoming += 1;
    activeList.appendChild(createCard(reminder, false));
  });
  if (!sorted.length) {
    const hasFilters = term || favFilter || recurFilter || tagFilterValue;
    activeList.appendChild(
      makeEmptyState(hasFilters ? t("empty-no-results") : t("empty-active")),
    );
  }
  if (overdueCount) overdueCount.textContent = overdue.toString();
  if (upcomingCount) upcomingCount.textContent = upcoming.toString();
  relayout();
}

async function loadHistoryFiltered() {
  if (!historyList) return;
  allHistory = await electronAPI.getHistory();
  populateHistTagFilter();
  const term = historySearchValue().toLowerCase();
  const filtered = allHistory.filter((r) => {
    if (histFav && !r.favorite) return false;
    if (histRecur && (!r.recurrence || r.recurrence === "none")) return false;
    if (histTagValue && !(r.tags || []).includes(histTagValue)) return false;
    if (term && !(r.text || "").toLowerCase().includes(term)) return false;
    return true;
  });
  if (completedCount) completedCount.textContent = filtered.length.toString();
  renderSortHeader("historySortHeader", histSort, loadHistoryFiltered);
  syncSortHeaders();
  historyList.innerHTML = "";
  const sorted = filtered
    .slice()
    .sort((a, b) => compareReminders(a, b, histSort));
  historyView = sorted;
  // Drop ticked ids that no longer exist (e.g. deleted individually).
  const liveIds = new Set(allHistory.map((r) => r.id));
  for (const id of [...historySelection])
    if (!liveIds.has(id)) historySelection.delete(id);
  sorted.forEach((item) => historyList.appendChild(createCard(item, true)));
  if (!sorted.length) {
    const hasFilters = term || histFav || histRecur || histTagValue;
    historyList.appendChild(
      makeEmptyState(hasFilters ? t("empty-no-results") : t("empty-completed")),
    );
  }
  updateHistSelectionUI();
  relayout();
}

// Refresh the "Delete selected (N)" button and the "Select all" tri-state from
// the current selection set vs. what's on screen.
function updateHistSelectionUI() {
  const btn = document.getElementById("deleteSelectedBtn");
  const all = document.getElementById("histSelectAll");
  const n = historySelection.size;
  if (btn) {
    btn.textContent = `${t("delete-selected-btn")} (${n})`;
    btn.disabled = n === 0;
  }
  if (all) {
    const visible = historyView.map((r) => r.id);
    const picked = visible.filter((id) => historySelection.has(id)).length;
    all.checked = visible.length > 0 && picked === visible.length;
    all.indeterminate = picked > 0 && picked < visible.length;
  }
}

// Pull the window's content-height cap (CSS px) from the main process, which
// derives it from the monitor's work area and the launch zoom. Used by the
// auto-fit so the renderer's cap matches the per-display window size.
async function loadLayoutMetrics() {
  try {
    const m = await electronAPI.getLayoutMetrics?.();
    if (m && Number.isFinite(m.maxContentHeight) && m.maxContentHeight > 0) {
      maxContentHeight = m.maxContentHeight;
    }
  } catch (err) {
    console.error("getLayoutMetrics failed", err);
  }
}

async function loadConfig() {
  const config = await electronAPI.getConfig();
  const dataPathEl = document.getElementById("dataPath");
  if (dataPathEl) dataPathEl.textContent = config.dataPath || t("storage-not-set");
  const loginToggle = document.getElementById("loginToggle");
  if (loginToggle) loginToggle.checked = config.openAtLogin !== false;
}

async function renderCalendar() {
  const container = document.getElementById("calendarContainer");
  if (!container || !window.ReminderCalendar) return;
  populateCalTagFilter();
  const term = (document.getElementById("calSearch")?.value || "").toLowerCase();
  const all = allReminders.concat(allHistory).filter((r) => {
    if (calFav && !r.favorite) return false;
    if (calRecur && (!r.recurrence || r.recurrence === "none")) return false;
    if (calTagValue && !(r.tags || []).includes(calTagValue)) return false;
    if (term && !(r.text || "").toLowerCase().includes(term)) return false;
    return true;
  });
  window.ReminderCalendar.mount(container, {
    reminders: all,
    t,
    lang: currentLang,
    onSelectDate: (date) => openModal("create", { time: date.toISOString() }),
    onSelectReminder: (rem) => openPreview(rem),
    // Re-fit the window once the calendar's real height is in the DOM (it mounts
    // after its data loads, so the earlier relayout passes saw an empty panel).
    onRendered: () => relayout(),
  });
}

async function reload() {
  autoFitReady = true; // real data is loading — auto-fit may now resize the window
  await loadActiveFiltered();
  await loadHistoryFiltered();
  await loadConfig();
  if (currentView === "calendarPanel") await renderCalendar();
}

// ---- view switching --------------------------------------------------------

function setView(targetId) {
  currentView = targetId;
  viewButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.target === targetId);
  });
  document.querySelectorAll(".panel").forEach((panel) => {
    panel.classList.toggle("hidden", panel.id !== targetId);
  });
  reload();
}

// ---- add / edit / duplicate modal ------------------------------------------

const modal = document.getElementById("reminderModal");
const previewModal = document.getElementById("previewModal");

// ---- segmented date / time picker ------------------------------------------

const DT_FIELDS = ["dtYear", "dtMonth", "dtDay", "dtHour", "dtMinute"];

function dtVal(id) {
  return (document.getElementById(id)?.value || "").trim();
}

// Read the five segments into a Date. Returns an invalid Date when anything is
// missing or out of range so callers can surface a single "pick a date" error.
function readModalDate() {
  const y = parseInt(dtVal("dtYear"), 10);
  const mo = parseInt(dtVal("dtMonth"), 10);
  const d = parseInt(dtVal("dtDay"), 10);
  const h = parseInt(dtVal("dtHour"), 10);
  const mi = parseInt(dtVal("dtMinute"), 10);
  if ([y, mo, d, h, mi].some((n) => Number.isNaN(n))) return new Date(NaN);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h < 0 || h > 23 || mi < 0 || mi > 59) {
    return new Date(NaN);
  }
  const date = new Date(y, mo - 1, d, h, mi, 0, 0);
  // Reject overflow (e.g. Feb 31 rolling into March).
  if (date.getMonth() !== mo - 1 || date.getDate() !== d) return new Date(NaN);
  return date;
}

function setModalDate(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return;
  const set = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.value = v;
  };
  set("dtYear", String(d.getFullYear()));
  set("dtMonth", pad2(d.getMonth() + 1));
  set("dtDay", pad2(d.getDate()));
  set("dtHour", pad2(d.getHours()));
  set("dtMinute", pad2(d.getMinutes()));
  updateDateHint();
}

// Friendly word-format echo of the chosen day, e.g. "Saturday, 12 July 2025".
function updateDateHint() {
  const hint = document.getElementById("dtHint");
  if (!hint) return;
  const d = readModalDate();
  if (isNaN(d.getTime())) {
    hint.textContent = t("dt-hint-invalid");
    hint.classList.add("dt-hint--warn");
    return;
  }
  hint.classList.remove("dt-hint--warn");
  hint.textContent = `${weekdayName(d.getDay())}, ${d.getDate()} ${monthName(
    d.getMonth(),
  )} ${d.getFullYear()} · ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function closeDtMenus() {
  document
    .querySelectorAll(".dt-menu.open")
    .forEach((m) => m.classList.remove("open"));
}

function fillDtMenu(menuId, targetId, items) {
  const menu = document.getElementById(menuId);
  if (!menu) return;
  menu.innerHTML = "";
  items.forEach(({ label, value }) => {
    const opt = document.createElement("button");
    opt.type = "button";
    opt.className = "dt-opt";
    opt.textContent = label;
    opt.addEventListener("click", () => {
      const input = document.getElementById(targetId);
      if (input) input.value = value;
      closeDtMenus();
      updateDateHint();
    });
    menu.appendChild(opt);
  });
}

// Builds the dropdown contents. Re-run on language change so month names track.
function buildDtMenus() {
  const thisYear = new Date().getFullYear();
  fillDtMenu(
    "dtYearMenu",
    "dtYear",
    Array.from({ length: 8 }, (_, i) => {
      const y = thisYear - 1 + i;
      return { label: String(y), value: String(y) };
    }),
  );
  fillDtMenu(
    "dtMonthMenu",
    "dtMonth",
    Array.from({ length: 12 }, (_, i) => ({
      label: monthName(i),
      value: pad2(i + 1),
    })),
  );
  fillDtMenu(
    "dtDayMenu",
    "dtDay",
    Array.from({ length: 31 }, (_, i) => ({
      label: pad2(i + 1),
      value: pad2(i + 1),
    })),
  );
  fillDtMenu(
    "dtHourMenu",
    "dtHour",
    Array.from({ length: 24 }, (_, i) => ({ label: pad2(i), value: pad2(i) })),
  );
  // Minutes in 5-minute steps; the quarter-hours people actually use are here.
  fillDtMenu(
    "dtMinuteMenu",
    "dtMinute",
    Array.from({ length: 12 }, (_, i) => ({
      label: pad2(i * 5),
      value: pad2(i * 5),
    })),
  );
}

// Big presets: pick the day, keep whatever time-of-day is already chosen.
// Target calendar day a quick-day preset jumps to (time-of-day stripped).
// Shared by applyQuickDay and the button labels so the displayed day number
// always matches the day the click will choose.
function quickDayDate(kind) {
  const d = new Date();
  d.setSeconds(0, 0);
  if (kind === "tomorrow") {
    d.setDate(d.getDate() + 1);
  } else if (kind === "weekend") {
    let add = (6 - d.getDay() + 7) % 7;
    if (add === 0) add = 7;
    d.setDate(d.getDate() + add);
  } else if (kind === "nextweek") {
    let add = (1 - d.getDay() + 7) % 7;
    if (add === 0) add = 7;
    d.setDate(d.getDate() + add);
  }
  return d;
}

function applyQuickDay(kind) {
  const cur = readModalDate();
  const h = isNaN(cur.getTime()) ? 9 : cur.getHours();
  const m = isNaN(cur.getTime()) ? 0 : cur.getMinutes();
  const d = quickDayDate(kind);
  d.setHours(h, m, 0, 0);
  // "Later today" with a time already in the past → bump to the next hour.
  if (kind === "today" && d <= new Date()) {
    const next = new Date();
    next.setHours(next.getHours() + 1, 0, 0, 0);
    d.setHours(next.getHours(), 0, 0, 0);
  }
  setModalDate(d);
}

// Small presets: set just the time-of-day, keep the chosen day.
function applyQuickTime(h, m) {
  const cur = readModalDate();
  const d = isNaN(cur.getTime()) ? new Date() : cur;
  d.setHours(h, m, 0, 0);
  setModalDate(d);
}

function buildQuickOptions() {
  const wrap = document.getElementById("quickOptions");
  if (!wrap) return;
  wrap.innerHTML = "";
  [
    ["today", "quick-today"],
    ["tomorrow", "quick-tomorrow"],
    ["weekend", "quick-weekend"],
    ["nextweek", "quick-nextweek"],
  ].forEach(([kind, key]) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "quick-day";
    const dayNum = document.createElement("span");
    dayNum.className = "quick-day-num";
    dayNum.textContent = String(quickDayDate(kind).getDate()).padStart(2, "0");
    btn.appendChild(dayNum);
    btn.appendChild(document.createTextNode(t(key)));
    btn.addEventListener("click", () => applyQuickDay(kind));
    wrap.appendChild(btn);
  });
}

function buildTimeOptions() {
  const wrap = document.getElementById("timeOptions");
  if (!wrap) return;
  wrap.innerHTML = "";
  [
    ["quick-morning", 10, 0, "morning"],
    ["quick-midday", 12, 0, "midday"],
    ["quick-afternoon", 17, 0, "afternoon"],
    ["quick-evening", 21, 0, "evening"],
  ].forEach(([key, h, m, tone]) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "quick-time qt-" + tone;
    btn.textContent = t(key);
    btn.addEventListener("click", () => applyQuickTime(h, m));
    wrap.appendChild(btn);
  });
}

// ---- tags ------------------------------------------------------------------

// Defaults + custom (localStorage) + any tag in use + currently selected.
function collectKnownTags() {
  const set = new Set(DEFAULT_TAGS);
  getCustomTags().forEach((tag) => set.add(tag));
  allReminders.forEach((r) => (r.tags || []).forEach((tag) => set.add(tag)));
  allHistory.forEach((r) => (r.tags || []).forEach((tag) => set.add(tag)));
  modalSelectedTags.forEach((tag) => set.add(tag));
  return [...set].sort((a, b) => a.localeCompare(b));
}

function updateFavButton() {
  const btn = document.getElementById("modalFavBtn");
  if (!btn) return;
  btn.textContent = modalFavorite ? "★" : "☆";
  btn.classList.toggle("active", modalFavorite);
}

// ---- emoji chooser ---------------------------------------------------------

// A small curated set covering everyday reminders; no full picker needed.
const EMOJI_CHOICES = [
  "🙂",
  "📌", "✅", "📝", "⭐", "🔔", "⏰", "🔥", "❗",
  "💼", "🏠", "🛒", "💰", "📞", "📧", "💬", "📅",
  "🎉", "🎂", "🎁", "❤️", "💊", "🏥", "🏋️", "🧘",
  "🍽️", "☕", "🚗", "✈️", "📚", "💡", "🐶", "🌟",
];

function updateEmojiButton() {
  const btn = document.getElementById("modalEmojiBtn");
  if (!btn) return;
  btn.textContent = modalEmoji || "🙂";
  btn.classList.toggle("emoji-btn--empty", !modalEmoji);
}

function buildEmojiPicker() {
  const pop = document.getElementById("emojiPop");
  if (!pop) return;
  pop.innerHTML = "";

  const none = document.createElement("button");
  none.type = "button";
  none.className = "emoji-none";
  none.textContent = "✕ " + t("emoji-none");
  none.addEventListener("click", () => {
    modalEmoji = "";
    updateEmojiButton();
    closeEmojiPicker();
  });
  pop.appendChild(none);

  const grid = document.createElement("div");
  grid.className = "emoji-grid";
  EMOJI_CHOICES.forEach((emoji) => {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "emoji-cell";
    cell.textContent = emoji;
    cell.addEventListener("click", () => {
      modalEmoji = emoji;
      updateEmojiButton();
      closeEmojiPicker();
    });
    grid.appendChild(cell);
  });
  pop.appendChild(grid);
}

function openEmojiPicker() {
  const pop = document.getElementById("emojiPop");
  if (!pop) return;
  buildEmojiPicker();
  pop.classList.remove("hidden");
}
function closeEmojiPicker() {
  document.getElementById("emojiPop")?.classList.add("hidden");
}
function toggleEmojiPicker() {
  const pop = document.getElementById("emojiPop");
  if (!pop) return;
  if (pop.classList.contains("hidden")) openEmojiPicker();
  else closeEmojiPicker();
}

// Apply a tag's color to a toggle chip for both selected/unselected states.
function styleTagToggle(chip, tag, selected) {
  const c = tagColor(tag);
  chip.classList.toggle("selected", selected);
  if (selected) {
    // Selected: vivid filled pill so it clearly stands out.
    chip.style.background = c.dot;
    chip.style.borderColor = c.dot;
    chip.style.color = "#ffffff";
  } else {
    // Unselected: muted — neutral chip with just colored text + a faint
    // colored outline, so the palette isn't shouting before you pick.
    chip.style.background = "#f8fafc";
    chip.style.borderColor = c.bg;
    chip.style.color = c.fg;
  }
}

function renderModalTagChips() {
  const wrap = document.getElementById("modalTagChips");
  if (!wrap) return;
  wrap.innerHTML = "";
  collectKnownTags().forEach((tag) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "tag-toggle";
    chip.textContent = "#" + tag;
    styleTagToggle(chip, tag, modalSelectedTags.has(tag));
    chip.addEventListener("click", () => {
      if (modalSelectedTags.has(tag)) modalSelectedTags.delete(tag);
      else modalSelectedTags.add(tag);
      renderModalTagChips();
    });
    wrap.appendChild(chip);
  });
}

// ---- tag manager popup -----------------------------------------------------

const tagModal = document.getElementById("tagManagerModal");

function openTagManager() {
  if (!tagModal) return;
  renderTagManagerList();
  const input = document.getElementById("tagMgrInput");
  if (input) input.value = "";
  tagModal.classList.remove("hidden");
  if (input) input.focus();
}

function closeTagManager() {
  if (tagModal) tagModal.classList.add("hidden");
  renderModalTagChips();
}

function renderTagManagerList() {
  const list = document.getElementById("tagMgrList");
  if (!list) return;
  list.innerHTML = "";
  collectKnownTags().forEach((tag) => {
    const row = document.createElement("div");
    row.className = "tag-mgr-row";

    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "tag-toggle";
    chip.textContent = "#" + tag;
    styleTagToggle(chip, tag, modalSelectedTags.has(tag));
    chip.addEventListener("click", () => {
      if (modalSelectedTags.has(tag)) modalSelectedTags.delete(tag);
      else modalSelectedTags.add(tag);
      renderTagManagerList();
    });
    row.appendChild(chip);

    const del = document.createElement("button");
    del.type = "button";
    del.className = "tag-mgr-del";
    del.textContent = "🗑";
    if (DEFAULT_TAGS.includes(tag)) {
      del.disabled = true;
      del.title = t("tag-default-note");
    } else {
      del.title = t("card-btn-delete");
      del.addEventListener("click", async () => {
        await electronAPI.deleteTag(tag);
        removeCustomTag(tag);
        modalSelectedTags.delete(tag);
        allReminders = await electronAPI.getReminders();
        allHistory = await electronAPI.getHistory();
        renderTagManagerList();
        loadActiveFiltered();
      });
    }
    row.appendChild(del);
    list.appendChild(row);
  });
}

function addTagFromManager() {
  const input = document.getElementById("tagMgrInput");
  if (!input) return;
  const value = input.value.trim();
  if (!value) return;
  addCustomTag(value);
  modalSelectedTags.add(value);
  input.value = "";
  renderTagManagerList();
  input.focus();
}

function openModal(mode, reminder) {
  if (!modal) return;
  modalMode = mode;
  modalEditId = mode === "edit" ? reminder.id : null;
  modalFromAlert = false; // default; the alert path sets it true after opening

  const titleEl = document.getElementById("modalTitle");
  if (titleEl) {
    titleEl.textContent =
      mode === "edit"
        ? t("modal-edit-title")
        : mode === "duplicate"
          ? t("modal-dup-title")
          : t("modal-add-title");
  }

  const textEl = document.getElementById("modalText");
  const recEl = document.getElementById("modalRecurrence");
  const errEl = document.getElementById("modalError");
  if (errEl) errEl.textContent = "";

  const r = reminder || {};
  if (textEl) textEl.value = mode === "create" && !r.text ? "" : r.text || "";
  // Edit keeps the reminder's time; create/duplicate use the provided time or a sensible default.
  const base =
    mode === "edit" || (mode === "create" && r.time)
      ? r.time
      : mode === "duplicate"
        ? quickDate("tomorrow")
        : r.time || defaultModalTime();
  setModalDate(base);
  if (recEl) recEl.value = r.recurrence || "none";

  modalSelectedTags = new Set(r.tags || []);
  modalFavorite = !!r.favorite;
  modalEmoji = r.emoji || "";
  updateFavButton();
  updateEmojiButton();
  closeEmojiPicker();
  renderModalTagChips();

  modal.classList.remove("hidden");
  if (textEl) textEl.focus();
  // Pin the window to full height so the vh-sized modal isn't cropped by a
  // window the auto-fit had shrunk to a short list. relayout() does the grow
  // (and ignores autoFitReady while locked, covering a freshly-opened window).
  windowHeightLocked = true;
  relayout();
}

function closeModal() {
  closeDtMenus();
  if (modal) modal.classList.add("hidden");
  modalEditId = null;
  // Release the full-height pin and let the window shrink back to fit the list.
  windowHeightLocked = false;
  relayout();
  // If this edit came from the alert's "Custom…" button, let the main process
  // resume showing alerts (it was suppressed while editing).
  if (modalFromAlert) {
    modalFromAlert = false;
    electronAPI.alertEditDone?.();
  }
}

// Small transient pill that slides down from the top of the window.
let toastTimer = null;
function showToast(message) {
  let host = document.getElementById("toastHost");
  if (!host) {
    host = document.createElement("div");
    host.id = "toastHost";
    host.className = "toast-host";
    document.body.appendChild(host);
  }
  host.innerHTML = "";
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  host.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("show")); // animate in
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 250);
  }, 1900);
}

async function saveModal() {
  const errEl = document.getElementById("modalError");
  const text = (document.getElementById("modalText")?.value || "").trim();
  const when = readModalDate();
  const recurrence = document.getElementById("modalRecurrence")?.value || "none";
  const tags = [...modalSelectedTags];
  const favorite = modalFavorite;
  const emoji = modalEmoji;

  const showError = (msg) => {
    if (errEl) errEl.textContent = msg;
  };

  if (!text) return showError(t("alert-empty-text"));
  if (isNaN(when.getTime())) return showError(t("alert-invalid-date"));
  if (when <= new Date()) return showError(t("alert-past-time"));

  const payload = { text, time: when.toISOString(), emoji, tags, favorite, recurrence };
  const isNew = !(modalMode === "edit" && modalEditId);
  try {
    if (isNew) {
      payload.done = false;
      await electronAPI.addReminder(payload);
    } else {
      await electronAPI.updateReminder(modalEditId, payload);
    }
    closeModal();
    reload();
    if (isNew) showToast(t("toast-created"));
  } catch (err) {
    console.error("save reminder failed", err);
    showError(t("alert-save-failed"));
  }
}

// ---- translations applied to static chrome ---------------------------------

function setOptionText(selectId, valueToKey) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  Array.from(sel.options).forEach((opt) => {
    if (valueToKey[opt.value]) opt.textContent = t(valueToKey[opt.value]);
  });
}

function updateAllTranslations() {
  const set = (sel, value) => {
    // querySelector handles both plain ids ("#foo") and compound selectors
    // ("#activePanel .panel-header h2"); getElementById would choke on the latter.
    const el = document.querySelector(sel);
    if (el) el.textContent = value;
  };

  set(".eyebrow", t("eyebrow-title"));
  set("h1", t("main-title"));
  const addBtn = document.getElementById("addBtn");
  if (addBtn) addBtn.textContent = t("add-btn");

  const statusKeys = ["status-upcoming", "status-overdue", "status-completed"];
  document.querySelectorAll(".status-card").forEach((card, i) => {
    const label = card.querySelector(".status-label");
    if (label && statusKeys[i]) label.textContent = t(statusKeys[i]);
  });

  const navKeys = ["nav-upcoming", "nav-calendar", "nav-completed", "nav-settings"];
  document.querySelectorAll(".view-button").forEach((btn, i) => {
    if (navKeys[i]) btn.textContent = t(navKeys[i]);
  });

  set("#activePanel .panel-header h2", t("panel-upcoming-title"));
  set("#activePanel .panel-header p", t("panel-upcoming-desc"));
  set("#calendarPanel .panel-header h2", t("panel-calendar-title"));
  set("#calendarPanel .panel-header p", t("panel-calendar-desc"));
  set("#historyPanel .panel-header h2", t("panel-history-title"));
  set("#historyPanel .panel-header p", t("panel-history-desc"));
  set("#settingsPanel .panel-header h2", t("panel-settings-title"));
  set("#settingsPanel .panel-header p", t("panel-settings-desc"));

  const activeSearch = document.getElementById("activeSearch");
  if (activeSearch) activeSearch.placeholder = t("search-active");
  const historySearch = document.getElementById("historySearch");
  if (historySearch) historySearch.placeholder = t("search-history");

  const favBtn = document.getElementById("favFilterBtn");
  if (favBtn) favBtn.textContent = t("filter-favorites");
  const recurBtn = document.getElementById("recurFilterBtn");
  if (recurBtn) recurBtn.textContent = t("filter-repeating");

  // Calendar toolbar mirrors the list's filter labels.
  const calSearch = document.getElementById("calSearch");
  if (calSearch) calSearch.placeholder = t("search-active");
  const calFavBtn = document.getElementById("calFavBtn");
  if (calFavBtn) calFavBtn.textContent = t("filter-favorites");
  const calRecurBtn = document.getElementById("calRecurBtn");
  if (calRecurBtn) calRecurBtn.textContent = t("filter-repeating");

  // Completed-tab filter labels
  const histFavBtn = document.getElementById("histFavBtn");
  if (histFavBtn) histFavBtn.textContent = t("filter-favorites");
  const histRecurBtn = document.getElementById("histRecurBtn");
  if (histRecurBtn) histRecurBtn.textContent = t("filter-repeating");

  // Sortable column headers (re-render so their labels follow the language)
  renderSortHeader("activeSortHeader", activeSort, loadActiveFiltered);
  renderSortHeader("historySortHeader", histSort, loadHistoryFiltered);
  syncSortHeaders();

  // Preview popup
  set("#previewHeading", t("preview-title"));
  const previewCloseBtn = document.getElementById("previewCloseBtn");
  if (previewCloseBtn) previewCloseBtn.textContent = t("preview-close");
  const previewCloseX = document.getElementById("previewClose");
  if (previewCloseX) previewCloseX.title = t("modal-close");
  const previewEditBtn = document.getElementById("previewEdit");
  if (previewEditBtn) previewEditBtn.textContent = t("card-btn-edit");

  const viewListBtn = document.getElementById("viewListBtn");
  const viewGridBtn = document.getElementById("viewGridBtn");
  if (viewListBtn) viewListBtn.textContent = t("view-list");
  if (viewGridBtn) viewGridBtn.textContent = t("view-grid");

  set(".delete-history-section h3", t("delete-history-title"));
  const deleteBtn = document.getElementById("deleteHistoryBtn");
  if (deleteBtn) deleteBtn.textContent = t("delete-btn");
  const histSelectAllLabel = document.getElementById("histSelectAllLabel");
  if (histSelectAllLabel) histSelectAllLabel.textContent = t("select-all");
  updateHistSelectionUI();
  set(".delete-confirm p", t("delete-confirm-msg"));
  const confirmDeleteBtn = document.getElementById("confirmDelete");
  const cancelDeleteBtn = document.getElementById("cancelDelete");
  if (confirmDeleteBtn) confirmDeleteBtn.textContent = t("delete-confirm-btn");
  if (cancelDeleteBtn) cancelDeleteBtn.textContent = t("delete-cancel-btn");

  setOptionText("deleteFilter", {
    lastHour: "filter-last-hour",
    today: "filter-today",
    lastWeek: "filter-last-week",
    allTime: "filter-all-time",
  });
  setOptionText("modalRecurrence", {
    none: "recur-none",
    daily: "recur-daily",
    weekdays: "recur-weekdays",
    weekly: "recur-weekly",
    monthly: "recur-monthly",
    yearly: "recur-yearly",
  });

  set(".storage-card--panel p", t("storage-label"));
  const changePathBtn = document.getElementById("changePathBtn");
  const openPathBtn = document.getElementById("openPathBtn");
  if (changePathBtn) changePathBtn.textContent = t("change-path-btn");
  if (openPathBtn) openPathBtn.textContent = t("open-path-btn");
  const backupLabel = document.getElementById("backupLabel");
  if (backupLabel) backupLabel.textContent = t("backup-label");
  const backupDesc = document.getElementById("backupDesc");
  if (backupDesc) backupDesc.textContent = t("backup-desc");
  const openBackupsBtn = document.getElementById("openBackupsBtn");
  if (openBackupsBtn) openBackupsBtn.textContent = t("open-backups-btn");
  set(".language-card p", t("language-label"));
  document.querySelectorAll(".lang-btn").forEach((btn) => {
    if (btn.dataset.lang === "en") btn.textContent = t("lang-en");
    if (btn.dataset.lang === "uk") btn.textContent = t("lang-uk");
  });
  const startupLabel = document.getElementById("startupLabel");
  if (startupLabel) startupLabel.textContent = t("startup-label");

  // Modal labels
  set("#modalTextLabel", t("modal-text-label"));
  set("#modalWhenLabel", t("modal-when-label"));
  set("#modalRepeatLabel", t("modal-repeat-label"));
  set("#modalTagsLabel", t("modal-tags-label"));
  const modalText = document.getElementById("modalText");
  if (modalText) modalText.placeholder = t("modal-text-ph");
  const modalManage = document.getElementById("modalManageTags");
  if (modalManage) modalManage.textContent = t("modal-managetags");
  const modalFavBtn = document.getElementById("modalFavBtn");
  if (modalFavBtn) modalFavBtn.title = t("modal-favorite-label");
  const modalClose = document.getElementById("modalClose");
  if (modalClose) modalClose.title = t("modal-close");
  const modalCancel = document.getElementById("modalCancel");
  const modalSave = document.getElementById("modalSave");
  if (modalCancel) modalCancel.textContent = t("modal-cancel");
  if (modalSave) modalSave.textContent = t("modal-save");

  // Date / time picker chrome
  set("#dtYearCap", t("dt-year"));
  set("#dtMonthCap", t("dt-month"));
  set("#dtDayCap", t("dt-day"));
  set("#dtHourCap", t("dt-hour"));
  set("#dtMinuteCap", t("dt-minute"));
  set("#dtCalendarBtnText", t("dt-calendar"));
  set("#dtNowBtnText", t("dt-now"));
  set("#quickDayCap", t("quick-day-cap"));
  set("#quickTimeCap", t("quick-time-cap"));
  const dtCalBtn = document.getElementById("dtCalendarBtn");
  if (dtCalBtn) dtCalBtn.title = t("dt-calendar-title");
  const dtNowBtn = document.getElementById("dtNowBtn");
  if (dtNowBtn) dtNowBtn.title = t("dt-now-title");
  const emojiBtn = document.getElementById("modalEmojiBtn");
  if (emojiBtn) emojiBtn.title = t("emoji-choose");

  // Tag manager popup
  set("#tagMgrTitle", t("tag-mgr-title"));
  const tagMgrInput = document.getElementById("tagMgrInput");
  if (tagMgrInput) tagMgrInput.placeholder = t("modal-newtag-ph");
  const tagMgrAdd = document.getElementById("tagMgrAdd");
  if (tagMgrAdd) tagMgrAdd.textContent = t("modal-addtag");
  const tagMgrDone = document.getElementById("tagMgrDone");
  if (tagMgrDone) tagMgrDone.textContent = t("tag-mgr-done");
  const tagMgrClose = document.getElementById("tagMgrClose");
  if (tagMgrClose) tagMgrClose.title = t("modal-close");

  buildDtMenus();
  buildQuickOptions();
  buildTimeOptions();
  updateDateHint();
}

// ---- event wiring ----------------------------------------------------------

if (electronAPI.onRefreshReminders) {
  electronAPI.onRefreshReminders(() => reload());
}
// The window was re-fitted to a different monitor (e.g. undocked) — pull the new
// size cap + zoom and re-run the auto-fit so the layout matches the new display.
if (electronAPI.onLayoutChanged) {
  electronAPI.onLayoutChanged(async () => {
    await loadLayoutMetrics();
    relayout();
  });
}
if (electronAPI.onOpenAddModal) {
  electronAPI.onOpenAddModal(() => openModal("create"));
}
if (electronAPI.onOpenEditModal) {
  electronAPI.onOpenEditModal((reminder) => {
    if (!reminder) return;
    openModal("edit", reminder);
    modalFromAlert = true; // set after openModal (which resets it)
  });
}

document.getElementById("activeSearch")?.addEventListener("input", () => loadActiveFiltered());
document.getElementById("historySearch")?.addEventListener("input", () => loadHistoryFiltered());
document.getElementById("tagFilter")?.addEventListener("change", (e) => {
  tagFilterValue = e.target.value;
  loadActiveFiltered();
});
document.getElementById("favFilterBtn")?.addEventListener("click", (e) => {
  favFilter = !favFilter;
  e.currentTarget.dataset.active = favFilter ? "true" : "false";
  loadActiveFiltered();
});
document.getElementById("recurFilterBtn")?.addEventListener("click", (e) => {
  recurFilter = !recurFilter;
  e.currentTarget.dataset.active = recurFilter ? "true" : "false";
  loadActiveFiltered();
});

// Calendar filters (independent of the list's)
document.getElementById("calSearch")?.addEventListener("input", () => renderCalendar());
document.getElementById("calTagFilter")?.addEventListener("change", (e) => {
  calTagValue = e.target.value;
  renderCalendar();
});
document.getElementById("calFavBtn")?.addEventListener("click", (e) => {
  calFav = !calFav;
  e.currentTarget.dataset.active = calFav ? "true" : "false";
  renderCalendar();
});
document.getElementById("calRecurBtn")?.addEventListener("click", (e) => {
  calRecur = !calRecur;
  e.currentTarget.dataset.active = calRecur ? "true" : "false";
  renderCalendar();
});

// Completed-tab filters
document.getElementById("histTagFilter")?.addEventListener("change", (e) => {
  histTagValue = e.target.value;
  loadHistoryFiltered();
});
document.getElementById("histFavBtn")?.addEventListener("click", (e) => {
  histFav = !histFav;
  e.currentTarget.dataset.active = histFav ? "true" : "false";
  loadHistoryFiltered();
});
document.getElementById("histRecurBtn")?.addEventListener("click", (e) => {
  histRecur = !histRecur;
  e.currentTarget.dataset.active = histRecur ? "true" : "false";
  loadHistoryFiltered();
});
document.getElementById("viewListBtn")?.addEventListener("click", () => {
  viewMode = "list";
  localStorage.setItem("viewMode", viewMode);
  applyViewMode();
});
document.getElementById("viewGridBtn")?.addEventListener("click", () => {
  viewMode = "grid";
  localStorage.setItem("viewMode", viewMode);
  applyViewMode();
});

// Delete-history controls
if (document.getElementById("deleteHistoryBtn")) {
  const deleteConfirm = document.getElementById("deleteConfirm");
  document.getElementById("deleteHistoryBtn").addEventListener("click", () => {
    deleteConfirm.classList.remove("hidden");
  });
  document.getElementById("cancelDelete").addEventListener("click", () => {
    deleteConfirm.classList.add("hidden");
  });
  document.getElementById("confirmDelete").addEventListener("click", async () => {
    const filter = document.getElementById("deleteFilter").value;
    const now = new Date();
    let cutoff = now;
    if (filter === "lastHour") cutoff = new Date(now - 60 * 60 * 1000);
    else if (filter === "today")
      cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    else if (filter === "lastWeek")
      cutoff = new Date(now - 7 * 24 * 60 * 60 * 1000);
    const toDelete = allHistory.filter(
      (item) =>
        filter === "allTime" || new Date(item.completedAt) >= cutoff,
    );
    for (const item of toDelete) await electronAPI.deleteReminder(item.id);
    deleteConfirm.classList.add("hidden");
    await loadHistoryFiltered();
  });
}

// Completed-tab multi-select: "Select all" + "Delete selected".
const histSelectAll = document.getElementById("histSelectAll");
if (histSelectAll) {
  histSelectAll.addEventListener("change", () => {
    const select = histSelectAll.checked;
    historyView.forEach((r) => {
      if (select) historySelection.add(r.id);
      else historySelection.delete(r.id);
    });
    document
      .querySelectorAll("#historyList .select-box")
      .forEach((cb) => (cb.checked = select));
    updateHistSelectionUI();
  });
}

const deleteSelectedBtn = document.getElementById("deleteSelectedBtn");
if (deleteSelectedBtn) {
  let armed = false;
  let armTimer = null;
  const disarm = () => {
    armed = false;
    if (armTimer) clearTimeout(armTimer);
    deleteSelectedBtn.classList.remove("armed");
    updateHistSelectionUI(); // restores the "Delete selected (N)" label
  };
  deleteSelectedBtn.addEventListener("click", async () => {
    if (historySelection.size === 0) return;
    if (!armed) {
      armed = true;
      deleteSelectedBtn.classList.add("armed");
      deleteSelectedBtn.textContent = `${t("confirm-delete")} (${historySelection.size})`;
      armTimer = setTimeout(disarm, 3000);
      return;
    }
    if (armTimer) clearTimeout(armTimer);
    armed = false;
    deleteSelectedBtn.classList.remove("armed");
    for (const id of [...historySelection])
      await electronAPI.deleteReminder(id);
    historySelection.clear();
    await loadHistoryFiltered();
  });
}

// Language
document.querySelectorAll(".lang-btn").forEach((btn) => {
  if (btn.dataset.lang === currentLang) btn.classList.add("active");
  btn.addEventListener("click", () => {
    document.querySelectorAll(".lang-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentLang = btn.dataset.lang;
    localStorage.setItem("language", currentLang);
    electronAPI.setLanguage(currentLang);
    updateAllTranslations();
    reload();
  });
});

// Reconcile language on boot. The renderer's language lives in localStorage,
// but the always-on-top alert window is localized by the main process from
// config.json. Those two stores only sync when a language button is clicked,
// so they can drift (e.g. localStorage set before config.json carried a
// language) and leave the alert in the wrong language. Push the persisted
// choice to the main process once at startup so the alert always matches the UI.
electronAPI.setLanguage(currentLang);

// Login item
document.getElementById("loginToggle")?.addEventListener("change", async (e) => {
  try {
    await electronAPI.setLoginItem(e.target.checked);
  } catch (err) {
    console.error("setLoginItem failed", err);
  }
});

// Nav
viewButtons.forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.target));
});

// Add button + modal
document.getElementById("addBtn")?.addEventListener("click", () => openModal("create"));
document.getElementById("modalCancel")?.addEventListener("click", closeModal);
document.getElementById("modalClose")?.addEventListener("click", closeModal);
document.getElementById("modalSave")?.addEventListener("click", saveModal);
document.getElementById("modalFavBtn")?.addEventListener("click", () => {
  modalFavorite = !modalFavorite;
  updateFavButton();
});
document.getElementById("modalManageTags")?.addEventListener("click", openTagManager);
modal?.addEventListener("click", (e) => {
  if (e.target === modal) closeModal();
});

// Reminder preview popup wiring
document.getElementById("previewClose")?.addEventListener("click", closePreview);
document.getElementById("previewCloseBtn")?.addEventListener("click", closePreview);
document.getElementById("previewEdit")?.addEventListener("click", () => {
  const r = previewReminder;
  closePreview();
  if (!r) return;
  if (r.done || r.completedAt) openModal("duplicate", r);
  else openModal("edit", r);
});
previewModal?.addEventListener("click", (e) => {
  if (e.target === previewModal) closePreview();
});

// Tag manager popup wiring
document.getElementById("tagMgrAdd")?.addEventListener("click", addTagFromManager);
document.getElementById("tagMgrInput")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    addTagFromManager();
  }
});
document.getElementById("tagMgrDone")?.addEventListener("click", closeTagManager);
document.getElementById("tagMgrClose")?.addEventListener("click", closeTagManager);
tagModal?.addEventListener("click", (e) => {
  if (e.target === tagModal) closeTagManager();
});

// Emoji chooser
document.getElementById("modalEmojiBtn")?.addEventListener("click", (e) => {
  e.stopPropagation();
  toggleEmojiPicker();
});
document.addEventListener("click", (e) => {
  if (!e.target.closest(".text-row")) closeEmojiPicker();
});

// "Now": sync the picker to the current time.
document.getElementById("dtNowBtn")?.addEventListener("click", () => {
  setModalDate(new Date());
});

// Date / time picker: caret menus, typing, and the calendar fallback.
document.querySelectorAll(".dt-caret").forEach((btn) => {
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    const menu = btn.closest(".dt-field")?.querySelector(".dt-menu");
    const wasOpen = menu?.classList.contains("open");
    closeDtMenus();
    if (menu && !wasOpen) menu.classList.add("open");
  });
});
DT_FIELDS.forEach((id) => {
  document.getElementById(id)?.addEventListener("input", updateDateHint);
});
document.addEventListener("click", (e) => {
  if (!e.target.closest(".dt-field")) closeDtMenus();
});
const dtCalInput = document.getElementById("dtCalendarInput");
document.getElementById("dtCalendarBtn")?.addEventListener("click", () => {
  if (!dtCalInput) return;
  const cur = readModalDate();
  if (!isNaN(cur.getTime())) {
    dtCalInput.value = `${cur.getFullYear()}-${pad2(cur.getMonth() + 1)}-${pad2(cur.getDate())}`;
  }
  try {
    if (typeof dtCalInput.showPicker === "function") dtCalInput.showPicker();
    else dtCalInput.click();
  } catch {
    dtCalInput.click();
  }
});
dtCalInput?.addEventListener("change", () => {
  if (!dtCalInput.value) return;
  const [y, mo, d] = dtCalInput.value.split("-").map((n) => parseInt(n, 10));
  const cur = readModalDate();
  const h = isNaN(cur.getTime()) ? 9 : cur.getHours();
  const mi = isNaN(cur.getTime()) ? 0 : cur.getMinutes();
  setModalDate(new Date(y, mo - 1, d, h, mi, 0, 0));
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  const emojiOpen = !document
    .getElementById("emojiPop")
    ?.classList.contains("hidden");
  if (tagModal && !tagModal.classList.contains("hidden")) {
    closeTagManager();
  } else if (emojiOpen) {
    closeEmojiPicker();
  } else if (document.querySelector(".dt-menu.open")) {
    closeDtMenus();
  } else if (previewModal && !previewModal.classList.contains("hidden")) {
    closePreview();
  } else if (modal && !modal.classList.contains("hidden")) {
    closeModal();
  }
});

// Settings folder controls
document.getElementById("changePathBtn")?.addEventListener("click", async () => {
  try {
    const folder = await electronAPI.chooseFolder();
    if (folder) {
      document.getElementById("dataPath").textContent = folder;
      reload();
    }
  } catch (err) {
    console.error("chooseFolder failed", err);
  }
});
document.getElementById("openPathBtn")?.addEventListener("click", async () => {
  try {
    await electronAPI.openFolder();
  } catch (err) {
    console.error("openFolder failed", err);
  }
});
document.getElementById("openBackupsBtn")?.addEventListener("click", async () => {
  try {
    await electronAPI.openBackupsFolder();
  } catch (err) {
    console.error("openBackupsFolder failed", err);
  }
});

// Live countdown: re-render the active list periodically.
setInterval(() => {
  if (currentView === "activePanel") loadActiveFiltered();
}, 30000);

// ---- init ------------------------------------------------------------------

applyViewMode();
updateAllTranslations();
// Fetch the display-derived size cap before the first layout pass so the window
// auto-fits to this monitor from the start.
loadLayoutMetrics().finally(() => setView("activePanel"));
