const { Tray, Menu, nativeImage } = require("electron");
const path = require("path");

function createTray(openMainWindow) {
  let icon;
  const iconPath = path.join(__dirname, "assets", "icon.ico");
  try {
    const image = nativeImage.createFromPath(iconPath);
    icon = image.isEmpty()
      ? nativeImage.createEmpty()
      : image.resize({ width: 16, height: 16 });
  } catch {
    icon = nativeImage.createEmpty();
  }
  const tray = new Tray(icon);
  const contextMenu = Menu.buildFromTemplate([
    { label: "Close", click: () => require("electron").app.quit() },
  ]);
  tray.setToolTip("Reminders");
  tray.setContextMenu(contextMenu);
  tray.on("click", openMainWindow);
  return tray;
}

module.exports = { createTray };
