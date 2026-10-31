!macro customUnInstall
  ; Keep the registration across installer updates. Actual uninstall removes only
  ; this application's opt-in login item; retained userData is untouched.
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Shortcut Expert"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "Shortcut Expert"
  ${endIf}
!macroend
