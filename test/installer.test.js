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

test("a silent install stops rather than installing over the data", () => {
  // A silent run can neither ask nor let the user pick another folder, so it
  // must stop rather than fall through and install over the data.
  const guard = macroBody("customInit").split("reminders_dir_ok:")[0];
  assert.ok(guard.includes("IfSilent 0 reminders_dir_retarget"));
  // Quit, not Abort: Abort inside .onInit crashes the installer instead of
  // exiting cleanly, which shows the user a Windows crash box.
  assert.ok(guard.includes("Quit"));
});

test("an interactive install is retargeted instead of dead-ended", () => {
  // $INSTDIR in customInit comes from the previous install's registry entry,
  // so quitting there left no folder the user could pick to get past it — the
  // refusal fired whatever folder setup was started from. Point the install at
  // the default location and carry on instead.
  const guard = macroBody("customInit").split("reminders_dir_ok:")[0];
  const retarget = guard.split("reminders_dir_retarget:")[1];
  assert.ok(retarget, "customInit must have an interactive retarget branch");
  assert.ok(
    retarget.includes('StrCpy $INSTDIR "$LOCALAPPDATA\\Programs\\${APP_FILENAME}"'),
    "the install must be pointed at the default location",
  );
  // ...and only after checking the default is not itself a data folder: the
  // directory page is skipped for an updater-driven run, so a blind fall
  // through could still wipe reminders.
  assert.ok(retarget.indexOf(DATA_FILE_TEST) > retarget.indexOf("StrCpy $INSTDIR"));
  assert.ok(retarget.includes("Quit"), "an unsafe default must still stop setup");
});

test("the update confirmation is never shown during a silent run", () => {
  assert.ok(macroBody("customInit").includes("IfSilent reminders_proceed"));
});
