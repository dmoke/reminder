"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const Storage = require("../app/storage.js");

// Create a fresh, isolated temp directory for a single test and register its
// cleanup with the test context so it is removed afterwards regardless of the
// test outcome. Each test therefore gets its own data folder and never touches
// the real user data directory, keeping the suite parallel-safe.
function makeTempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "storage-test-"));
  t.after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

function readJSON(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function listDir(dir) {
  return fs.readdirSync(dir);
}

test("construction on empty dir initializes reminders.json with [] and getActive() returns []", (t) => {
  const dir = makeTempDir(t);
  const storage = new Storage(dir);

  // The active file must have been created on disk during construction.
  const activePath = path.join(dir, "reminders.json");
  assert.ok(fs.existsSync(activePath), "reminders.json should exist after construction");
  assert.deepEqual(readJSON(activePath), [], "reminders.json should contain an empty array");

  // In-memory cache reflects the empty file.
  assert.deepEqual(storage.getActive(), [], "getActive() should return an empty array");
});

test("add() appends, persists to reminders.json on disk, and getActive() reflects it", (t) => {
  const dir = makeTempDir(t);
  const storage = new Storage(dir);

  const reminder = { id: "a1", text: "buy milk" };
  storage.add(reminder);

  // In-memory view.
  assert.deepEqual(storage.getActive(), [reminder], "getActive() should include the added reminder");

  // Persisted view (read the file back from disk).
  const onDisk = readJSON(path.join(dir, "reminders.json"));
  assert.deepEqual(onDisk, [reminder], "reminders.json on disk should include the added reminder");

  // A second add appends rather than replaces.
  const second = { id: "a2", text: "walk dog" };
  storage.add(second);
  assert.deepEqual(readJSON(path.join(dir, "reminders.json")), [reminder, second]);
});

test("add()/update()/delete()/archive() each invoke onChange exactly once per call", (t) => {
  const dir = makeTempDir(t);
  let count = 0;
  const storage = new Storage(dir, () => {
    count += 1;
  });

  // Constructing on an empty dir writes the file but does NOT call notify(),
  // so the counter should still be 0 here.
  assert.equal(count, 0, "construction should not invoke onChange");

  storage.add({ id: "x1", text: "one" });
  assert.equal(count, 1, "add() should invoke onChange exactly once");

  storage.update("x1", { text: "one-updated" });
  assert.equal(count, 2, "update() should invoke onChange exactly once");

  storage.archive("x1");
  assert.equal(count, 3, "archive() should invoke onChange exactly once");

  // Re-add so there is something to delete.
  storage.add({ id: "x2", text: "two" });
  assert.equal(count, 4, "add() (second) should invoke onChange exactly once");

  storage.delete("x2");
  assert.equal(count, 5, "delete() should invoke onChange exactly once");
});

test("update() returns true and mutates the matching reminder", (t) => {
  const dir = makeTempDir(t);
  const storage = new Storage(dir);
  storage.add({ id: "u1", text: "old", priority: 1 });

  const result = storage.update("u1", { text: "new" });
  assert.equal(result, true, "update() should return true for a known id");

  const item = storage.getActive().find((r) => r.id === "u1");
  assert.equal(item.text, "new", "text should be updated");
  assert.equal(item.priority, 1, "untouched fields should be preserved (Object.assign merge)");

  // Persisted to disk.
  const onDisk = readJSON(path.join(dir, "reminders.json"));
  assert.equal(onDisk[0].text, "new");
});

test("update() returns false and does NOT call onChange for an unknown id", (t) => {
  const dir = makeTempDir(t);
  let count = 0;
  const storage = new Storage(dir, () => {
    count += 1;
  });
  storage.add({ id: "u1", text: "old" });
  assert.equal(count, 1, "precondition: add() called onChange once");

  const result = storage.update("does-not-exist", { text: "new" });
  assert.equal(result, false, "update() should return false for an unknown id");
  assert.equal(count, 1, "update() must not invoke onChange for an unknown id");
});

test("archive() moves a reminder to the FRONT of history, sets done/completedAt, removes from active, returns true", (t) => {
  const dir = makeTempDir(t);
  const storage = new Storage(dir);

  storage.add({ id: "r1", text: "first" });
  storage.add({ id: "r2", text: "second" });

  const before = Date.now();
  const ok1 = storage.archive("r1");
  const after = Date.now();
  assert.equal(ok1, true, "archive() should return true for a known id");

  // Removed from active (both memory and disk).
  assert.deepEqual(
    storage.getActive().map((r) => r.id),
    ["r2"],
    "archived reminder should be removed from active"
  );
  assert.deepEqual(
    readJSON(path.join(dir, "reminders.json")).map((r) => r.id),
    ["r2"]
  );

  // Added to history with the right shape.
  const history1 = readJSON(path.join(dir, "history.json"));
  assert.equal(history1.length, 1);
  const archived1 = history1[0];
  assert.equal(archived1.id, "r1");
  assert.equal(archived1.done, true, "archived reminder should have done:true");

  // completedAt must be a valid ISO string within the call window.
  assert.equal(typeof archived1.completedAt, "string");
  const ts = Date.parse(archived1.completedAt);
  assert.ok(!Number.isNaN(ts), "completedAt should be a parseable date");
  assert.equal(
    new Date(archived1.completedAt).toISOString(),
    archived1.completedAt,
    "completedAt should be a canonical ISO string"
  );
  assert.ok(ts >= before && ts <= after, "completedAt should fall within the archive() call window");

  // Archive the second one and confirm unshift (newest at the front).
  const ok2 = storage.archive("r2");
  assert.equal(ok2, true);
  const history2 = readJSON(path.join(dir, "history.json"));
  assert.deepEqual(
    history2.map((r) => r.id),
    ["r2", "r1"],
    "most recently archived reminder should be at the FRONT of history"
  );
});

test("archive() returns false for an unknown id", (t) => {
  const dir = makeTempDir(t);
  let count = 0;
  const storage = new Storage(dir, () => {
    count += 1;
  });
  storage.add({ id: "r1", text: "first" });
  assert.equal(count, 1);

  const result = storage.archive("nope");
  assert.equal(result, false, "archive() should return false for an unknown id");
  assert.equal(count, 1, "archive() of unknown id must not invoke onChange");
  // Active unchanged, no history file changes expected.
  assert.deepEqual(storage.getActive().map((r) => r.id), ["r1"]);
});

test("delete() removes the id from BOTH active and history files", (t) => {
  const dir = makeTempDir(t);
  const storage = new Storage(dir);

  // Put the same id in active and (via archive of a separate item) in history,
  // plus the target id directly into history to prove it is removed there too.
  storage.add({ id: "keep", text: "keep me" });
  storage.add({ id: "target", text: "delete me" });

  // Seed history.json with an entry that shares the target id so we can verify
  // delete() strips it from history as well.
  const historyPath = path.join(dir, "history.json");
  fs.writeFileSync(
    historyPath,
    JSON.stringify([{ id: "target", text: "old archived" }, { id: "other", text: "other" }], null, 2)
  );

  storage.delete("target");

  // Removed from active.
  const active = readJSON(path.join(dir, "reminders.json"));
  assert.deepEqual(active.map((r) => r.id), ["keep"], "target removed from active");

  // Removed from history, other entries preserved.
  const history = readJSON(historyPath);
  assert.deepEqual(history.map((r) => r.id), ["other"], "target removed from history, others kept");
});

test("persistence/reload: a second Storage instance sees data written by the first", (t) => {
  const dir = makeTempDir(t);

  const first = new Storage(dir);
  first.add({ id: "p1", text: "persist me" });
  first.archive("p1");
  first.add({ id: "p2", text: "still active" });

  // A brand new instance over the same dir rehydrates its cache from disk.
  const second = new Storage(dir);
  assert.deepEqual(
    second.getActive().map((r) => r.id),
    ["p2"],
    "second instance should see active reminders written by the first"
  );
  assert.deepEqual(
    second.getHistory().map((r) => r.id),
    ["p1"],
    "second instance should see history written by the first"
  );
});

test("corrupt reminders.json is moved to a *.bak file and getActive() returns []", (t) => {
  const dir = makeTempDir(t);

  // Write invalid JSON to the active file before constructing Storage.
  const activePath = path.join(dir, "reminders.json");
  fs.writeFileSync(activePath, "{ this is not valid json ]");

  // Silence the expected console.error noise during this test only.
  const originalError = console.error;
  console.error = () => {};
  let storage;
  try {
    storage = new Storage(dir);
  } finally {
    console.error = originalError;
  }

  // getActive() should recover with an empty array.
  assert.deepEqual(storage.getActive(), [], "getActive() should return [] after corruption recovery");

  // A backup file matching reminders.json.<timestamp>.bak should now exist.
  const baks = listDir(dir).filter((name) => /^reminders\.json\.\d+\.bak$/.test(name));
  assert.equal(baks.length, 1, "exactly one .bak backup of the corrupt file should exist");

  // The corrupt content should have been preserved in the backup.
  assert.equal(
    fs.readFileSync(path.join(dir, baks[0]), "utf8"),
    "{ this is not valid json ]",
    "backup should contain the original corrupt content"
  );

  // And reminders.json should have been rewritten with a valid empty array.
  assert.deepEqual(readJSON(activePath), []);
});

test("writeFile leaves no leftover .tmp file after a successful write", (t) => {
  const dir = makeTempDir(t);
  const storage = new Storage(dir);

  storage.add({ id: "t1", text: "one" });
  storage.update("t1", { text: "two" });
  storage.archive("t1");
  storage.add({ id: "t2", text: "three" });
  storage.delete("t2");

  const tmpFiles = listDir(dir).filter((name) => name.endsWith(".tmp"));
  assert.deepEqual(tmpFiles, [], "no .tmp files should remain after successful writes");
});

test("valid JSON that is not an array is quarantined to a *.bak file and getActive() returns []", (t) => {
  const dir = makeTempDir(t);

  // A file that parses fine but is the wrong shape (e.g. a hand-edited or
  // legacy file, or a bad restore) must not flow through as live data and crash
  // the scheduler — it should be treated like corruption.
  const activePath = path.join(dir, "reminders.json");
  fs.writeFileSync(activePath, '{"oops":"not an array"}');

  const originalError = console.error;
  console.error = () => {};
  let storage;
  try {
    storage = new Storage(dir);
  } finally {
    console.error = originalError;
  }

  assert.deepEqual(storage.getActive(), [], "getActive() should recover with []");
  const baks = listDir(dir).filter((name) => /^reminders\.json\.\d+\.bak$/.test(name));
  assert.equal(baks.length, 1, "the wrong-shape file should be quarantined to a .bak");
  assert.equal(
    fs.readFileSync(path.join(dir, baks[0]), "utf8"),
    '{"oops":"not an array"}',
    "original content should be preserved in the backup",
  );
  assert.deepEqual(readJSON(activePath), [], "reminders.json rewritten as an empty array");

  // The recovered store is usable (the crash this guards against was push on a
  // non-array).
  storage.add({ id: "ok", text: "still works" });
  assert.deepEqual(storage.getActive().map((r) => r.id), ["ok"]);
});

test("an unreadable file is left intact when it cannot be quarantined", (t) => {
  const dir = makeTempDir(t);
  const activePath = path.join(dir, "reminders.json");
  const original = '[{"id":"a"},{"id":"b"}';  // truncated mid-write
  fs.writeFileSync(activePath, original);

  // Make the quarantine rename fail, the way a lock from antivirus, a OneDrive
  // sync or a permissions blip does. The read failure is then very likely
  // transient — and these bytes are the user's only copy, so overwriting them
  // with [] would turn a hiccup into permanent loss.
  const realRename = fs.renameSync;
  fs.renameSync = (from, to) => {
    if (String(to).endsWith(".bak")) {
      throw Object.assign(new Error("EBUSY: resource busy or locked"), {
        code: "EBUSY",
      });
    }
    return realRename(from, to);
  };
  t.after(() => {
    fs.renameSync = realRename;
  });

  const storage = new Storage(dir, () => {});

  // The app still starts, just with nothing loaded for this session.
  assert.deepEqual(storage.getActive(), []);
  // …and the file on disk is byte-for-byte what it was.
  assert.equal(
    fs.readFileSync(activePath, "utf8"),
    original,
    "the original bytes must survive a failed quarantine",
  );
  assert.equal(storage.lastReadFailure.quarantined, false);
  assert.equal(storage.lastReadFailure.file, "reminders.json");
});

test("a successful quarantine still starts a fresh empty file", (t) => {
  const dir = makeTempDir(t);
  const activePath = path.join(dir, "reminders.json");
  fs.writeFileSync(activePath, "{ not an array");

  const storage = new Storage(dir, () => {});

  assert.deepEqual(storage.getActive(), []);
  assert.deepEqual(readJSON(activePath), [], "a usable empty list takes over");
  assert.equal(storage.lastReadFailure.quarantined, true);
  assert.ok(
    fs.existsSync(storage.lastReadFailure.backupPath),
    "the original content is preserved alongside",
  );
});

function writeJSON(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

// Blocks a rename to *.bak so a file can neither be read nor set aside — the
// "locked by antivirus / mid-sync" case. Restores itself after the test.
function blockQuarantine(t) {
  const realRename = fs.renameSync;
  fs.renameSync = (from, to) => {
    if (String(to).endsWith(".bak")) {
      throw Object.assign(new Error("EBUSY: resource busy or locked"), {
        code: "EBUSY",
      });
    }
    return realRename(from, to);
  };
  t.after(() => {
    fs.renameSync = realRename;
  });
}

test("a preserved file survives a whole session of writes, not just the read", (t) => {
  const dir = makeTempDir(t);
  const activePath = path.join(dir, "reminders.json");
  const original = '[{"id":"REAL"}';
  fs.writeFileSync(activePath, original);
  blockQuarantine(t);

  const storage = new Storage(dir, () => {});
  // Ordinary user actions that each end in a write to reminders.json.
  storage.add({ id: "new" });
  storage.update("new", { text: "x" });

  assert.equal(
    fs.readFileSync(activePath, "utf8"),
    original,
    "writes must not overwrite a file we failed to preserve",
  );
});

test("completing a reminder is refused rather than losing it, when history is stuck", (t) => {
  const dir = makeTempDir(t);
  writeJSON(path.join(dir, "reminders.json"), [
    { id: "a", text: "pay rent" },
    { id: "b", text: "call mom" },
  ]);
  fs.writeFileSync(path.join(dir, "history.json"), "{ truncated");
  blockQuarantine(t);

  const storage = new Storage(dir, () => {});
  // Completing MOVES the reminder between the two files. If the history side
  // cannot be written, doing the active side anyway drops it from both.
  assert.equal(storage.archive("a"), false);
  assert.deepEqual(
    readJSON(path.join(dir, "reminders.json")).map((r) => r.id),
    ["a", "b"],
    "the reminder must still be in the active list",
  );
});

test("a recurring occurrence is not skipped when history is stuck", (t) => {
  const dir = makeTempDir(t);
  writeJSON(path.join(dir, "reminders.json"), [
    { id: "a", time: "2026-09-19T09:00:00.000Z" },
  ]);
  fs.writeFileSync(path.join(dir, "history.json"), "{ truncated");
  blockQuarantine(t);

  const storage = new Storage(dir, () => {});
  assert.equal(storage.recurComplete("a", "2026-09-26T09:00:00.000Z"), false);
  assert.equal(
    readJSON(path.join(dir, "reminders.json"))[0].time,
    "2026-09-19T09:00:00.000Z",
    "advancing without recording the occurrence would silently lose it",
  );
});

test("deleting is refused rather than half-applied when history is stuck", (t) => {
  const dir = makeTempDir(t);
  writeJSON(path.join(dir, "reminders.json"), [{ id: "a" }]);
  fs.writeFileSync(path.join(dir, "history.json"), "{ truncated");
  blockQuarantine(t);

  const storage = new Storage(dir, () => {});
  assert.equal(storage.delete("a"), false);
  assert.deepEqual(readJSON(path.join(dir, "reminders.json")), [{ id: "a" }]);
});

test("restoring a backup is refused rather than dropping its completed half", (t) => {
  const dir = makeTempDir(t);
  writeJSON(path.join(dir, "reminders.json"), []);
  fs.writeFileSync(path.join(dir, "history.json"), "{ truncated");
  blockQuarantine(t);

  const storage = new Storage(dir, () => {});
  const summary = storage.mergeFromBackup({
    reminders: [{ id: "x" }],
    history: [{ id: "h" }],
  });
  assert.equal(summary.added, 0);
  assert.ok(summary.error, "the caller must be told the restore did not happen");
});

test("once the file is readable again, normal operation resumes", (t) => {
  const dir = makeTempDir(t);
  const activePath = path.join(dir, "reminders.json");
  fs.writeFileSync(activePath, '[{"id":"REAL"}');

  const realRename = fs.renameSync;
  let blocking = true;
  fs.renameSync = (from, to) => {
    if (blocking && String(to).endsWith(".bak")) {
      throw Object.assign(new Error("EBUSY"), { code: "EBUSY" });
    }
    return realRename(from, to);
  };
  t.after(() => {
    fs.renameSync = realRename;
  });

  const blocked = new Storage(dir, () => {});
  blocked.add({ id: "ignored" });
  assert.equal(fs.readFileSync(activePath, "utf8"), '[{"id":"REAL"}');

  // The lock clears and the file is valid again.
  blocking = false;
  writeJSON(activePath, [{ id: "REAL" }]);
  const recovered = new Storage(dir, () => {});
  recovered.add({ id: "later" });
  assert.deepEqual(
    readJSON(activePath).map((r) => r.id),
    ["REAL", "later"],
  );
});
