// Importer for "Pichugin Organizer 3" reminder data. Pure functions, no Electron
// deps, so this module is unit-testable under plain `node --test`.
//
// Two on-disk formats are supported, both written in the Windows-1251 (cp1251)
// codepage that the organizer uses:
//   • db_*.podb      — the live database: an INI-style file with one `[T-n]`
//                      section per task and `key=value` lines. Uses `Ok=0|1`.
//   • db_*.podb.xml  — a manual export: `<db><tasks><item>…</item></tasks></db>`
//                      with one tag per field. Uses `<Executed>true|false`.
// Both carry the same task fields (guid, dates, text, …); this module normalizes
// either into a common record shape and maps it onto the app's reminder model.

// ---- cp1251 decoding -------------------------------------------------------
// windows-1251 is a single-byte codepage: 0x00–0x7F is ASCII, 0xC0–0xFF maps
// linearly onto U+0410–U+044F (the А…я Cyrillic block). Only the 0x80–0xBF half
// needs an explicit table. Embedding it keeps the app dependency-free (iconv-lite
// is only a transitive dev dependency and would not survive packaging).
const CP1251_HIGH = [
  0x0402, 0x0403, 0x201a, 0x0453, 0x201e, 0x2026, 0x2020, 0x2021, // 0x80
  0x20ac, 0x2030, 0x0409, 0x2039, 0x040a, 0x040c, 0x040b, 0x040f, // 0x88
  0x0452, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, // 0x90
  0xfffd, 0x2122, 0x0459, 0x203a, 0x045a, 0x045c, 0x045b, 0x045f, // 0x98
  0x00a0, 0x040e, 0x045e, 0x0408, 0x00a4, 0x0490, 0x00a6, 0x00a7, // 0xA0
  0x0401, 0x00a9, 0x0404, 0x00ab, 0x00ac, 0x00ad, 0x00ae, 0x0407, // 0xA8
  0x00b0, 0x00b1, 0x0406, 0x0456, 0x0491, 0x00b5, 0x00b6, 0x00b7, // 0xB0
  0x0451, 0x2116, 0x0454, 0x00bb, 0x0458, 0x0405, 0x0455, 0x0457, // 0xB8
];

function decodeCp1251(buf) {
  // Decode in chunks: String.fromCharCode(...) takes one argument per byte, so a
  // single spread over a multi-MB file would blow the engine's argument limit.
  const CHUNK = 0x8000;
  let result = "";
  for (let start = 0; start < buf.length; start += CHUNK) {
    const end = Math.min(start + CHUNK, buf.length);
    const codes = new Array(end - start);
    for (let i = start; i < end; i++) {
      const b = buf[i];
      codes[i - start] =
        b < 0x80 ? b : b < 0xc0 ? CP1251_HIGH[b - 0x80] : 0x0410 + (b - 0xc0);
    }
    result += String.fromCharCode.apply(null, codes); // 0xC0..0xFF → U+0410..U+044F
  }
  return result;
}

// Decode a file buffer to a string. Honors a UTF-8 BOM and an XML `encoding=`
// declaration; otherwise assumes cp1251 (what the organizer writes).
function decode(buf) {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.toString("utf8", 3); // skip the BOM so it can't pollute field 1
  }
  const head = buf.slice(0, 200).toString("latin1").toLowerCase();
  const m = head.match(/encoding\s*=\s*["']\s*([\w-]+)\s*["']/);
  if (m) {
    const enc = m[1];
    if (enc === "utf-8" || enc === "utf8") return buf.toString("utf8");
  }
  return decodeCp1251(buf);
}

// ---- helpers ---------------------------------------------------------------

// Convert a numeric character-reference value to a character, but leave the
// original text untouched when it is out of Unicode range — so a corrupt or
// oversized entity (e.g. &#x110000;) can never make String.fromCodePoint throw
// and abort the whole import.
function fromCodePointSafe(cp, original) {
  return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : original;
}

function decodeEntities(s) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (m, n) => fromCodePointSafe(parseInt(n, 16), m))
    .replace(/&#(\d+);/g, (m, n) => fromCodePointSafe(parseInt(n, 10), m))
    .replace(/&amp;/g, "&"); // ampersand last so "&amp;lt;" → "&lt;", not "<"
}

// Small deterministic 32-bit hash (FNV-1a), used to synthesize a stable de-dup
// key for records that have no guid, so re-importing the same content still
// skips them instead of duplicating.
function hashKey(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

// Parse the organizer's `dd.mm.yyyy[ HH:MM[:SS]]` timestamps into an ISO string.
// `dateStr` may carry its own time (CreatedDate/ChangedDate); otherwise the
// separate `timeStr` (the task's HH:MM) supplies the time of day. Wall-clock
// values are treated as local time and converted to UTC, matching how the app
// stores reminder times. Returns null for the `01.01.0001` "never" sentinel and
// for malformed or impossible dates (e.g. 31.02).
function toIso(dateStr, timeStr) {
  if (!dateStr) return null;
  const parts = String(dateStr).trim().split(/\s+/);
  const dm = parts[0].match(/^(\d{1,2})\.(\d{1,2})\.(\d{1,4})$/);
  if (!dm) return null;
  const dd = +dm[1];
  const mo = +dm[2];
  const yyyy = +dm[3];
  if (yyyy < 1900) return null; // 01.01.0001 (and similar) = "no date"
  let hh = 0;
  let mi = 0;
  let ss = 0;
  const tpart = parts[1] || timeStr || "";
  const tm = String(tpart).match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
  if (tm) {
    hh = +tm[1];
    mi = +tm[2];
    ss = tm[3] ? +tm[3] : 0;
  }
  // Reject overflowing time fields (e.g. "10:99") rather than letting the Date
  // constructor silently roll them into a wrong-but-plausible time.
  if (hh > 23 || mi > 59 || ss > 59) return null;
  const d = new Date(yyyy, mo - 1, dd, hh, mi, ss, 0);
  if (isNaN(d.getTime())) return null;
  // Reject values that silently rolled over (e.g. day 31 of a 30-day month).
  if (d.getFullYear() !== yyyy || d.getMonth() !== mo - 1 || d.getDate() !== dd) {
    return null;
  }
  return d.toISOString();
}

// Stable de-dup key from the organizer guid (so re-importing the same data does
// not create duplicates). `{80EA…}` → `80ea…`; falls back to null when absent.
function cleanGuid(guid) {
  if (!guid) return null;
  const g = String(guid).trim().replace(/[{}]/g, "").toLowerCase();
  return g || null;
}

// ---- format parsers --------------------------------------------------------

function xmlTag(body, name) {
  const m = body.match(new RegExp("<" + name + ">([\\s\\S]*?)</" + name + ">"));
  return m ? m[1] : ""; // absent or self-closing element → empty string
}

function parseXml(text) {
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(text))) {
    const b = m[1];
    items.push({
      guid: xmlTag(b, "guid"),
      CreatedDate: xmlTag(b, "CreatedDate"),
      ChangedDate: xmlTag(b, "ChangedDate"),
      Executed: xmlTag(b, "Executed"),
      DateLastComplite: xmlTag(b, "DateLastComplite"),
      // `<Date>`/`<Time>` regexes do not match `<Date-Original>`/`<Time-Original>`.
      Date: xmlTag(b, "Date"),
      Time: xmlTag(b, "Time"),
      Text: decodeEntities(xmlTag(b, "Text")),
    });
  }
  return items;
}

function parseIni(text) {
  const items = [];
  let cur = null;
  for (const line of text.split(/\r?\n/)) {
    const sec = line.match(/^\[([^\]]+)\]\s*$/);
    if (sec) {
      if (cur) items.push(cur);
      cur = /^T-\d+$/i.test(sec[1]) ? {} : null; // only [T-n] task sections
      continue;
    }
    if (!cur) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    cur[line.slice(0, eq).trim()] = line.slice(eq + 1); // value may contain '='
  }
  if (cur) items.push(cur);
  return items;
}

// ---- normalization ---------------------------------------------------------

// Map one raw record (from either format) onto the app's reminder shape, minus
// the id/tags/emoji the caller fills in. Returns null for records that can't
// become a usable reminder (no text, or no valid scheduled date).
function normalize(rec) {
  // XML <Text> is already entity-decoded in parseXml, and INI values are plain
  // cp1251 text — so do NOT decode here. Decoding again would double-decode XML
  // and would corrupt a literal "&amp;"/"&lt;" a user typed into an INI reminder.
  const text = String(rec.Text || "").trim();
  if (!text) return null;
  const time = toIso(rec.Date, rec.Time);
  if (!time) return null;

  // Trim before comparing: INI values are stored verbatim (so a stray "Ok=1 ")
  // and XML "<Executed>true </Executed>" still register as completed.
  const done =
    String(rec.Executed).trim() === "true" || String(rec.Ok).trim() === "1";
  // ChangedDate is a precise timestamp and, for a completed task, marks the last
  // action (≈ completion). Prefer it; fall back to the completion date, then the
  // scheduled time, so a completed import always carries a sensible completedAt.
  const completedAt = done
    ? toIso(rec.ChangedDate) || toIso(rec.DateLastComplite, rec.Time) || time
    : null;

  const guid = cleanGuid(rec.guid);
  return {
    guid,
    // Stable de-dup key for re-imports. Prefer the organizer guid; records with
    // none get a content hash so re-importing the same file still skips them.
    importKey: guid || "h:" + hashKey(text + "|" + time + "|" + (done ? 1 : 0)),
    text,
    time,
    done,
    // The organizer's `Review` repeat bitmask is not decoded (its layout is
    // undocumented and unused in observed data), so imports are non-recurring.
    recurrence: "none",
    createdAt: toIso(rec.CreatedDate) || time,
    completedAt,
  };
}

// Parse a Pichugin Organizer file buffer (either format) into normalized reminder
// records. Auto-detects XML vs INI from the decoded content.
function parse(buf) {
  const text = decode(buf);
  // Discriminate on the first non-space character, not a body-wide substring
  // scan: XML files open with "<" (<?xml / <!-- / <db), INI .podb files with
  // "[Database]". A whole-body scan would misclassify a valid INI file whose
  // reminder text merely contains "<item>" and silently drop everything.
  const isXml = text.replace(/^\s+/, "").charAt(0) === "<";
  const raw = isXml ? parseXml(text) : parseIni(text);
  const records = [];
  for (const r of raw) {
    try {
      const rec = normalize(r);
      if (rec) records.push(rec);
    } catch (err) {
      // One malformed record must never sink the whole import.
      console.error("pichugin: skipped a record:", (err && err.message) || err);
    }
  }
  return records;
}

module.exports = {
  parse,
  decode,
  decodeCp1251,
  decodeEntities,
  hashKey,
  toIso,
  cleanGuid,
  normalize,
  parseXml,
  parseIni,
};
