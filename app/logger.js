// Lightweight file logger. Tees the main process's console output and crash
// reports into <dataPath>/logs/reminder.log so a renderer/GPU crash or an
// uncaught exception leaves a record on disk for after-the-fact diagnosis — the
// kind of "Renderer process crashed" event that otherwise only shows in a
// terminal nobody is watching. No Electron dependency, so this is unit-testable
// under plain `node --test`.
//
// Everything here is best-effort: a logging failure (disk full, a locked file,
// the data folder vanishing) must NEVER throw into the app, so all fs work is
// guarded and silently drops the line on error.

const fs = require("fs");
const path = require("path");

const LOG_DIR = "logs";
const LOG_FILE = "reminder.log";
const DEFAULT_MAX_BYTES = 1024 * 1024; // rotate the active file at ~1 MB
const DEFAULT_KEEP = 3; // reminder.log + reminder.log.1 + reminder.log.2
// Lines logged before a data folder is known (very early startup) are held here
// so a crash during boot is still captured once the folder is set. Bounded so a
// boot loop can't grow it without limit.
const MAX_BUFFER_LINES = 500;

function stringifyPart(p) {
  if (typeof p === "string") return p;
  if (p instanceof Error) return p.stack || `${p.name}: ${p.message}`;
  try {
    return JSON.stringify(p);
  } catch {
    return String(p);
  }
}

// One log record: "[ISO-timestamp] [LEVEL] message\n".
function formatLine(level, parts, now) {
  const ts = (now || new Date()).toISOString();
  const msg = parts.map(stringifyPart).join(" ");
  return `[${ts}] [${level}] ${msg}\n`;
}

class Logger {
  constructor(opts = {}) {
    this.maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
    this.keep = opts.keep ?? DEFAULT_KEEP;
    this.dir = null;
    this.filePath = null;
    this.buffer = []; // lines logged before a data folder was set
  }

  // Point logging at <dataPath>/logs/, creating the folder, and flush anything
  // buffered before the data folder was known. Safe to call again when the data
  // folder changes (the new folder simply starts a fresh file). Never throws.
  setDataPath(dataPath) {
    if (!dataPath) return;
    let dir;
    try {
      dir = path.join(dataPath, LOG_DIR);
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      return; // cannot create the folder — keep buffering / stay a no-op
    }
    this.dir = dir;
    this.filePath = path.join(dir, LOG_FILE);
    if (this.buffer.length) {
      const pending = this.buffer;
      this.buffer = [];
      for (const line of pending) this.append(line);
    }
  }

  // Record one line at a level (e.g. "INFO", "ERROR"). Never throws.
  write(level, ...parts) {
    const line = formatLine(level, parts);
    if (!this.filePath) {
      // Hold early lines (pre-data-folder) so a startup crash is still captured.
      if (this.buffer.length < MAX_BUFFER_LINES) this.buffer.push(line);
      return;
    }
    this.append(line);
  }

  // Append a preformatted line, rotating first if the file would grow too big.
  append(line) {
    if (!this.filePath) return;
    try {
      this.rotateIfNeeded(Buffer.byteLength(line));
      fs.appendFileSync(this.filePath, line);
    } catch {
      // disk full / locked / folder vanished — drop the line, never crash
    }
  }

  // Size-based rotation: reminder.log -> .1 -> .2 -> dropped, keeping at most
  // `keep` files total so the logs folder never grows without bound.
  rotateIfNeeded(incomingBytes = 0) {
    if (!this.filePath || this.maxBytes <= 0 || this.keep < 2) return;
    let size;
    try {
      size = fs.statSync(this.filePath).size;
    } catch {
      return; // no active file yet → nothing to rotate
    }
    if (size + incomingBytes <= this.maxBytes) return;
    try {
      fs.rmSync(`${this.filePath}.${this.keep - 1}`, { force: true }); // drop oldest
      for (let i = this.keep - 2; i >= 1; i -= 1) {
        const from = `${this.filePath}.${i}`;
        if (fs.existsSync(from)) fs.renameSync(from, `${this.filePath}.${i + 1}`);
      }
      fs.renameSync(this.filePath, `${this.filePath}.1`);
    } catch {
      // best-effort: a rotation hiccup must not lose the incoming line
    }
  }
}

module.exports = { Logger, formatLine, LOG_DIR, LOG_FILE };
