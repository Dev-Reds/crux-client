!macro customInstall
  CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
  ClearErrors
  WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"

  !ifdef MENU_FILENAME
    CreateDirectory "$SMPROGRAMS\${MENU_FILENAME}"
  !endif
  CreateShortCut "$newStartMenuLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
  ClearErrors
  WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"

  System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
!macroend

!macro customFinishPage
  Page custom finishPageShow finishPageLeave

  Var chkRunApp

  Function finishPageShow
    !insertmacro MUI_HEADER_TEXT "Completing Crux Client Setup" "Setup has completed successfully."
    nsDialogs::Create 1018
    Pop $0

    ${NSD_CreateLabel} 0u 10u 100% 20u "Setup has completed successfully. Shortcuts have been created in the Start Menu and Desktop."
    Pop $0

    ${NSD_CreateCheckbox} 10u 50u 200u 12u "Run Crux Client"
    Pop $chkRunApp
    ${NSD_Check} $chkRunApp

    nsDialogs::Show
  FunctionEnd

  Function finishPageLeave
    ${NSD_GetState} $chkRunApp $0
    ${If} $0 == ${BST_CHECKED}
      HideWindow
      ${if} ${isUpdated}
        StrCpy $1 "--updated"
      ${else}
        StrCpy $1 ""
      ${endif}
      ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
    ${EndIf}
  FunctionEnd
!macroend
