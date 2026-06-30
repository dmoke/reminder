const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { Logger, formatLine, LOG_DIR, LOG_FILE } = require("../app/logger.js");

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "logger-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function logPath(dir) {
  return path.join(dir, LOG_DIR, LOG_FILE);
}

test("formatLine stamps a timestamp, level, and message", () => {
  const line = formatLine("ERROR", ["boom", 42], new Date("2026-06-30T12:00:00Z"));
  assert.equal(line, "[2026-06-30T12:00:00.000Z] [ERROR] boom 42\n");
});

test("formatLine renders an Error with its stack", () => {
  const err = new Error("nope");
  const line = formatLine("ERROR", [err], new Date("2026-06-30T12:00:00Z"));
  assert.match(line, /\[ERROR\] Error: nope/);
});

test("setDataPath creates logs/ and write() appends a line", (t) => {
  const dir = tempDir(t);
  const log = new Logger();
  log.setDataPath(dir);
  assert.ok(fs.existsSync(path.join(dir, LOG_DIR)));
  log.write("INFO", "hello");
  const text = fs.readFileSync(logPath(dir), "utf8");
  assert.match(text, /\[INFO\] hello\n$/);
});

test("write() before a data folder is buffered, then flushed on setDataPath", (t) => {
  const dir = tempDir(t);
  const log = new Logger();
  log.write("INFO", "early one");
  log.write("WARN", "early two");
  // Nothing on disk yet — no data folder.
  assert.equal(fs.existsSync(logPath(dir)), false);
  log.setDataPath(dir);
  const text = fs.readFileSync(logPath(dir), "utf8");
  assert.match(text, /early one/);
  assert.match(text, /early two/);
  // Flushed in order.
  assert.ok(text.indexOf("early one") < text.indexOf("early two"));
});

test("write() never throws when no data folder is set (buffer capped)", () => {
  const log = new Logger();
  for (let i = 0; i < 1000; i += 1) log.write("INFO", "x" + i);
  assert.ok(log.buffer.length <= 500); // bounded so a boot loop can't blow up
});

test("rotation keeps at most `keep` files when the active log exceeds maxBytes", (t) => {
  const dir = tempDir(t);
  const log = new Logger({ maxBytes: 200, keep: 3 });
  log.setDataPath(dir);
  // Each line is well over 200 bytes after the prefix, so every write rotates.
  const big = "z".repeat(300);
  for (let i = 0; i < 6; i += 1) log.write("INFO", big + i);

  const base = logPath(dir);
  assert.ok(fs.existsSync(base), "active log exists");
  assert.ok(fs.existsSync(base + ".1"), "rotated .1 exists");
  assert.ok(fs.existsSync(base + ".2"), "rotated .2 exists");
  assert.equal(fs.existsSync(base + ".3"), false, "never keeps more than `keep`");

  // The active file holds the most recent line.
  assert.match(fs.readFileSync(base, "utf8"), /z+5\n$/);
});

test("a write failure (data folder removed) does not throw", (t) => {
  const dir = tempDir(t);
  const log = new Logger();
  log.setDataPath(dir);
  log.write("INFO", "before");
  fs.rmSync(path.join(dir, LOG_DIR), { recursive: true, force: true });
  // The folder is gone; appendFileSync will fail internally but must be swallowed.
  assert.doesNotThrow(() => log.write("ERROR", "after the folder vanished"));
});

test("setDataPath is a no-op for a falsy path", () => {
  const log = new Logger();
  assert.doesNotThrow(() => log.setDataPath(""));
  assert.doesNotThrow(() => log.setDataPath(null));
  assert.equal(log.filePath, null);
});
