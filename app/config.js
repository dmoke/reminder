const fs = require("fs");
const path = require("path");
const { app } = require("electron");

const configPath = path.join(app.getPath("userData"), "config.json");

function load() {
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {
    return {};
  }
}

function save(config) {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

module.exports = { load, save };
