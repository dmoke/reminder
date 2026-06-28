// Recurrence math for repeating reminders. Pure functions, no Electron deps,
// so this module is unit-testable under plain `node --test`.

const RECURRENCES = ["none", "daily", "weekdays", "weekly", "monthly", "yearly"];

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

// Add months while keeping the day-of-month, clamped to the target month's
// length (e.g. Jan 31 + 1 month => Feb 28/29, not Mar 3).
function addMonths(date, months) {
  const d = new Date(date);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return d;
}

function stepOnce(date, recurrence) {
  switch (recurrence) {
    case "daily":
      return addDays(date, 1);
    case "weekly":
      return addDays(date, 7);
    case "weekdays": {
      let d = addDays(date, 1);
      while (d.getDay() === 0 || d.getDay() === 6) d = addDays(d, 1);
      return d;
    }
    case "monthly":
      return addMonths(date, 1);
    case "yearly":
      return addMonths(date, 12);
    default:
      return null;
  }
}

// Next occurrence strictly after `after` (default: now), advancing at least one
// step from the given time. Returns an ISO string, or null for non-recurring /
// invalid input. Skips missed occurrences (e.g. PC was off) and lands on the
// next future slot.
function nextOccurrence(timeISO, recurrence, after) {
  if (!recurrence || recurrence === "none") return null;
  const start = new Date(timeISO);
  if (isNaN(start.getTime())) return null;
  const afterDate = after ? new Date(after) : new Date();
  let next = stepOnce(start, recurrence);
  if (!next) return null;
  let guard = 0;
  while (next <= afterDate && guard < 10000) {
    const stepped = stepOnce(next, recurrence);
    if (!stepped) break;
    next = stepped;
    guard += 1;
  }
  return next.toISOString();
}

module.exports = { RECURRENCES, nextOccurrence, stepOnce, addDays, addMonths };
