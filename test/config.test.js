"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

// app/config.js requires electron only for app.getPath("userData"). Stub it so
// the load/save rules are testable under plain `node --test`.
let userDataDir = null;
const realLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "electron") {
    return { app: { getPath: () => userDataDir } };
  }
  return realLoad.call(this, request, ...rest);
};
const Config = require("../app/config.js");

function makeProfile(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "config-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  userDataDir = dir;
  return dir;
}

function configFile(dir) {
  return path.join(dir, "config.json");
}

test("a missing config is simply empty", (t) => {
  makeProfile(t);
  assert.deepEqual(Config.load(), {});
});

test("save then load round-trips", (t) => {
  const dir = makeProfile(t);
  Config.save({ dataPath: dir, language: "uk" });
  assert.deepEqual(Config.load(), { dataPath: dir, language: "uk" });
});

test("save is atomic and leaves no .tmp behind", (t) => {
  const dir = makeProfile(t);
  Config.save({ dataPath: dir });
  assert.deepEqual(
    fs.readdirSync(dir).filter((n) => n.endsWith(".tmp")),
    [],
  );
});

test("a config truncated mid-write still yields the data folder", (t) => {
  const dir = makeProfile(t);
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "config-data-"));
  t.after(() => fs.rmSync(data, { recursive: true, force: true }));

  // The shape a force-kill during a non-atomic write leaves behind.
  const full = JSON.stringify({ dataPath: data, language: "uk" });
  fs.writeFileSync(configFile(dir), full.slice(0, full.length - 12));

  const loaded = Config.load();
  assert.equal(
    loaded.dataPath,
    data,
    "the data folder must be recovered, not forgotten",
  );
  assert.ok(!loaded.unreadable, "a corrupt config must not block startup");
  assert.ok(
    fs.readdirSync(dir).some((n) => /^config\.json\.\d+\.bak$/.test(n)),
    "the corrupt file is kept, never deleted",
  );
});

test("an unsalvageable config falls back to first-launch setup", (t) => {
  const dir = makeProfile(t);
  fs.writeFileSync(configFile(dir), "%%% not json at all %%%");
  const loaded = Config.load();
  // {} means "run setup" — the app stays usable rather than refusing to start.
  assert.deepEqual(loaded, {});
});

test("a salvaged data folder is ignored when it no longer exists", (t) => {
  const dir = makeProfile(t);
  const gone = path.join(os.tmpdir(), "config-data-that-never-existed-12345");
  const full = JSON.stringify({ dataPath: gone, language: "uk" });
  fs.writeFileSync(configFile(dir), full.slice(0, full.length - 12));
  assert.deepEqual(Config.load(), {}, "never point the app at a missing folder");
});

test("an unreadable config is flagged, not treated as missing", (t) => {
  const dir = makeProfile(t);
  Config.save({ dataPath: dir, language: "uk" });

  // A lock from antivirus or a file-sync tool: the file is almost certainly
  // fine, so reporting "no config" would run setup and save over it.
  const realRead = fs.readFileSync;
  fs.readFileSync = (p, ...rest) => {
    if (String(p).endsWith("config.json")) {
      throw Object.assign(new Error("EBUSY: resource busy or locked"), {
        code: "EBUSY",
      });
    }
    return realRead(p, ...rest);
  };
  t.after(() => {
    fs.readFileSync = realRead;
  });

  const loaded = Config.load();
  assert.ok(loaded.unreadable, "the caller must be able to tell this apart");
  assert.ok(!loaded.dataPath);
  // And the real file is untouched, so the next launch recovers fully.
  assert.equal(JSON.parse(realRead(configFile(dir), "utf8")).dataPath, dir);
});
