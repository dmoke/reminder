const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ALERT_STRINGS = require("../app/alertStrings.js");
const Snooze = require("../ui/snooze.js");

test("every alert snooze preset has a label in both languages", () => {
  // The alert window's s() returns the raw key when a string is missing, so a
  // forgotten entry ships a button that literally reads "snooze-30m".
  for (const kind of Snooze.ALERT_KINDS) {
    const key = `snooze-${kind}`;
    for (const lang of ["en", "uk"]) {
      assert.ok(
        ALERT_STRINGS[lang][key],
        `ALERT_STRINGS.${lang} is missing "${key}"`,
      );
    }
  }
});

test("the alert's custom-time button is labelled in both languages", () => {
  assert.ok(ALERT_STRINGS.en["snooze-custom"]);
  assert.ok(ALERT_STRINGS.uk["snooze-custom"]);
});

test("en and uk expose an identical key set", () => {
  assert.deepEqual(
    Object.keys(ALERT_STRINGS.en).sort(),
    Object.keys(ALERT_STRINGS.uk).sort(),
  );
});

test("no alert string is left empty", () => {
  for (const lang of ["en", "uk"]) {
    for (const [key, value] of Object.entries(ALERT_STRINGS[lang])) {
      assert.equal(typeof value, "string", `${lang}.${key} is not a string`);
      assert.ok(value.trim().length > 0, `${lang}.${key} is empty`);
    }
  }
});

// The main window keeps its own translation table inside ui/renderer.js, which
// cannot be required under node (it dereferences `window` on its first line).
// Checking the source text still catches the failure that matters: a new preset
// chip added to CARD_KINDS with no label behind it in one of the languages.
test("every card snooze preset has a label in both languages", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "ui", "renderer.js"),
    "utf8",
  );
  for (const kind of Snooze.CARD_KINDS) {
    const occurrences = src.split(`"snooze-${kind}":`).length - 1;
    assert.equal(
      occurrences,
      2,
      `ui/renderer.js should define "snooze-${kind}" once per language ` +
        `(en and uk), found ${occurrences}`,
    );
  }
});

test("the card custom-time button is labelled in both languages", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "ui", "renderer.js"),
    "utf8",
  );
  assert.equal(src.split('"snooze-custom":').length - 1, 2);
});

// Both browser windows load ui/snooze.js as a plain <script>; miss the tag and
// the window throws on first render with no snooze buttons at all.
test("both windows load the shared snooze script before their own", () => {
  for (const [page, own] of [
    ["alert.html", "alert.js"],
    ["index.html", "renderer.js"],
  ]) {
    const html = fs.readFileSync(
      path.join(__dirname, "..", "ui", page),
      "utf8",
    );
    const snoozeAt = html.indexOf('src="snooze.js"');
    const ownAt = html.indexOf(`src="${own}"`);
    assert.ok(snoozeAt !== -1, `${page} does not load snooze.js`);
    assert.ok(ownAt !== -1, `${page} does not load ${own}`);
    assert.ok(snoozeAt < ownAt, `${page} loads snooze.js after ${own}`);
  }
});
