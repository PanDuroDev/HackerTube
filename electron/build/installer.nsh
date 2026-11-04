; HackerTube installer and uninstaller UI.
; electron-builder prepends this include before its generated NSIS script.

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "nsDialogs.nsh"
!include "WinMessages.nsh"
!include "FileFunc.nsh"

!ifndef DO_NOT_CREATE_DESKTOP_SHORTCUT
  !define DO_NOT_CREATE_DESKTOP_SHORTCUT
!endif

!define MUI_BGCOLOR "111111"
!define MUI_TEXTCOLOR "FAF7F2"
!define MUI_INSTFILESPAGE_COLORS "FAF7F2 111111"
!ifndef MUI_HEADERIMAGE_UNBITMAP
  !define MUI_HEADERIMAGE_UNBITMAP "${BUILD_RESOURCES_DIR}\installerHeader.bmp"
!endif

!define HT_BG 0x111111
!define HT_TEXT 0xFAF7F2
!define HT_MUTED 0xA3A3A3
!define HT_ACCENT 0xFF6600
!define HT_LINE 0x2C2C2C

!ifndef BUILD_UNINSTALLER
  Var htInstallDirField
  Var htBrowseButton
  Var htDesktopCheckbox
  Var htFinishLaunchCheckbox
  Var htDesktopShortcut

  !macro customInit
    StrCpy $htDesktopShortcut "1"
    ReadRegStr $0 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" DesktopShortcut
    ${If} $0 == "0"
      StrCpy $htDesktopShortcut "0"
    ${EndIf}
  !macroend

  !macro customInstallMode
    StrCpy $isForceMachineInstall "0"
    StrCpy $isForceCurrentInstall "1"
  !macroend

  !macro customWelcomePage
    Page custom htOptionsPageShow htOptionsPageLeave
  !macroend

  ; Custom show hook so the progress page matches the dark theme.
  !macro customPageAfterChangeDir
    !define MUI_PAGE_CUSTOMFUNCTION_SHOW htInstFilesShow
  !macroend

  !macro customFinishPage
    Page custom htFinishPageShow htFinishPageLeave
  !macroend

  !macro customInstall
    WriteRegStr SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" DesktopShortcut "$htDesktopShortcut"
    ${If} $htDesktopShortcut == "1"
      CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
      ClearErrors
      WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
    ${Else}
      Delete "$DESKTOP\${SHORTCUT_NAME}.lnk"
    ${EndIf}
  !macroend

  Function htBrowseInstallDir
    ${NSD_GetText} $htInstallDirField $0
    nsDialogs::SelectFolderDialog "Choose the install folder" "$0"
    Pop $0
    ${If} $0 != ""
    ${AndIf} $0 != "error"
      StrCpy $INSTDIR "$0"
      ${NSD_SetText} $htInstallDirField "$0"
    ${EndIf}
  FunctionEnd

  Function htOptionsPageShow
    !insertmacro MUI_HEADER_TEXT "Install HackerTube" "Set up the desktop app on this computer."

    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}
    SetCtlColors $0 ${HT_TEXT} ${HT_BG}

    ${NSD_CreateIcon} 5% 7% 14% 21% ""
    Pop $1
    ${NSD_SetIconFromInstaller} $1 $2

    CreateFont $3 "Segoe UI" "17" "700"
    ${NSD_CreateLabel} 23% 7% 72% 12% "HackerTube"
    Pop $4
    SetCtlColors $4 ${HT_TEXT} ${HT_BG}
    SendMessage $4 ${WM_SETFONT} $3 1

    CreateFont $3 "Segoe UI" "8" "700"
    ${NSD_CreateLabel} 23% 18% 72% 9% "DESKTOP APP INSTALLER"
    Pop $4
    SetCtlColors $4 ${HT_ACCENT} ${HT_BG}
    SendMessage $4 ${WM_SETFONT} $3 1

    ${NSD_CreateLabel} 5% 31% 90% 1% ""
    Pop $4
    SetCtlColors $4 ${HT_LINE} ${HT_LINE}

    CreateFont $3 "Segoe UI" "9" "600"
    ${NSD_CreateLabel} 5% 36% 90% 8% "Install location"
    Pop $4
    SetCtlColors $4 ${HT_TEXT} ${HT_BG}
    SendMessage $4 ${WM_SETFONT} $3 1

    ${NSD_CreateDirRequest} 5% 45% 68% 11% "$INSTDIR"
    Pop $htInstallDirField
    SetCtlColors $htInstallDirField 0x111111 0xFFFFFF

    CreateFont $3 "Segoe UI" "9" "400"
    ${NSD_CreateBrowseButton} 75% 44% 20% 13% "Browse..."
    Pop $htBrowseButton
    SendMessage $htBrowseButton ${WM_SETFONT} $3 1
    ${NSD_OnClick} $htBrowseButton htBrowseInstallDir

    ${NSD_CreateCheckbox} 5% 62% 90% 9% "Create a desktop shortcut"
    Pop $htDesktopCheckbox
    SetCtlColors $htDesktopCheckbox ${HT_TEXT} ${HT_BG}
    SendMessage $htDesktopCheckbox ${WM_SETFONT} $3 1
    System::Call 'uxtheme::SetWindowTheme(p $htDesktopCheckbox, w "", w "")'
    ${If} $htDesktopShortcut == "1"
      ${NSD_Check} $htDesktopCheckbox
    ${EndIf}

    CreateFont $3 "Segoe UI" "8" "400"
    ${NSD_CreateLabel} 5% 76% 90% 18% "Your likes, history, playlists and settings stay on this device.$\r$\nInstalling over an existing copy keeps your data.$\r$\nYou can choose to launch the app on the next screen."
    Pop $4
    SetCtlColors $4 ${HT_MUTED} ${HT_BG}
    SendMessage $4 ${WM_SETFONT} $3 1

    GetDlgItem $0 $HWNDPARENT 1
    SendMessage $0 ${WM_SETTEXT} 0 "STR:Install"
    GetDlgItem $0 $HWNDPARENT 3
    ShowWindow $0 ${SW_HIDE}

    ${NSD_SetFocus} $htInstallDirField
    nsDialogs::Show
  FunctionEnd

  Function htOptionsPageLeave
    ${NSD_GetText} $htInstallDirField $0
    ${If} $0 == ""
      MessageBox MB_ICONEXCLAMATION "Choose a folder to install HackerTube."
      Abort
    ${EndIf}

    ${GetFileName} $1 "$0"
    ${If} $1 != "${APP_FILENAME}"
      StrCpy $0 "$0\${APP_FILENAME}"
    ${EndIf}
    StrCpy $INSTDIR "$0"

    ${NSD_GetState} $htDesktopCheckbox $0
    StrCpy $htDesktopShortcut "$0"
  FunctionEnd

  Function htInstFilesShow
    FindWindow $0 "#32770" "" $HWNDPARENT
    SetCtlColors $0 ${HT_TEXT} ${HT_BG}
    GetDlgItem $1 $0 1006
    SetCtlColors $1 ${HT_TEXT} ${HT_BG}
    GetDlgItem $1 $0 1004
    SetCtlColors $1 ${HT_TEXT} ${HT_BG}
  FunctionEnd

  Function htFinishPageShow
    !insertmacro MUI_HEADER_TEXT "Installation complete" "HackerTube is ready to use."

    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}
    SetCtlColors $0 ${HT_TEXT} ${HT_BG}

    ${NSD_CreateIcon} 5% 8% 14% 22% ""
    Pop $1
    ${NSD_SetIconFromInstaller} $1 $2

    CreateFont $3 "Segoe UI" "17" "700"
    ${NSD_CreateLabel} 23% 8% 72% 12% "You're all set"
    Pop $4
    SetCtlColors $4 ${HT_TEXT} ${HT_BG}
    SendMessage $4 ${WM_SETFONT} $3 1

    CreateFont $3 "Segoe UI" "9" "400"
    ${NSD_CreateLabel} 23% 19% 72% 9% "HackerTube is installed on this computer."
    Pop $4
    SetCtlColors $4 ${HT_MUTED} ${HT_BG}
    SendMessage $4 ${WM_SETFONT} $3 1

    ${NSD_CreateLabel} 5% 38% 90% 1% ""
    Pop $4
    SetCtlColors $4 ${HT_LINE} ${HT_LINE}

    CreateFont $3 "Segoe UI" "8" "400"
    ${NSD_CreateLabel} 5% 43% 90% 24% "Installed in: $INSTDIR$\r$\n$\r$\nYour likes, history, playlists and settings are kept."
    Pop $4
    SetCtlColors $4 ${HT_MUTED} ${HT_BG}
    SendMessage $4 ${WM_SETFONT} $3 1

    ${NSD_CreateCheckbox} 5% 68% 90% 10% "Launch HackerTube"
    Pop $htFinishLaunchCheckbox
    SetCtlColors $htFinishLaunchCheckbox ${HT_TEXT} ${HT_BG}
    System::Call 'uxtheme::SetWindowTheme(p $htFinishLaunchCheckbox, w "", w "")'
    ${NSD_Check} $htFinishLaunchCheckbox

    GetDlgItem $0 $HWNDPARENT 1
    SendMessage $0 ${WM_SETTEXT} 0 "STR:Finish"
    GetDlgItem $0 $HWNDPARENT 2
    SendMessage $0 ${WM_SETTEXT} 0 "STR:Close"
    GetDlgItem $0 $HWNDPARENT 3
    ShowWindow $0 ${SW_HIDE}

    nsDialogs::Show
  FunctionEnd

  Function htFinishPageLeave
    ${NSD_GetState} $htFinishLaunchCheckbox $0
    ${If} $0 == ${BST_CHECKED}
      ExecShell "open" "$INSTDIR\${APP_FILENAME}.exe"
    ${EndIf}
  FunctionEnd
!endif

!ifdef BUILD_UNINSTALLER
  !macro customUnWelcomePage
    UninstPage custom un.htUninstallPageShow un.htUninstallPageLeave
  !macroend

  !macro customUnInstall
    WinShell::UninstShortcut "$newDesktopLink"
    Delete "$newDesktopLink"
  !macroend

  Function un.htUninstallPageShow
    !insertmacro MUI_HEADER_TEXT "Uninstall HackerTube" "Remove the desktop app from this computer."

    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}
    SetCtlColors $0 ${HT_TEXT} ${HT_BG}

    ${NSD_CreateIcon} 5% 7% 14% 21% ""
    Pop $1
    ${If} ${FileExists} "$INSTDIR\uninstallerIcon.ico"
      ${NSD_SetIcon} $1 "$INSTDIR\uninstallerIcon.ico" $2
    ${Else}
      ${NSD_SetIconFromInstaller} $1 $2
    ${EndIf}

    CreateFont $3 "Segoe UI" "17" "700"
    ${NSD_CreateLabel} 23% 7% 72% 12% "Remove HackerTube?"
    Pop $4
    SetCtlColors $4 ${HT_TEXT} ${HT_BG}
    SendMessage $4 ${WM_SETFONT} $3 1

    CreateFont $3 "Segoe UI" "8" "700"
    ${NSD_CreateLabel} 23% 18% 72% 9% "UNINSTALL DESKTOP APP"
    Pop $4
    SetCtlColors $4 ${HT_ACCENT} ${HT_BG}
    SendMessage $4 ${WM_SETFONT} $3 1

    ${NSD_CreateLabel} 5% 32% 90% 1% ""
    Pop $4
    SetCtlColors $4 ${HT_LINE} ${HT_LINE}

    CreateFont $3 "Segoe UI" "9" "400"
    ${NSD_CreateLabel} 5% 38% 90% 20% "This removes HackerTube and its shortcuts from this computer.$\r$\nInstalled in: $INSTDIR"
    Pop $4
    SetCtlColors $4 ${HT_MUTED} ${HT_BG}
    SendMessage $4 ${WM_SETFONT} $3 1

    CreateFont $3 "Segoe UI" "8" "400"
    ${NSD_CreateLabel} 5% 63% 90% 18% "Your likes, history, playlists and settings stay on this device.$\r$\nThe app will close if it is still running."
    Pop $4
    SetCtlColors $4 ${HT_MUTED} ${HT_BG}
    SendMessage $4 ${WM_SETFONT} $3 1

    GetDlgItem $0 $HWNDPARENT 1
    SendMessage $0 ${WM_SETTEXT} 0 "STR:Uninstall"
    GetDlgItem $0 $HWNDPARENT 3
    ShowWindow $0 ${SW_HIDE}

    nsDialogs::Show
  FunctionEnd

  Function un.htUninstallPageLeave
  FunctionEnd
!endif
