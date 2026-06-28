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
    addReminder: async () => {},
    updateReminder: async () => {},
    archiveReminder: async () => {},
    deleteReminder: async () => {},
    setLoginItem: async () => true,
    setLanguage: async () => "en",
    onRefreshReminders: () => {},
    onOpenAddModal: () => {},
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
let viewMode = localStorage.getItem("viewMode") || "grid";
let favFilter = false;
let tagFilterValue = "";
let currentView = "activePanel";
let modalMode = "create"; // 'create' | 'edit' | 'duplicate'
let modalEditId = null;

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

function toDatetimeLocal(value) {
  const d = new Date(value);
  if (isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(
    d.getHours(),
  )}:${pad2(d.getMinutes())}`;
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

function formatDate(value) {
  return new Date(value).toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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
    "view-list": "☰ List",
    "view-grid": "▦ Grid",
    "panel-history-title": "Completed reminders",
    "panel-history-desc":
      "Archived reminders are stored separately for performance.",
    "search-history": "Search completed...",
    "delete-history-title": "Delete history",
    "delete-btn": "Delete in range",
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
    "modal-tags-label": "Tags (comma separated)",
    "modal-tags-ph": "work, home, urgent",
    "modal-favorite-label": "Mark as favorite",
    "modal-cancel": "Cancel",
    "modal-save": "Save",
    "quick-today": "Later today",
    "quick-tomorrow": "Tomorrow",
    "quick-weekend": "This weekend",
    "quick-nextweek": "Next week",
    "quick-morning": "🌅 Before lunch",
    "quick-midday": "🕛 Midday",
    "quick-afternoon": "🌇 Afternoon",
    "quick-evening": "🌙 Evening",
    "snooze-tomorrow": "📅 Tomorrow",
    "calendar-today": "Today",
    "calendar-more": "+{n} more",
    "empty-active": "No reminders yet. Add one to get started.",
    "empty-completed": "No completed reminders yet.",
    "empty-no-results": "No reminders match your filters.",
    "alert-empty-text": "Please enter a reminder text.",
    "alert-invalid-date": "Please choose a valid date and time.",
    "alert-past-time": "Reminder time must be in the future.",
    "alert-save-failed": "Unable to save reminder. Please try again.",
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
    "filter-all-tags": "Усі мітки",
    "filter-favorites": "★ Обрані",
    "view-list": "☰ Список",
    "view-grid": "▦ Сітка",
    "panel-history-title": "Завершені нагадування",
    "panel-history-desc":
      "Архівні нагадування зберігаються окремо для швидкодії.",
    "search-history": "Пошук завершених...",
    "delete-history-title": "Очистити історію",
    "delete-btn": "Видалити за період",
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
    "modal-tags-label": "Мітки (через кому)",
    "modal-tags-ph": "робота, дім, терміново",
    "modal-favorite-label": "Позначити як обране",
    "modal-cancel": "Скасувати",
    "modal-save": "Зберегти",
    "quick-today": "Пізніше сьогодні",
    "quick-tomorrow": "Завтра",
    "quick-weekend": "На вихідних",
    "quick-nextweek": "Наступного тижня",
    "quick-morning": "🌅 До обіду",
    "quick-midday": "🕛 Опівдні",
    "quick-afternoon": "🌇 Пополудні",
    "quick-evening": "🌙 Увечері",
    "snooze-tomorrow": "📅 Завтра",
    "calendar-today": "Сьогодні",
    "calendar-more": "+{n} ще",
    "empty-active": "Поки що немає нагадувань. Додайте перше.",
    "empty-completed": "Поки що немає завершених нагадувань.",
    "empty-no-results": "Немає нагадувань, що відповідають фільтрам.",
    "alert-empty-text": "Будь ласка, введіть текст нагадування.",
    "alert-invalid-date": "Будь ласка, виберіть коректні дату й час.",
    "alert-past-time": "Час нагадування має бути в майбутньому.",
    "alert-save-failed": "Не вдалося зберегти нагадування. Спробуйте ще раз.",
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

  const info = document.createElement("div");
  info.className = "card-info";

  const titleRow = document.createElement("div");
  titleRow.className = "card-title-row";
  const title = document.createElement("h3");
  title.className = "card-title";
  title.textContent = reminder.text;
  titleRow.appendChild(title);
  if (recurrence !== "none") {
    const recur = document.createElement("span");
    recur.className = "recur-badge";
    recur.textContent = "🔁 " + t("recur-" + recurrence);
    titleRow.appendChild(recur);
  }
  info.appendChild(titleRow);

  const when = document.createElement("p");
  when.className = "card-when";
  if (isHistory) {
    when.textContent = reminder.completedAt
      ? `${t("card-badge-completed")} · ${formatDate(reminder.completedAt)}`
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
  head.appendChild(info);

  const badge = document.createElement("span");
  badge.className = "badge";
  if (isHistory) {
    badge.classList.add("completed");
    badge.textContent = t("card-badge-completed");
  } else if (overdue) {
    badge.classList.add("overdue");
    badge.textContent = t("card-badge-overdue");
    card.classList.add("priority-high");
  } else {
    badge.classList.add("upcoming");
    badge.textContent = t("card-badge-upcoming");
    const hours = (reminderTime - now) / 36e5;
    card.classList.add(
      hours < 1 ? "priority-high" : hours < 6 ? "priority-medium" : "priority-low",
    );
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
  return card;
}

// ---- list loading + filtering ----------------------------------------------

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

async function loadActiveFiltered() {
  if (!activeList) return;
  allReminders = await electronAPI.getReminders();
  populateTagFilter();
  const now = new Date();
  const term = activeSearchValue().toLowerCase();

  const filtered = allReminders.filter((r) => {
    if (favFilter && !r.favorite) return false;
    if (tagFilterValue && !(r.tags || []).includes(tagFilterValue)) return false;
    if (term && !(r.text || "").toLowerCase().includes(term)) return false;
    return true;
  });

  const sorted = filtered
    .slice()
    .sort((a, b) => new Date(a.time) - new Date(b.time));
  activeList.innerHTML = "";
  let overdue = 0;
  let upcoming = 0;
  sorted.forEach((reminder) => {
    if (new Date(reminder.time) < now) overdue += 1;
    else upcoming += 1;
    activeList.appendChild(createCard(reminder, false));
  });
  if (!sorted.length) {
    const hasFilters = term || favFilter || tagFilterValue;
    activeList.appendChild(
      makeEmptyState(hasFilters ? t("empty-no-results") : t("empty-active")),
    );
  }
  if (overdueCount) overdueCount.textContent = overdue.toString();
  if (upcomingCount) upcomingCount.textContent = upcoming.toString();
}

async function loadHistoryFiltered() {
  if (!historyList) return;
  allHistory = await electronAPI.getHistory();
  const term = historySearchValue().toLowerCase();
  const filtered = term
    ? allHistory.filter((r) => (r.text || "").toLowerCase().includes(term))
    : allHistory;
  if (completedCount) completedCount.textContent = filtered.length.toString();
  historyList.innerHTML = "";
  const sorted = filtered
    .slice()
    .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));
  sorted.forEach((item) => historyList.appendChild(createCard(item, true)));
  if (!sorted.length) {
    historyList.appendChild(
      makeEmptyState(term ? t("empty-no-results") : t("empty-completed")),
    );
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
  const all = allReminders.concat(allHistory);
  window.ReminderCalendar.mount(container, {
    reminders: all,
    t,
    lang: currentLang,
    onSelectDate: (date) => openModal("create", { time: date.toISOString() }),
    onSelectReminder: (rem) => {
      if (rem.done || rem.completedAt) openModal("duplicate", rem);
      else openModal("edit", rem);
    },
  });
}

async function reload() {
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
    btn.className = "quick-btn";
    btn.textContent = t(key);
    btn.addEventListener("click", () => {
      const input = document.getElementById("modalTime");
      if (input) input.value = toDatetimeLocal(quickDate(kind));
    });
    wrap.appendChild(btn);
  });
}

// Set just the time-of-day on the modal's chosen date (keeps the date).
function setModalTimeOfDay(h, m) {
  const input = document.getElementById("modalTime");
  if (!input) return;
  let d = input.value ? new Date(input.value) : new Date();
  if (isNaN(d.getTime())) d = new Date();
  d.setHours(h, m, 0, 0);
  input.value = toDatetimeLocal(d);
}

function buildTimeOptions() {
  const wrap = document.getElementById("timeOptions");
  if (!wrap) return;
  wrap.innerHTML = "";
  [
    ["quick-morning", 11, 0],
    ["quick-midday", 12, 0],
    ["quick-afternoon", 17, 0],
    ["quick-evening", 21, 0],
  ].forEach(([key, h, m]) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "quick-btn";
    btn.textContent = t(key);
    btn.addEventListener("click", () => setModalTimeOfDay(h, m));
    wrap.appendChild(btn);
  });
}

function openModal(mode, reminder) {
  if (!modal) return;
  modalMode = mode;
  modalEditId = mode === "edit" ? reminder.id : null;

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
  const timeEl = document.getElementById("modalTime");
  const recEl = document.getElementById("modalRecurrence");
  const tagsEl = document.getElementById("modalTags");
  const favEl = document.getElementById("modalFavorite");
  const errEl = document.getElementById("modalError");
  if (errEl) errEl.textContent = "";

  const r = reminder || {};
  if (textEl) textEl.value = mode === "create" && !r.text ? "" : r.text || "";
  if (timeEl) {
    // Edit keeps the reminder's time; create/duplicate use the provided time or a sensible default.
    const base =
      mode === "edit" || (mode === "create" && r.time)
        ? r.time
        : mode === "duplicate"
          ? quickDate("tomorrow")
          : r.time || defaultModalTime();
    timeEl.value = toDatetimeLocal(base);
  }
  if (recEl) recEl.value = r.recurrence || "none";
  if (tagsEl) tagsEl.value = (r.tags || []).join(", ");
  if (favEl) favEl.checked = !!r.favorite;

  modal.classList.remove("hidden");
  if (textEl) textEl.focus();
}

function closeModal() {
  if (modal) modal.classList.add("hidden");
  modalEditId = null;
}

async function saveModal() {
  const errEl = document.getElementById("modalError");
  const text = (document.getElementById("modalText")?.value || "").trim();
  const timeVal = document.getElementById("modalTime")?.value || "";
  const recurrence = document.getElementById("modalRecurrence")?.value || "none";
  const tags = parseTags(document.getElementById("modalTags")?.value);
  const favorite = !!document.getElementById("modalFavorite")?.checked;

  const showError = (msg) => {
    if (errEl) errEl.textContent = msg;
  };

  if (!text) return showError(t("alert-empty-text"));
  const when = new Date(timeVal);
  if (!timeVal || isNaN(when.getTime())) return showError(t("alert-invalid-date"));
  if (when <= new Date()) return showError(t("alert-past-time"));

  const payload = { text, time: when.toISOString(), tags, favorite, recurrence };
  try {
    if (modalMode === "edit" && modalEditId) {
      await electronAPI.updateReminder(modalEditId, payload);
    } else {
      payload.done = false;
      await electronAPI.addReminder(payload);
    }
    closeModal();
    reload();
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
    const el =
      typeof sel === "string" && sel.startsWith("#")
        ? document.getElementById(sel.slice(1))
        : document.querySelector(sel);
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
  const viewListBtn = document.getElementById("viewListBtn");
  const viewGridBtn = document.getElementById("viewGridBtn");
  if (viewListBtn) viewListBtn.textContent = t("view-list");
  if (viewGridBtn) viewGridBtn.textContent = t("view-grid");

  set(".delete-history-section h3", t("delete-history-title"));
  const deleteBtn = document.getElementById("deleteHistoryBtn");
  if (deleteBtn) deleteBtn.textContent = t("delete-btn");
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
  set("#modalFavoriteLabel", t("modal-favorite-label"));
  const modalText = document.getElementById("modalText");
  if (modalText) modalText.placeholder = t("modal-text-ph");
  const modalTags = document.getElementById("modalTags");
  if (modalTags) modalTags.placeholder = t("modal-tags-ph");
  const modalCancel = document.getElementById("modalCancel");
  const modalSave = document.getElementById("modalSave");
  if (modalCancel) modalCancel.textContent = t("modal-cancel");
  if (modalSave) modalSave.textContent = t("modal-save");

  buildQuickOptions();
  buildTimeOptions();
}

// ---- event wiring ----------------------------------------------------------

if (electronAPI.onRefreshReminders) {
  electronAPI.onRefreshReminders(() => reload());
}
if (electronAPI.onOpenAddModal) {
  electronAPI.onOpenAddModal(() => openModal("create"));
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
document.getElementById("modalSave")?.addEventListener("click", saveModal);
modal?.addEventListener("click", (e) => {
  if (e.target === modal) closeModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && modal && !modal.classList.contains("hidden")) closeModal();
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

// Live countdown: re-render the active list periodically.
setInterval(() => {
  if (currentView === "activePanel") loadActiveFiltered();
}, 30000);

// ---- init ------------------------------------------------------------------

applyViewMode();
updateAllTranslations();
setView("activePanel");
