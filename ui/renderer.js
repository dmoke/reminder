var electronAPI = window.electronAPI;

if (!electronAPI) {
  console.error("renderer: electronAPI is not available");
  electronAPI = {
    getReminders: async () => [],
    getHistory: async () => [],
    openAddWindow: async () => {},
    getConfig: async () => ({ dataPath: "" }),
    chooseFolder: async () => null,
    openFolder: async () => false,
    addReminder: async () => {},
    updateReminder: async () => {},
    archiveReminder: async () => {},
    deleteReminder: async () => {},
  };
}

const activeList = document.getElementById("activeList");
const historyList = document.getElementById("historyList");
const overdueCount = document.getElementById("overdueCount");
const upcomingCount = document.getElementById("upcomingCount");
const completedCount = document.getElementById("completedCount");
const viewButtons = Array.from(document.querySelectorAll(".view-button"));

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
    const reschedule = document.createElement("button");
    reschedule.className = "card-action";
    reschedule.textContent = t("card-btn-reschedule");
    reschedule.addEventListener("click", async () => {
      const newTime = prompt(
        "New date/time (YYYY-MM-DDTHH:MM):",
        reminder.time.slice(0, 16),
      );
      if (newTime) {
        await electronAPI.updateReminder(reminder.id, {
          time: new Date(newTime).toISOString(),
        });
        loadAll();
      }
    });

    const complete = document.createElement("button");
    complete.className = "card-action";
    complete.textContent = t("card-btn-complete");
    complete.addEventListener("click", async () => {
      await electronAPI.archiveReminder(reminder.id);
      loadAll();
    });

    const snooze = document.createElement("button");
    snooze.className = "card-action";
    snooze.textContent = t("card-btn-snooze");
    snooze.addEventListener("click", async () => {
      const snoozeTime = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      await electronAPI.updateReminder(reminder.id, { time: snoozeTime });
      loadAll();
    });

    actions.append(reschedule, complete, snooze);
  }

  const remove = document.createElement("button");
  remove.className = "card-action danger";
  remove.textContent = isHistory ? t("card-btn-remove") : t("card-btn-delete");
  remove.addEventListener("click", async () => {
    await electronAPI.deleteReminder(reminder.id);
    loadAll();
  });
  actions.appendChild(remove);

  card.append(title, when, meta, actions);
  return card;
}

async function loadActive() {
  if (!activeList) return; // Guard against add-reminder window
  const reminders = await electronAPI.getReminders();
  const now = new Date();
  const upcoming = reminders
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

  if (overdueCount) overdueCount.textContent = overdue.toString();
  if (upcomingCount) upcomingCount.textContent = upcomingCountValue.toString();
}

async function loadHistory() {
  if (!historyList) return; // Guard against add-reminder window
  const history = await electronAPI.getHistory();
  const completed = history.length;
  if (completedCount) completedCount.textContent = completed.toString();
  historyList.innerHTML = "";
  history
    .slice()
    .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt))
    .forEach((item) => historyList.appendChild(createCard(item, true)));
}

async function loadConfig() {
  const config = await electronAPI.getConfig();
  const dataPathEl = document.getElementById("dataPath");
  if (dataPathEl) {
    dataPathEl.textContent = config.dataPath || "Not set";
  }
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
    "delete-btn": "Delete selected",
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
    "change-path-btn": "Change",
    "open-path-btn": "Open",
    "language-label": "Language:",
    "lang-en": "English",
    "lang-uk": "Українська",
    "add-modal-eyebrow": "New reminder",
    "add-modal-title": "Add reminder",
    "add-modal-text-label": "What do you want to remember?",
    "add-modal-text-placeholder": "Reminder text",
    "add-modal-time-label": "When should it alert?",
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
    "card-btn-reschedule": "Reschedule",
    "card-btn-complete": "Complete",
    "card-btn-snooze": "Snooze 10m",
    "card-btn-delete": "Delete",
    "card-btn-remove": "Remove",
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
    "delete-btn": "Видалити вибране",
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
    "change-path-btn": "Змінити",
    "open-path-btn": "Відкрити",
    "language-label": "Мова:",
    "lang-en": "English",
    "lang-uk": "Українська",
    "add-modal-eyebrow": "Нове нагадування",
    "add-modal-title": "Додати нагадування",
    "add-modal-text-label": "Що ви хочете запам'ятати?",
    "add-modal-text-placeholder": "Текст нагадування",
    "add-modal-time-label": "Коли це повинне спрацювати?",
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
    "card-btn-reschedule": "Перенести",
    "card-btn-complete": "Завершити",
    "card-btn-snooze": "Відкласти 10м",
    "card-btn-delete": "Видалити",
    "card-btn-remove": "Видалити",
  },
};

function t(key) {
  return translations[currentLang]?.[key] || translations.en[key] || key;
}

function updateAllTranslations() {
  // Update header
  const eyebrow = document.querySelector(".eyebrow");
  const mainTitle = document.querySelector("h1");
  const addBtn = document.getElementById("addBtn");

  if (eyebrow) eyebrow.textContent = t("eyebrow-title");
  if (mainTitle) mainTitle.textContent = t("main-title");
  if (addBtn) addBtn.textContent = t("add-btn");

  // Update status cards
  const statusCards = document.querySelectorAll(".status-card");
  const statusLabels = [
    "status-upcoming",
    "status-overdue",
    "status-completed",
  ];
  statusCards.forEach((card, i) => {
    const label = card.querySelector(".status-label");
    if (label) label.textContent = t(statusLabels[i]);
  });

  // Update navigation buttons
  const navButtons = document.querySelectorAll(".view-button");
  const navKeys = ["nav-upcoming", "nav-completed", "nav-settings"];
  navButtons.forEach((btn, i) => {
    btn.textContent = t(navKeys[i]);
  });

  // Update panels
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

  // Update delete controls
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

  // Update filter options
  const filterOptions = document.querySelectorAll("#deleteFilter option");
  const filterKeys = [
    "filter-last-hour",
    "filter-today",
    "filter-last-week",
    "filter-all-time",
  ];
  filterOptions.forEach((option, i) => {
    option.textContent = t(filterKeys[i]);
  });

  // Update settings panel
  const settingsTitle = document.querySelector(
    "#settingsPanel .panel-header h2",
  );
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
}

function updateAddModalTranslations() {
  const eyebrow = document.querySelector(".eyebrow");
  const title = document.querySelector("h1");
  if (eyebrow) eyebrow.textContent = t("add-modal-eyebrow");
  if (title) title.textContent = t("add-modal-title");

  const labels = document.querySelectorAll("label");
  const textLabel = labels[0];
  const timeLabel = labels[1];
  if (textLabel) textLabel.textContent = t("add-modal-text-label");
  if (timeLabel) timeLabel.textContent = t("add-modal-time-label");

  const textInput = document.getElementById("text");
  if (textInput) textInput.placeholder = t("add-modal-text-placeholder");

  const subLabels = document.querySelectorAll(".sub-label");
  const subLabelKeys = [
    "add-modal-year-label",
    "add-modal-month-label",
    "add-modal-day-label",
    "add-modal-hour-label",
    "add-modal-minute-label",
  ];
  subLabels.forEach((label, i) => {
    label.textContent = t(subLabelKeys[i]);
  });

  const submitBtn = document.querySelector(".primary-btn");
  if (submitBtn) submitBtn.textContent = t("add-modal-save-btn");
}

async function loadAll() {
  await loadActive();
  await loadHistory();
  await loadConfig();
}

let allReminders = [];
let allHistory = [];
let currentLang = localStorage.getItem("language") || "en";

async function loadActiveFiltered(searchTerm = "") {
  if (!activeList) return; // Guard against add-reminder window
  allReminders = await electronAPI.getReminders();
  const now = new Date();
  const filtered = searchTerm
    ? allReminders.filter((r) =>
        r.text.toLowerCase().includes(searchTerm.toLowerCase()),
      )
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

  if (overdueCount) overdueCount.textContent = overdue.toString();
  if (upcomingCount) upcomingCount.textContent = upcomingCountValue.toString();
}

async function loadHistoryFiltered(searchTerm = "") {
  if (!historyList) return; // Guard against add-reminder window
  allHistory = await electronAPI.getHistory();
  const filtered = searchTerm
    ? allHistory.filter((r) =>
        r.text.toLowerCase().includes(searchTerm.toLowerCase()),
      )
    : allHistory;
  const completed = filtered.length;
  if (completedCount) completedCount.textContent = completed.toString();
  historyList.innerHTML = "";
  filtered
    .slice()
    .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt))
    .forEach((item) => historyList.appendChild(createCard(item, true)));
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
    await loadHistoryFiltered(
      document.getElementById("historySearch")?.value || "",
    );
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
  });
});

// Initialize translations on load
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    updateAllTranslations();
  });
} else {
  updateAllTranslations();
}

viewButtons.forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.target));
});

setView("activePanel");

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
  const now = new Date();

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

  // Set default values
  yearInput.value = now.getFullYear();
  monthInput.value = String(now.getMonth() + 1).padStart(2, "0");
  dayInput.value = String(now.getDate()).padStart(2, "0");
  hourInput.value = "09";
  minuteInput.value = "00";

  // Update day of week and month name display
  function updateDateDisplay() {
    const year = parseInt(yearInput.value, 10);
    const month = parseInt(monthInput.value, 10);
    const day = parseInt(dayInput.value, 10);
    const testDate = new Date(year, month - 1, day);
    if (
      !isNaN(testDate.getTime()) &&
      month >= 1 &&
      month <= 12 &&
      day >= 1 &&
      day <= 31
    ) {
      const dayIndex = testDate.getDay();
      const dayKeys = [
        "day-sunday",
        "day-monday",
        "day-tuesday",
        "day-wednesday",
        "day-thursday",
        "day-friday",
        "day-saturday",
      ];
      if (dayOfWeekSpan) dayOfWeekSpan.textContent = t(dayKeys[dayIndex]);

      const monthIndex = month - 1;
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
      if (monthOfYearSpan && monthIndex >= 0 && monthIndex < 12)
        monthOfYearSpan.textContent = t(monthKeys[monthIndex]);
    }
  }

  // Helper to create and populate a dropdown
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

  // Populate year dropdown (current year ± 5-10)
  createDropdownOptions(
    yearDropdown,
    Array.from({ length: 16 }, (_, i) => now.getFullYear() - 5 + i),
  );

  // Populate month dropdown
  createDropdownOptions(
    monthDropdown,
    Array.from({ length: 12 }, (_, i) => i + 1),
  );

  // Populate day dropdown (1-31)
  createDropdownOptions(
    dayDropdown,
    Array.from({ length: 31 }, (_, i) => i + 1),
  );

  // Populate hour dropdown (0-23)
  createDropdownOptions(
    hourDropdown,
    Array.from({ length: 24 }, (_, i) => i),
  );

  // Populate minute dropdown (0-59, in 5-minute increments)
  createDropdownOptions(
    minuteDropdown,
    Array.from({ length: 12 }, (_, i) => i * 5),
  );

  // Helper to toggle dropdown and handle selection
  function setupDropdown(button, dropdown, input, options) {
    button.addEventListener("click", (e) => {
      e.preventDefault();
      dropdown.classList.toggle("open");
    });

    dropdown.querySelectorAll(".datetime-option").forEach((optBtn, index) => {
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

  // Close dropdowns when clicking outside
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".datetime-field")) {
      [
        yearDropdown,
        monthDropdown,
        dayDropdown,
        hourDropdown,
        minuteDropdown,
      ].forEach((d) => {
        d.classList.remove("open");
      });
    }
  });

  // Update day of week on input change
  [yearInput, monthInput, dayInput].forEach((input) => {
    input.addEventListener("input", updateDateDisplay);
  });

  // Initial date display
  updateDateDisplay();

  document
    .getElementById("addForm")
    .addEventListener("submit", async (event) => {
      event.preventDefault();
      const text = document.getElementById("text").value.trim();

      if (!text) {
        alert("Please enter a reminder text.");
        return;
      }

      let year = parseInt(yearInput.value, 10);
      let month = parseInt(monthInput.value, 10);
      let day = parseInt(dayInput.value, 10);
      let hour = parseInt(hourInput.value, 10);
      let minute = parseInt(minuteInput.value, 10);

      if (!year || year < 2026 || year > 2100) {
        alert("Please enter a valid year (2026-2100).");
        return;
      }

      if (!month || month < 1 || month > 12) {
        alert("Please enter a valid month (1-12).");
        return;
      }

      if (!day || day < 1 || day > 31) {
        alert("Please enter a valid day (1-31).");
        return;
      }

      if (isNaN(hour) || hour < 0 || hour > 23) {
        alert("Please enter a valid hour (0-23).");
        return;
      }

      if (isNaN(minute) || minute < 0 || minute > 59) {
        alert("Please enter a valid minute (0-59).");
        return;
      }

      const reminderDate = new Date(year, month - 1, day, hour, minute);
      if (isNaN(reminderDate.getTime())) {
        alert("Please enter a valid date.");
        return;
      }

      if (reminderDate <= now) {
        alert("Reminder time must be in the future.");
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
        alert("Unable to save reminder. Please try again.");
      }
    });
}

if (
  document.getElementById("remindersList") ||
  document.getElementById("activeList")
) {
  loadAll();
  updateAllTranslations();
}

if (document.getElementById("addForm")) {
  updateAddModalTranslations();
}

if (syncNowBtn) {
  syncNowBtn.addEventListener("click", () => {
    const now = new Date();

    yearInput.value = now.getFullYear();
    monthInput.value = String(now.getMonth() + 1).padStart(2, "0");
    dayInput.value = String(now.getDate()).padStart(2, "0");
    hourInput.value = String(now.getHours()).padStart(2, "0");
    minuteInput.value = String(now.getMinutes()).padStart(2, "0");

    updateDateDisplay();
  });
}
