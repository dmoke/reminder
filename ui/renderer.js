var electronAPI = window.electronAPI;

if (!electronAPI) {
  console.error("renderer: electronAPI is not available");
  electronAPI = {
    getReminders: async () => [],
    getHistory: async () => [],
    openAddWindow: async () => {},
    getConfig: async () => ({ dataPath: "", openAtLogin: true }),
    chooseFolder: async () => null,
    openFolder: async () => false,
    addReminder: async () => {},
    updateReminder: async () => {},
    archiveReminder: async () => {},
    deleteReminder: async () => {},
    setLoginItem: async () => true,
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

function activeSearchValue() {
  return document.getElementById("activeSearch")?.value || "";
}

function historySearchValue() {
  return document.getElementById("historySearch")?.value || "";
}

function setView(targetId) {
  viewButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.target === targetId);
  });
  document.querySelectorAll(".panel").forEach((panel) => {
    panel.classList.toggle("hidden", panel.id !== targetId);
  });
  loadAll();
}

function formatDate(value) {
  const date = new Date(value);
  return date.toLocaleString([], {
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

function makeEmptyState(message) {
  const el = document.createElement("div");
  el.className = "empty-state";
  el.textContent = message;
  return el;
}

// Convert a Date/ISO string into the local value expected by an
// <input type="datetime-local"> (YYYY-MM-DDTHH:MM, no timezone).
function toDatetimeLocal(value) {
  const d = new Date(value);
  if (isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

function createCard(reminder, isHistory) {
  const card = document.createElement("div");
  card.className = "card";
  const title = document.createElement("h3");
  title.textContent = reminder.text;
  const now = new Date();
  const reminderTime = new Date(reminder.time);
  const remainingMs = Math.max(0, reminderTime - now);

  const remaining = document.createElement("p");
  remaining.className = "remaining-time";
  remaining.textContent =
    remainingMs === 0
      ? t("card-due-now")
      : `${t("card-remains-prefix")} ${formatRemainingTime(remainingMs)}`;

  const when = document.createElement("p");
  when.textContent = `${t("card-due-prefix")} ${formatDate(reminder.time)}`;
  const badge = document.createElement("span");
  badge.className = "badge";

  if (isHistory) {
    badge.classList.add("completed");
    badge.textContent = reminder.completedAt
      ? `${t("card-badge-completed")} ${formatDate(reminder.completedAt)}`
      : t("card-badge-completed");
    card.classList.add("priority-low");
  } else {
    if (reminderTime < now) {
      badge.classList.add("overdue");
      badge.textContent = t("card-badge-overdue");
      card.classList.add("priority-high");
    } else {
      badge.classList.add("upcoming");
      badge.textContent = t("card-badge-upcoming");
      const hours = remainingMs / 36e5;
      if (hours < 1) {
        card.classList.add("priority-high");
      } else if (hours < 6) {
        card.classList.add("priority-medium");
      } else {
        card.classList.add("priority-low");
      }
    }
  }

  const meta = document.createElement("div");
  meta.className = "card-meta";
  meta.appendChild(badge);
  if (!isHistory) {
    meta.appendChild(remaining);
  }

  const actions = document.createElement("div");
  actions.className = "button-group";

  if (!isHistory) {
    const complete = document.createElement("button");
    complete.className = "card-action";
    complete.textContent = t("card-btn-complete");
    complete.addEventListener("click", async () => {
      await electronAPI.archiveReminder(reminder.id);
      loadAll();
    });

    const edit = document.createElement("button");
    edit.className = "card-action";
    edit.textContent = t("card-btn-edit");
    edit.addEventListener("click", () => openEditModal(reminder));

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
        // Snooze relative to the later of "now" and the reminder's scheduled
        // time, so snoozing a future reminder never pulls it earlier.
        const baseMs = isNaN(reminderTime.getTime())
          ? Date.now()
          : Math.max(Date.now(), reminderTime.getTime());
        const newTime = getSnoozeTime(new Date(baseMs), type);
        await electronAPI.updateReminder(reminder.id, { time: newTime });
        loadAll();
      });
      snoozeGroup.appendChild(btn);
    });
    actions.appendChild(snoozeGroup);
  }

  // Single delete/remove uses an inline two-step confirm so one misclick
  // cannot permanently destroy a reminder (matches the bulk-delete safety).
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
    loadAll();
  });
  actions.appendChild(remove);

  card.append(title, when, meta, actions);
  return card;
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

// In-app reschedule/edit dialog. Replaces window.prompt(), which Electron's
// renderer does not implement. Edits both the text and the date/time.
function openEditModal(reminder) {
  const existing = document.querySelector(".modal-overlay");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  const modal = document.createElement("div");
  modal.className = "modal";

  const heading = document.createElement("h2");
  heading.textContent = t("edit-title");

  const textLabel = document.createElement("label");
  textLabel.textContent = t("edit-text-label");
  const textInput = document.createElement("input");
  textInput.type = "text";
  textInput.value = reminder.text || "";

  const timeLabel = document.createElement("label");
  timeLabel.textContent = t("edit-time-label");
  const timeInput = document.createElement("input");
  timeInput.type = "datetime-local";
  timeInput.value = toDatetimeLocal(reminder.time);

  const error = document.createElement("p");
  error.className = "modal-error";

  const actions = document.createElement("div");
  actions.className = "modal-actions";
  const cancelBtn = document.createElement("button");
  cancelBtn.className = "secondary-btn";
  cancelBtn.textContent = t("modal-cancel");
  const saveBtn = document.createElement("button");
  saveBtn.className = "primary-btn";
  saveBtn.textContent = t("modal-save");
  actions.append(cancelBtn, saveBtn);

  function close() {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
  }
  function onKey(e) {
    if (e.key === "Escape") close();
  }

  cancelBtn.addEventListener("click", close);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener("keydown", onKey);

  saveBtn.addEventListener("click", async () => {
    const text = textInput.value.trim();
    if (!text) {
      error.textContent = t("alert-empty-text");
      return;
    }
    const when = new Date(timeInput.value);
    if (isNaN(when.getTime())) {
      error.textContent = t("alert-invalid-date");
      return;
    }
    if (when <= new Date()) {
      error.textContent = t("alert-past-time");
      return;
    }
    try {
      await electronAPI.updateReminder(reminder.id, {
        text,
        time: when.toISOString(),
      });
      close();
      loadAll();
    } catch (err) {
      console.error("updateReminder failed", err);
      error.textContent = t("alert-save-failed");
    }
  });

  modal.append(heading, textLabel, textInput, timeLabel, timeInput, error, actions);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  textInput.focus();
}

async function loadActiveFiltered(searchTerm = "") {
  if (!activeList) return; // Guard against add-reminder window
  allReminders = await electronAPI.getReminders();
  const now = new Date();
  const term = searchTerm.toLowerCase();
  const filtered = term
    ? allReminders.filter((r) => (r.text || "").toLowerCase().includes(term))
    : allReminders;
  const upcoming = filtered
    .slice()
    .sort((a, b) => new Date(a.time) - new Date(b.time));
  activeList.innerHTML = "";
  let overdue = 0;
  let upcomingCountValue = 0;

  upcoming.forEach((reminder) => {
    const reminderTime = new Date(reminder.time);
    if (reminderTime < now) overdue += 1;
    else upcomingCountValue += 1;
    activeList.appendChild(createCard(reminder, false));
  });

  if (!upcoming.length) {
    activeList.appendChild(
      makeEmptyState(term ? t("empty-no-results") : t("empty-active")),
    );
  }

  if (overdueCount) overdueCount.textContent = overdue.toString();
  if (upcomingCount) upcomingCount.textContent = upcomingCountValue.toString();
}

async function loadHistoryFiltered(searchTerm = "") {
  if (!historyList) return; // Guard against add-reminder window
  allHistory = await electronAPI.getHistory();
  const term = searchTerm.toLowerCase();
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
  if (dataPathEl) {
    dataPathEl.textContent = config.dataPath || t("storage-not-set");
  }
  const loginToggle = document.getElementById("loginToggle");
  if (loginToggle) {
    loginToggle.checked = config.openAtLogin !== false;
  }
}

async function loadAll() {
  await loadActiveFiltered(activeSearchValue());
  await loadHistoryFiltered(historySearchValue());
  await loadConfig();
}

// Translations object
const translations = {
  en: {
    "eyebrow-title": "Your reminders",
    "main-title": "Reminders",
    "add-btn": "+ Add Reminder",
    "status-upcoming": "Upcoming",
    "status-overdue": "Overdue",
    "status-completed": "Completed",
    "nav-upcoming": "Upcoming",
    "nav-completed": "Completed",
    "nav-settings": "Settings",
    "panel-upcoming-title": "Planned reminders",
    "panel-upcoming-desc": "Manage your upcoming tasks and reschedule quickly.",
    "search-active": "Search reminders...",
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
    "add-modal-eyebrow": "New reminder",
    "add-modal-title": "Add reminder",
    "add-modal-text-label": "What do you want to remember?",
    "add-modal-text-placeholder": "Reminder text",
    "add-modal-time-label": "When should it alert?",
    "add-modal-now-btn": "Now",
    "add-modal-year-label": "Year",
    "add-modal-month-label": "Month",
    "add-modal-day-label": "Day",
    "add-modal-hour-label": "Hour",
    "add-modal-minute-label": "Minute",
    "add-modal-save-btn": "Save reminder",
    "day-sunday": "Sunday",
    "day-monday": "Monday",
    "day-tuesday": "Tuesday",
    "day-wednesday": "Wednesday",
    "day-thursday": "Thursday",
    "day-friday": "Friday",
    "day-saturday": "Saturday",
    "month-january": "January",
    "month-february": "February",
    "month-march": "March",
    "month-april": "April",
    "month-may": "May",
    "month-june": "June",
    "month-july": "July",
    "month-august": "August",
    "month-september": "September",
    "month-october": "October",
    "month-november": "November",
    "month-december": "December",
    "card-due-now": "Due now",
    "card-due-prefix": "Due",
    "card-remains-prefix": "Remains",
    "card-badge-overdue": "Overdue",
    "card-badge-upcoming": "Upcoming",
    "card-badge-completed": "Completed",
    "card-btn-edit": "Edit",
    "card-btn-complete": "Complete",
    "card-snooze-label": "Snooze",
    "card-btn-delete": "Delete",
    "card-btn-remove": "Remove",
    "confirm-delete": "Click to confirm",
    "snooze-10m": "10m",
    "snooze-1d": "1d",
    "snooze-2d": "2d",
    "snooze-1w": "1w",
    "snooze-1m": "1mo",
    "edit-title": "Edit reminder",
    "edit-text-label": "Reminder text",
    "edit-time-label": "Date & time",
    "modal-cancel": "Cancel",
    "modal-save": "Save",
    "empty-active": "No reminders yet. Add one to get started.",
    "empty-completed": "No completed reminders yet.",
    "empty-no-results": "No reminders match your search.",
    "alert-empty-text": "Please enter a reminder text.",
    "alert-invalid-year": "Please enter a valid year.",
    "alert-invalid-month": "Please enter a valid month (1-12).",
    "alert-invalid-day": "Please enter a valid day (1-31).",
    "alert-invalid-hour": "Please enter a valid hour (0-23).",
    "alert-invalid-minute": "Please enter a valid minute (0-59).",
    "alert-invalid-date": "That date does not exist. Please check the day.",
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
    "nav-completed": "Завершені",
    "nav-settings": "Налаштування",
    "panel-upcoming-title": "Заплановані нагадування",
    "panel-upcoming-desc":
      "Керуйте своїми майбутніми завданнями та швидко переносьте їх.",
    "search-active": "Пошук нагадувань...",
    "panel-history-title": "Завершені нагадування",
    "panel-history-desc":
      "Архівні нагадування зберігаються окремо для оптимізації.",
    "search-history": "Пошук завершених...",
    "delete-history-title": "Видалити історію",
    "delete-btn": "Видалити за період",
    "delete-confirm-msg": "Ви впевнені? Цю дію неможливо скасувати.",
    "delete-confirm-btn": "Підтвердити видалення",
    "delete-cancel-btn": "Скасувати",
    "filter-last-hour": "Останню годину",
    "filter-today": "Сьогодні",
    "filter-last-week": "Останні 7 днів",
    "filter-all-time": "Весь час",
    "panel-settings-title": "Налаштування",
    "panel-settings-desc":
      "Керуйте місцезнаходженням нагадувань та видимістю папки.",
    "storage-label": "Папка даних:",
    "storage-not-set": "Не вказано",
    "change-path-btn": "Змінити",
    "open-path-btn": "Відкрити",
    "language-label": "Мова:",
    "lang-en": "English",
    "lang-uk": "Українська",
    "startup-label": "Запускати разом із Windows:",
    "add-modal-eyebrow": "Нове нагадування",
    "add-modal-title": "Додати нагадування",
    "add-modal-text-label": "Що ви хочете запам'ятати?",
    "add-modal-text-placeholder": "Текст нагадування",
    "add-modal-time-label": "Коли це повинне спрацювати?",
    "add-modal-now-btn": "Зараз",
    "add-modal-year-label": "Рік",
    "add-modal-month-label": "Місяць",
    "add-modal-day-label": "День",
    "add-modal-hour-label": "Година",
    "add-modal-minute-label": "Хвилина",
    "add-modal-save-btn": "Зберегти нагадування",
    "day-sunday": "Неділя",
    "day-monday": "Понеділок",
    "day-tuesday": "Вівторок",
    "day-wednesday": "Середа",
    "day-thursday": "Четвер",
    "day-friday": "П'ятниця",
    "day-saturday": "Субота",
    "month-january": "Січень",
    "month-february": "Лютий",
    "month-march": "Березень",
    "month-april": "Квітень",
    "month-may": "Травень",
    "month-june": "Червень",
    "month-july": "Липень",
    "month-august": "Серпень",
    "month-september": "Вересень",
    "month-october": "Жовтень",
    "month-november": "Листопад",
    "month-december": "Грудень",
    "card-due-now": "Як зараз",
    "card-due-prefix": "Потрібно",
    "card-remains-prefix": "Залишилось",
    "card-badge-overdue": "Прострочено",
    "card-badge-upcoming": "Майбутнє",
    "card-badge-completed": "Завершено",
    "card-btn-edit": "Редагувати",
    "card-btn-complete": "Завершити",
    "card-snooze-label": "Відкласти",
    "card-btn-delete": "Видалити",
    "card-btn-remove": "Видалити",
    "confirm-delete": "Натисніть, щоб підтвердити",
    "snooze-10m": "10 хв",
    "snooze-1d": "1 д",
    "snooze-2d": "2 д",
    "snooze-1w": "1 тиж",
    "snooze-1m": "1 міс",
    "edit-title": "Редагувати нагадування",
    "edit-text-label": "Текст нагадування",
    "edit-time-label": "Дата та час",
    "modal-cancel": "Скасувати",
    "modal-save": "Зберегти",
    "empty-active": "Поки що немає нагадувань. Додайте перше.",
    "empty-completed": "Поки що немає завершених нагадувань.",
    "empty-no-results": "Немає нагадувань за вашим запитом.",
    "alert-empty-text": "Будь ласка, введіть текст нагадування.",
    "alert-invalid-year": "Будь ласка, введіть коректний рік.",
    "alert-invalid-month": "Будь ласка, введіть коректний місяць (1-12).",
    "alert-invalid-day": "Будь ласка, введіть коректний день (1-31).",
    "alert-invalid-hour": "Будь ласка, введіть коректну годину (0-23).",
    "alert-invalid-minute": "Будь ласка, введіть коректну хвилину (0-59).",
    "alert-invalid-date": "Такої дати не існує. Перевірте день.",
    "alert-past-time": "Час нагадування має бути в майбутньому.",
    "alert-save-failed": "Не вдалося зберегти нагадування. Спробуйте ще раз.",
  },
};

function t(key) {
  return translations[currentLang]?.[key] || translations.en[key] || key;
}

function updateAllTranslations() {
  const eyebrow = document.querySelector(".eyebrow");
  const mainTitle = document.querySelector("h1");
  const addBtn = document.getElementById("addBtn");

  if (eyebrow) eyebrow.textContent = t("eyebrow-title");
  if (mainTitle) mainTitle.textContent = t("main-title");
  if (addBtn) addBtn.textContent = t("add-btn");

  const statusCards = document.querySelectorAll(".status-card");
  const statusLabels = ["status-upcoming", "status-overdue", "status-completed"];
  statusCards.forEach((card, i) => {
    const label = card.querySelector(".status-label");
    if (label && statusLabels[i]) label.textContent = t(statusLabels[i]);
  });

  const navButtons = document.querySelectorAll(".view-button");
  const navKeys = ["nav-upcoming", "nav-completed", "nav-settings"];
  navButtons.forEach((btn, i) => {
    if (navKeys[i]) btn.textContent = t(navKeys[i]);
  });

  const upcomingTitle = document.querySelector("#activePanel .panel-header h2");
  const upcomingDesc = document.querySelector("#activePanel .panel-header p");
  if (upcomingTitle) upcomingTitle.textContent = t("panel-upcoming-title");
  if (upcomingDesc) upcomingDesc.textContent = t("panel-upcoming-desc");

  const activeSearchInput = document.getElementById("activeSearch");
  if (activeSearchInput) activeSearchInput.placeholder = t("search-active");

  const historyTitle = document.querySelector("#historyPanel .panel-header h2");
  const historyDesc = document.querySelector("#historyPanel .panel-header p");
  if (historyTitle) historyTitle.textContent = t("panel-history-title");
  if (historyDesc) historyDesc.textContent = t("panel-history-desc");

  const historySearchInput = document.getElementById("historySearch");
  if (historySearchInput) historySearchInput.placeholder = t("search-history");

  const deleteTitle = document.querySelector(".delete-history-section h3");
  const deleteBtn = document.getElementById("deleteHistoryBtn");
  if (deleteTitle) deleteTitle.textContent = t("delete-history-title");
  if (deleteBtn) deleteBtn.textContent = t("delete-btn");

  const deleteConfirmMsg = document.querySelector(".delete-confirm p");
  if (deleteConfirmMsg) deleteConfirmMsg.textContent = t("delete-confirm-msg");

  const confirmDeleteBtn = document.getElementById("confirmDelete");
  const cancelDeleteBtn = document.getElementById("cancelDelete");
  if (confirmDeleteBtn) confirmDeleteBtn.textContent = t("delete-confirm-btn");
  if (cancelDeleteBtn) cancelDeleteBtn.textContent = t("delete-cancel-btn");

  const filterOptions = document.querySelectorAll("#deleteFilter option");
  const filterKeys = [
    "filter-last-hour",
    "filter-today",
    "filter-last-week",
    "filter-all-time",
  ];
  filterOptions.forEach((option, i) => {
    if (filterKeys[i]) option.textContent = t(filterKeys[i]);
  });

  const settingsTitle = document.querySelector("#settingsPanel .panel-header h2");
  const settingsDesc = document.querySelector("#settingsPanel .panel-header p");
  if (settingsTitle) settingsTitle.textContent = t("panel-settings-title");
  if (settingsDesc) settingsDesc.textContent = t("panel-settings-desc");

  const storageLabel = document.querySelector(".storage-card--panel p");
  if (storageLabel) storageLabel.textContent = t("storage-label");

  const changePathBtn = document.getElementById("changePathBtn");
  const openPathBtn = document.getElementById("openPathBtn");
  if (changePathBtn) changePathBtn.textContent = t("change-path-btn");
  if (openPathBtn) openPathBtn.textContent = t("open-path-btn");

  const languageLabel = document.querySelector(".language-card p");
  if (languageLabel) languageLabel.textContent = t("language-label");

  const langBtns = document.querySelectorAll(".lang-btn");
  langBtns.forEach((btn) => {
    if (btn.dataset.lang === "en") btn.textContent = t("lang-en");
    if (btn.dataset.lang === "uk") btn.textContent = t("lang-uk");
  });

  const startupLabel = document.getElementById("startupLabel");
  if (startupLabel) startupLabel.textContent = t("startup-label");
}

function updateAddModalTranslations() {
  // Only meaningful in the add-reminder window; no-op on the main window so the
  // shared lang-switch handler can call it unconditionally without clobbering
  // the main header or throwing.
  if (!document.getElementById("addForm")) return;

  const eyebrow = document.querySelector(".eyebrow");
  const title = document.querySelector("h1");
  if (eyebrow) eyebrow.textContent = t("add-modal-eyebrow");
  if (title) title.textContent = t("add-modal-title");

  const labels = document.querySelectorAll("#addForm > label, .label-row label");
  if (labels[0]) labels[0].textContent = t("add-modal-text-label");
  if (labels[1]) labels[1].textContent = t("add-modal-time-label");

  const textInput = document.getElementById("text");
  if (textInput) textInput.placeholder = t("add-modal-text-placeholder");

  const subLabels = document.querySelectorAll(".datetime-label");
  const subLabelKeys = [
    "add-modal-year-label",
    "add-modal-month-label",
    "add-modal-day-label",
    "add-modal-hour-label",
    "add-modal-minute-label",
  ];
  subLabels.forEach((label, i) => {
    if (subLabelKeys[i]) label.textContent = t(subLabelKeys[i]);
  });

  const submitBtn = document.querySelector("#addForm .primary-btn");
  if (submitBtn) submitBtn.textContent = t("add-modal-save-btn");

  const syncBtn = document.getElementById("syncNowBtn");
  if (syncBtn) syncBtn.textContent = t("add-modal-now-btn");
}

if (electronAPI.onRefreshReminders) {
  electronAPI.onRefreshReminders(() => {
    loadAll();
  });
}

// Search functionality
if (document.getElementById("activeSearch")) {
  document.getElementById("activeSearch").addEventListener("input", (e) => {
    loadActiveFiltered(e.target.value);
  });
}

if (document.getElementById("historySearch")) {
  document.getElementById("historySearch").addEventListener("input", (e) => {
    loadHistoryFiltered(e.target.value);
  });
}

// Delete history controls
if (document.getElementById("deleteHistoryBtn")) {
  const deleteHistoryBtn = document.getElementById("deleteHistoryBtn");
  const deleteConfirm = document.getElementById("deleteConfirm");
  const confirmDelete = document.getElementById("confirmDelete");
  const cancelDelete = document.getElementById("cancelDelete");
  const deleteFilter = document.getElementById("deleteFilter");

  deleteHistoryBtn.addEventListener("click", () => {
    deleteConfirm.classList.remove("hidden");
  });

  cancelDelete.addEventListener("click", () => {
    deleteConfirm.classList.add("hidden");
  });

  confirmDelete.addEventListener("click", async () => {
    const filter = deleteFilter.value;
    const now = new Date();
    let cutoffTime = now;

    if (filter === "lastHour") {
      cutoffTime = new Date(now - 60 * 60 * 1000);
    } else if (filter === "today") {
      cutoffTime = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (filter === "lastWeek") {
      cutoffTime = new Date(now - 7 * 24 * 60 * 60 * 1000);
    }

    const toDelete = allHistory.filter((item) => {
      const completedTime = new Date(item.completedAt);
      return filter === "allTime" || completedTime >= cutoffTime;
    });

    for (const item of toDelete) {
      await electronAPI.deleteReminder(item.id);
    }

    deleteConfirm.classList.add("hidden");
    await loadHistoryFiltered(historySearchValue());
  });
}

// Language selection
document.querySelectorAll(".lang-btn").forEach((btn) => {
  if (btn.dataset.lang === currentLang) {
    btn.classList.add("active");
  }
  btn.addEventListener("click", () => {
    document.querySelectorAll(".lang-btn").forEach((b) => {
      b.classList.remove("active");
    });
    btn.classList.add("active");
    currentLang = btn.dataset.lang;
    localStorage.setItem("language", currentLang);
    updateAllTranslations();
    updateAddModalTranslations();
    // Re-render lists so already-rendered card text/labels relocalize.
    loadActiveFiltered(activeSearchValue());
    loadHistoryFiltered(historySearchValue());
  });
});

// Start-with-Windows toggle
if (document.getElementById("loginToggle")) {
  document.getElementById("loginToggle").addEventListener("change", async (e) => {
    try {
      await electronAPI.setLoginItem(e.target.checked);
    } catch (error) {
      console.error("setLoginItem failed", error);
    }
  });
}

viewButtons.forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.target));
});

if (document.getElementById("addBtn")) {
  document.getElementById("addBtn").addEventListener("click", async () => {
    try {
      await electronAPI.openAddWindow();
    } catch (error) {
      console.error("openAddWindow failed", error);
    }
  });
}

if (document.getElementById("changePathBtn")) {
  document
    .getElementById("changePathBtn")
    .addEventListener("click", async () => {
      try {
        const folder = await electronAPI.chooseFolder();
        if (folder) {
          document.getElementById("dataPath").textContent = folder;
          loadAll();
        }
      } catch (error) {
        console.error("chooseFolder failed", error);
      }
    });
}

if (document.getElementById("openPathBtn")) {
  document.getElementById("openPathBtn").addEventListener("click", async () => {
    try {
      await electronAPI.openFolder();
    } catch (error) {
      console.error("openFolder failed", error);
    }
  });
}

if (document.getElementById("addForm")) {
  // Get input and dropdown elements
  const yearInput = document.getElementById("yearInput");
  const monthInput = document.getElementById("monthInput");
  const dayInput = document.getElementById("dayInput");
  const hourInput = document.getElementById("hourInput");
  const minuteInput = document.getElementById("minuteInput");

  const yearBtn = document.getElementById("yearDropdownBtn");
  const monthBtn = document.getElementById("monthDropdownBtn");
  const dayBtn = document.getElementById("dayDropdownBtn");
  const hourBtn = document.getElementById("hourDropdownBtn");
  const minuteBtn = document.getElementById("minuteDropdownBtn");

  const yearDropdown = document.getElementById("yearDropdown");
  const monthDropdown = document.getElementById("monthDropdown");
  const dayDropdown = document.getElementById("dayDropdown");
  const hourDropdown = document.getElementById("hourDropdown");
  const minuteDropdown = document.getElementById("minuteDropdown");

  const dayOfWeekSpan = document.getElementById("dayOfWeek");
  const monthOfYearSpan = document.getElementById("monthOfYear");

  const syncNowBtn = document.getElementById("syncNowBtn");

  const now = new Date();

  // Set default values
  yearInput.value = now.getFullYear();
  monthInput.value = String(now.getMonth() + 1).padStart(2, "0");
  dayInput.value = String(now.getDate()).padStart(2, "0");
  hourInput.value = "09";
  minuteInput.value = "00";

  // Update day-of-week and month-name hints, only for dates that actually exist
  // (the multi-arg Date constructor silently rolls Feb 31 into March).
  function updateDateDisplay() {
    const year = parseInt(yearInput.value, 10);
    const month = parseInt(monthInput.value, 10);
    const day = parseInt(dayInput.value, 10);
    const testDate = new Date(year, month - 1, day);
    const valid =
      !isNaN(testDate.getTime()) &&
      testDate.getFullYear() === year &&
      testDate.getMonth() === month - 1 &&
      testDate.getDate() === day;

    if (!valid) {
      if (dayOfWeekSpan) dayOfWeekSpan.textContent = "";
      if (monthOfYearSpan) monthOfYearSpan.textContent = "";
      return;
    }

    const dayKeys = [
      "day-sunday",
      "day-monday",
      "day-tuesday",
      "day-wednesday",
      "day-thursday",
      "day-friday",
      "day-saturday",
    ];
    if (dayOfWeekSpan) dayOfWeekSpan.textContent = t(dayKeys[testDate.getDay()]);

    const monthKeys = [
      "month-january",
      "month-february",
      "month-march",
      "month-april",
      "month-may",
      "month-june",
      "month-july",
      "month-august",
      "month-september",
      "month-october",
      "month-november",
      "month-december",
    ];
    if (monthOfYearSpan) monthOfYearSpan.textContent = t(monthKeys[month - 1]);
  }

  function createDropdownOptions(
    dropdown,
    values,
    formatter = (v) => String(v).padStart(2, "0"),
  ) {
    dropdown.innerHTML = "";
    values.forEach((val) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "datetime-option";
      btn.textContent = formatter(val);
      dropdown.appendChild(btn);
    });
  }

  // Year dropdown: current year through +10 (no past years offered).
  createDropdownOptions(
    yearDropdown,
    Array.from({ length: 11 }, (_, i) => now.getFullYear() + i),
  );
  createDropdownOptions(
    monthDropdown,
    Array.from({ length: 12 }, (_, i) => i + 1),
  );
  createDropdownOptions(
    dayDropdown,
    Array.from({ length: 31 }, (_, i) => i + 1),
  );
  createDropdownOptions(
    hourDropdown,
    Array.from({ length: 24 }, (_, i) => i),
  );
  // Full 0-59 minute list so it matches the free-text input and Now button.
  createDropdownOptions(
    minuteDropdown,
    Array.from({ length: 60 }, (_, i) => i),
  );

  function setupDropdown(button, dropdown, input) {
    button.addEventListener("click", (e) => {
      e.preventDefault();
      dropdown.classList.toggle("open");
    });

    dropdown.querySelectorAll(".datetime-option").forEach((optBtn) => {
      optBtn.addEventListener("click", (e) => {
        e.preventDefault();
        input.value = optBtn.textContent;
        dropdown.classList.remove("open");
        updateDateDisplay();
      });
    });
  }

  setupDropdown(yearBtn, yearDropdown, yearInput);
  setupDropdown(monthBtn, monthDropdown, monthInput);
  setupDropdown(dayBtn, dayDropdown, dayInput);
  setupDropdown(hourBtn, hourDropdown, hourInput);
  setupDropdown(minuteBtn, minuteDropdown, minuteInput);

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".datetime-field")) {
      [
        yearDropdown,
        monthDropdown,
        dayDropdown,
        hourDropdown,
        minuteDropdown,
      ].forEach((d) => d.classList.remove("open"));
    }
  });

  [yearInput, monthInput, dayInput].forEach((input) => {
    input.addEventListener("input", updateDateDisplay);
  });

  // "Now" sets the next whole minute so the value is always clearly in the
  // future and passes the submit-time guard.
  if (syncNowBtn) {
    syncNowBtn.addEventListener("click", (e) => {
      e.preventDefault();
      const soon = new Date();
      soon.setSeconds(0, 0);
      soon.setMinutes(soon.getMinutes() + 1);
      yearInput.value = soon.getFullYear();
      monthInput.value = String(soon.getMonth() + 1).padStart(2, "0");
      dayInput.value = String(soon.getDate()).padStart(2, "0");
      hourInput.value = String(soon.getHours()).padStart(2, "0");
      minuteInput.value = String(soon.getMinutes()).padStart(2, "0");
      updateDateDisplay();
    });
  }

  updateDateDisplay();

  document
    .getElementById("addForm")
    .addEventListener("submit", async (event) => {
      event.preventDefault();
      const submitNow = new Date();
      const text = document.getElementById("text").value.trim();

      if (!text) {
        alert(t("alert-empty-text"));
        return;
      }

      const year = parseInt(yearInput.value, 10);
      const month = parseInt(monthInput.value, 10);
      const day = parseInt(dayInput.value, 10);
      const hour = parseInt(hourInput.value, 10);
      const minute = parseInt(minuteInput.value, 10);

      if (!year || year < submitNow.getFullYear() || year > 2100) {
        alert(t("alert-invalid-year"));
        return;
      }
      if (!month || month < 1 || month > 12) {
        alert(t("alert-invalid-month"));
        return;
      }
      if (!day || day < 1 || day > 31) {
        alert(t("alert-invalid-day"));
        return;
      }
      if (isNaN(hour) || hour < 0 || hour > 23) {
        alert(t("alert-invalid-hour"));
        return;
      }
      if (isNaN(minute) || minute < 0 || minute > 59) {
        alert(t("alert-invalid-minute"));
        return;
      }

      const reminderDate = new Date(year, month - 1, day, hour, minute);
      // Reject impossible dates (e.g. Feb 31) which the Date constructor would
      // otherwise silently roll over into the next month.
      if (
        isNaN(reminderDate.getTime()) ||
        reminderDate.getFullYear() !== year ||
        reminderDate.getMonth() !== month - 1 ||
        reminderDate.getDate() !== day
      ) {
        alert(t("alert-invalid-date"));
        return;
      }

      if (reminderDate <= submitNow) {
        alert(t("alert-past-time"));
        return;
      }

      try {
        await electronAPI.addReminder({
          text,
          time: reminderDate.toISOString(),
          done: false,
        });
        window.close();
      } catch (error) {
        console.error("addReminder failed", error);
        alert(t("alert-save-failed"));
      }
    });
}

// Initial render
updateAllTranslations();
updateAddModalTranslations();
if (activeList) {
  setView("activePanel");
}
