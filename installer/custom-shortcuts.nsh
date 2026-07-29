!macro customFinishPage
  Page custom finishPageShow finishPageLeave

  Var chkDesktop
  Var chkStartMenu
  Var chkRunApp

  Function finishPageShow
    !insertmacro MUI_HEADER_TEXT "$(mui.finishpage.title)" "$(mui.finishpage.subtitle)"
    nsDialogs::Create 1018
    Pop $0

    ${NSD_CreateLabel} 0u 10u 100% 20u "$(mui.finishpage.text)"
    Pop $0

    ${NSD_CreateCheckbox} 10u 50u 200u 12u "Create desktop shortcut"
    Pop $chkDesktop
    ${NSD_Check} $chkDesktop

    ${NSD_CreateCheckbox} 10u 70u 200u 12u "Create start menu shortcut"
    Pop $chkStartMenu
    ${NSD_Check} $chkStartMenu

    ${NSD_CreateCheckbox} 10u 90u 200u 12u "Run Crux Client"
    Pop $chkRunApp
    ${NSD_Check} $chkRunApp

    nsDialogs::Show
  FunctionEnd

  Function finishPageLeave
    ${NSD_GetState} $chkDesktop $0
    ${If} $0 == ${BST_CHECKED}
      CreateShortCut "$DESKTOP\${SHORTCUT_NAME}.lnk" "$appExe"
      WinShell::SetLnkAUMI "$DESKTOP\${SHORTCUT_NAME}.lnk" "${APP_ID}"
    ${EndIf}

    ${NSD_GetState} $chkStartMenu $0
    ${If} $0 == ${BST_CHECKED}
      !ifdef MENU_FILENAME
        CreateDirectory "$SMPROGRAMS\${MENU_FILENAME}"
        CreateShortCut "$SMPROGRAMS\${MENU_FILENAME}\${SHORTCUT_NAME}.lnk" "$appExe"
      !else
        CreateShortCut "$SMPROGRAMS\${SHORTCUT_NAME}.lnk" "$appExe"
      !endif
      WinShell::SetLnkAUMI "$SMPROGRAMS\${SHORTCUT_NAME}.lnk" "${APP_ID}"
    ${EndIf}

    System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'

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
