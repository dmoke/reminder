; Custom NSIS hooks for the Reminders installer.
;
; electron-builder auto-includes build/installer.nsh and invokes these macros at
; defined points in its generated installer/uninstaller scripts.
;
; Two jobs here:
;   1. Refuse to install into a folder that holds reminder data. This is the one
;      way an update can destroy reminders, and it is not hypothetical — see the
;      comment on customInit below.
;   2. Confirm before updating an existing install, and say plainly that the
;      user's data is not touched.

; Shared message for the "that folder holds your reminders" refusal.
!define REMINDERS_DATA_DIR_MSG "This folder holds your reminders (reminders.json).$\r$\n$\r$\nReminders cannot be installed here. Installing replaces everything in the program folder, which would delete them.$\r$\n$\r$\nChoose an empty folder, or accept the default location. Your reminders folder is chosen separately, inside the app."

!macro customHeader
  ; Blocks the Next button on the directory page when the chosen folder holds
  ; reminder data. Covers a fresh install where the user browses to their own
  ; data folder — at that point .onInit has long since run.
  Function .onVerifyInstDir
    IfFileExists "$INSTDIR\reminders.json" 0 reminders_verify_ok
      Abort
    reminders_verify_ok:
  FunctionEnd
!macroend

!macro customInit
  ; initMultiUser has already run, so $INSTDIR is the folder this install will
  ; actually use — including the one remembered from a PREVIOUS install, which
  ; is what a silent or in-place update inherits without ever showing a
  ; directory page.
  ;
  ; That inherited path is the dangerous case. If an earlier version was once
  ; installed into a folder the user later also picked for their data, every
  ; subsequent update silently wipes it: the uninstaller electron-builder runs
  ; during an update does an unconditional RMDir /r $INSTDIR. Refuse instead —
  ; a failed install is recoverable, a deleted reminders.json is not.
  IfFileExists "$INSTDIR\reminders.json" 0 reminders_dir_ok
    IfSilent reminders_dir_stop
    MessageBox MB_OK|MB_ICONSTOP "${REMINDERS_DATA_DIR_MSG}"
    reminders_dir_stop:
    ; Quit, not Abort: this runs inside .onInit, where Abort leaves the
    ; half-initialised installer to unwind and crash instead of exiting.
    Quit
  reminders_dir_ok:

  ; Never prompt during a silent / auto-update run (e.g. a background updater
  ; invoking the installer with /S) — a modal dialog would hang it.
  IfSilent reminders_proceed

  ; ${UNINSTALL_REGISTRY_KEY} + SHELL_CONTEXT are defined by electron-builder and
  ; point at this app's uninstall entry (HKCU for our per-user install). A
  ; non-empty DisplayName means a previous version is already installed.
  ReadRegStr $0 SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "DisplayName"
  StrCmp $0 "" reminders_proceed

  MessageBox MB_OKCANCEL|MB_ICONQUESTION \
    "Reminders is already installed.$\r$\n$\r$\nUpdate it to this version?$\r$\n$\r$\nYour reminders live in your own data folder, outside the program folder, and this update does not touch it. Your settings are kept, and a snapshot of your reminders is saved automatically the first time the new version starts." \
    IDOK reminders_proceed
  Quit

  reminders_proceed:
!macroend
