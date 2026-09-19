/* ==========================================================================
   Shared snooze ("postpone") presets + date math.

   Both snooze surfaces used to carry their own copy of this logic, with two
   different kind vocabularies, so adding a preset meant editing two date-math
   sites and hoping they agreed. They now delegate here:

     - the alert popup (ui/alert.js)  — offsets are measured from NOW, because
       the reminder is already overdue and the user is asking for "not now".
     - the main-window cards (ui/renderer.js) — offsets are measured from the
       reminder's own due time (max(now, due)), because there the user is
       pushing a scheduled item further out, not dismissing an alarm.

   That difference is deliberate and predates this file; it is preserved here
   as two entry points (alertIso / cardIso) over one shared offset table.

   Plain classic script: no imports, no build step. The tail exposes
   `window.ReminderSnooze` for the two browser windows (the same shape
   ui/calendar.js uses) AND `module.exports` so the math is unit-testable
   under plain `node --test` — nothing else in ui/ is reachable from tests.
   ========================================================================== */

var ReminderSnooze = (function () {
  "use strict";

  // One offset per kind. Keys are the kind strings the UIs pass around.
  // `1mo` (alert window) and `1m` (main window) are historical spellings of the
  // same offset; both are kept so neither window's stored vocabulary shifts.
  var OFFSETS = {
    "10m": { minutes: 10 },
    "30m": { minutes: 30 },
    "1h": { hours: 1 },
    "3h": { hours: 3 },
    "5h": { hours: 5 },
    "1d": { days: 1 },
    "2d": { days: 2 },
    "1w": { days: 7 },
    "1mo": { months: 1 },
    "1m": { months: 1 },
    "1y": { years: 1 },
  };

  // Preset order for the alert popup, shortest first. "tomorrow" is not in
  // OFFSETS: it is a day jump that re-applies the reminder's own time-of-day.
  var ALERT_KINDS = [
    "10m",
    "30m",
    "1h",
    "3h",
    "5h",
    "tomorrow",
    "2d",
    "1w",
    "1mo",
    "1y",
  ];

  // Preset order for the main-window cards. The "Tomorrow (same time)" chip is
  // appended separately by the renderer, so it is not listed here.
  var CARD_KINDS = ["10m", "30m", "5h", "1d", "2d", "1w", "1m"];

  // Kinds that keep the reminder's own time-of-day rather than the current
  // clock time, so "2 days" on a 09:00 reminder stays a 09:00 reminder.
  var DAY_KINDS = { tomorrow: 1, "2d": 2, "1w": 7 };

  // Fallback when a kind is not recognized, matching the alert window's
  // long-standing behavior: never leave the reminder due, nudge it 10 minutes.
  var FALLBACK_KIND = "10m";

  function isKnown(kind) {
    return Object.prototype.hasOwnProperty.call(OFFSETS, kind) ||
      Object.prototype.hasOwnProperty.call(DAY_KINDS, kind);
  }

  // Add a kind's offset to `date` in place. Returns false for an unknown kind
  // so callers can decide what to do rather than silently producing `date`.
  function addOffset(date, kind) {
    var o = OFFSETS[kind];
    if (!o) return false;
    if (o.minutes) date.setMinutes(date.getMinutes() + o.minutes);
    if (o.hours) date.setHours(date.getHours() + o.hours);
    if (o.days) date.setDate(date.getDate() + o.days);
    if (o.months) date.setMonth(date.getMonth() + o.months);
    if (o.years) date.setFullYear(date.getFullYear() + o.years);
    return true;
  }

  // Alert-window semantics: everything is measured from `now`. Day-based kinds
  // additionally re-apply the reminder's own time-of-day from `baseIso`
  // (falling back to 09:00 for "tomorrow" when the source time is unusable).
  // `now` is injectable purely so tests can pin the clock.
  function alertIso(kind, baseIso, now) {
    var target = now ? new Date(now.getTime()) : new Date();

    var dayJump = DAY_KINDS[kind];
    if (dayJump) {
      var src = baseIso ? new Date(baseIso) : null;
      var haveSrc = !!src && !isNaN(src.getTime());
      target.setDate(target.getDate() + dayJump);
      if (haveSrc) {
        target.setHours(src.getHours(), src.getMinutes(), 0, 0);
      } else if (kind === "tomorrow") {
        target.setHours(9, 0, 0, 0);
      }
      return target.toISOString();
    }

    if (!addOffset(target, kind)) addOffset(target, FALLBACK_KIND);
    return target.toISOString();
  }

  // Card semantics: the offset is applied to `baseDate` (the caller already
  // resolved that to max(now, due)). An unknown kind returns the base instant
  // unchanged, matching the main window's previous switch with no default.
  function cardIso(baseDate, kind) {
    var target = new Date(baseDate);
    addOffset(target, kind);
    return target.toISOString();
  }

  return {
    OFFSETS: OFFSETS,
    ALERT_KINDS: ALERT_KINDS,
    CARD_KINDS: CARD_KINDS,
    DAY_KINDS: DAY_KINDS,
    FALLBACK_KIND: FALLBACK_KIND,
    isKnown: isKnown,
    addOffset: addOffset,
    alertIso: alertIso,
    cardIso: cardIso,
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = ReminderSnooze;
}
if (typeof window !== "undefined") {
  window.ReminderSnooze = ReminderSnooze;
}
