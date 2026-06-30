// Versioned, self-describing snapshots of the reminder dataset.
//
// Why this exists: an update (or a half-broken file) must never silently lose a
// user's reminders. Each backup is a single shareable JSON file in a separate
// `backups/` folder that captures BOTH data files together, stamped with the
// app + format version. That lets a user hand over one file when "I lost my
// stuff after the update", lets a backup be copied back to restore, and lets a
// future version load an older backup and migrate it (legacy support).
//
// No Electron dependency here, so this is unit-testable under plain
// `node --test` (the caller passes the app version in).

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// Envelope identity. Bump FORMAT_VERSION only if the envelope shape below
// changes incompatibly; readers should tolerate older values.
const FORMAT = "reminder-backup";
const FORMAT_VERSION = 1;

const BACKUP_DIR = "backups";
const FILE_PREFIX = "reminder-backup-";
const FILE_RE = /^reminder-backup-.*\.json$/;

// At startup we take a new backup only if the newest one is older than this
// (a version change always forces one regardless — see maybeBackupOnStartup).
const DEFAULT_MAX_AGE_MS = 12 * 60 * 60 * 1000; // 12h
// How many automatic backups to retain — only the most recent snapshot is kept
// by default, so the backups folder never accumulates files. Right after an
// update this single file is the pre-update snapshot (the version-change backup
// captured before the new version touched the data).
const DEFAULT_KEEP = 1;

// The files that together make up one complete reminder dataset. A backup
// captures them as a coherent pair so a restore point is internally consistent.
const SOURCES = [
  { key: "reminders", file: "reminders.json" },
  { key: "history", file: "history.json" },
];

// The directory snapshots are written to / read from. Defaults to a `backups/`
// folder INSIDE the data folder (the legacy layout, still used by the tests),
// but the app overrides it via opts.backupDir with a stable location OUTSIDE the
// data folder (see main.js). Keeping backups off the data folder means deleting,
// moving, or un-syncing that folder (it may live on OneDrive) can't take its own
// safety net down with it.
function backupDirFor(dataPath, opts = {}) {
  return opts.backupDir || path.join(dataPath, BACKUP_DIR);
}

// Stable, filesystem-safe identifier for a data folder, used to namespace its
// backups under the shared app backups root so two different data folders — or a
// folder you later switch away from — never overwrite each other's snapshots. A
// readable basename prefix keeps the folders recognizable; the hash makes the
// full path unambiguous (and case-insensitive on Windows, where paths are).
function dataFolderKey(dataPath) {
  const norm = path.resolve(dataPath || ".").replace(/[\\/]+$/, "");
  const canon = process.platform === "win32" ? norm.toLowerCase() : norm;
  const hash = crypto.createHash("sha1").update(canon).digest("hex").slice(0, 10);
  const base =
    path.basename(norm).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 32) || "data";
  return `${base}-${hash}`;
}

// Carry snapshots from a legacy backups folder into a new location, never
// overwriting an existing file. Best-effort and non-destructive: the originals
// are left untouched, so this is safe to run on every launch. Used once when
// backups move out of the data folder, so version-change history stays
// continuous and no prior snapshot is orphaned.
function migrateLegacyBackups(legacyDir, newDir) {
  let names;
  try {
    names = fs.readdirSync(legacyDir);
  } catch {
    return { migrated: [] };
  }
  const migrated = [];
  for (const name of names) {
    if (!FILE_RE.test(name)) continue;
    const src = path.join(legacyDir, name);
    const dest = path.join(newDir, name);
    try {
      if (!fs.statSync(src).isFile()) continue;
      if (fs.existsSync(dest)) continue; // never clobber an existing backup
      fs.mkdirSync(newDir, { recursive: true });
      fs.copyFileSync(src, dest);
      migrated.push(dest);
    } catch {
      // best-effort: a single un-copyable file must not abort startup
    }
  }
  return { migrated };
}

// Read one source file. Returns exactly one of:
//   { missing: true }   — file does not exist (ENOENT)
//   { unreadable }      — present but could not be read (lock/permissions)
//   { parsed, text }    — valid JSON (text kept so non-array shapes can be
//                          preserved verbatim)
//   { raw, error }      — present but not valid JSON
// Never throws.
function readSource(filePath) {
  let text;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return { missing: true };
    return { unreadable: `read failed: ${err.message}` };
  }
  try {
    return { parsed: JSON.parse(text), text };
  } catch (err) {
    return { raw: text, error: `parse failed: ${err.message}` };
  }
}

// Unparseable / unexpected source text is preserved inside an unambiguous
// envelope. A bare { __raw__: "..." } could collide with real parsed data that
// happens to have a "__raw__" member, so we use a typed marker instead.
function rawEnvelope(text) {
  return { __backupRaw__: true, text };
}
function isRawEnvelope(v) {
  return (
    !!v &&
    typeof v === "object" &&
    v.__backupRaw__ === true &&
    typeof v.text === "string"
  );
}

// Build the in-memory snapshot envelope (does not touch the backups folder).
// opts.now: capture time (Date). opts.dataVersion: the app version the captured
// data BELONGS to (may differ from the running appVersion on the first launch
// after an update — see maybeBackupOnStartup).
function buildSnapshot(dataPath, appVersion, reason, opts = {}) {
  const now = opts.now || new Date();
  const dataVersion =
    opts.dataVersion !== undefined ? opts.dataVersion : appVersion || null;
  const data = {};
  const counts = {};
  const issues = {};
  for (const { key, file } of SOURCES) {
    const res = readSource(path.join(dataPath, file));
    if (res.missing) {
      data[key] = [];
      counts[key] = 0;
    } else if (res.unreadable) {
      // We could not read the bytes at all (transient lock, AV/OneDrive, perms).
      // Capturing nothing is safer than fabricating an empty/sentinel value that
      // restore would later write OVER real data, so omit the key entirely and
      // just record the issue.
      counts[key] = null;
      issues[key] = res.unreadable;
    } else if ("parsed" in res && Array.isArray(res.parsed)) {
      data[key] = res.parsed;
      counts[key] = res.parsed.length;
    } else if ("parsed" in res) {
      // Valid JSON but not the array Storage expects — preserve the exact bytes
      // rather than a value that would wedge the app if restored.
      data[key] = rawEnvelope(res.text);
      counts[key] = null;
      issues[key] = "unexpected shape: not an array";
    } else {
      // Unparseable: preserve verbatim so it can be inspected / hand-recovered.
      data[key] = rawEnvelope(res.raw);
      counts[key] = null;
      issues[key] = res.error;
    }
  }
  const snapshot = {
    format: FORMAT,
    formatVersion: FORMAT_VERSION,
    appVersion: appVersion || null,
    dataVersion,
    createdAt: now.toISOString(),
    reason: reason || "manual",
    counts,
    data,
  };
  if (Object.keys(issues).length) snapshot.issues = issues;
  return snapshot;
}

// Filename derived from the timestamp. Colons/periods are invalid in Windows
// filenames, so swap them for dashes while keeping it lexicographically sortable.
function fileNameFor(createdAt) {
  return `${FILE_PREFIX}${createdAt.replace(/[:.]/g, "-")}.json`;
}

// Atomic write (temp + rename), mirroring storage.js. Crucially this NEVER
// overwrites an existing backup: if two snapshots land on the same millisecond
// timestamp, a counter suffix is appended so no prior backup is ever destroyed.
function writeSnapshot(backupDir, snapshot) {
  fs.mkdirSync(backupDir, { recursive: true });
  const base = fileNameFor(snapshot.createdAt);
  let dest = path.join(backupDir, base);
  if (fs.existsSync(dest)) {
    const stem = base.slice(0, -".json".length);
    let i = 1;
    do {
      dest = path.join(backupDir, `${stem}-${i}.json`);
      i += 1;
    } while (fs.existsSync(dest));
  }
  const tmp = dest + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(snapshot, null, 2));
  fs.renameSync(tmp, dest);
  return dest;
}

// List our backups, newest first. Each entry carries the parsed envelope's
// metadata when available. Ordering falls back to file mtime whenever createdAt
// is missing OR unparseable, so a single garbled file can never wedge the sort.
function listBackups(dataPath, backupDir) {
  const dir = backupDir || path.join(dataPath, BACKUP_DIR);
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    if (!FILE_RE.test(name)) continue;
    const full = path.join(dir, name);
    let stat;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    let env = null;
    try {
      env = JSON.parse(fs.readFileSync(full, "utf8"));
    } catch {
      // Unknown/corrupt backup file — still listed so rotation can see it.
    }
    const valid = !!env && env.format === FORMAT;
    const createdAt =
      env && typeof env.createdAt === "string" ? env.createdAt : null;
    const parsedTime = createdAt ? Date.parse(createdAt) : NaN;
    // Floor the mtime fallback so sub-millisecond precision can't outrank an
    // integer createdAt key from a real backup written in the same millisecond.
    const sortKey = Number.isNaN(parsedTime)
      ? Math.floor(stat.mtimeMs)
      : parsedTime;
    const appVersion = env && env.appVersion != null ? env.appVersion : null;
    const dataVersion =
      env && env.dataVersion != null ? env.dataVersion : appVersion;
    // Which sources this snapshot actually captured as data (an array — possibly
    // empty, which legitimately means "zero reminders"). A source omitted because
    // it was unreadable, or preserved as a raw/odd-shape envelope, is NOT counted.
    // prune() uses this so an incomplete later snapshot can't evict the last good
    // copy of a source.
    const captured = {};
    for (const { key } of SOURCES) {
      captured[key] = !!(env && env.data && Array.isArray(env.data[key]));
    }
    out.push({
      name,
      path: full,
      appVersion,
      dataVersion,
      createdAt,
      sortKey,
      valid,
      captured,
    });
  }
  out.sort((a, b) => {
    const d = b.sortKey - a.sortKey;
    return Number.isNaN(d) ? 0 : d;
  });
  return out;
}

// Prune old backups, keeping the newest `keep`. Pass a precomputed `list`
// (newest-first) to avoid re-reading the folder.
//
// Content-aware safety: beyond the newest `keep`, the newest snapshot that
// actually captured each source is also protected from deletion. This stops an
// incomplete later snapshot from evicting the last good copy of a source — e.g.
// a transient read lock (OneDrive/AV) during a forced version-change backup
// yields a snapshot that omits `reminders`; without this guard, pruning to
// keep=1 would delete the older snapshot that still holds the real reminders.
// The set of protected files self-heals: once a fresh snapshot captures every
// source again, it becomes the sole protected holder and the extras are pruned.
function prune(dataPath, keep = DEFAULT_KEEP, list = null, backupDir) {
  const all = list || listBackups(dataPath, backupDir); // newest first
  if (all.length <= keep) return [];
  const protectedPaths = new Set();
  for (const { key } of SOURCES) {
    const holder = all.find((b) => b.captured && b.captured[key]);
    if (holder) protectedPaths.add(holder.path);
  }
  const removed = [];
  for (const b of all.slice(keep)) {
    if (protectedPaths.has(b.path)) continue; // sole good copy of some source
    try {
      fs.rmSync(b.path);
      removed.push(b.path);
    } catch {
      // ignore — a backup we cannot delete is harmless
    }
  }
  return removed;
}

// Create a backup unconditionally, then prune.
function createBackup(dataPath, appVersion, reason, opts = {}) {
  const keep = opts.keep ?? DEFAULT_KEEP;
  let backupDir = backupDirFor(dataPath, opts);
  const snapshot = buildSnapshot(dataPath, appVersion, reason, {
    now: opts.now,
    dataVersion: opts.dataVersion,
  });
  let dest;
  try {
    dest = writeSnapshot(backupDir, snapshot);
  } catch (err) {
    // The configured backup dir (e.g. the app's userData) is unwritable — a
    // locked-down/roaming profile, a full disk, or a non-directory squatting at
    // the path. Rather than take NO backup, fall back to a `backups/` folder
    // inside the data folder, so a writable data folder always yields a snapshot.
    const legacy = path.join(dataPath, BACKUP_DIR);
    if (path.resolve(backupDir) === path.resolve(legacy)) throw err;
    console.error(
      `backup: ${backupDir} unwritable (${err.message}); falling back to ${legacy}`,
    );
    backupDir = legacy;
    dest = writeSnapshot(backupDir, snapshot);
  }
  prune(dataPath, keep, null, backupDir);
  return { path: dest, snapshot };
}

// Startup policy: back up when there is no prior backup ("initial"), when the
// app version changed since the newest backup ("version-change" — captures the
// dataset before the new version touches it), or when the newest backup is
// stale ("daily"). Otherwise do nothing.
function maybeBackupOnStartup(dataPath, appVersion, opts = {}) {
  const maxAgeMs = opts.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const keep = opts.keep ?? DEFAULT_KEEP;
  const now = opts.now || new Date();
  const nowMs = now.getTime();
  const version = appVersion || null;
  const backupDir = backupDirFor(dataPath, opts);

  // First launch after backups moved out of the data folder: carry any existing
  // in-data-folder snapshots over so version-change detection stays continuous
  // and nothing is orphaned (non-destructive — the originals are left in place).
  // Gated on an EMPTY store so it runs at most once: otherwise a relaunch within
  // the daily window would re-copy a snapshot that prune deliberately removed,
  // resurrecting it and breaking the retention count.
  let existing = listBackups(dataPath, backupDir);
  if (
    existing.length === 0 &&
    opts.migrateFrom &&
    path.resolve(opts.migrateFrom) !== path.resolve(backupDir)
  ) {
    migrateLegacyBackups(opts.migrateFrom, backupDir);
    existing = listBackups(dataPath, backupDir);
  }

  // Base the decision on the newest VALID backup so a corrupt/stray file (which
  // lists with appVersion=null) can't wedge us into a "version-change" backup
  // on every single launch.
  const newest = existing.find((b) => b.valid) || null;

  let reason = null;
  let dataVersion = version;
  if (!newest) {
    reason = "initial";
  } else if (newest.appVersion !== version) {
    reason = "version-change";
    // On the first launch of a new version the data on disk still belongs to
    // the PREVIOUS version; record that as dataVersion so a future migration can
    // tell which version actually produced the captured data.
    dataVersion = newest.appVersion;
  } else if (nowMs - newest.sortKey >= maxAgeMs) {
    reason = "daily";
  }
  if (!reason) return { created: false, reason: null };

  const { path: p, snapshot } = createBackup(dataPath, appVersion, reason, {
    keep,
    now,
    dataVersion,
    backupDir,
  });
  return { created: true, reason, path: p, snapshot };
}

// Non-throwing entry point for the main process: a backup failure must never
// block app startup.
function safeBackupOnStartup(dataPath, appVersion, opts) {
  try {
    return maybeBackupOnStartup(dataPath, appVersion, opts);
  } catch (err) {
    console.error(`backup: startup backup failed: ${err.message}`);
    return { created: false, error: err.message };
  }
}

// Read + validate a backup envelope. Throws on a missing or non-backup file so
// a caller (a future migration tool, or a restore) can decide how to handle it.
function loadBackup(backupPath) {
  const env = JSON.parse(fs.readFileSync(backupPath, "utf8"));
  if (!env || env.format !== FORMAT) {
    throw new Error("not a reminder backup file");
  }
  return env;
}

// Does the data folder currently hold reminders worth protecting? Used to decide
// whether a restore may proceed when the pre-restore safety snapshot fails.
function hasLiveData(dataPath) {
  for (const { file } of SOURCES) {
    try {
      const value = JSON.parse(fs.readFileSync(path.join(dataPath, file), "utf8"));
      if (Array.isArray(value) ? value.length > 0 : value != null) return true;
    } catch (err) {
      // A present-but-unreadable/unparseable file is itself data worth keeping.
      if (err.code !== "ENOENT") return true;
    }
  }
  return false;
}

// Restore a backup over the live data files. Snapshots the current state first
// (reason "pre-restore") so the restore is reversible; if that safety snapshot
// fails and there is live data to lose, the restore ABORTS rather than
// overwrite with no way back (pass { force: true } to override). All sources
// are staged to temp files before any is renamed into place, so a crash can't
// leave the pair half-applied. Not wired to the UI — intended for manual
// recovery and for a future legacy-migration path.
function restore(backupPath, dataPath, appVersion, opts = {}) {
  const env = loadBackup(backupPath);
  const backupDir = backupDirFor(dataPath, opts);

  let safety = null;
  try {
    // keep:Infinity so this safety snapshot never prunes its siblings — in the
    // shared backup dir the file being restored FROM lives alongside it, and
    // pruning to keep=1 would delete that very backup mid-restore.
    safety = createBackup(dataPath, appVersion, "pre-restore", {
      backupDir,
      keep: Infinity,
    }).path;
  } catch (err) {
    if (!opts.force && hasLiveData(dataPath)) {
      throw new Error(
        `restore aborted: could not create a pre-restore safety backup (${err.message})`,
      );
    }
    console.error(`backup: pre-restore snapshot failed: ${err.message}`);
  }

  const sourceData = env.data || {};
  // Stage every restorable source to a temp file first; only rename them into
  // place once all are written, to shrink the half-applied window.
  const staged = [];
  for (const { key, file } of SOURCES) {
    if (!(key in sourceData)) continue;
    const value = sourceData[key];
    let text;
    if (isRawEnvelope(value)) {
      text = value.text; // preserved verbatim (unparseable/odd-shape source)
    } else if (Array.isArray(value)) {
      text = JSON.stringify(value, null, 2);
    } else {
      // Refuse to write a shape Storage can't use (null/object/number or a
      // legacy sentinel) — leave the live file untouched.
      continue;
    }
    const dest = path.join(dataPath, file);
    const tmp = dest + ".tmp";
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(tmp, text);
    staged.push({ tmp, dest, file });
  }
  const restored = [];
  for (const s of staged) {
    fs.renameSync(s.tmp, s.dest);
    restored.push(s.file);
  }
  return { restored, safetyBackup: safety, backup: backupPath };
}

module.exports = {
  FORMAT,
  FORMAT_VERSION,
  DEFAULT_KEEP,
  DEFAULT_MAX_AGE_MS,
  buildSnapshot,
  createBackup,
  maybeBackupOnStartup,
  safeBackupOnStartup,
  listBackups,
  prune,
  loadBackup,
  restore,
  hasLiveData,
  dataFolderKey,
  migrateLegacyBackups,
};
