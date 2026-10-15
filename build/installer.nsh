; Query the exact process name; never treat copy failures as a running app.
!macro customCheckAppRunning
  Push $R0
  Push $R1
  kg_check_running:
    nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -Command "try { if (@(Get-Process -Name $\'${PRODUCT_FILENAME}$\' -ErrorAction SilentlyContinue).Count -gt 0) { exit 1 }; exit 0 } catch { exit 2 }"'
    Pop $R0
    Pop $R1
    ${If} $R0 == 1
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "${PRODUCT_NAME}.exe is running. Please save your work and exit the application, then retry." /SD IDCANCEL IDRETRY kg_check_running
      Pop $R1
      Pop $R0
      Abort
    ${ElseIf} $R0 != 0
      MessageBox MB_OK|MB_ICONSTOP "Unable to check application processes (error $R0). $R1"
      Pop $R1
      Pop $R0
      Abort
    ${EndIf}
  Pop $R1
  Pop $R0
!macroend
