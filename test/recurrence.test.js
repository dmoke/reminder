const test = require("node:test");
const assert = require("node:assert/strict");

const { nextOccurrence } = require("../app/recurrence.js");

// Compare by local calendar components to avoid timezone-dependent ISO strings.
function parts(iso) {
  const d = new Date(iso);
  return {
    y: d.getFullYear(),
    mo: d.getMonth(),
    day: d.getDate(),
    h: d.getHours(),
    min: d.getMinutes(),
    dow: d.getDay(),
  };
}

test("non-recurring returns null", () => {
  assert.equal(nextOccurrence("2026-01-01T09:00:00", "none"), null);
  assert.equal(nextOccurrence("2026-01-01T09:00:00", undefined), null);
});

test("invalid time returns null", () => {
  assert.equal(nextOccurrence("not-a-date", "daily"), null);
});

test("daily advances to the next future day, keeping the time", () => {
  const r = parts(
    nextOccurrence("2026-01-01T09:00:00", "daily", "2026-01-03T10:00:00"),
  );
  assert.equal(r.y, 2026);
  assert.equal(r.mo, 0);
  assert.equal(r.day, 4); // Jan 2,3 are <= after; Jan 4 is the next future slot
  assert.equal(r.h, 9);
  assert.equal(r.min, 0);
});

test("daily skips many missed occurrences (PC was off)", () => {
  const r = parts(
    nextOccurrence("2026-01-01T09:00:00", "daily", "2026-01-10T08:00:00"),
  );
  assert.equal(r.day, 10); // Jan 10 09:00 is the first slot after Jan 10 08:00
  assert.equal(r.h, 9);
});

test("weekdays skips weekends", () => {
  // 2026-01-02 is a Friday; next weekday occurrence is Monday 2026-01-05.
  const r = parts(
    nextOccurrence("2026-01-02T09:00:00", "weekdays", "2026-01-02T10:00:00"),
  );
  assert.equal(r.dow, 1); // Monday
  assert.equal(r.day, 5);
});

test("weekly advances 7 days", () => {
  const r = parts(
    nextOccurrence("2026-01-01T09:00:00", "weekly", "2026-01-01T10:00:00"),
  );
  assert.equal(r.day, 8);
});

test("monthly clamps to the last day of a shorter month", () => {
  // Jan 31 -> Feb (2026 is not a leap year) -> Feb 28.
  const r = parts(
    nextOccurrence("2026-01-31T09:00:00", "monthly", "2026-01-31T10:00:00"),
  );
  assert.equal(r.mo, 1); // February
  assert.equal(r.day, 28);
});

test("completing early (floor = the reminder's own future time) advances exactly one period, not skipping it", () => {
  // A daily reminder set for the future, completed before it is due: passing
  // its own time as the floor must advance exactly one day, not two.
  const future = "2026-06-10T09:00:00";
  const r = parts(nextOccurrence(future, "daily", future));
  assert.equal(r.mo, 5); // June
  assert.equal(r.day, 11); // exactly +1 day
  assert.equal(r.h, 9);
});

test("yearly advances one year", () => {
  const r = parts(
    nextOccurrence("2026-03-10T09:00:00", "yearly", "2026-03-10T10:00:00"),
  );
  assert.equal(r.y, 2027);
  assert.equal(r.mo, 2);
  assert.equal(r.day, 10);
});
