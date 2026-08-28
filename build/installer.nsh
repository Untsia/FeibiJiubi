; ============================================================================
; FeibiJiubi NSIS customization (installer + uninstaller)
;
; IMPORTANT: keep this file ASCII-only.  makensis (Unicode NSIS) parses
; source files as UTF-8; a GBK/ANSI saved file turns CJK chars into
; mojibake, so `taskkill /IM "<mojibake>.exe"` matches nothing and the old
; app process can never be closed.
; All process matching below is done via ASCII executable names and the
; (ASCII) install directory path -- no CJK literals needed.
; ============================================================================

; ---------------------------------------------------------------------------
; preInit: runs at the very start of .onInit (before UAC elevation).
; Best-effort kill of the old app so later checks do not find it running.
; ---------------------------------------------------------------------------
!macro preInit
  nsExec::ExecToLog 'taskkill.exe /IM "feibijiubi.exe" /T /F'
  nsExec::ExecToLog 'taskkill.exe /IM "FeibiJiubi.exe" /T /F'
  Sleep 300
!macroend

; ---------------------------------------------------------------------------
; customInit: runs at the end of .onInit, right before CHECK_APP_RUNNING.
; Kill again by name, plus a PowerShell kill by install-dir path.
; ---------------------------------------------------------------------------
!macro customInit
  nsExec::ExecToLog 'taskkill.exe /IM "feibijiubi.exe" /T /F'
  nsExec::ExecToLog 'taskkill.exe /IM "FeibiJiubi.exe" /T /F'
  Sleep 500
  ${if} $INSTDIR != ""
    nsExec::ExecToLog `powershell.exe -NoProfile -NonInteractive -Command "Get-CimInstance Win32_Process | Where-Object { $$_.ExecutablePath -and $$_.ExecutablePath.StartsWith('$INSTDIR', [System.StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"`
    Sleep 800
  ${endIf}
  nsExec::ExecToLog 'taskkill.exe /IM "feibijiubi.exe" /T /F'
  Sleep 300
!macroend

; ---------------------------------------------------------------------------
; customCheckAppRunning: REPLACES electron-builder's default CHECK_APP_RUNNING.
;
; Why: the default logic (allowOnlyOneInstallerInstance.nsh) treats the app
; as running when ANY process path starts with $INSTDIR.  When the
; "InstallLocation" registry value is missing (e.g. a broken previous
; install), $INSTDIR can be empty, so StartsWith('') matches EVERY process
; -> installer believes the app is always running, its kill loop can never
; succeed, and it shows the "cannot be closed / Retry" box forever.
;
; Here we silently kill by executable name + install dir and then continue
; without any retry dialog, so installation can proceed.
; ---------------------------------------------------------------------------
!macro customCheckAppRunning
  nsExec::ExecToLog 'taskkill.exe /IM "feibijiubi.exe" /T /F'
  nsExec::ExecToLog 'taskkill.exe /IM "FeibiJiubi.exe" /T /F'
  Sleep 500
  ${if} $INSTDIR != ""
    nsExec::ExecToLog `powershell.exe -NoProfile -NonInteractive -Command "Get-CimInstance Win32_Process | Where-Object { $$_.ExecutablePath -and $$_.ExecutablePath.StartsWith('$INSTDIR', [System.StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"`
    Sleep 800
  ${endIf}
  nsExec::ExecToLog 'taskkill.exe /IM "feibijiubi.exe" /T /F'
  Sleep 300
  ; Remove the old uninstall registry entry so uninstallOldVersion() skips
  ; running the buggy OLD uninstaller (built before this fix).  That old
  ; uninstaller uses electron-builder's default CHECK_APP_RUNNING with an
  ; empty $INSTDIR (InstallLocation was never written), so it can never close
  ; the app and returns a non-zero code -> installer shows the
  ; "cannot be closed / Retry" loop forever.
  ; The new installer overwrites the old files anyway.
  !ifndef BUILD_UNINSTALLER
    DeleteRegKey SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}"
  !endif
!macroend
