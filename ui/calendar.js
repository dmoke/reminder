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

  // The currently-open day popup (only one at a time) and its dismiss helpers.
  var activeDayPopup = null;

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

    // Close any open day popup whenever we (re)mount (e.g. month change).
    closeDayPopup();

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
    var today = new Date();
    var todayKey = dayKey(today);
    var monthIndex = currentMonth.getMonth();

    // First cell = Monday on/before the 1st of the month.
    var firstOfMonth = startOfMonth(currentMonth);
    var leadOffset = (firstOfMonth.getDay() + 6) % 7; // 0 for Monday ... 6 for Sunday
    var gridStart = addDays(firstOfMonth, -leadOffset);
    var gridEnd = addDays(gridStart, 42); // 6 weeks * 7 days; exclusive upper bound

    // Expand recurring reminders into one entry per occurrence inside the
    // visible grid, then bucket the expanded list by day.
    var expanded = expandReminders(reminders, gridStart, gridEnd);
    var byDay = bucketReminders(expanded); // key 'YYYY-M-D' -> [reminders]

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
      // Clicking "+N more" opens a popup listing ALL of the day's reminders.
      more.addEventListener("click", function (ev) {
        ev.stopPropagation();
        openDayPopup(more, date, sorted, lang, onSelectReminder);
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
    var text = (reminder && reminder.text) || "";
    var emoji = (reminder && reminder.emoji) || "";
    var label = (emoji ? emoji + " " : "") + text;

    // Lead with the title; the time follows as a secondary, trailing detail.
    var textEl = el("span", "cal-pill-text");
    textEl.textContent = label;

    var timeEl = el("span", "cal-pill-time");
    timeEl.textContent = timeStr;

    pill.appendChild(textEl);
    pill.appendChild(timeEl);

    // Defensive defaults; mark favorites with a subtle star.
    var favorite = !!(reminder && reminder.favorite);
    if (favorite) {
      var star = el("span", "cal-pill-fav");
      star.textContent = "★"; // ★
      pill.appendChild(star);
    }

    var titleParts = [];
    if (label) titleParts.push(label);
    if (timeStr) titleParts.push(timeStr);
    pill.title = titleParts.join("  ");

    pill.addEventListener("click", function (ev) {
      ev.stopPropagation();
      // Per-occurrence clones carry __source pointing at the original reminder.
      onSelectReminder(reminder.__source || reminder);
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
  // Recurrence expansion
  // ---------------------------------------------------------------------------
  // Returns true if a reminder recurs (and is not a completed history snapshot).
  function isRecurringActive(reminder) {
    if (!reminder) return false;
    if (reminder.done || reminder.completedAt) return false;
    var rec = reminder.recurrence;
    return !!rec && rec !== "none";
  }

  // Step a Date forward by one occurrence of `recurrence`. Returns a new Date.
  // Semantics copied from the app's recurrence module.
  function stepRecurrence(date, recurrence) {
    var y = date.getFullYear();
    var m = date.getMonth();
    var day = date.getDate();
    var h = date.getHours();
    var min = date.getMinutes();
    var s = date.getSeconds();
    var ms = date.getMilliseconds();

    switch (recurrence) {
      case "daily":
        return new Date(y, m, day + 1, h, min, s, ms);
      case "weekly":
        return new Date(y, m, day + 7, h, min, s, ms);
      case "weekdays": {
        var next = new Date(y, m, day + 1, h, min, s, ms);
        // Skip Saturday(6) and Sunday(0).
        while (next.getDay() === 6 || next.getDay() === 0) {
          next = new Date(
            next.getFullYear(),
            next.getMonth(),
            next.getDate() + 1,
            h,
            min,
            s,
            ms
          );
        }
        return next;
      }
      case "monthly":
        return addClampedMonths(date, 1);
      case "yearly":
        return addClampedMonths(date, 12);
      default:
        return null;
    }
  }

  // Add `n` months keeping day-of-month, clamped to the target month's last day.
  // (e.g. Jan 31 + 1 month => Feb 28/29.)
  function addClampedMonths(date, n) {
    var y = date.getFullYear();
    var m = date.getMonth();
    var day = date.getDate();
    var h = date.getHours();
    var min = date.getMinutes();
    var s = date.getSeconds();
    var ms = date.getMilliseconds();

    // Move to the 1st of the target month, then clamp the day-of-month.
    var target = new Date(y, m + n, 1, h, min, s, ms);
    var lastDay = new Date(
      target.getFullYear(),
      target.getMonth() + 1,
      0
    ).getDate();
    target.setDate(Math.min(day, lastDay));
    return target;
  }

  // Build a flat list of reminders to render: non-recurring & history items
  // pass through once at their stored time; active recurring reminders are
  // expanded into one shallow clone per occurrence within [gridStart, gridEnd).
  function expandReminders(reminders, gridStart, gridEnd) {
    var out = [];
    var startMs = gridStart.getTime();
    var endMs = gridEnd.getTime();
    var MAX_STEPS = 400;

    for (var i = 0; i < reminders.length; i++) {
      var r = reminders[i];
      if (!r || !r.time) continue;

      if (!isRecurringActive(r)) {
        out.push(r);
        continue;
      }

      var occ = new Date(r.time);
      if (isNaN(occ.getTime())) {
        out.push(r);
        continue;
      }

      // Walk occurrences forward from the stored time. The stored time may be
      // before gridStart (skip those) or after gridEnd (stop immediately).
      for (var step = 0; step < MAX_STEPS; step++) {
        var ms = occ.getTime();
        if (ms >= endMs) break;
        if (ms >= startMs) {
          out.push(cloneOccurrence(r, occ));
        }
        var nextOcc = stepRecurrence(occ, r.recurrence);
        if (!nextOcc || isNaN(nextOcc.getTime()) || nextOcc.getTime() <= ms) {
          break; // unknown recurrence or non-advancing step; bail safely
        }
        occ = nextOcc;
      }
    }
    return out;
  }

  // Shallow clone of a reminder with `time` set to `dateObj`, keeping a
  // reference to the original via __source so clicks open the real reminder.
  function cloneOccurrence(reminder, dateObj) {
    var clone = {};
    for (var k in reminder) {
      if (Object.prototype.hasOwnProperty.call(reminder, k)) {
        clone[k] = reminder[k];
      }
    }
    clone.time = dateObj.toISOString();
    clone.__source = reminder.__source || reminder;
    return clone;
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
  // Day popup ("+N more" -> list ALL of that day's reminders)
  // ---------------------------------------------------------------------------
  function openDayPopup(anchor, date, dayReminders, lang, onSelectReminder) {
    // Toggle off if already open for this same anchor.
    if (activeDayPopup && activeDayPopup.anchor === anchor) {
      closeDayPopup();
      return;
    }
    closeDayPopup();

    var pop = el("div", "cal-daypop");

    // Heading: localized date (e.g. "Mon, 28 Jun").
    var head = el("div", "cal-daypop-head");
    head.textContent = formatPopupDate(date, lang);
    pop.appendChild(head);

    var list = el("div", "cal-daypop-list");
    var sorted = dayReminders.slice().sort(function (a, b) {
      return safeTime(a.time) - safeTime(b.time);
    });

    for (var i = 0; i < sorted.length; i++) {
      list.appendChild(buildDayPopupRow(sorted[i], lang, onSelectReminder));
    }
    pop.appendChild(list);

    document.body.appendChild(pop);
    positionDayPopup(pop, anchor);

    // Dismiss handlers: outside click, Escape, scroll/resize.
    var onDocClick = function (ev) {
      if (pop.contains(ev.target)) return;
      closeDayPopup();
    };
    var onKey = function (ev) {
      if (ev.key === "Escape" || ev.keyCode === 27) closeDayPopup();
    };
    var onScrollResize = function () {
      closeDayPopup();
    };

    // Defer attaching the document click listener so the originating click
    // (which is still propagating) does not immediately close the popup.
    setTimeout(function () {
      document.addEventListener("mousedown", onDocClick, true);
    }, 0);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScrollResize, true);
    window.addEventListener("resize", onScrollResize, true);

    activeDayPopup = {
      node: pop,
      anchor: anchor,
      cleanup: function () {
        document.removeEventListener("mousedown", onDocClick, true);
        document.removeEventListener("keydown", onKey, true);
        window.removeEventListener("scroll", onScrollResize, true);
        window.removeEventListener("resize", onScrollResize, true);
      },
    };
  }

  function buildDayPopupRow(reminder, lang, onSelectReminder) {
    var state = reminderState(reminder);
    var row = el("button", "cal-daypop-row cal-daypop-row--" + state);
    row.type = "button";

    var timeStr = formatTime(reminder.time, lang);
    var text = (reminder && reminder.text) || "";
    var emoji = (reminder && reminder.emoji) || "";

    var timeEl = el("span", "cal-daypop-time");
    timeEl.textContent = timeStr;
    row.appendChild(timeEl);

    var label = (emoji ? emoji + " " : "") + text;
    var textEl = el("span", "cal-daypop-text");
    textEl.textContent = label;
    row.appendChild(textEl);

    if (reminder && reminder.favorite) {
      var star = el("span", "cal-daypop-fav");
      star.textContent = "★"; // ★
      row.appendChild(star);
    }

    var titleParts = [];
    if (timeStr) titleParts.push(timeStr);
    if (label) titleParts.push(label);
    row.title = titleParts.join("  ");

    row.addEventListener("click", function (ev) {
      ev.stopPropagation();
      var src = reminder.__source || reminder;
      closeDayPopup();
      onSelectReminder(src);
    });

    return row;
  }

  // Position the popup near its anchor, keeping it within the viewport.
  function positionDayPopup(pop, anchor) {
    var rect = anchor.getBoundingClientRect();
    // Measure after insertion (it's already in the DOM).
    var pw = pop.offsetWidth || 240;
    var ph = pop.offsetHeight || 200;
    var margin = 8;
    var vw = document.documentElement.clientWidth || window.innerWidth;
    var vh = document.documentElement.clientHeight || window.innerHeight;

    var left = rect.left;
    if (left + pw + margin > vw) left = vw - pw - margin;
    if (left < margin) left = margin;

    var top = rect.bottom + 4;
    if (top + ph + margin > vh) {
      // Flip above the anchor if there's not enough room below.
      var above = rect.top - ph - 4;
      top = above >= margin ? above : Math.max(margin, vh - ph - margin);
    }

    pop.style.left = Math.round(left) + "px";
    pop.style.top = Math.round(top) + "px";
  }

  function closeDayPopup() {
    if (!activeDayPopup) return;
    var p = activeDayPopup;
    activeDayPopup = null;
    if (p.cleanup) p.cleanup();
    if (p.node && p.node.parentNode) p.node.parentNode.removeChild(p.node);
  }

  function formatPopupDate(date, lang) {
    try {
      return new Intl.DateTimeFormat(lang || "en", {
        weekday: "short",
        day: "numeric",
        month: "short",
      }).format(date);
    } catch (e) {
      return date.getFullYear() + "-" + (date.getMonth() + 1) + "-" + date.getDate();
    }
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
