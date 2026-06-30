const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const Storage = require("../app/storage.js");

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "storage-import-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function reminder(id, over = {}) {
  return {
    id,
    text: "t" + id,
    time: "2026-06-20T09:00:00Z",
    done: false,
    tags: [],
    importId: "guid-" + id,
    importSource: "pichugin",
    ...over,
  };
}

test("importReminders splits active vs completed into the right files", (t) => {
  const dir = tempDir(t);
  const store = new Storage(dir);
  const summary = store.importReminders([
    reminder("1"),
    reminder("2", { done: true, completedAt: "2026-06-21T10:00:00Z" }),
    reminder("3"),
  ]);
  assert.deepEqual(summary, { added: 2, completed: 1, skipped: 0, total: 3 });
  assert.equal(store.getActive().length, 2);
  const hist = store.getHistory();
  assert.equal(hist.length, 1);
  assert.equal(hist[0].id, "2");
  assert.equal(hist[0].done, true);
});

test("importReminders skips items whose importId already exists", (t) => {
  const dir = tempDir(t);
  const store = new Storage(dir);
  store.importReminders([reminder("1"), reminder("2")]);

  // Re-import the same two plus one new — the two duplicates are skipped.
  const summary = store.importReminders([reminder("1"), reminder("2"), reminder("9")]);
  assert.deepEqual(summary, { added: 1, completed: 0, skipped: 2, total: 3 });
  assert.equal(store.getActive().length, 3);
});

test("importReminders de-dups within a single batch", (t) => {
  const dir = tempDir(t);
  const store = new Storage(dir);
  const summary = store.importReminders([reminder("1"), reminder("1"), reminder("2")]);
  assert.deepEqual(summary, { added: 2, completed: 0, skipped: 1, total: 3 });
  assert.equal(store.getActive().length, 2);
});

test("importReminders de-dups completed items against existing history", (t) => {
  const dir = tempDir(t);
  const store = new Storage(dir);
  store.importReminders([reminder("5", { done: true, completedAt: "2026-06-21T10:00:00Z" })]);
  const summary = store.importReminders([
    reminder("5", { done: true, completedAt: "2026-06-21T10:00:00Z" }),
  ]);
  assert.deepEqual(summary, { added: 0, completed: 0, skipped: 1, total: 1 });
  assert.equal(store.getHistory().length, 1);
});

test("importReminders without importId always adds (no de-dup key)", (t) => {
  const dir = tempDir(t);
  const store = new Storage(dir);
  const a = reminder("1");
  delete a.importId;
  const b = reminder("2");
  delete b.importId;
  const summary = store.importReminders([a, b]);
  assert.deepEqual(summary, { added: 2, completed: 0, skipped: 0, total: 2 });
});

test("importReminders coexists with existing reminders and the scheduler view", (t) => {
  const dir = tempDir(t);
  const store = new Storage(dir);
  store.add({ id: "pre", text: "pre", time: "2026-06-19T09:00:00Z", tags: [] });
  store.importReminders([reminder("1")]);
  // The in-memory active array (what the scheduler reads) reflects both.
  assert.equal(store.getActive().length, 2);
  assert.ok(store.getActive().some((r) => r.id === "pre"));
  assert.ok(store.getActive().some((r) => r.id === "1"));
});

test("importReminders handles an empty / non-array input", (t) => {
  const dir = tempDir(t);
  const store = new Storage(dir);
  assert.deepEqual(store.importReminders([]), { added: 0, completed: 0, skipped: 0, total: 0 });
  assert.deepEqual(store.importReminders(null), { added: 0, completed: 0, skipped: 0, total: 0 });
});
