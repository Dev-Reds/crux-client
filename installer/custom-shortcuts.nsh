; custom-shortcuts.nsh - Custom shortcut selection page for Crux Client installer

Var chkDesktopShortcut
Var chkStartMenuShortcut

!macro customHeader
  ; Don't auto-launch after install - we handle it after shortcuts
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
    ${NSD_GetState} $chkDesktopShortcut $0
    ${If} $0 == ${BST_CHECKED}
      CreateShortCut "$DESKTOP\Crux Client.lnk" "$INSTDIR\Crux Client.exe" "" "$INSTDIR\icons\icon.ico"
    ${EndIf}
    ${NSD_GetState} $chkStartMenuShortcut $0
    ${If} $0 == ${BST_CHECKED}
      CreateDirectory "$SMPROGRAMS\Crux Client"
      CreateShortCut "$SMPROGRAMS\Crux Client\Crux Client.lnk" "$INSTDIR\Crux Client.exe" "" "$INSTDIR\icons\icon.ico"
    ${EndIf}
    ; Now launch the application
    Exec '"$INSTDIR\Crux Client.exe"'
  FunctionEnd
!macroend
