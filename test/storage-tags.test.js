const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const Storage = require("../app/storage.js");

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "storage-tags-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("removeTag strips a tag from active and history reminders", (t) => {
  const dir = tempDir(t);
  const store = new Storage(dir);
  store.add({ id: "a", text: "x", time: "2026-01-01T09:00:00Z", tags: ["work", "home"] });
  store.add({ id: "b", text: "y", time: "2026-01-02T09:00:00Z", tags: ["home"] });
  store.archive("b"); // b -> history (still carries "home")

  const changed = store.removeTag("home");
  assert.equal(changed, true);

  assert.deepEqual(store.getActive()[0].tags, ["work"]);
  const hist = store.getHistory();
  assert.equal(hist[0].id, "b");
  assert.deepEqual(hist[0].tags, []);
});

test("removeTag returns false when the tag is not present", (t) => {
  const dir = tempDir(t);
  const store = new Storage(dir);
  store.add({ id: "a", text: "x", time: "2026-01-01T09:00:00Z", tags: ["work"] });
  assert.equal(store.removeTag("nonexistent"), false);
});
