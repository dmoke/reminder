"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const nsh = fs.readFileSync(
  path.join(__dirname, "..", "build", "installer.nsh"),
  "utf8",
);

// The installer is the one place that can destroy reminders outright: it
// replaces everything in its install folder, and an update silently inherits
// the folder a previous install used. If that folder is also the user's data
// folder, reminders.json is gone before the app ever runs — so no in-app guard
// can help. These pin the two checks that prevent it.

const DATA_FILE_TEST = 'IfFileExists "$INSTDIR\\reminders.json"';

function macroBody(name) {
  const start = nsh.indexOf("!macro " + name);
  assert.notEqual(start, -1, "installer.nsh must define " + name);
  return nsh.slice(start, nsh.indexOf("!macroend", start));
}

test("the installer refuses a folder that already holds reminders", () => {
  assert.ok(
    nsh.includes(DATA_FILE_TEST),
    "installer.nsh must test the target folder for reminders.json",
  );
});

test("the refusal covers the folder an in-place update inherits", () => {
  // customInit runs after initMultiUser, so $INSTDIR there is the remembered
  // path a silent or in-place update would wipe without ever asking.
  assert.ok(macroBody("customInit").includes(DATA_FILE_TEST));
});

test("the refusal covers a folder the user browses to", () => {
  // .onVerifyInstDir is the directory page's guard, for a fresh install.
  const header = macroBody("customHeader");
  assert.ok(header.includes("Function .onVerifyInstDir"));
  assert.ok(header.includes(DATA_FILE_TEST));
});

test("the refusal still applies during a silent install", () => {
  // A silent run cannot show the message box, but it must abort rather than
  // fall through and install over the data.
  const guard = macroBody("customInit").split("reminders_dir_ok:")[0];
  assert.ok(guard.includes("IfSilent reminders_dir_stop"));
  // Quit, not Abort: Abort inside .onInit crashes the installer instead of
  // exiting cleanly, which shows the user a Windows crash box.
  assert.ok(guard.includes("Quit"));
});

test("the update confirmation is never shown during a silent run", () => {
  assert.ok(macroBody("customInit").includes("IfSilent reminders_proceed"));
});
