const fs = require("fs");
const path = require("path");
const { app } = require("electron");

// Resolved lazily (not at module load) so an early app.setPath("userData", …)
// — e.g. the separate dev profile set in main.js — is honored. Reading it at
// require time would bake in the default userData before that override runs.
function configPath() {
  return path.join(app.getPath("userData"), "config.json");
}

// Returns the parsed config, or {} when there simply isn't one yet.
//
// The three failure modes are deliberately NOT treated alike, because
// config.json is what remembers where the user's reminders live:
//
//   missing      -> {}, and the caller runs first-launch setup. Normal.
//   unparseable  -> the bytes are readable but corrupt (e.g. a truncated write
//                   from a force-kill). This is permanent, so refusing to start
//                   would brick the app. We set the bad file aside instead of
//                   deleting it, try to salvage the data folder out of it, and
//                   carry on.
//   unreadable   -> we could not read the file at all (a lock from antivirus or
//                   a file-sync tool, a permissions blip). That is usually
//                   TRANSIENT and the file is probably fine, so this is flagged:
//                   the caller stops rather than running setup and saving a
//                   fresh config over a perfectly good one.
function load() {
  const p = configPath();
  let text;
  try {
    text = fs.readFileSync(p, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return {};
    console.error(`config: ${p} could not be read: ${err.message}`);
    return { unreadable: err.message };
  }

  try {
    return JSON.parse(text);
  } catch (err) {
    console.error(`config: ${p} is not valid JSON: ${err.message}`);
    const salvaged = salvageDataPath(text);
    try {
      fs.renameSync(p, `${p}.${Date.now()}.bak`);
    } catch {
      // Keeping a copy is best-effort; it must not stop the app from starting.
    }
    // A truncated config usually still contains the data folder, and getting it
    // back means the user never sees an empty app or has to find the folder
    // again. Only accepted when the folder actually exists.
    return salvaged ? { dataPath: salvaged } : {};
  }
}

// Pull a still-intact "dataPath" out of a corrupt config's text. Returns the
// path only if it currently exists on disk, so a half-written value can never
// point the app at nothing.
function salvageDataPath(text) {
  const match = new RegExp('"dataPath"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"').exec(
    text || "",
  );
  if (!match) return null;
  let value;
  try {
    value = JSON.parse(`"${match[1]}"`);
  } catch {
    return null;
  }
  try {
    if (value && fs.statSync(value).isDirectory()) {
      console.error(`config: recovered data folder ${value} from the corrupt file`);
      return value;
    }
  } catch {
    // not a usable folder — fall through
  }
  return null;
}

// Atomic write (temp file + rename), mirroring storage.js. The NSIS installer
// force-kills the running tray app during an in-place update, with no graceful
// shutdown — a plain writeFileSync caught mid-flush leaves a truncated
// config.json, which is exactly the unreadable case above.
function save(config) {
  const p = configPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tempPath = p + ".tmp";
  fs.writeFileSync(tempPath, JSON.stringify(config, null, 2));
  fs.renameSync(tempPath, p);
}

module.exports = { load, save };
