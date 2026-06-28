const test = require("node:test");
const assert = require("node:assert/strict");

const Scheduler = require("../app/scheduler.js");

const iso = (offsetMs) => new Date(Date.now() + offsetMs).toISOString();

test("getDue returns only overdue, not-done, valid-time reminders", () => {
  const active = [
    { id: "overdue", time: iso(-1000), done: false },
    { id: "future", time: iso(60000), done: false },
    { id: "done", time: iso(-1000), done: true },
    { id: "invalid", time: "not-a-date", done: false },
  ];
  const s = new Scheduler({ getActive: () => active });
  const due = s.getDue(new Date());
  assert.deepEqual(
    due.map((r) => r.id),
    ["overdue"],
  );
});

test("tick passes the due set to the onDue callback", () => {
  const active = [
    { id: "a", time: iso(-1000), done: false },
    { id: "b", time: iso(-2000), done: false },
  ];
  let received = null;
  const s = new Scheduler({ getActive: () => active }, (due) => {
    received = due;
  });
  s.tick();
  assert.equal(received.length, 2);
  assert.deepEqual(received.map((r) => r.id).sort(), ["a", "b"]);
});

test("tick reports an empty array when nothing is due", () => {
  const active = [{ id: "future", time: iso(60000), done: false }];
  let received = "unset";
  const s = new Scheduler({ getActive: () => active }, (due) => {
    received = due;
  });
  s.tick();
  assert.deepEqual(received, []);
});
