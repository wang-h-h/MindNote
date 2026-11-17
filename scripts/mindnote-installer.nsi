Unicode true
ManifestDPIAware true
RequestExecutionLevel user
SetCompressor /SOLID lzma
SetCompressorDictSize 64
Name "MindNote"
Caption "MindNote 安装"
OutFile "${OUT_FILE}"
InstallDir "$LOCALAPPDATA\Programs\MindNote"
InstallDirRegKey HKCU "Software\whh\MindNote" "InstallDir"
Icon "${ASSETS_DIR}\icon.ico"
UninstallIcon "${ASSETS_DIR}\icon.ico"
VIProductVersion "${APP_VERSION}.0"
VIAddVersionKey /LANG=2052 "ProductName" "MindNote"
VIAddVersionKey /LANG=2052 "CompanyName" "whh"
VIAddVersionKey /LANG=2052 "FileDescription" "MindNote 安装程序"
VIAddVersionKey /LANG=2052 "FileVersion" "${APP_VERSION}"
VIAddVersionKey /LANG=2052 "ProductVersion" "${APP_VERSION}"
VIAddVersionKey /LANG=2052 "LegalCopyright" "Copyright whh"

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "安装 MindNote"
!define MUI_WELCOMEPAGE_TEXT "将 MindNote 安装到您选择的文件夹。$\r$\n$\r$\n待办、项目、设置和背景图片保存于安装文件夹内的 data 子目录。请选择当前用户有写入权限的位置。$\r$\n$\r$\n升级保留已有数据；卸载保留 data 文件夹。"
!define MUI_DIRECTORYPAGE_TEXT_TOP "选择安装位置。数据保存在此文件夹内的 data 子目录。升级前，请先从托盘退出旧版 MindNote，避免旧版继续写入原数据库。"
!insertmacro MUI_PAGE_WELCOME
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE CheckInstallDirectory
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_TITLE "MindNote 安装完成"
!define MUI_FINISHPAGE_TEXT "可通过桌面上的 MindNote 快捷方式启动。$\r$\n$\r$\n首次启动会安全迁移检测到的旧版数据库；原始数据及迁移前备份都会保留。"
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"

Function CheckInstallDirectory
  ${GetRoot} "$INSTDIR" $0
  ${If} "$INSTDIR" == "$0"
  ${OrIf} "$INSTDIR" == "$0\"
    MessageBox MB_ICONEXCLAMATION "请选择专用应用文件夹，例如 D:\Apps\MindNote，不要选择磁盘根目录。"
    Abort
  ${EndIf}
  CreateDirectory "$INSTDIR"
  ClearErrors
  FileOpen $0 "$INSTDIR\.mindnote-install-write-test" w
  ${If} ${Errors}
    MessageBox MB_ICONEXCLAMATION "该文件夹不可写。请为当前用户选择有写入权限的安装位置。"
    Abort
  ${EndIf}
  FileClose $0
  Delete "$INSTDIR\.mindnote-install-write-test"
FunctionEnd

Section "MindNote" SEC_MAIN
  Call CheckInstallDirectory
  SetShellVarContext current
  SetOutPath "$INSTDIR"
  File /r /x "data" "${APP_DIR}\*"
  CreateDirectory "$INSTDIR\data"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateShortcut "$DESKTOP\MindNote.lnk" "$INSTDIR\MindNote.exe" "" "$INSTDIR\MindNote.exe" 0
  CreateShortcut "$SMPROGRAMS\MindNote.lnk" "$INSTDIR\MindNote.exe" "" "$INSTDIR\MindNote.exe" 0
  WriteRegStr HKCU "Software\whh\MindNote" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\MindNote" "DisplayName" "MindNote"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\MindNote" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\MindNote" "Publisher" "whh"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\MindNote" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\MindNote" "DisplayIcon" "$INSTDIR\MindNote.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\MindNote" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\MindNote" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\MindNote" "NoRepair" 1
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  Delete "$DESKTOP\MindNote.lnk"
  Delete "$SMPROGRAMS\MindNote.lnk"
  !include "${GENERATED_DIR}\uninstall-files.nsh"
  Delete "$INSTDIR\Uninstall.exe"
  ; No recursive delete: keep data, user files and unknown future assets.
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "Software\whh\MindNote"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\MindNote"
SectionEnd
