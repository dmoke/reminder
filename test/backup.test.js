"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const Backup = require("../app/backup.js");

// Fresh isolated temp data folder per test, auto-cleaned regardless of outcome.
function makeTempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "backup-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeJSON(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function backupsDir(dir) {
  return path.join(dir, "backups");
}

function listBackupFiles(dir) {
  try {
    return fs
      .readdirSync(backupsDir(dir))
      .filter((n) => /^reminder-backup-.*\.json$/.test(n));
  } catch {
    return [];
  }
}

// Seed reminders.json + history.json in a data folder.
function seed(dir, reminders, history) {
  writeJSON(path.join(dir, "reminders.json"), reminders);
  writeJSON(path.join(dir, "history.json"), history);
}

test("buildSnapshot captures both files with a versioned, self-describing envelope", (t) => {
  const dir = makeTempDir(t);
  seed(dir, [{ id: "a", text: "one" }], [{ id: "b", text: "done" }]);

  const snap = Backup.buildSnapshot(dir, "1.1.0", "manual", {
    now: new Date("2026-06-28T12:00:00.000Z"),
  });

  assert.equal(snap.format, "reminder-backup");
  assert.equal(snap.formatVersion, Backup.FORMAT_VERSION);
  assert.equal(snap.appVersion, "1.1.0");
  assert.equal(snap.dataVersion, "1.1.0");
  assert.equal(snap.reason, "manual");
  assert.equal(snap.createdAt, "2026-06-28T12:00:00.000Z");
  assert.deepEqual(snap.counts, { reminders: 1, history: 1 });
  assert.deepEqual(snap.data.reminders, [{ id: "a", text: "one" }]);
  assert.deepEqual(snap.data.history, [{ id: "b", text: "done" }]);
  assert.equal(snap.issues, undefined, "no issues for valid sources");
});

test("buildSnapshot treats a missing source as an empty list", (t) => {
  const dir = makeTempDir(t);
  // Only reminders.json exists; history.json is absent.
  writeJSON(path.join(dir, "reminders.json"), [{ id: "a" }]);

  const snap = Backup.buildSnapshot(dir, "1.1.0", "manual");
  assert.deepEqual(snap.data.history, []);
  assert.equal(snap.counts.history, 0);
});

test("buildSnapshot preserves an unparseable source verbatim and records the issue", (t) => {
  const dir = makeTempDir(t);
  fs.writeFileSync(path.join(dir, "reminders.json"), "{ broken json ]");
  writeJSON(path.join(dir, "history.json"), []);

  const snap = Backup.buildSnapshot(dir, "1.1.0", "manual");
  assert.equal(snap.data.reminders.__backupRaw__, true);
  assert.equal(snap.data.reminders.text, "{ broken json ]");
  assert.equal(snap.counts.reminders, null);
  assert.ok(snap.issues && typeof snap.issues.reminders === "string");
});

test("buildSnapshot omits an unreadable (non-ENOENT) source instead of fabricating data", (t) => {
  const dir = makeTempDir(t);
  // A directory where reminders.json should be: readFileSync fails with EISDIR
  // (not ENOENT), so the source is present-but-unreadable.
  fs.mkdirSync(path.join(dir, "reminders.json"));
  writeJSON(path.join(dir, "history.json"), [{ id: "h" }]);

  const snap = Backup.buildSnapshot(dir, "1.1.0", "manual");
  assert.equal("reminders" in snap.data, false, "unreadable source is omitted");
  assert.equal(snap.counts.reminders, null);
  assert.ok(snap.issues && typeof snap.issues.reminders === "string");
  // The readable source is still captured normally.
  assert.deepEqual(snap.data.history, [{ id: "h" }]);
});

test("buildSnapshot preserves a valid-but-non-array source verbatim", (t) => {
  const dir = makeTempDir(t);
  fs.writeFileSync(path.join(dir, "reminders.json"), '{"not":"an array"}');
  writeJSON(path.join(dir, "history.json"), []);

  const snap = Backup.buildSnapshot(dir, "1.1.0", "manual");
  assert.equal(snap.data.reminders.__backupRaw__, true);
  assert.equal(snap.data.reminders.text, '{"not":"an array"}');
  assert.ok(snap.issues && /not an array/.test(snap.issues.reminders));
});

test("createBackup writes one snapshot file into backups/ and leaves no .tmp", (t) => {
  const dir = makeTempDir(t);
  seed(dir, [{ id: "a" }], []);

  const { path: dest, snapshot } = Backup.createBackup(dir, "1.1.0", "manual");

  assert.ok(fs.existsSync(dest), "backup file should exist");
  assert.equal(path.dirname(dest), backupsDir(dir));
  const onDisk = JSON.parse(fs.readFileSync(dest, "utf8"));
  assert.equal(onDisk.appVersion, "1.1.0");
  assert.equal(onDisk.createdAt, snapshot.createdAt);

  const leftover = fs
    .readdirSync(backupsDir(dir))
    .filter((n) => n.endsWith(".tmp"));
  assert.deepEqual(leftover, [], "no .tmp file should remain");
});

test("maybeBackupOnStartup creates an initial backup when none exists", (t) => {
  const dir = makeTempDir(t);
  seed(dir, [{ id: "a" }], []);

  const res = Backup.maybeBackupOnStartup(dir, "1.1.0");
  assert.equal(res.created, true);
  assert.equal(res.reason, "initial");
  assert.equal(listBackupFiles(dir).length, 1);
});

test("maybeBackupOnStartup skips a fresh same-version backup, but takes one when stale", (t) => {
  const dir = makeTempDir(t);
  seed(dir, [{ id: "a" }], []);

  // keep:1000 so rotation doesn't remove earlier files — this test is about the
  // backup *cadence*, not retention.
  const t0 = new Date("2026-06-28T12:00:00.000Z");
  const first = Backup.maybeBackupOnStartup(dir, "1.1.0", { now: t0, keep: 1000 });
  assert.equal(first.created, true);

  // 1 hour later, same version → within the 12h window → skip.
  const t1 = new Date("2026-06-28T13:00:00.000Z");
  const second = Backup.maybeBackupOnStartup(dir, "1.1.0", { now: t1, keep: 1000 });
  assert.equal(second.created, false);
  assert.equal(second.reason, null);
  assert.equal(listBackupFiles(dir).length, 1);

  // 13 hours after the first → stale → a daily backup is taken.
  const t2 = new Date("2026-06-29T01:00:00.000Z");
  const third = Backup.maybeBackupOnStartup(dir, "1.1.0", { now: t2, keep: 1000 });
  assert.equal(third.created, true);
  assert.equal(third.reason, "daily");
  assert.equal(listBackupFiles(dir).length, 2);
});

test("maybeBackupOnStartup forces a backup on app-version change even when fresh", (t) => {
  const dir = makeTempDir(t);
  seed(dir, [{ id: "a" }], []);

  const t0 = new Date("2026-06-28T12:00:00.000Z");
  Backup.maybeBackupOnStartup(dir, "1.1.0", { now: t0, keep: 1000 });

  // Seconds later, but a new app version → must capture pre/post-update state.
  const t1 = new Date("2026-06-28T12:00:05.000Z");
  const res = Backup.maybeBackupOnStartup(dir, "1.2.0", { now: t1, keep: 1000 });
  assert.equal(res.created, true);
  assert.equal(res.reason, "version-change");
  assert.equal(listBackupFiles(dir).length, 2);
});

test("prune keeps only the newest `keep` backups", (t) => {
  const dir = makeTempDir(t);
  seed(dir, [{ id: "a" }], []);

  const stamps = [
    "2026-06-01T00:00:00.000Z",
    "2026-06-02T00:00:00.000Z",
    "2026-06-03T00:00:00.000Z",
    "2026-06-04T00:00:00.000Z", // newest
  ];
  for (const when of stamps) {
    Backup.createBackup(dir, "1.1.0", "daily", { now: new Date(when), keep: 1000 });
  }
  assert.equal(listBackupFiles(dir).length, 4);

  Backup.prune(dir, 2);

  const kept = Backup.listBackups(dir).map((b) => b.createdAt).sort();
  assert.deepEqual(kept, ["2026-06-03T00:00:00.000Z", "2026-06-04T00:00:00.000Z"]);
});

test("default retention keeps a single backup file", (t) => {
  const dir = makeTempDir(t);
  seed(dir, [{ id: "a" }], []);
  // Three backups at the default keep — only the newest should remain.
  Backup.createBackup(dir, "1.1.0", "daily", { now: new Date("2026-06-01T00:00:00.000Z") });
  Backup.createBackup(dir, "1.1.0", "daily", { now: new Date("2026-06-02T00:00:00.000Z") });
  const last = Backup.createBackup(dir, "1.1.0", "daily", { now: new Date("2026-06-03T00:00:00.000Z") });

  const files = listBackupFiles(dir);
  assert.equal(files.length, 1, "only one backup file is retained by default");
  assert.equal(Backup.listBackups(dir)[0].path, last.path, "the newest is the one kept");
});

test("listBackups returns entries newest-first with envelope metadata", (t) => {
  const dir = makeTempDir(t);
  seed(dir, [], []);
  Backup.createBackup(dir, "1.1.0", "daily", { now: new Date("2026-06-01T00:00:00.000Z"), keep: 1000 });
  Backup.createBackup(dir, "1.2.0", "daily", { now: new Date("2026-06-02T00:00:00.000Z"), keep: 1000 });

  const list = Backup.listBackups(dir);
  assert.equal(list.length, 2);
  assert.equal(list[0].appVersion, "1.2.0", "newest first");
  assert.equal(list[1].appVersion, "1.1.0");
  assert.ok(list.every((b) => b.valid));
});

test("restore overwrites live files from a backup and snapshots current state first", (t) => {
  const dir = makeTempDir(t);
  // Original data, then a backup of it.
  seed(dir, [{ id: "orig", text: "original" }], [{ id: "h1" }]);
  const { path: backupPath } = Backup.createBackup(dir, "1.1.0", "manual", {
    now: new Date("2026-06-28T12:00:00.000Z"),
  });

  // Now the live data drifts/breaks.
  seed(dir, [{ id: "changed", text: "different" }], []);

  const res = Backup.restore(backupPath, dir, "1.1.0");

  assert.deepEqual(res.restored, ["reminders.json", "history.json"]);
  assert.ok(res.safetyBackup, "a pre-restore safety snapshot should be created");

  // Live files now match the backup again.
  const reminders = JSON.parse(
    fs.readFileSync(path.join(dir, "reminders.json"), "utf8"),
  );
  const history = JSON.parse(
    fs.readFileSync(path.join(dir, "history.json"), "utf8"),
  );
  assert.deepEqual(reminders, [{ id: "orig", text: "original" }]);
  assert.deepEqual(history, [{ id: "h1" }]);

  // The safety snapshot captured the drifted state, so the restore is undoable.
  const safety = JSON.parse(fs.readFileSync(res.safetyBackup, "utf8"));
  assert.deepEqual(safety.data.reminders, [{ id: "changed", text: "different" }]);
  assert.equal(safety.reason, "pre-restore");
});

test("restore writes back unparseable raw content verbatim", (t) => {
  const dir = makeTempDir(t);
  fs.writeFileSync(path.join(dir, "reminders.json"), "{ half written");
  writeJSON(path.join(dir, "history.json"), []);
  const { path: backupPath } = Backup.createBackup(dir, "1.1.0", "manual");

  // Wipe the live file, then restore.
  writeJSON(path.join(dir, "reminders.json"), []);
  Backup.restore(backupPath, dir, "1.1.0");

  assert.equal(
    fs.readFileSync(path.join(dir, "reminders.json"), "utf8"),
    "{ half written",
    "raw bytes should be restored exactly",
  );
});

test("loadBackup rejects a file that is not a reminder backup", (t) => {
  const dir = makeTempDir(t);
  const bogus = path.join(dir, "bogus.json");
  writeJSON(bogus, { hello: "world" });
  assert.throws(() => Backup.loadBackup(bogus), /not a reminder backup/);
});

test("safeBackupOnStartup never throws on a bad data path", () => {
  // A path whose parent cannot be created should be swallowed, not thrown.
  const res = Backup.safeBackupOnStartup("\0invalid\0path", "1.1.0");
  assert.equal(res.created, false);
  assert.ok("error" in res);
});

test("two backups in the same millisecond both survive (no silent overwrite)", (t) => {
  const dir = makeTempDir(t);
  seed(dir, [{ id: "v1" }], []);
  const now = new Date("2026-06-28T12:00:00.000Z");

  const a = Backup.createBackup(dir, "1.0.0", "initial", { now, keep: 1000 });
  // Same instant, different version/data — must NOT clobber the first file.
  seed(dir, [{ id: "v2" }], []);
  const b = Backup.createBackup(dir, "2.0.0", "version-change", { now, keep: 1000 });

  assert.notEqual(a.path, b.path, "second backup must get a distinct filename");
  assert.equal(listBackupFiles(dir).length, 2, "both backups must exist on disk");
  // The first backup's contents are intact.
  const first = JSON.parse(fs.readFileSync(a.path, "utf8"));
  assert.deepEqual(first.data.reminders, [{ id: "v1" }]);
});

test("a corrupt stray backup does not force a version-change backup every launch", (t) => {
  const dir = makeTempDir(t);
  seed(dir, [{ id: "a" }], []);
  // A real backup, plus a later-named but unparseable stray file.
  Backup.maybeBackupOnStartup(dir, "1.1.0", { now: new Date("2026-06-28T12:00:00.000Z") });
  fs.writeFileSync(
    path.join(backupsDir(dir), "reminder-backup-9999-99-99.json"),
    "{ truncated",
  );

  // Same version, shortly after — the corrupt stray must be ignored for the
  // decision, so no spurious "version-change" backup is taken.
  const res = Backup.maybeBackupOnStartup(dir, "1.1.0", {
    now: new Date("2026-06-28T12:05:00.000Z"),
  });
  assert.equal(res.created, false, "should not back up again so soon");
  assert.equal(res.reason, null);
});

test("version-change records the previous version as dataVersion (for legacy migration)", (t) => {
  const dir = makeTempDir(t);
  seed(dir, [{ id: "old" }], []);
  // Last good state under v1.0.0.
  Backup.maybeBackupOnStartup(dir, "1.0.0", {
    now: new Date("2026-01-01T00:00:00.000Z"),
    keep: 1000,
  });

  // App updates to 1.1.0; first launch captures the still-v1.0.0 data before the
  // new version touches anything. appVersion is the running build; dataVersion
  // records the version the captured bytes actually belong to.
  const vc = Backup.maybeBackupOnStartup(dir, "1.1.0", {
    now: new Date("2026-06-01T00:00:00.000Z"),
    keep: 1000,
  });
  assert.equal(vc.reason, "version-change");
  assert.equal(vc.snapshot.appVersion, "1.1.0");
  assert.equal(vc.snapshot.dataVersion, "1.0.0");
  assert.deepEqual(vc.snapshot.data.reminders, [{ id: "old" }], "captured pre-update data");
});

test("restore aborts (does not overwrite live data) when the safety snapshot fails", (t) => {
  // Source folder with a good backup to restore FROM.
  const src = makeTempDir(t);
  seed(src, [{ id: "good" }], []);
  const { path: backupPath } = Backup.createBackup(src, "1.1.0", "manual");

  // Target folder has live data, but its backups/ path is blocked by a FILE,
  // so the pre-restore safety snapshot cannot be created.
  const dst = makeTempDir(t);
  seed(dst, [{ id: "live" }], [{ id: "h" }]);
  fs.writeFileSync(backupsDir(dst), "not a directory");

  assert.throws(
    () => Backup.restore(backupPath, dst, "1.1.0"),
    /restore aborted/,
    "restore must refuse when it cannot make a safety snapshot",
  );
  // Live data is untouched.
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(dst, "reminders.json"), "utf8")),
    [{ id: "live" }],
  );
});

test("restore leaves a live file untouched when the backup omits that source", (t) => {
  const dir = makeTempDir(t);
  seed(dir, [{ id: "r-old" }], [{ id: "h-keep" }]);
  // Hand-written legacy backup envelope that only carries `reminders`.
  const backupPath = path.join(dir, "legacy.json");
  writeJSON(backupPath, {
    format: "reminder-backup",
    data: { reminders: [{ id: "r-new" }] },
  });

  const res = Backup.restore(backupPath, dir, "1.1.0");
  assert.deepEqual(res.restored, ["reminders.json"], "only the present source is written");
  // history.json must be byte-unchanged (not wiped or set to 'undefined').
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(dir, "history.json"), "utf8")),
    [{ id: "h-keep" }],
  );
});

test("restore refuses to write a non-array source shape (e.g. null) over live data", (t) => {
  const dir = makeTempDir(t);
  seed(dir, [{ id: "live" }], []);
  const backupPath = path.join(dir, "bad.json");
  writeJSON(backupPath, {
    format: "reminder-backup",
    data: { reminders: null, history: [{ id: "h" }] },
  });

  const res = Backup.restore(backupPath, dir, "1.1.0");
  assert.equal(res.restored.includes("reminders.json"), false, "null source is skipped");
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(dir, "reminders.json"), "utf8")),
    [{ id: "live" }],
    "live reminders left intact",
  );
  // The valid history array in the backup is still applied.
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(dir, "history.json"), "utf8")),
    [{ id: "h" }],
  );
});

test("listBackups ignores stray files and matching-named directories", (t) => {
  const dir = makeTempDir(t);
  seed(dir, [], []);
  const real = Backup.createBackup(dir, "1.1.0", "manual").path;
  // Noise alongside the real backup.
  fs.writeFileSync(path.join(backupsDir(dir), "notes.txt"), "ignore me");
  fs.writeFileSync(path.join(backupsDir(dir), "reminder-backup-x.json.tmp"), "{}");
  fs.mkdirSync(path.join(backupsDir(dir), "reminder-backup-adir.json"));

  const list = Backup.listBackups(dir);
  assert.equal(list.length, 1, "only the genuine backup file is listed");
  assert.equal(list[0].path, real);
});

test("listBackups falls back to mtime for a non-empty but unparseable createdAt", (t) => {
  const dir = makeTempDir(t);
  fs.mkdirSync(backupsDir(dir), { recursive: true });
  // A backup whose createdAt is present but garbage → Date.parse → NaN.
  writeJSON(path.join(backupsDir(dir), "reminder-backup-garbage.json"), {
    format: "reminder-backup",
    appVersion: "1.1.0",
    createdAt: "garbage",
    data: { reminders: [], history: [] },
  });

  const list = Backup.listBackups(dir);
  assert.equal(list.length, 1);
  assert.equal(Number.isNaN(list[0].sortKey), false, "sortKey must be a finite number");
});

test("createBackup writes to an explicit backupDir OUTSIDE the data folder", (t) => {
  const data = makeTempDir(t);
  const store = makeTempDir(t); // separate backups root
  seed(data, [{ id: "a" }], []);

  const { path: dest } = Backup.createBackup(data, "1.1.0", "manual", {
    backupDir: store,
  });

  assert.equal(path.dirname(dest), store, "snapshot lands in the explicit dir");
  assert.equal(
    fs.existsSync(backupsDir(data)),
    false,
    "no backups/ folder is created inside the data folder",
  );
  assert.ok(fs.existsSync(dest));
});

test("maybeBackupOnStartup honors backupDir and keeps the data folder clean", (t) => {
  const data = makeTempDir(t);
  const store = makeTempDir(t);
  seed(data, [{ id: "a" }], []);

  const res = Backup.maybeBackupOnStartup(data, "1.1.0", { backupDir: store });
  assert.equal(res.created, true);
  assert.equal(res.reason, "initial");
  assert.equal(path.dirname(res.path), store);
  assert.equal(listBackupFiles(data).length, 0, "data folder has no backups");
  assert.equal(
    fs.readdirSync(store).filter((n) => /^reminder-backup-.*\.json$/.test(n)).length,
    1,
  );
});

test("listBackups/prune operate on the given backupDir", (t) => {
  const data = makeTempDir(t);
  const store = makeTempDir(t);
  seed(data, [{ id: "a" }], []);
  Backup.createBackup(data, "1.0.0", "daily", {
    backupDir: store,
    now: new Date("2026-06-01T00:00:00.000Z"),
    keep: 1000,
  });
  Backup.createBackup(data, "1.1.0", "daily", {
    backupDir: store,
    now: new Date("2026-06-02T00:00:00.000Z"),
    keep: 1000,
  });

  const list = Backup.listBackups(data, store);
  assert.equal(list.length, 2);
  assert.equal(list[0].appVersion, "1.1.0", "newest first, read from store");

  Backup.prune(data, 1, null, store);
  assert.equal(Backup.listBackups(data, store).length, 1, "prune trims the store");
});

test("dataFolderKey is stable, distinct per folder, and filesystem-safe", () => {
  const a = Backup.dataFolderKey("C:/Users/x/OneDrive/Desktop/rem_test");
  const b = Backup.dataFolderKey("C:/Users/x/OneDrive/Desktop/rem_test");
  const c = Backup.dataFolderKey("C:/Users/x/OneDrive/Desktop/other");
  assert.equal(a, b, "same path → same key");
  assert.notEqual(a, c, "different paths → different keys");
  assert.match(a, /^[A-Za-z0-9._-]+$/, "no characters illegal in a filename");
  // A trailing separator must not change the key (same folder).
  assert.equal(Backup.dataFolderKey("/tmp/data"), Backup.dataFolderKey("/tmp/data/"));
});

test("migrateLegacyBackups copies snapshots, skips existing, ignores non-backups, is non-destructive", (t) => {
  const data = makeTempDir(t);
  const store = makeTempDir(t);
  seed(data, [{ id: "a" }], []);
  // Two real legacy snapshots in the data folder, plus noise.
  const legacy = backupsDir(data);
  Backup.createBackup(data, "1.0.0", "daily", { now: new Date("2026-06-01T00:00:00.000Z"), keep: 1000 });
  Backup.createBackup(data, "1.0.0", "daily", { now: new Date("2026-06-02T00:00:00.000Z"), keep: 1000 });
  fs.writeFileSync(path.join(legacy, "notes.txt"), "ignore me");
  const legacyNames = listBackupFiles(data);
  assert.equal(legacyNames.length, 2);
  // Pre-seed one of them into the store to prove it is NOT clobbered.
  fs.mkdirSync(store, { recursive: true });
  fs.writeFileSync(path.join(store, legacyNames[0]), "PRE-EXISTING");

  const res = Backup.migrateLegacyBackups(legacy, store);
  assert.equal(res.migrated.length, 1, "only the not-yet-present snapshot is copied");
  // Non-backup file was not copied.
  assert.equal(fs.existsSync(path.join(store, "notes.txt")), false);
  // Pre-existing file is untouched (not clobbered).
  assert.equal(fs.readFileSync(path.join(store, legacyNames[0]), "utf8"), "PRE-EXISTING");
  // Originals are left in place (non-destructive).
  assert.equal(listBackupFiles(data).length, 2);
});

test("maybeBackupOnStartup migrateFrom carries legacy backups into the new dir", (t) => {
  const data = makeTempDir(t);
  const store = makeTempDir(t);
  seed(data, [{ id: "a" }], []);
  // A legacy in-data-folder snapshot under the OLD app version.
  Backup.createBackup(data, "1.0.0", "version-change", {
    now: new Date("2026-06-01T00:00:00.000Z"),
    keep: 1000,
  });
  const legacyName = listBackupFiles(data)[0];

  // New launch on a NEW version: migrate, then the migrated 1.0.0 backup makes
  // this a version-change (not a spurious "initial").
  const res = Backup.maybeBackupOnStartup(data, "1.1.0", {
    backupDir: store,
    migrateFrom: backupsDir(data),
    now: new Date("2026-06-02T00:00:00.000Z"),
    keep: 1000,
  });
  assert.equal(res.reason, "version-change", "migrated history informs the decision");
  const inStore = fs.readdirSync(store).filter((n) => /^reminder-backup-.*\.json$/.test(n));
  assert.ok(inStore.includes(legacyName), "legacy snapshot now lives in the store");
  assert.equal(inStore.length, 2, "legacy + the new version-change snapshot");
});

test("restore's pre-restore safety snapshot honors opts.backupDir", (t) => {
  const data = makeTempDir(t);
  const store = makeTempDir(t);
  seed(data, [{ id: "orig" }], []);
  const { path: backupPath } = Backup.createBackup(data, "1.1.0", "manual", { backupDir: store });
  seed(data, [{ id: "changed" }], []);

  const res = Backup.restore(backupPath, data, "1.1.0", { backupDir: store });
  assert.ok(res.safetyBackup, "a safety snapshot was created");
  assert.equal(path.dirname(res.safetyBackup), store, "safety snapshot lands in the store");
  assert.equal(fs.existsSync(backupsDir(data)), false, "data folder stays free of backups/");
});

test("version-change detection across a prior null-version backup", (t) => {
  const dir = makeTempDir(t);
  seed(dir, [{ id: "a" }], []);
  // A backup with no app version (e.g. taken before APP_VERSION was wired).
  Backup.createBackup(dir, null, "initial", { now: new Date("2026-06-28T12:00:00.000Z") });

  // Next launch still with no version → must NOT spuriously back up.
  const same = Backup.maybeBackupOnStartup(dir, undefined, {
    now: new Date("2026-06-28T12:00:01.000Z"),
  });
  assert.equal(same.created, false);

  // Next launch with a real version → MUST force a version-change backup.
  const changed = Backup.maybeBackupOnStartup(dir, "1.1.0", {
    now: new Date("2026-06-28T12:00:02.000Z"),
  });
  assert.equal(changed.created, true);
  assert.equal(changed.reason, "version-change");
});

// --- Regression tests for review findings (data-safety) ---------------------

test("prune never evicts the last good copy of a source for an incomplete newer snapshot", (t) => {
  const data = makeTempDir(t);
  const store = makeTempDir(t);
  seed(data, [{ id: "keep-me", text: "real" }], []);
  // A GOOD backup under v1.0.0 capturing the real reminders.
  Backup.createBackup(data, "1.0.0", "version-change", {
    backupDir: store,
    now: new Date("2026-06-01T00:00:00.000Z"),
  });

  // reminders.json becomes unreadable (a directory → EISDIR); history stays fine.
  fs.rmSync(path.join(data, "reminders.json"));
  fs.mkdirSync(path.join(data, "reminders.json"));

  // Version-change launch: the new snapshot omits reminders. With keep=1 the
  // naive prune would delete the older good snapshot; the content-aware prune
  // must keep it (it is the sole holder of captured reminders).
  const res = Backup.maybeBackupOnStartup(data, "1.1.0", {
    backupDir: store,
    now: new Date("2026-06-20T00:00:00.000Z"),
  });
  assert.equal(res.reason, "version-change");

  const holder = Backup.listBackups(data, store).find((b) => b.captured.reminders);
  assert.ok(holder, "a surviving backup still holds the captured reminders");
  const env = JSON.parse(fs.readFileSync(holder.path, "utf8"));
  assert.deepEqual(env.data.reminders, [{ id: "keep-me", text: "real" }], "real reminders survived");
  assert.equal(env.appVersion, "1.0.0", "it is the pre-lock good snapshot");
});

test("migration is idempotent: a second launch does not resurrect a pruned legacy snapshot", (t) => {
  const data = makeTempDir(t);
  const store = makeTempDir(t);
  seed(data, [{ id: "a" }], []);
  // Legacy snapshot under an OLDER version, inside the data folder.
  Backup.createBackup(data, "1.0.0", "version-change", { now: new Date("2026-06-01T00:00:00.000Z") });

  // Run 1 (new version): migrate, version-change backup, prune to default keep=1.
  const r1 = Backup.maybeBackupOnStartup(data, "1.1.2", {
    backupDir: store,
    migrateFrom: backupsDir(data),
    now: new Date("2026-06-20T00:00:00.000Z"),
  });
  assert.equal(r1.reason, "version-change");
  assert.equal(
    fs.readdirSync(store).filter((n) => /^reminder-backup-.*\.json$/.test(n)).length,
    1,
    "exactly one snapshot after the version-change prune",
  );

  // Run 2 (same version, within the daily window): must NOT re-copy the legacy
  // snapshot prune removed.
  const r2 = Backup.maybeBackupOnStartup(data, "1.1.2", {
    backupDir: store,
    migrateFrom: backupsDir(data),
    now: new Date("2026-06-20T01:00:00.000Z"),
  });
  assert.equal(r2.created, false, "no new backup (same version, fresh)");
  assert.equal(
    fs.readdirSync(store).filter((n) => /^reminder-backup-.*\.json$/.test(n)).length,
    1,
    "store still holds exactly one file (no resurrection, keep=1 honored)",
  );
});

test("createBackup falls back to the data folder when the configured backupDir is unwritable", (t) => {
  const data = makeTempDir(t);
  seed(data, [{ id: "a" }], []);
  // A backupDir whose PARENT is a file → mkdirSync there fails (ENOTDIR).
  const parentFile = path.join(makeTempDir(t), "afile");
  fs.writeFileSync(parentFile, "x");
  const blocked = path.join(parentFile, "store");

  const { path: dest } = Backup.createBackup(data, "1.1.0", "manual", { backupDir: blocked });
  assert.equal(path.dirname(dest), backupsDir(data), "snapshot fell back into <data>/backups");
  assert.ok(fs.existsSync(dest), "a backup was still written");
});

test("restore does not prune the backup it is restoring from in a shared dir", (t) => {
  const data = makeTempDir(t);
  const store = makeTempDir(t);
  seed(data, [{ id: "orig" }], []);
  const { path: backupPath } = Backup.createBackup(data, "1.1.0", "manual", { backupDir: store });
  seed(data, [{ id: "changed" }], []);

  const res = Backup.restore(backupPath, data, "1.1.0", { backupDir: store });
  assert.ok(fs.existsSync(backupPath), "the source backup survives the restore (not pruned)");
  assert.ok(res.safetyBackup && fs.existsSync(res.safetyBackup), "the safety snapshot also exists");
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(data, "reminders.json"), "utf8")),
    [{ id: "orig" }],
    "live data was restored from the backup",
  );
});
