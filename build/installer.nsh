; Custom NSIS hooks for the Reminders installer.
;
; electron-builder auto-includes build/installer.nsh and invokes these macros at
; defined points in its generated installer/uninstaller scripts.
;
; Two jobs here:
;   1. Never install into a folder that holds reminder data. This is the one way
;      an update can destroy reminders, and it is not hypothetical — see the
;      comment on customInit below.
;   2. Confirm before updating an existing install, and say plainly that the
;      user's data is not touched.

; Shown only when there is genuinely nowhere safe left to install to. Every
; other case is recoverable and must not stop setup — see customInit.
!define REMINDERS_DATA_DIR_MSG "Your reminders (reminders.json) are in the folder Reminders is installed in, and also in the default install location.$\r$\n$\r$\nInstalling replaces everything in the program folder, which would delete them, so setup cannot continue.$\r$\n$\r$\nOpen Reminders, move your reminders to a folder of their own with Settings > Data folder > Change, then run setup again."

!macro customHeader
  ; Remembers the folder customInit refused, so the message can name it. Only
  ; for the installer pass: customHeader is compiled into the uninstaller too,
  ; customInit is not, and an unreferenced Var there is a warning — which
  ; electron-builder compiles with -WX.
  !ifndef BUILD_UNINSTALLER
    Var reminders_old_instdir
  !endif

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
  ; during an update does an unconditional RMDir /r $INSTDIR.
  IfFileExists "$INSTDIR\reminders.json" 0 reminders_dir_ok

    ; A silent run can neither ask nor let the user retarget the install, so
    ; stopping is the only safe answer. Quit, not Abort: Abort inside .onInit
    ; leaves the half-initialised installer to unwind and crash instead of
    ; exiting.
    IfSilent 0 reminders_dir_retarget
      Quit

    reminders_dir_retarget:
    ; Interactive: retarget, do NOT quit. Quitting here is what v1.3.1/v1.3.2
    ; did, and it dead-ended every machine whose previous install folder is also
    ; its data folder: $INSTDIR comes from the registry, so the refusal fired
    ; before any directory page and no choice of folder — including the folder
    ; setup itself was started from — could get past it.
    ;
    ; Sending the install to the default location is safe and keeps the data:
    ; the old folder is left untouched, and the new version still finds the
    ; reminders because the data folder is remembered in config.json under
    ; %APPDATA%, not in the program folder.
    StrCpy $reminders_old_instdir $INSTDIR
    ; electron-builder resolves this through FOLDERID_UserProgramFiles and falls
    ; back to the same literal; on a machine where those differ the user can
    ; still correct it on the directory page.
    StrCpy $INSTDIR "$LOCALAPPDATA\Programs\${APP_FILENAME}"

    ; If the default holds reminders too, there is no safe folder left to
    ; preselect. The directory page is skipped for an updater-driven run
    ; (--updated), so falling through could still wipe data — stop instead.
    IfFileExists "$INSTDIR\reminders.json" 0 reminders_dir_retargeted
      MessageBox MB_OK|MB_ICONSTOP "${REMINDERS_DATA_DIR_MSG}"
      Quit

    reminders_dir_retargeted:
    MessageBox MB_OK|MB_ICONEXCLAMATION \
      "The folder Reminders is installed in also holds your reminders (reminders.json):$\r$\n$\r$\n$reminders_old_instdir$\r$\n$\r$\nInstalling there would replace everything in it and delete them, so this install has been pointed at:$\r$\n$\r$\n$INSTDIR$\r$\n$\r$\nThe old folder is left untouched and your reminders stay where they are — the new version will still find them. You can confirm or change the install folder on the next page."

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
