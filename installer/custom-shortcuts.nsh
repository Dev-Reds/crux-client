; custom-shortcuts.nsh - Custom shortcut selection page for Crux Client installer

Var chkDesktopShortcut
Var chkStartMenuShortcut
Var createDesktop
Var createStartMenu

!macro customHeader
  !define DONT_RUN_APP_AFTER_INSTALL

  Page custom nsisShortcutsPageShow nsisShortcutsPageLeave

  Function nsisShortcutsPageShow
    nsDialogs::Create 1018
    Pop $0
    ${NSD_CreateLabel} 0u 10u 100% 20u "Select additional tasks:"
    Pop $0
    ${NSD_CreateCheckbox} 10u 40u 200u 12u "Create desktop shortcut"
    Pop $chkDesktopShortcut
    ${NSD_Check} $chkDesktopShortcut
    ${NSD_CreateCheckbox} 10u 60u 200u 12u "Create start menu shortcut"
    Pop $chkStartMenuShortcut
    ${NSD_Check} $chkStartMenuShortcut
    nsDialogs::Show
  FunctionEnd

  Function nsisShortcutsPageLeave
    ${NSD_GetState} $chkDesktopShortcut $createDesktop
    ${NSD_GetState} $chkStartMenuShortcut $createStartMenu
  FunctionEnd
!macroend

!macro customInstall
  ${If} $createDesktop == ${BST_CHECKED}
    CreateShortCut "$DESKTOP\Crux Client.lnk" "$INSTDIR\Crux Client.exe" "" "$INSTDIR\icons\icon.ico"
  ${EndIf}
  ${If} $createStartMenu == ${BST_CHECKED}
    CreateDirectory "$SMPROGRAMS\Crux Client"
    CreateShortCut "$SMPROGRAMS\Crux Client\Crux Client.lnk" "$INSTDIR\Crux Client.exe" "" "$INSTDIR\icons\icon.ico"
  ${EndIf}
!macroend
