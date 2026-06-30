const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const Storage = require("../app/storage.js");

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "storage-merge-"));
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
    ...over,
  };
}

// A backup envelope's `data` block: active reminders + completed history.
function backupData(active = [], history = []) {
  return { reminders: active, history };
}

test("mergeFromBackup adds active and history into the right files", (t) => {
  const dir = tempDir(t);
  const store = new Storage(dir);
  const summary = store.mergeFromBackup(
    backupData(
      [reminder("1"), reminder("2")],
      [reminder("9", { done: true, completedAt: "2026-06-21T10:00:00Z" })],
    ),
  );
  assert.deepEqual(summary, {
    addedActive: 2,
    addedHistory: 1,
    added: 3,
    skipped: 0,
    total: 3,
  });
  assert.equal(store.getActive().length, 2);
  const hist = store.getHistory();
  assert.equal(hist.length, 1);
  assert.equal(hist[0].id, "9");
});

test("mergeFromBackup dry run previews without writing anything", (t) => {
  const dir = tempDir(t);
  const store = new Storage(dir);
  store.add(reminder("keep"));
  const summary = store.mergeFromBackup(
    backupData([reminder("1"), reminder("keep")]),
    { dryRun: true },
  );
  // Two incoming, one already present → only one would be added.
  assert.deepEqual(summary, {
    addedActive: 1,
    addedHistory: 0,
    added: 1,
    skipped: 1,
    total: 2,
  });
  // Nothing was actually written: still just the pre-existing reminder.
  assert.equal(store.getActive().length, 1);
  assert.equal(store.getActive()[0].id, "keep");
});

test("mergeFromBackup skips ids already present (active or history)", (t) => {
  const dir = tempDir(t);
  const store = new Storage(dir);
  store.add(reminder("a"));
  store.archive("a"); // moves id "a" to history
  store.add(reminder("b"));

  const summary = store.mergeFromBackup(
    backupData(
      [reminder("b"), reminder("c")], // b active dupe, c new
      [reminder("a", { done: true, completedAt: "2026-06-21T10:00:00Z" })], // a history dupe
    ),
  );
  assert.deepEqual(summary, {
    addedActive: 1,
    addedHistory: 0,
    added: 1,
    skipped: 2,
    total: 3,
  });
  assert.ok(store.getActive().some((r) => r.id === "c"));
});

test("mergeFromBackup re-loading the same backup is idempotent", (t) => {
  const dir = tempDir(t);
  const store = new Storage(dir);
  const data = backupData(
    [reminder("1"), reminder("2")],
    [reminder("9", { done: true, completedAt: "2026-06-21T10:00:00Z" })],
  );
  store.mergeFromBackup(data);
  const second = store.mergeFromBackup(data);
  assert.deepEqual(second, {
    addedActive: 0,
    addedHistory: 0,
    added: 0,
    skipped: 3,
    total: 3,
  });
  assert.equal(store.getActive().length, 2);
  assert.equal(store.getHistory().length, 1);
});

test("mergeFromBackup de-dups within a single batch and across lists", (t) => {
  const dir = tempDir(t);
  const store = new Storage(dir);
  const summary = store.mergeFromBackup(
    backupData(
      [reminder("1"), reminder("1"), reminder("2")], // "1" twice in active
      [reminder("2", { done: true })], // "2" already taken by active above
    ),
  );
  assert.deepEqual(summary, {
    addedActive: 2,
    addedHistory: 0,
    added: 2,
    skipped: 2,
    total: 4,
  });
});

test("mergeFromBackup ignores non-array sources and bad entries", (t) => {
  const dir = tempDir(t);
  const store = new Storage(dir);
  // A corrupt snapshot preserves unparseable text as a raw envelope, not an array.
  const summary = store.mergeFromBackup({
    reminders: { __backupRaw__: true, text: "garbage" },
    history: [reminder("ok"), null, 42],
  });
  assert.deepEqual(summary, {
    addedActive: 0,
    addedHistory: 1,
    added: 1,
    skipped: 2,
    total: 3,
  });
});

test("mergeFromBackup handles empty / missing data", (t) => {
  const dir = tempDir(t);
  const store = new Storage(dir);
  const empty = { addedActive: 0, addedHistory: 0, added: 0, skipped: 0, total: 0 };
  assert.deepEqual(store.mergeFromBackup(backupData()), empty);
  assert.deepEqual(store.mergeFromBackup(null), empty);
  assert.deepEqual(store.mergeFromBackup(undefined), empty);
  assert.deepEqual(store.mergeFromBackup({}), empty);
});

test("mergeFromBackup coexists with existing reminders", (t) => {
  const dir = tempDir(t);
  const store = new Storage(dir);
  store.add(reminder("pre"));
  store.mergeFromBackup(backupData([reminder("1")]));
  assert.equal(store.getActive().length, 2);
  assert.ok(store.getActive().some((r) => r.id === "pre"));
  assert.ok(store.getActive().some((r) => r.id === "1"));
});
