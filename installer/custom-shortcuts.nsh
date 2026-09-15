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

  ; Pin to taskbar: shortcuts placed in the "User Pinned\TaskBar" folder are
  ; shown as pinned taskbar icons. The AppUserModelID must match the one the
  ; app sets at runtime (see app.setAppUserModelId in main.js).
  CreateDirectory "$APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar"
  CreateShortCut "$APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\${APP_FILENAME}.lnk" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
  ClearErrors
  WinShell::SetLnkAUMI "$APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\${APP_FILENAME}.lnk" "${APP_ID}"

  ; Just creating the .lnk in that folder does NOT pin it on Windows 10/11, so
  ; we must explicitly invoke the "Pin to taskbar" shell verb as well.
  Sleep 1000
  ${StdUtils.InvokeShellVerb} $0 "$APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar" "${APP_FILENAME}.lnk" ${StdUtils.Const.ShellVerb.PinToTaskbar}

  System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
!macroend

!macro customUnInstall
  ${StdUtils.InvokeShellVerb} $0 "$APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar" "${APP_FILENAME}.lnk" ${StdUtils.Const.ShellVerb.UnpinFromTaskbar}
  Delete "$APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\${APP_FILENAME}.lnk"
  System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
!macroend

!macro customFinishPage
  Page custom finishPageShow finishPageLeave

  Var chkDesktop
  Var chkStartMenu
  Var chkTaskbar
  Var chkRunApp

  Function finishPageShow
    !insertmacro MUI_HEADER_TEXT "Completing Crux Client Setup" "Setup has completed successfully."
    nsDialogs::Create 1018
    Pop $0

    ${NSD_CreateLabel} 0u 10u 100% 20u "Setup has completed successfully. Select additional options below:"
    Pop $0

    ${NSD_CreateCheckbox} 10u 50u 200u 12u "Create desktop shortcut"
    Pop $chkDesktop
    ${NSD_Check} $chkDesktop

    ${NSD_CreateCheckbox} 10u 70u 200u 12u "Create start menu shortcut"
    Pop $chkStartMenu
    ${NSD_Check} $chkStartMenu

    ${NSD_CreateCheckbox} 10u 90u 200u 12u "Pin to taskbar"
    Pop $chkTaskbar
    ${NSD_Check} $chkTaskbar

    ${NSD_CreateCheckbox} 10u 110u 200u 12u "Run Crux Client"
    Pop $chkRunApp
    ${NSD_Check} $chkRunApp

    nsDialogs::Show
  FunctionEnd

  Function finishPageLeave
    ${NSD_GetState} $chkDesktop $0
    ${If} $0 == ${BST_UNCHECKED}
      Delete "$newDesktopLink"
    ${EndIf}

    ${NSD_GetState} $chkStartMenu $0
    ${If} $0 == ${BST_UNCHECKED}
      Delete "$newStartMenuLink"
    ${EndIf}

    ${NSD_GetState} $chkTaskbar $0
    ${If} $0 == ${BST_UNCHECKED}
      ${StdUtils.InvokeShellVerb} $0 "$APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar" "${APP_FILENAME}.lnk" ${StdUtils.Const.ShellVerb.UnpinFromTaskbar}
      Delete "$APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\${APP_FILENAME}.lnk"
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
