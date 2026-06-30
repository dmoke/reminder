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

> **Re-running the installer:** if Reminders is already installed, the installer
> asks you to confirm before continuing — choosing **OK** updates it in place
> (your reminders and settings are kept) and **Cancel** stops. Your reminders
> live in the data folder you chose and are never touched by the installer or
> uninstaller.

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
- **Import from Pichugin Organizer** — bring in reminders from a [Pichugin Organizer 3](#importing-from-pichugin-organizer) database (`db_<name>.podb`) or its XML export (`db_<name>.podb.xml`) from **Settings → Import**. Completed tasks go to history, the rest become active reminders, and re-importing the same file skips duplicates.
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

### Backups

To guard against data loss across updates, the app keeps an automatic backup of
your reminders. The backup is a single, self-describing JSON file named
`reminder-backup-<timestamp>.json` that bundles **both** data files together with
the app and format versions that wrote it:

```json
{
  "format": "reminder-backup",
  "formatVersion": 1,
  "appVersion": "1.2.0",
  "dataVersion": "1.1.0",
  "createdAt": "2026-06-28T12:00:00.000Z",
  "reason": "version-change",
  "counts": { "reminders": 12, "history": 340 },
  "data": { "reminders": [ ... ], "history": [ ... ] }
}
```

- **Where backups live** — in a stable per-user app directory **outside your
  data folder**: `%APPDATA%\reminder\backups\<data-folder>\`. Keeping them off the
  data folder (which may live on OneDrive, or be moved or deleted) means the
  backup survives even if that folder is moved, deleted, or un-synced — the exact
  "I lost my stuff" case the backup exists for. Backups are namespaced per data
  folder, so switching folders never overwrites another folder's snapshot. Open
  it from **Settings → Open backups folder**. (Older backups that lived inside a
  `backups/` subfolder of the data folder are carried over automatically on first
  launch.)
- **When backups are taken** — on startup at most once every 12 hours, and
  **always** immediately when the app version changes, so the exact state from
  before an update is captured before the new version touches anything. (For
  that pre-update snapshot, `appVersion` is the new build that wrote the file
  while `dataVersion` is the older version the data still belongs to.) A
  partially-broken file is preserved verbatim rather than discarded.
- **Rotation** — only the most recent snapshot is kept, so the folder never
  accumulates files. Right after an update that single file is the pre-update
  snapshot (captured before the new version touched anything); it refreshes to
  the current state on a later launch.
- **Restoring** — open the backups folder (Settings → **Open backups folder**),
  and copy the `reminders` / `history` arrays from the snapshot's `data` field
  back into `reminders.json` / `history.json` (with the app closed). If you hit a
  problem after an update, sharing the backup file is enough to recover or
  diagnose your reminders.

### Importing from Pichugin Organizer

You can migrate reminders from **Pichugin Organizer 3** in **Settings → Import
reminders → Import from Pichugin Organizer…**, then pick one of its data files:

- `db_<name>.podb` — the live organizer database (always current).
- `db_<name>.podb.xml` — a manual XML export from the organizer.

Both are read directly (including their Windows‑1251 Cyrillic text — no manual
conversion needed). Each task is mapped to a reminder: its scheduled date/time
becomes the reminder time, completed tasks are added to your **history**, and the
rest become **active** reminders. Imports are matched on the organizer's task id,
so re-importing the same file (or importing both the `.podb` and its `.podb.xml`)
never creates duplicates — already-imported tasks are skipped. A short summary
(added / completed / skipped) is shown after each import. Repeat schedules are not
carried over (imported reminders are one-off).

## Project structure

```
reminder/
├── app/                 # Electron main process
│   ├── main.js          # App entry: windows, IPC handlers, lifecycle, CSP
│   ├── storage.js       # JSON persistence (reminders.json / history.json)
│   ├── backup.js        # Versioned snapshots of the dataset (per-user app backups dir)
│   ├── scheduler.js     # 1s polling + due-reminder toast notifications
│   ├── tray.js          # System tray icon and context menu
│   ├── config.js        # Loads/saves config.json in userData
│   ├── pichugin.js      # Parser/importer for Pichugin Organizer 3 (.podb / .podb.xml)
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
