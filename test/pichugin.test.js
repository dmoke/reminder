const test = require("node:test");
const assert = require("node:assert/strict");

const P = require("../app/pichugin.js");

// "добовий" in windows-1251 bytes (each Cyrillic letter is one byte 0xC0–0xFF).
const DOBOVYI = Buffer.from([0xe4, 0xee, 0xe1, 0xee, 0xe2, 0xe8, 0xe9]);

test("decodeCp1251 maps cp1251 bytes to Ukrainian Unicode", () => {
  assert.equal(P.decodeCp1251(DOBOVYI), "добовий");
  // Ukrainian-specific letters live in the 0x80–0xBF half of the table.
  // Ґ=0xA5 ґ=0xB4 Є=0xAA є=0xBA І=0xB2 і=0xB3 Ї=0xAF ї=0xBF №=0xB9
  assert.equal(
    P.decodeCp1251(Buffer.from([0xa5, 0xb4, 0xaa, 0xba, 0xb2, 0xb3, 0xaf, 0xbf, 0xb9])),
    "ҐґЄєІіЇї№",
  );
});

test("decode honors a UTF-8 BOM", () => {
  const buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("café", "utf8")]);
  assert.equal(P.decode(buf), "café");
});

test("decode falls back to cp1251 for the organizer's files", () => {
  assert.equal(P.decode(DOBOVYI), "добовий");
});

test("toIso converts dd.mm.yyyy + HH:MM as local time", () => {
  const iso = P.toIso("16.06.2026", "15:58");
  const d = new Date(iso);
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 5); // June
  assert.equal(d.getDate(), 16);
  assert.equal(d.getHours(), 15);
  assert.equal(d.getMinutes(), 58);
});

test("toIso parses an embedded timestamp with seconds", () => {
  const d = new Date(P.toIso("05.12.2025 14:29:51"));
  assert.equal(d.getDate(), 5);
  assert.equal(d.getHours(), 14);
  assert.equal(d.getSeconds(), 51);
});

test("toIso rejects the 01.01.0001 'never' sentinel and bad dates", () => {
  assert.equal(P.toIso("01.01.0001"), null);
  assert.equal(P.toIso("31.02.2026"), null); // impossible day
  assert.equal(P.toIso(""), null);
  assert.equal(P.toIso("not a date"), null);
});

test("decodeEntities resolves XML entities (ampersand last)", () => {
  assert.equal(P.decodeEntities("a &amp; b"), "a & b");
  assert.equal(P.decodeEntities("&lt;tag&gt;"), "<tag>");
  assert.equal(P.decodeEntities("&amp;lt;"), "&lt;"); // not double-decoded
  assert.equal(P.decodeEntities("&#1076;"), "д");
});

test("cleanGuid strips braces and lowercases", () => {
  assert.equal(P.cleanGuid("{80EA2734-30B4-4BB5-B879-4859F89192D7}"), "80ea2734-30b4-4bb5-b879-4859f89192d7");
  assert.equal(P.cleanGuid(""), null);
  assert.equal(P.cleanGuid(undefined), null);
});

const XML_SAMPLE = `<?xml version="1.0" encoding="Windows-1251"?>
<db>
  <general FileType="DB Pichugin Organizer"/>
  <tasks>
    <item>
      <guid>{80EA2734-30B4-4BB5-B879-4859F89192D7}</guid>
      <CreatedDate>05.12.2025 14:29:51</CreatedDate>
      <ChangedDate>16.06.2026 14:58:00</ChangedDate>
      <Executed>false</Executed>
      <Time-Original>15:19</Time-Original>
      <Date-Original>11.05.2026</Date-Original>
      <Time>15:58</Time>
      <Date>16.06.2026</Date>
      <Review>00000000</Review>
      <DateLastComplite>01.01.0001</DateLastComplite>
      <Comment></Comment>
      <Text>active task</Text>
      <Group>1</Group>
      <Rang>-1</Rang>
    </item>
    <item>
      <guid>{8E80B4E1-A9EC-4056-8733-3263DE1E3595}</guid>
      <CreatedDate>24.02.2026 17:07:54</CreatedDate>
      <ChangedDate>16.06.2026 16:18:40</ChangedDate>
      <Executed>true</Executed>
      <Time>15:12</Time>
      <Date>16.06.2026</Date>
      <DateLastComplite>16.06.2026</DateLastComplite>
      <Text>done task</Text>
    </item>
    <item>
      <guid>{00000000-0000-0000-0000-000000000000}</guid>
      <Time>10:00</Time>
      <Date>01.01.0001</Date>
      <Text>no valid date</Text>
    </item>
    <item>
      <guid>{11111111-1111-1111-1111-111111111111}</guid>
      <Time>10:00</Time>
      <Date>20.06.2026</Date>
      <Text></Text>
    </item>
  </tasks>
</db>`;

test("parse reads the XML export, mapping done/active and skipping bad rows", () => {
  const recs = P.parse(Buffer.from(XML_SAMPLE, "latin1"));
  // The empty-text row and the 01.01.0001 row are dropped.
  assert.equal(recs.length, 2);

  const active = recs.find((r) => !r.done);
  assert.equal(active.text, "active task");
  assert.equal(active.guid, "80ea2734-30b4-4bb5-b879-4859f89192d7");
  assert.equal(active.recurrence, "none");
  assert.equal(active.completedAt, null);
  assert.equal(new Date(active.createdAt).getFullYear(), 2025);

  const done = recs.find((r) => r.done);
  assert.equal(done.text, "done task");
  assert.ok(done.completedAt); // ChangedDate
  assert.equal(new Date(done.completedAt).getHours(), 16);
});

const INI_SAMPLE = `[Database]
Tasks_Count=2
[Postpone]
item1=5|min
[T-1]
guid={80EA2734-30B4-4BB5-B879-4859F89192D7}
CreatedDate=05.12.2025 14:29:51
ChangedDate=29.06.2026 9:21:07
Ok=0
Time=14:21
Date=29.06.2026
Review=00000000
DateLastComplite=01.01.0001
Comment=
Text=active = with equals
Group=1
Rang=-1
[T-2]
guid={697FB139-867B-4DA6-950A-35C0EF2B7D9C}
CreatedDate=23.04.2026 07:28:35
ChangedDate=25.06.2026 9:16:17
Ok=1
Time=09:28
Date=24.06.2026
DateLastComplite=25.06.2026
Text=done ini task
Group=1
Rang=-1`;

test("parse reads the .podb INI format and Ok=1 marks completion", () => {
  const recs = P.parse(Buffer.from(INI_SAMPLE, "latin1"));
  assert.equal(recs.length, 2);

  const active = recs.find((r) => !r.done);
  assert.equal(active.text, "active = with equals"); // value may contain '='
  assert.equal(active.guid, "80ea2734-30b4-4bb5-b879-4859f89192d7");

  const done = recs.find((r) => r.done);
  assert.equal(done.text, "done ini task");
  assert.ok(done.completedAt);
});

test("INI parser ignores non-task sections", () => {
  const recs = P.parse(Buffer.from(INI_SAMPLE, "latin1"));
  // Only [T-1] and [T-2] become records; [Database]/[Postpone] are ignored.
  assert.equal(recs.length, 2);
});

test("toIso rejects overflowing time fields", () => {
  assert.equal(P.toIso("29.06.2026", "10:99"), null);
  assert.equal(P.toIso("29.06.2026", "24:00"), null);
  assert.equal(P.toIso("29.06.2026 10:00:99"), null);
  assert.ok(P.toIso("29.06.2026", "23:59")); // boundary stays valid
});

test("decodeEntities leaves out-of-range numeric entities untouched (no throw)", () => {
  assert.equal(P.decodeEntities("x &#x110000; y"), "x &#x110000; y");
  assert.equal(P.decodeEntities("x &#9999999999; y"), "x &#9999999999; y");
});

test("a malformed entity does not sink the rest of the import", () => {
  const xml =
    "<db><tasks>" +
    "<item><guid>{1}</guid><Date>20.06.2026</Date><Time>10:00</Time><Text>boom &#x110000; here</Text></item>" +
    "<item><guid>{2}</guid><Date>21.06.2026</Date><Time>11:00</Time><Text>good one</Text></item>" +
    "</tasks></db>";
  const recs = P.parse(Buffer.from(xml, "latin1"));
  // Both records survive — the bad entity is preserved literally, not thrown on.
  assert.equal(recs.length, 2);
  assert.ok(recs.some((r) => r.text === "good one"));
  assert.ok(recs.some((r) => r.text.includes("&#x110000;")));
});

test("XML text is entity-decoded exactly once (no double decode)", () => {
  const xml =
    "<db><tasks><item><guid>{1}</guid><Date>20.06.2026</Date><Time>10:00</Time>" +
    "<Text>a &amp;amp; b</Text></item></tasks></db>";
  const recs = P.parse(Buffer.from(xml, "latin1"));
  assert.equal(recs[0].text, "a &amp; b"); // one decode, not "a & b"
});

test("INI text is preserved verbatim (entities are not decoded)", () => {
  const ini = "[T-1]\nguid={1}\nDate=20.06.2026\nTime=10:00\nText=R&D at 5 &amp; later\nOk=0\n";
  const recs = P.parse(Buffer.from(ini, "latin1"));
  assert.equal(recs[0].text, "R&D at 5 &amp; later");
});

test("done flag tolerates trailing whitespace on the value", () => {
  const ini = "[T-1]\nguid={1}\nDate=20.06.2026\nTime=10:00\nText=t\nOk=1 \n";
  assert.equal(P.parse(Buffer.from(ini, "latin1"))[0].done, true);
  const xml =
    "<db><tasks><item><guid>{2}</guid><Date>20.06.2026</Date><Time>10:00</Time>" +
    "<Executed>true </Executed><Text>t</Text></item></tasks></db>";
  assert.equal(P.parse(Buffer.from(xml, "latin1"))[0].done, true);
});

test("an INI file whose text contains '<item>' is still parsed as INI", () => {
  const ini =
    "[Database]\nTasks_Count=1\n[T-1]\nguid={1}\nDate=20.06.2026\nTime=10:00\n" +
    "Text=buy the <item> from the store\nOk=0\n";
  const recs = P.parse(Buffer.from(ini, "latin1"));
  assert.equal(recs.length, 1);
  assert.equal(recs[0].text, "buy the <item> from the store");
});

test("normalize sets a stable importKey, falling back to a content hash without a guid", () => {
  const base = { Date: "20.06.2026", Time: "10:00", Text: "no guid task" };
  const a = P.normalize({ ...base });
  const b = P.normalize({ ...base });
  assert.equal(a.guid, null);
  assert.ok(a.importKey);
  assert.equal(a.importKey, b.importKey); // deterministic across imports
  // A different reminder yields a different key.
  const c = P.normalize({ ...base, Text: "other" });
  assert.notEqual(a.importKey, c.importKey);
  // With a guid, importKey is the guid.
  const g = P.normalize({ ...base, guid: "{80EA2734-30B4-4BB5-B879-4859F89192D7}" });
  assert.equal(g.importKey, "80ea2734-30b4-4bb5-b879-4859f89192d7");
});
