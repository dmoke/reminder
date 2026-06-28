/* ui/calendar.js
 * MODULE B — Calendar month view
 * Exposes: window.ReminderCalendar = { mount(container, options) }
 *   options = {
 *     reminders: Reminder[],        // COMBINED list (active + history)
 *     t: (key) => string,           // i18n helper (used only for UI labels we add)
 *     lang: 'en' | 'uk',            // for Intl localization of weekday/month names
 *     onSelectDate: (Date) => void, // clicked empty day space -> Date at that day, noon
 *     onSelectReminder: (reminder) => void, // clicked a pill
 *   }
 *
 * Pure vanilla DOM. No deps, no modules, no inline event handlers.
 * Week starts Monday. 6 week rows. Up to 3 pills per day + "+N more".
 */
(function () {
  "use strict";

  var MAX_PILLS = 3;

  // Module-level state: preserve the currently-viewed month across re-mounts.
  // Initialized to the first day of the current month.
  var currentMonth = startOfMonth(new Date());

  // Fallback labels in case the passed t() returns the key unchanged.
  var FALLBACKS = {
    "calendar-today": "Today",
    "calendar-more": "+{n} more",
  };

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------
  function mount(container, options) {
    if (!container) return;

    options = options || {};
    var reminders = Array.isArray(options.reminders) ? options.reminders : [];
    var lang = options.lang || "en";
    var t = makeTranslator(options.t);
    var onSelectDate =
      typeof options.onSelectDate === "function" ? options.onSelectDate : noop;
    var onSelectReminder =
      typeof options.onSelectReminder === "function"
        ? options.onSelectReminder
        : noop;

    // Clear container so mount() is safe to call repeatedly.
    container.textContent = "";

    var root = el("div", "cal-root");

    // ---- Header (nav + label + Today) ----
    var header = el("div", "cal-header");

    var navGroup = el("div", "cal-nav-group");
    var prevBtn = el("button", "cal-nav-btn");
    prevBtn.type = "button";
    prevBtn.textContent = "◀"; // ◀
    prevBtn.setAttribute("aria-label", "Previous month");
    prevBtn.addEventListener("click", function () {
      currentMonth = addMonths(currentMonth, -1);
      mount(container, options);
    });

    var nextBtn = el("button", "cal-nav-btn");
    nextBtn.type = "button";
    nextBtn.textContent = "▶"; // ▶
    nextBtn.setAttribute("aria-label", "Next month");
    nextBtn.addEventListener("click", function () {
      currentMonth = addMonths(currentMonth, 1);
      mount(container, options);
    });

    var label = el("div", "cal-month-label");
    label.textContent = formatMonthYear(currentMonth, lang);

    navGroup.appendChild(prevBtn);
    navGroup.appendChild(label);
    navGroup.appendChild(nextBtn);

    var todayBtn = el("button", "cal-today-btn");
    todayBtn.type = "button";
    todayBtn.textContent = t("calendar-today");
    todayBtn.addEventListener("click", function () {
      currentMonth = startOfMonth(new Date());
      mount(container, options);
    });

    header.appendChild(navGroup);
    header.appendChild(todayBtn);
    root.appendChild(header);

    // ---- Weekday header row (Monday-start) ----
    var grid = el("div", "cal-grid");
    var weekdayNames = getWeekdayNames(lang); // Mon..Sun
    var weekdayRow = el("div", "cal-weekday-row");
    for (var w = 0; w < 7; w++) {
      var wd = el("div", "cal-weekday");
      wd.textContent = weekdayNames[w];
      weekdayRow.appendChild(wd);
    }
    grid.appendChild(weekdayRow);

    // ---- Build the day matrix ----
    var byDay = bucketReminders(reminders); // key 'YYYY-M-D' -> [reminders]
    var today = new Date();
    var todayKey = dayKey(today);
    var monthIndex = currentMonth.getMonth();

    // First cell = Monday on/before the 1st of the month.
    var firstOfMonth = startOfMonth(currentMonth);
    var leadOffset = (firstOfMonth.getDay() + 6) % 7; // 0 for Monday ... 6 for Sunday
    var gridStart = addDays(firstOfMonth, -leadOffset);

    var weeksWrap = el("div", "cal-weeks");
    for (var week = 0; week < 6; week++) {
      var weekRow = el("div", "cal-week");
      for (var d = 0; d < 7; d++) {
        var cellDate = addDays(gridStart, week * 7 + d);
        weekRow.appendChild(
          buildDayCell(
            cellDate,
            cellDate.getMonth() === monthIndex,
            dayKey(cellDate) === todayKey,
            byDay[dayKey(cellDate)] || [],
            lang,
            t,
            onSelectDate,
            onSelectReminder
          )
        );
      }
      weeksWrap.appendChild(weekRow);
    }
    grid.appendChild(weeksWrap);
    root.appendChild(grid);

    container.appendChild(root);
  }

  // ---------------------------------------------------------------------------
  // Day cell construction
  // ---------------------------------------------------------------------------
  function buildDayCell(
    date,
    inMonth,
    isToday,
    dayReminders,
    lang,
    t,
    onSelectDate,
    onSelectReminder
  ) {
    var cell = el("div", "cal-day");
    if (!inMonth) cell.classList.add("cal-day--adjacent");
    if (isToday) cell.classList.add("cal-day--today");

    // Clicking empty space in the day -> onSelectDate at noon.
    cell.addEventListener("click", function (ev) {
      if (ev.target.closest && ev.target.closest(".cal-pill")) return;
      var noon = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
        12,
        0,
        0,
        0
      );
      onSelectDate(noon);
    });

    var num = el("div", "cal-day-number");
    num.textContent = String(date.getDate());
    cell.appendChild(num);

    var pillsWrap = el("div", "cal-pills");

    // Sort the day's reminders chronologically by time.
    var sorted = dayReminders.slice().sort(function (a, b) {
      return safeTime(a.time) - safeTime(b.time);
    });

    var shown = Math.min(sorted.length, MAX_PILLS);
    for (var i = 0; i < shown; i++) {
      pillsWrap.appendChild(buildPill(sorted[i], lang, onSelectReminder));
    }

    if (sorted.length > MAX_PILLS) {
      var more = el("div", "cal-more");
      var extra = sorted.length - MAX_PILLS;
      more.textContent = t("calendar-more").replace("{n}", String(extra));
      // Clicking "+N more" surfaces the day (same behavior as empty space).
      more.addEventListener("click", function (ev) {
        ev.stopPropagation();
        var noon = new Date(
          date.getFullYear(),
          date.getMonth(),
          date.getDate(),
          12,
          0,
          0,
          0
        );
        onSelectDate(noon);
      });
      pillsWrap.appendChild(more);
    }

    cell.appendChild(pillsWrap);
    return cell;
  }

  function buildPill(reminder, lang, onSelectReminder) {
    var state = reminderState(reminder);
    var pill = el("button", "cal-pill cal-pill--" + state);
    pill.type = "button";

    var timeStr = formatTime(reminder.time, lang);
    var label = (reminder && reminder.text) || "";

    var timeEl = el("span", "cal-pill-time");
    timeEl.textContent = timeStr;

    var textEl = el("span", "cal-pill-text");
    textEl.textContent = label;

    pill.appendChild(timeEl);
    pill.appendChild(textEl);

    // Defensive defaults; mark favorites with a subtle star.
    var favorite = !!(reminder && reminder.favorite);
    if (favorite) {
      var star = el("span", "cal-pill-fav");
      star.textContent = "★"; // ★
      pill.appendChild(star);
    }

    var titleParts = [];
    if (timeStr) titleParts.push(timeStr);
    if (label) titleParts.push(label);
    pill.title = titleParts.join("  ");

    pill.addEventListener("click", function (ev) {
      ev.stopPropagation();
      onSelectReminder(reminder);
    });

    return pill;
  }

  // ---------------------------------------------------------------------------
  // Reminder helpers
  // ---------------------------------------------------------------------------
  // State: 'done' (history/completed) -> muted blue; else overdue (red) if in
  // the past, else upcoming (green).
  function reminderState(reminder) {
    if (!reminder) return "upcoming";
    if (reminder.done || reminder.completedAt) return "done";
    var ts = safeTime(reminder.time);
    if (isNaN(ts)) return "upcoming";
    return ts < Date.now() ? "overdue" : "upcoming";
  }

  function bucketReminders(reminders) {
    var map = {};
    for (var i = 0; i < reminders.length; i++) {
      var r = reminders[i];
      if (!r || !r.time) continue;
      var d = new Date(r.time);
      if (isNaN(d.getTime())) continue;
      var key = dayKey(d);
      if (!map[key]) map[key] = [];
      map[key].push(r);
    }
    return map;
  }

  function safeTime(iso) {
    if (!iso) return NaN;
    var t = new Date(iso).getTime();
    return t;
  }

  // ---------------------------------------------------------------------------
  // Date helpers
  // ---------------------------------------------------------------------------
  function startOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
  }

  function addMonths(date, n) {
    return new Date(date.getFullYear(), date.getMonth() + n, 1, 0, 0, 0, 0);
  }

  function addDays(date, n) {
    return new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate() + n,
      0,
      0,
      0,
      0
    );
  }

  function dayKey(date) {
    return date.getFullYear() + "-" + date.getMonth() + "-" + date.getDate();
  }

  // ---------------------------------------------------------------------------
  // Localization helpers (Intl with safe fallbacks)
  // ---------------------------------------------------------------------------
  function formatMonthYear(date, lang) {
    try {
      return new Intl.DateTimeFormat(lang || "en", {
        month: "long",
        year: "numeric",
      }).format(date);
    } catch (e) {
      return date.getFullYear() + "-" + (date.getMonth() + 1);
    }
  }

  function formatTime(iso, lang) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    try {
      return new Intl.DateTimeFormat(lang || "en", {
        hour: "2-digit",
        minute: "2-digit",
      }).format(d);
    } catch (e) {
      var h = String(d.getHours()).padStart(2, "0");
      var m = String(d.getMinutes()).padStart(2, "0");
      return h + ":" + m;
    }
  }

  // Returns 7 short weekday names starting Monday, localized.
  function getWeekdayNames(lang) {
    var names = [];
    try {
      var fmt = new Intl.DateTimeFormat(lang || "en", { weekday: "short" });
      // 2024-01-01 is a Monday; iterate 7 days from there.
      for (var i = 0; i < 7; i++) {
        var d = new Date(2024, 0, 1 + i);
        names.push(fmt.format(d));
      }
    } catch (e) {
      names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    }
    return names;
  }

  // ---------------------------------------------------------------------------
  // Translation wrapper: use passed t, but fall back to a sensible default if
  // the key comes back unchanged (i.e. unknown key) or t is missing.
  // ---------------------------------------------------------------------------
  function makeTranslator(t) {
    return function (key) {
      if (typeof t === "function") {
        var val = t(key);
        if (typeof val === "string" && val !== key && val.length) return val;
      }
      return FALLBACKS[key] != null ? FALLBACKS[key] : key;
    };
  }

  // ---------------------------------------------------------------------------
  // Tiny DOM helper
  // ---------------------------------------------------------------------------
  function el(tag, className) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    return node;
  }

  function noop() {}

  // ---------------------------------------------------------------------------
  window.ReminderCalendar = { mount: mount };
})();
