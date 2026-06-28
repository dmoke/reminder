; Custom NSIS hooks for the Reminders installer.
;
; electron-builder auto-includes build/installer.nsh and invokes these macros at
; defined points in its generated installer/uninstaller scripts.
;
; customInit runs early in the installer's .onInit. When the app is already
; installed we ask the user to confirm before continuing; choosing Cancel aborts
; the installer. Either way nothing destructive happens here — the in-place
; update preserves settings, and the uninstaller never touches the user-chosen
; reminders data folder.

!macro customInit
  ; Never prompt during a silent / auto-update run (e.g. a background updater
  ; invoking the installer with /S) — a modal dialog would hang it.
  IfSilent reminders_proceed

  ; ${UNINSTALL_REGISTRY_KEY} + SHELL_CONTEXT are defined by electron-builder and
  ; point at this app's uninstall entry (HKCU for our per-user install). A
  ; non-empty DisplayName means a previous version is already installed.
  ReadRegStr $0 SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "DisplayName"
  StrCmp $0 "" reminders_proceed

  MessageBox MB_OKCANCEL|MB_ICONQUESTION \
    "Reminders is already installed.$\r$\n$\r$\nUpdate it to this version? Your reminders and settings will be kept." \
    IDOK reminders_proceed
  Quit

  reminders_proceed:
!macroend
