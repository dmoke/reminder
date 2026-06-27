# Reminders

Reminders is a Windows tray-based desktop reminders app built with Electron. It runs quietly in the system tray, lets you create timed reminders with a text note and a date/time picker, and fires a native Windows toast notification when each reminder is due. Reminders are stored locally as JSON in a folder you choose, so your data stays on your machine.

## Install (Windows)

1. Go to the **[latest release](https://github.com/dmoke/reminder/releases/latest)**.
2. Under **Assets**, download `Reminders-Setup-<version>.exe`.
3. Run the installer (it installs for the current user — no administrator rights needed) and follow the prompts.

> **SmartScreen note:** the app is not code-signed, so Windows may show a
> "Windows protected your PC" prompt the first time you run the installer.
> Click **More info → Run anyway** to continue.

After installing, Reminders launches into the system tray and (by default) starts automatically with Windows. You can turn auto-start off in **Settings**.

## Features

- **System tray app** — the app lives in the Windows tray. Closing the main window hides it; the tray icon and scheduler keep running in the background. The tray menu offers **Open Reminders**, **Add Reminder**, and **Quit**, and left-clicking the tray icon opens the main window.
- **Toast notifications** — a scheduler polls once per second and shows a native Windows notification when a reminder is due, with **Complete** and **Snooze 10 min** action buttons.
- **Add reminders** — enter reminder text and pick a date/time (year, month, day, hour, minute) with a dropdown-assisted picker, plus a **Now** shortcut.
- **Organized views** — see counts and lists for **Upcoming**, **Overdue**, and **Completed** reminders.
- **Search** — filter active and completed reminders by text.
- **Snooze** — postpone an active reminder by 10 minutes, 1 day, 2 days, 1 week, or 1 month.
- **Reschedule / edit** — change a reminder's text or time.
- **Complete & delete** — mark reminders done (archived to history) or delete them outright.
- **History management** — delete completed reminders by time range (last hour, today, last 7 days, all time).
- **Choose data folder** — pick where reminders are stored, and open that folder from the app.
- **Language switch** — English or Українська (Ukrainian).
- **Start with Windows** — optional login-item toggle so the app launches at startup (installed builds only).

## Security posture

- `contextIsolation` enabled and `nodeIntegration` disabled on all windows.
- The renderer talks to the main process only through a `contextBridge` preload (`app/preload.js`); all persistence and OS access happens in the main process.
- A `Content-Security-Policy` is applied to bundled pages, and window-open / external-navigation attempts are blocked.
- IPC input from the renderer is sanitized before any reminder is persisted.

## Requirements

- [Node.js](https://nodejs.org/) (with npm)
- Windows — the app uses Windows toast notifications and the system tray, and is packaged for Windows via electron-builder's NSIS target.

## Getting started / Development

Install dependencies:

```bash
npm install
```

Run the app in development:

```bash
npm start
```

`npm start` runs `electron . --enable-logging`. On first launch the app asks you to pick a folder where reminders will be stored; the chosen path is saved in the app's config and reused on subsequent launches.

## Running tests

```bash
npm test
```

Tests run the [`node:test`](https://nodejs.org/api/test.html) suite (via `node --test`) under the `test/` directory.

## Building the installer

```bash
npm run build
```

This runs electron-builder with the Windows **NSIS** target. The installer is written to the `dist/` directory.

### Publishing a release

Releases are automated. Bump the `version` in `package.json`, then push a matching tag:

```bash
git tag v1.0.0
git push origin v1.0.0
```

The [`.github/workflows/release.yml`](.github/workflows/release.yml) workflow builds the installer on a Windows runner and uploads it to a public GitHub Release, where users can download it from the **Install** steps above. You can also trigger it manually from the **Actions** tab (`Release` → *Run workflow*).

## Data & storage

- **Reminders** are stored as JSON in the folder you select on first launch:
  - `reminders.json` — active reminders
  - `history.json` — completed (archived) reminders
- **App configuration** (including the selected data-folder path and the start-with-Windows preference) is stored in `config.json` inside Electron's per-user `userData` directory (for example, `%APPDATA%\reminder\config.json`).

You can change the data folder at any time from the app's Settings panel, and open the current folder in File Explorer.

## Project structure

```
reminder/
├── app/                 # Electron main process
│   ├── main.js          # App entry: windows, IPC handlers, lifecycle, CSP
│   ├── storage.js       # JSON persistence (reminders.json / history.json)
│   ├── scheduler.js     # 1s polling + due-reminder toast notifications
│   ├── tray.js          # System tray icon and context menu
│   ├── config.js        # Loads/saves config.json in userData
│   ├── preload.js       # contextBridge API exposed to the renderer
│   └── assets/          # App/tray icon
├── ui/                  # Renderer (UI)
│   ├── index.html       # Main window (views, search, settings)
│   ├── add.html         # Add-reminder modal window
│   ├── renderer.js      # UI logic for both windows
│   └── styles.css       # Styles
├── test/                # node:test suite (run with npm test)
└── package.json
```
