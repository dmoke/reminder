const test = require("node:test");
const assert = require("node:assert");

const Snooze = require("../ui/snooze.js");

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

// A fixed clock so every assertion is exact rather than "about now".
const NOW = new Date("2026-09-19T10:00:00.000Z");

function offsetFromNow(kind, baseIso) {
  return Date.parse(Snooze.alertIso(kind, baseIso, NOW)) - NOW.getTime();
}

test("the alert window offers 30m and 5h, in ascending order", () => {
  assert.deepEqual(Snooze.ALERT_KINDS, [
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
  ]);
});

test("the main-window cards offer 30m and 5h, in ascending order", () => {
  assert.deepEqual(Snooze.CARD_KINDS, ["10m", "30m", "5h", "1d", "2d", "1w", "1m"]);
});

test("30m lands exactly 30 minutes ahead", () => {
  assert.equal(offsetFromNow("30m"), 30 * MIN);
});

test("5h lands exactly 5 hours ahead", () => {
  // Asserted in absolute milliseconds, so this holds across a DST boundary.
  assert.equal(offsetFromNow("5h"), 5 * HOUR);
});

test("30m and 5h ignore the reminder's own time-of-day", () => {
  // Guards against the new kinds being folded into the day-based branch, which
  // re-applies the reminder's clock time and would silently move a 30-minute
  // snooze to 07:15 tomorrow-ish instead of 30 minutes from now.
  assert.equal(offsetFromNow("30m", "2026-09-18T07:15:00.000Z"), 30 * MIN);
  assert.equal(offsetFromNow("5h", "2026-09-18T07:15:00.000Z"), 5 * HOUR);
});

test("the short presets are measured from now, not from the reminder", () => {
  assert.equal(offsetFromNow("10m"), 10 * MIN);
  assert.equal(offsetFromNow("1h"), 1 * HOUR);
  assert.equal(offsetFromNow("3h"), 3 * HOUR);
});

test("day-based presets still keep the reminder's own time-of-day", () => {
  const base = new Date("2026-09-18T07:15:00.000Z");
  for (const [kind, days] of [["tomorrow", 1], ["2d", 2], ["1w", 7]]) {
    const out = new Date(Snooze.alertIso(kind, base.toISOString(), NOW));
    assert.equal(out.getHours(), base.getHours(), `${kind} hours`);
    assert.equal(out.getMinutes(), base.getMinutes(), `${kind} minutes`);
    const expected = new Date(NOW);
    expected.setDate(expected.getDate() + days);
    assert.equal(out.getDate(), expected.getDate(), `${kind} date`);
  }
});

test("tomorrow falls back to 09:00 when the reminder's time is unusable", () => {
  const out = new Date(Snooze.alertIso("tomorrow", "not-a-date", NOW));
  assert.equal(out.getHours(), 9);
  assert.equal(out.getMinutes(), 0);
});

test("every alert preset yields a valid ISO time strictly in the future", () => {
  for (const kind of Snooze.ALERT_KINDS) {
    const iso = Snooze.alertIso(kind, NOW.toISOString(), NOW);
    const t = Date.parse(iso);
    assert.ok(!Number.isNaN(t), `${kind} produced an unparseable time: ${iso}`);
    assert.ok(t > NOW.getTime(), `${kind} did not move the reminder forward`);
  }
});

test("an unknown alert kind falls back to +10 minutes rather than staying due", () => {
  assert.equal(offsetFromNow("does-not-exist"), 10 * MIN);
});

test("card presets are measured from the base the caller passes", () => {
  // The main window passes max(now, due), so a 30m chip on a reminder due later
  // pushes it 30 minutes past its OWN time, not 30 minutes from now. That is
  // long-standing behavior; pin it so the shared module cannot quietly change it.
  const due = new Date("2026-09-19T13:00:00.000Z");
  assert.equal(Date.parse(Snooze.cardIso(due, "30m")) - due.getTime(), 30 * MIN);
  assert.equal(Date.parse(Snooze.cardIso(due, "5h")) - due.getTime(), 5 * HOUR);
});

test("every card preset resolves to a real, later time", () => {
  const due = new Date("2026-09-19T13:00:00.000Z");
  for (const kind of Snooze.CARD_KINDS) {
    const t = Date.parse(Snooze.cardIso(due, kind));
    assert.ok(!Number.isNaN(t), `${kind} produced an unparseable time`);
    assert.ok(t > due.getTime(), `${kind} did not move the reminder forward`);
  }
});

test("1mo and 1m are the same offset under different spellings", () => {
  // The two windows disagree historically; both must keep working.
  const due = new Date("2026-09-19T13:00:00.000Z");
  assert.equal(Snooze.cardIso(due, "1m"), Snooze.cardIso(due, "1mo"));
});

test("every preset either has an offset or is a day-jump kind", () => {
  for (const kind of [...Snooze.ALERT_KINDS, ...Snooze.CARD_KINDS]) {
    assert.ok(Snooze.isKnown(kind), `${kind} has no date math behind it`);
  }
});
