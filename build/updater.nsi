Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "${MANIFEST}"
Name "Arcwell 更新 ${VERSION}"
OutFile "${OUTPUT}"
RequestExecutionLevel user
SetCompressor /SOLID lzma
CRCCheck on
Icon "..\assets\icon.ico"
InstallDir "$LOCALAPPDATA\Programs\Arcwell"
BrandingText "Arcwell ${VERSION}"
ShowInstDetails show
Var stage
Var rollbackFailed
Var failureText
Var mutex
Var entryCount
Var updateActive
Var testRoot
Var replaceUninstaller
!macro Trace TEXT
  !ifdef ARCWELL_TRACE_LOG
    FileOpen $9 "${ARCWELL_TRACE_LOG}" a
    FileSeek $9 0 END
    FileWrite $9 "${TEXT}$\r$\n"
    FileClose $9
  !endif
!macroend
!define REGKEY "Software\${APP_GUID}"
!define UNINSTALLKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_GUID}"
!define MUI_CUSTOMFUNCTION_ABORT ArcwellUserAbort
!define MUI_DIRECTORYPAGE_TEXT_TOP "选择原来安装 Arcwell 的文件夹。更新只替换程序文件，保留收藏、备份设置、快捷方式和目录中的网址备份。请先保存正在编辑的内容。"
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE VerifyDirectory
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_TITLE "Arcwell 已更新"
!define MUI_FINISHPAGE_TEXT "已更新原安装位置的程序，无需卸载。收藏、备份设置和快捷方式均保持不变。"
!define MUI_FINISHPAGE_RUN "$INSTDIR\Arcwell.exe"
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_LANGUAGE "SimpChinese"

Function .onInit
  !insertmacro Trace "init: $INSTDIR"
  SetRegView 64
  System::Call 'kernel32::CreateMutex(p0,i0,w"${APP_GUID}")p.r0?e'
  StrCpy $mutex $0
  Pop $1
  ${If} $1 == 183
    MessageBox MB_OK|MB_ICONEXCLAMATION "另一个 Arcwell 安装或更新程序正在运行，请完成后再试。" /SD IDOK
    SetErrorLevel 2
    Quit
  ${EndIf}
  ; NSIS strips /D from both CMDLINE and GetParameters, but has already
  ; assigned its exact value to INSTDIR. Detect it in the OS command line
  ; and retain that value before attempting registry-based auto-detection.
  Call HasExplicitDirectory
  ${If} $5 == 0
    ReadRegStr $0 HKCU "${REGKEY}" InstallLocation
    ${If} $0 == ""
      ReadRegStr $0 HKLM "${REGKEY}" InstallLocation
    ${EndIf}
    ${If} $0 != ""
      StrCpy $INSTDIR $0
    ${ElseIf} ${FileExists} "$EXEDIR\Arcwell.exe"
      StrCpy $INSTDIR $EXEDIR
    ${EndIf}
  ${EndIf}
  !insertmacro Trace "raw: $CMDLINE; chosen: $INSTDIR"
  Call GuardTestDirectory
  !insertmacro Trace "target: $INSTDIR"
FunctionEnd

Function HasExplicitDirectory
  StrCpy $5 0
  System::Call 'kernel32::GetCommandLineW()p.r0'
  System::Call 'kernel32::lstrcpynW(w.r1,p r0,i${NSIS_MAX_STRLEN})p.r0'
  StrLen $2 $1
  StrCpy $3 0
  loop_argument:
    IntCmp $3 $2 argument_done argument_check argument_done
  argument_check:
    StrCpy $4 $1 4 $3
    ${If} $4 == " /D="
    ${OrIf} $4 == '"/D='
      StrCpy $5 1
      Return
    ${EndIf}
    IntOp $3 $3 + 1
    Goto loop_argument
  argument_done:
FunctionEnd

Function GuardTestDirectory
  ; Tests execute the actual distributed EXE. This optional constraint can
  ; only restrict its target, never broaden permissions or bypass validation.
  ReadEnvStr $testRoot "ARCWELL_UPDATE_TEST_ROOT"
  ${If} $testRoot != ""
    GetFullPathName $testRoot "$testRoot"
    GetFullPathName $INSTDIR "$INSTDIR"
    StrCpy $testRoot "$testRoot\"
    StrLen $0 $testRoot
    StrCpy $1 "$INSTDIR\" $0
    !insertmacro Trace "guard: $testRoot; prefix: $1"
    ${If} $1 != $testRoot
      SetErrorLevel 9
      Quit
    ${EndIf}
  ${EndIf}
FunctionEnd

Function VerifyDirectory
  !insertmacro Trace "verify: $INSTDIR"
  GetFullPathName $INSTDIR "$INSTDIR"
  Call GuardTestDirectory
  ${IfNot} ${FileExists} "$INSTDIR\Arcwell.exe"
  ${OrIfNot} ${FileExists} "$INSTDIR\resources\app.asar"
    MessageBox MB_OK|MB_ICONEXCLAMATION "这里没有已安装的 Arcwell。请选择同时包含 Arcwell.exe 和 resources 的原软件文件夹；首次使用请运行安装包。" /SD IDOK
    SetErrorLevel 2
    Abort
  ${EndIf}
  ClearErrors
  GetDLLVersion "$INSTDIR\Arcwell.exe" $0 $1
  !insertmacro Trace "version: $0 $1"
  ${If} ${Errors}
    MessageBox MB_OK|MB_ICONEXCLAMATION "无法确认原程序版本，未修改任何文件。" /SD IDOK
    SetErrorLevel 2
    Abort
  ${EndIf}
  ${If} $0 > ${VERSION_HIGH}
    Goto newer
  ${EndIf}
  ${If} $0 == ${VERSION_HIGH}
  ${AndIf} $1 > ${VERSION_LOW}
    Goto newer
  ${EndIf}
  Return
  newer:
    MessageBox MB_OK|MB_ICONEXCLAMATION "原程序版本高于此更新包，已停止以避免降级。" /SD IDOK
    SetErrorLevel 2
    Abort
FunctionEnd

Function ArcwellUserAbort
  ; Interrupting file replacement would leave a partial installation.
  ${If} $updateActive == 1
    Abort
  ${EndIf}
FunctionEnd

Function .onInstFailed
  !insertmacro Trace "failed: $failureText"
  StrCpy $updateActive 0
FunctionEnd

Function .onInstSuccess
  StrCpy $updateActive 0
FunctionEnd

Function CloseArcwell
  ; Only request a normal close for windows whose executable matches the target.
  ; WM_CLOSE uses the application's draft prompt and pending-write protection.
  StrCpy $0 0
  loop:
    FindWindow $0 "Chrome_WidgetWin_1" "Arcwell" 0 $0
    StrCmp $0 0 done
    System::Call 'user32::GetWindowThreadProcessId(p r0,*i.r1)'
    System::Call 'kernel32::OpenProcess(i0x1000,i0,i r1)p.r2'
    ${If} $2 != 0
      StrCpy $4 ${NSIS_MAX_STRLEN}
      System::Call 'kernel32::QueryFullProcessImageNameW(p r2,i0,w.r3,*i r4)i.r5'
      System::Call 'kernel32::CloseHandle(p r2)'
      ${If} $5 != 0
      ${AndIf} $3 == "$INSTDIR\Arcwell.exe"
        System::Call 'user32::PostMessageW(p r0,i0x10,p0,p0)'
      ${EndIf}
    ${EndIf}
    Goto loop
  done:
  Sleep 500
FunctionEnd

!macro CommitEntry NAME
  !insertmacro Trace "commit ${NAME}"
  ClearErrors
  ${If} ${FileExists} "$INSTDIR\${NAME}"
    Rename "$INSTDIR\${NAME}" "$stage\old\${NAME}"
    ${If} ${Errors}
      StrCpy $failureText "程序文件正在使用或没有写入权限。请保存并关闭 Arcwell 后重试；若软件安装在受保护目录，请以管理员身份运行更新程序。"
      Goto rollback
    ${EndIf}
  ${EndIf}
  ClearErrors
  Rename "$stage\new\${NAME}" "$INSTDIR\${NAME}"
  ${If} ${Errors}
    StrCpy $failureText "替换程序文件失败。请检查权限和磁盘空间后重试。"
    Goto rollback
  ${EndIf}
  !ifdef ARCWELL_TEST_FAIL_AFTER
    IntOp $entryCount $entryCount + 1
    ${If} $entryCount == ${ARCWELL_TEST_FAIL_AFTER}
      StrCpy $failureText "TEST: injected replacement failure"
      Goto rollback
    ${EndIf}
  !endif
!macroend

!macro RollbackEntry NAME
  ; A missing staged entry means it was moved into the live directory.
  ${IfNot} ${FileExists} "$stage\new\${NAME}"
    ClearErrors
    ${If} ${FileExists} "$INSTDIR\${NAME}\*.*"
      RMDir /r "$INSTDIR\${NAME}"
    ${Else}
      Delete "$INSTDIR\${NAME}"
    ${EndIf}
    ${If} ${Errors}
      StrCpy $rollbackFailed 1
    ${EndIf}
  ${EndIf}
  ${If} ${FileExists} "$stage\old\${NAME}"
    ClearErrors
    Rename "$stage\old\${NAME}" "$INSTDIR\${NAME}"
    ${If} ${Errors}
      StrCpy $rollbackFailed 1
    ${EndIf}
  ${EndIf}
!macroend

Section "更新 Arcwell"
  !insertmacro Trace "section"
  Call VerifyDirectory
  StrCpy $replaceUninstaller 0
  ${If} ${FileExists} "$INSTDIR\Uninstall Arcwell.exe"
    StrCpy $replaceUninstaller 1
  ${EndIf}
  StrCpy $updateActive 1
  StrCpy $stage "$INSTDIR\.arcwell-update-${VERSION}"
  ${If} ${FileExists} "$stage"
    MessageBox MB_OK|MB_ICONEXCLAMATION "检测到上次更新留下的恢复目录：$stage。请先检查其中的 old 文件夹，当前程序未修改。" /SD IDOK
    SetErrorLevel 2
    Abort
  ${EndIf}
  ClearErrors
  CreateDirectory "$stage\new"
  CreateDirectory "$stage\old"
  ${If} ${Errors}
    MessageBox MB_OK|MB_ICONEXCLAMATION "无法创建更新暂存目录，请检查写入权限与空间。原程序未修改。" /SD IDOK
    SetErrorLevel 2
    Abort
  ${EndIf}
  ; Extract completely before touching the installed application. Staging is
  ; on the target volume so that the subsequent moves are same-volume renames.
  SetOutPath "$stage\new"
  ClearErrors
  File /r "${PAYLOAD}\*.*"
  File "/oname=Uninstall Arcwell.exe" "${UNINSTALLER}"
  ${If} ${Errors}
    SetOutPath $TEMP
    RMDir /r "$stage"
    MessageBox MB_OK|MB_ICONEXCLAMATION "更新包解压失败，原程序未修改。请检查空间后重试。" /SD IDOK
    SetErrorLevel 2
    Abort
  ${EndIf}
  SetOutPath $TEMP
  Call CloseArcwell
  !insertmacro Trace "closed"
  StrCpy $entryCount 0
  !insertmacro ArcwellEntries CommitEntry
  ; Preserve existing uninstall commands, install location and shortcuts.
  ReadRegStr $0 HKCU "${REGKEY}" InstallLocation
  ${If} $0 == $INSTDIR
    WriteRegStr HKCU "${UNINSTALLKEY}" DisplayVersion "${VERSION}"
  ${EndIf}
  ReadRegStr $0 HKLM "${REGKEY}" InstallLocation
  ${If} $0 == $INSTDIR
    WriteRegStr HKLM "${UNINSTALLKEY}" DisplayVersion "${VERSION}"
  ${EndIf}
  RMDir /r "$stage"
  ${If} ${FileExists} "$stage"
    DetailPrint "更新已完成；暂存目录中有文件仍被占用，可关闭程序后再清理：$stage"
  ${EndIf}
  SetErrorLevel 0
  !insertmacro Trace "success"
  Goto done
  rollback:
    !insertmacro Trace "rollback: $failureText"
    StrCpy $rollbackFailed 0
    !insertmacro ArcwellEntries RollbackEntry
    ${If} $rollbackFailed == 0
      RMDir /r "$stage"
      MessageBox MB_OK|MB_ICONEXCLAMATION "$failureText$\r$\n已恢复原程序。收藏与设置未修改。" /SD IDOK
      SetErrorLevel 3
    ${Else}
      MessageBox MB_OK|MB_ICONSTOP "$failureText$\r$\n部分程序文件未能自动恢复。旧文件保留在：$stage\old。请关闭 Arcwell 后恢复该目录中的文件。收藏与设置未修改。" /SD IDOK
      SetErrorLevel 4
    ${EndIf}
    Abort
  done:
SectionEnd
