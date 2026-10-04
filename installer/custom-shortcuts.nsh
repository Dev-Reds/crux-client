# ── Crux Client installer customisations ──────────────────────────────────────
#
# Wird per package.json -> build.nsis.include als "installer.nsh" eingebunden und
# VOR common.nsh / multiUser.nsh / MUI2.nsh geparst. Defines aus diesen Dateien
# (${VERSION}, ${APP_EXECUTABLE_FILENAME}, ${UNINSTALL_FILENAME},
# ${INSTALL_REGISTRY_KEY}, ${UNINSTALL_REGISTRY_KEY}) sowie die Variable
# $installMode sind beim Parsen DIESER Datei noch nicht vorhanden - sie duerfen
# deshalb nur in !macro-Bodies benutzt werden (dort greift die Ersetzung erst
# bei !insertmacro, also nach dem Include von assistedInstaller.nsh).
#
# Enthaelt:
#   * eine Auswahl-Seite ganz vorn (Installieren / Aktualisieren / Deinstallieren)
#   * ein In-Place-Update: der Installer ersetzt die Dateien direkt, OHNE die
#     alte Version vorher zu deinstallieren (Profil/Konten/Einstellungen bleiben)
#   * eine Deinstallation aus dem Installer heraus
#   * Desktop-/Startmenue-/Taskbar-Verknuepfungen und eine Finish-Seite

!ifdef BUILD_UNINSTALLER
  # Der Deinstaller selbst kennt kein Update/Deinstallieren-Auswahl, die Variablen
  # wuerden dort nur eine Warnung erzeugen (der Build laeuft mit -WX).
!else
  Var cruxInstalled        # "1" = Crux Client auf diesem PC gefunden
  Var cruxInstallDir       # Installationsordner der gefundenen Version
  Var cruxInstalledVersion # Version der gefundenen Version
  Var cruxActionMode       # "" | "install" | "update" | "uninstall"
!endif

# Update OHNE Deinstallation.
# installSection.nsh ruft immer uninstallOldVersion auf, das die alte Version
# ueber die Registry findet und startet. Wir verstecken die Uninstall-Eintraege
# der alten Version, dadurch findet das Template nichts und ueberschreibt die
# Dateien direkt. registryAddInstallInfo schreibt die Eintraege danach neu,
# profile/Konten/Einstellungen (%APPDATA%\Crux Client) werden nie angefasst.
!macro cruxHideOldVersionReg
  ${If} $installMode == "all"
    DeleteRegValue HKEY_LOCAL_MACHINE "${UNINSTALL_REGISTRY_KEY}" UninstallString
    DeleteRegValue HKEY_LOCAL_MACHINE "${UNINSTALL_REGISTRY_KEY}" QuietUninstallString
    DeleteRegValue HKEY_LOCAL_MACHINE "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${Else}
    DeleteRegValue HKEY_CURRENT_USER "${UNINSTALL_REGISTRY_KEY}" UninstallString
    DeleteRegValue HKEY_CURRENT_USER "${UNINSTALL_REGISTRY_KEY}" QuietUninstallString
    DeleteRegValue HKEY_CURRENT_USER "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${EndIf}
!macroend

!macro cruxDoUninstall
  ; "Nein" springt ans Label und damit zurueck auf die Auswahl-Seite
  MessageBox MB_YESNO|MB_ICONQUESTION "${PRODUCT_NAME} will be removed completely - including all profiles, accounts and settings. Continue?" IDNO cruxDoUninstallAbort

  !insertmacro CHECK_APP_RUNNING

  ${If} $installMode == "all"
    ExecWait '"$cruxInstallDir\${UNINSTALL_FILENAME}" /S /allusers' $0
  ${Else}
    ExecWait '"$cruxInstallDir\${UNINSTALL_FILENAME}" /S /currentuser' $0
  ${EndIf}

  ${If} $0 != 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "Uninstall failed (error $0). The uninstaller can also be started from the app folder."
  ${EndIf}
  Quit

  cruxDoUninstallAbort:
  Abort
!macroend

!macro customInit
  StrCpy $cruxActionMode ""
  StrCpy $cruxInstalled "0"
  StrCpy $cruxInstallDir ""
  StrCpy $cruxInstalledVersion ""

  # Vorhandene Installation suchen (per-user zuerst, dann per-machine)
  ReadRegStr $0 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${If} $0 != ""
    StrCpy $cruxInstallDir $0
  ${Else}
    ReadRegStr $0 HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
    ${If} $0 != ""
      StrCpy $cruxInstallDir $0
    ${EndIf}
  ${EndIf}

  ${If} $cruxInstallDir != ""
  ${AndIf} ${FileExists} "$cruxInstallDir\${APP_EXECUTABLE_FILENAME}"
    StrCpy $cruxInstalled "1"
    ReadRegStr $1 HKCU "${UNINSTALL_REGISTRY_KEY}" DisplayVersion
    ${If} $1 == ""
      ReadRegStr $1 HKLM "${UNINSTALL_REGISTRY_KEY}" DisplayVersion
    ${EndIf}
    ${If} $1 == ""
      StrCpy $1 "?"
    ${EndIf}
    StrCpy $cruxInstalledVersion $1
  ${EndIf}

  # Update aus dem Launcher: "Crux-Client-Installer.exe /S --updated"
  # -> Seiten ueberspringen und direkt in-place aktualisieren
  ${If} ${isUpdated}
    StrCpy $cruxActionMode "update"
    !insertmacro cruxHideOldVersionReg
  ${EndIf}
!macroend

# Erste Seite: was soll der Installer tun? Ist Crux Client schon installiert,
# gibt es nur noch Aktualisieren und Deinstallieren.
!macro customWelcomePage
  Page custom cruxActionPageCreate cruxActionPageLeave

  Var rdInstall
  Var rdUpdate
  Var rdUninstall

  Function cruxActionPageCreate
    # Launcher-Update bzw. stille Installation: keine Auswahl-Seite
    ${If} ${isUpdated}
      Abort
    ${EndIf}
    ${If} ${Silent}
      Abort
    ${EndIf}

    !insertmacro MUI_HEADER_TEXT "${PRODUCT_NAME}" "Select what the installer should do"
    nsDialogs::Create 1018
    Pop $0

    ${If} $cruxInstalled == "1"
      ${NSD_CreateLabel} 0u 4u 300u 34u "${PRODUCT_NAME} is already installed on this PC.$\r$\nInstalled version: $cruxInstalledVersion$\r$\nFolder: $cruxInstallDir"
      Pop $0

      ${NSD_CreateRadioButton} 10u 48u 290u 14u "Update to version ${VERSION}"
      Pop $rdUpdate
      ${NSD_CreateLabel} 24u 62u 272u 28u "The app files are replaced in place. Profiles, accounts and settings are kept - nothing is uninstalled first."
      Pop $0

      ${NSD_CreateRadioButton} 10u 100u 290u 14u "Uninstall ${PRODUCT_NAME}"
      Pop $rdUninstall
      ${NSD_CreateLabel} 24u 114u 272u 14u "Removes the app and all of its data."
      Pop $0

      SendMessage $rdUpdate ${BM_SETCHECK} ${BST_CHECKED} 0
    ${Else}
      ${NSD_CreateRadioButton} 10u 20u 290u 14u "Install ${PRODUCT_NAME} ${VERSION}"
      Pop $rdInstall
      SendMessage $rdInstall ${BM_SETCHECK} ${BST_CHECKED} 0
      ${NSD_CreateLabel} 24u 34u 272u 28u "No installation of ${PRODUCT_NAME} was found on this PC."
      Pop $0
    ${EndIf}

    nsDialogs::Show
  FunctionEnd

  Function cruxActionPageLeave
    ${If} $cruxInstalled == "1"
      ${NSD_GetState} $rdUpdate $0
      ${If} $0 == ${BST_CHECKED}
        # Update: in den vorhandenen Ordner, ohne Deinstallation
        StrCpy $cruxActionMode "update"
        StrCpy $INSTDIR $cruxInstallDir
        !insertmacro cruxHideOldVersionReg
      ${Else}
        StrCpy $cruxActionMode "uninstall"
        !insertmacro cruxDoUninstall
      ${EndIf}
    ${Else}
      StrCpy $cruxActionMode "install"
    ${EndIf}
  FunctionEnd
!macroend

# Beim Update gibt es nichts zu waehlen (Ordner/Benutzer stehen schon fest).
!macro customInstallMode
  !ifndef BUILD_UNINSTALLER
    ${If} $cruxActionMode == "update"
      Abort
    ${EndIf}
  !endif
!macroend

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