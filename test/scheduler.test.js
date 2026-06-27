const test = require("node:test");
const assert = require("node:assert/strict");

const Scheduler = require("../app/scheduler.js");

// A minimal Scheduler whose triggerReminder is stubbed so it does not touch
// Electron's Notification API. The stub mirrors the real one's only relevant
// side effect: adding the id to `pending`.
function makeScheduler(active) {
  const storage = { getActive: () => active };
  const s = new Scheduler(storage);
  const fired = [];
  s.triggerReminder = (reminder) => {
    s.pending.add(reminder.id);
    fired.push(reminder.id);
  };
  return { s, fired };
}

const iso = (offsetMs) => new Date(Date.now() + offsetMs).toISOString();

test("a due reminder fires exactly once, then is suppressed", () => {
  const active = [{ id: "a", text: "x", time: iso(-60000), done: false }];
  const { s, fired } = makeScheduler(active);
  s.checkReminders();
  s.checkReminders();
  s.checkReminders();
  assert.deepEqual(fired, ["a"]);
});

test("future and done reminders never fire", () => {
  const active = [
    { id: "future", text: "x", time: iso(3600000), done: false },
    { id: "done", text: "y", time: iso(-60000), done: true },
  ];
  const { s, fired } = makeScheduler(active);
  s.checkReminders();
  assert.deepEqual(fired, []);
});

test("an invalid time never fires", () => {
  const active = [{ id: "bad", text: "x", time: "not-a-date", done: false }];
  const { s, fired } = makeScheduler(active);
  s.checkReminders();
  assert.deepEqual(fired, []);
});

test("rescheduling a fired reminder into the future re-arms it so it can fire again", () => {
  const active = [{ id: "a", text: "x", time: iso(-60000), done: false }];
  const { s, fired } = makeScheduler(active);

  s.checkReminders(); // fires once
  assert.deepEqual(fired, ["a"]);
  assert.ok(s.pending.has("a"));

  // Simulate a snooze/edit from the main window: time pushed into the future.
  active[0].time = iso(3600000);
  s.checkReminders(); // re-arms (does not fire — still future)
  assert.deepEqual(fired, ["a"]);
  assert.equal(s.pending.has("a"), false);

  // It becomes due again at its new time.
  active[0].time = iso(-1000);
  s.checkReminders();
  assert.deepEqual(fired, ["a", "a"]);
});

test("a reminder removed from active is purged from the pending set", () => {
  const active = [{ id: "a", text: "x", time: iso(-60000), done: false }];
  const { s, fired } = makeScheduler(active);
  s.checkReminders();
  assert.ok(s.pending.has("a"));

  // Simulate delete/archive: gone from active.
  active.length = 0;
  s.checkReminders();
  assert.equal(s.pending.has("a"), false);
  assert.equal(s.pending.size, 0);
});
