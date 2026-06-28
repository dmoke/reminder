const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const Storage = require("../app/storage.js");

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "storage-recur-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("recurComplete advances the active reminder and snapshots to history", (t) => {
  const dir = tempDir(t);
  const store = new Storage(dir);
  store.add({
    id: "r1",
    text: "standup",
    time: "2026-01-01T09:00:00.000Z",
    done: false,
    recurrence: "daily",
  });

  const ok = store.recurComplete("r1", "2026-01-02T09:00:00.000Z");
  assert.equal(ok, true);

  // Still active, advanced to the next occurrence.
  const active = store.getActive();
  assert.equal(active.length, 1);
  assert.equal(active[0].id, "r1");
  assert.equal(active[0].time, "2026-01-02T09:00:00.000Z");

  // A completed snapshot landed at the front of history.
  const history = store.getHistory();
  assert.equal(history.length, 1);
  assert.equal(history[0].id, "r1");
  assert.equal(history[0].done, true);
  assert.equal(history[0].time, "2026-01-01T09:00:00.000Z");
  assert.ok(!isNaN(new Date(history[0].completedAt).getTime()));
});

test("recurComplete returns false for an unknown id and writes nothing", (t) => {
  const dir = tempDir(t);
  const store = new Storage(dir);
  assert.equal(store.recurComplete("nope", "2026-01-02T09:00:00.000Z"), false);
  assert.deepEqual(store.getHistory(), []);
});
