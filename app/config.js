const fs = require("fs");
const path = require("path");
const { app } = require("electron");

// Resolved lazily (not at module load) so an early app.setPath("userData", …)
// — e.g. the separate dev profile set in main.js — is honored. Reading it at
// require time would bake in the default userData before that override runs.
function configPath() {
  return path.join(app.getPath("userData"), "config.json");
}

function load() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), "utf8"));
  } catch {
    return {};
  }
}

function save(config) {
  const p = configPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(config, null, 2));
}

module.exports = { load, save };
