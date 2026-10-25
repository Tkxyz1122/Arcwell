!include "LogicLib.nsh"
!include "FileFunc.nsh"

Var arcwellDataDirectory
Var arcwellHtmlBackup

!macro customUnInit
  ; Electron data belongs to the current user, including all-users installs.
  SetShellVarContext current
  GetFullPathName $arcwellDataDirectory "$APPDATA\Arcwell"
  GetFullPathName $arcwellHtmlBackup "$INSTDIR\网址备份.html"
  ${If} $installMode == "all"
    SetShellVarContext all
  ${EndIf}
  ; Do not let the framework's legacy flag permanently erase data after our
  ; hook. Data deletion requires the interactive choice and Recycle Bin.
  ${GetParameters} $0
  ClearErrors
  ${GetOptions} $0 "--delete-app-data" $1
  ${IfNot} ${Errors}
    MessageBox MB_OK|MB_ICONEXCLAMATION "请正常运行卸载程序，在向导中选择是否删除本地数据。此次未卸载或删除文件。" /SD IDOK
    SetErrorLevel 2
    Quit
  ${EndIf}
  ; This environment variable can only restrict test executions, never redirect
  ; the production data directory or select deletion without confirmation.
  ReadEnvStr $0 "ARCWELL_UNINSTALL_TEST_ROOT"
  ${If} $0 != ""
    GetFullPathName $0 "$0"
    StrCpy $0 "$0\"
    StrLen $1 $0
    StrCpy $2 "$INSTDIR\" $1
    StrCpy $3 "$arcwellDataDirectory\" $1
    ${If} $2 != $0
    ${OrIf} $3 != $0
      SetErrorLevel 9
      Quit
    ${EndIf}
  ${EndIf}
!macroend

Function un.ArcwellRecycle
  Pop $8
  System::Store "S"
  StrCpy $9 1
  StrCpy $0 0
  StrCpy $2 0
  ; IFileOperation supports recycle-only deletion. Never fall back to RMDir,
  ; DeleteFile, or permanent deletion if recycling is unavailable.
  System::Call 'ole32::CoInitializeEx(p0,i2)i.r7'
  ${If} $7 < 0
    Goto recycle_done
  ${EndIf}
  System::Call 'ole32::CoCreateInstance(g "{3ad05575-8857-4850-9277-11b85bdb8e09}",p0,i1,g "{947aab5f-0a5c-4c13-b4d6-4bf7836fc9f8}",*p.r0)i.r1'
  ${If} $1 < 0
    Goto recycle_release
  ${EndIf}
  ; ADDUNDORECORD | RECYCLEONDELETE | EARLYFAILURE | NO_CONNECTED_ELEMENTS |
  ; NOERRORUI | ALLOWUNDO | NOCONFIRMATION | SILENT. Shell skips junctions.
  System::Call '$0->5(i0x20182454)i.r1'
  ${If} $1 < 0
    Goto recycle_release
  ${EndIf}
  System::Call 'shell32::SHCreateItemFromParsingName(w r8,p0,g "{43826d1e-e718-42ee-bc55-a1e261c37bfe}",*p.r2)i.r1'
  ${If} $1 < 0
    Goto recycle_release
  ${EndIf}
  System::Call '$0->18(p r2,p0)i.r1'
  ${If} $1 < 0
    Goto recycle_release
  ${EndIf}
  System::Call '$0->21()i.r1'
  ${If} $1 < 0
    Goto recycle_release
  ${EndIf}
  System::Call '$0->22(*i.r3)i.r1'
  ${If} $1 >= 0
  ${AndIf} $3 == 0
    StrCpy $9 0
  ${EndIf}
  recycle_release:
    ${If} $2 != 0
      System::Call '$2->2()'
    ${EndIf}
    ${If} $0 != 0
      System::Call '$0->2()'
    ${EndIf}
    System::Call 'ole32::CoUninitialize()'
  recycle_done:
    Push $9
    System::Store "L"
FunctionEnd

Function un.ArcwellPreserveData
  Call un.ArcwellValidateDataPaths
  ; electron-builder removes the whole program directory. First retain its
  ; HTML in the already-preserved profile; never overwrite a prior backup.
  ${If} ${FileExists} "$arcwellHtmlBackup"
    ClearErrors
    CreateDirectory "$arcwellDataDirectory\uninstall-backups"
    GetTempFileName $0 "$arcwellDataDirectory\uninstall-backups"
    ${If} ${Errors}
      Goto preserve_failed
    ${EndIf}
    Rename "$0" "$0.html"
    ${If} ${Errors}
      Goto preserve_failed
    ${EndIf}
    System::Call 'kernel32::CopyFileW(w "$arcwellHtmlBackup",w "$0.html",i0)i.r1'
    ${If} $1 == 0
      Goto preserve_failed
    ${EndIf}
    DetailPrint "收藏与设置已保留；应用内 HTML 副本：$0.html"
  ${EndIf}
  Return
  preserve_failed:
    MessageBox MB_OK|MB_ICONSTOP "无法保留应用目录中的网址备份，卸载已停止。请检查权限或空间后重试。" /SD IDOK
    SetErrorLevel 2
    Abort
FunctionEnd

Function un.ArcwellRecycleData
  Call un.ArcwellValidateDataPaths
  ; Only these two exact app-owned targets are allowed. Custom backup paths
  ; are never read from settings or passed to a recursive delete operation.
  ${If} ${FileExists} "$arcwellHtmlBackup"
    Push "$arcwellHtmlBackup"
    Call un.ArcwellRecycle
    Pop $0
    ${If} $0 != 0
      Goto recycle_failed
    ${EndIf}
  ${EndIf}
  ${If} ${FileExists} "$arcwellDataDirectory"
    Push "$arcwellDataDirectory"
    Call un.ArcwellRecycle
    Pop $0
    ${If} $0 != 0
      Goto recycle_failed
    ${EndIf}
  ${EndIf}
  Return
  recycle_failed:
    MessageBox MB_OK|MB_ICONSTOP "本地数据无法完整移入回收站，卸载已停止。部分文件可能已在回收站中；其余文件保留，请关闭占用程序后重试。" /SD IDOK
    SetErrorLevel 2
    Abort
FunctionEnd

Function un.ArcwellValidateDataPaths
  GetFullPathName $arcwellDataDirectory "$arcwellDataDirectory"
  GetFullPathName $arcwellHtmlBackup "$arcwellHtmlBackup"
  GetFullPathName $0 "$INSTDIR\网址备份.html"
  ${GetFileName} "$arcwellDataDirectory" $1
  ${If} $1 != "Arcwell"
  ${OrIf} $0 != $arcwellHtmlBackup
    Goto invalid_data_path
  ${EndIf}
  ; Refuse an installation overlapping the profile and refuse root junctions.
  StrCpy $0 "$INSTDIR\"
  StrCpy $1 "$arcwellDataDirectory\"
  StrLen $2 $0
  StrCpy $3 $1 $2
  ${If} $3 == $0
    Goto invalid_data_path
  ${EndIf}
  StrLen $2 $1
  StrCpy $3 $0 $2
  ${If} $3 == $1
    Goto invalid_data_path
  ${EndIf}
  Push "$arcwellDataDirectory"
  Push "$arcwellDataDirectory\uninstall-backups"
  Push "$INSTDIR"
  StrCpy $4 3
  validate_root:
    Pop $0
    System::Call 'kernel32::GetFileAttributesW(w r0)i.r1'
    ${If} $1 != -1
      IntOp $1 $1 & 0x400
      ${If} $1 != 0
        ; Balance the stack before aborting the uninstall section.
        IntOp $4 $4 - 1
        ${DoWhile} $4 > 0
          Pop $0
          IntOp $4 $4 - 1
        ${Loop}
        Goto invalid_data_path
      ${EndIf}
    ${EndIf}
    IntOp $4 $4 - 1
    IntCmp $4 0 valid_data_path validate_root validate_root
  valid_data_path:
    Return
  invalid_data_path:
    MessageBox MB_OK|MB_ICONSTOP "本地数据路径异常或包含目录链接，卸载已停止，未继续处理数据。请先检查软件与数据目录。" /SD IDOK
    SetErrorLevel 2
    Abort
FunctionEnd

!macro customUnInstall
  ${If} ${Silent}
    Call un.ArcwellPreserveData
  ${ElseIf} ${isUpdated}
    Call un.ArcwellPreserveData
  ${Else}
    MessageBox MB_YESNOCANCEL|MB_ICONQUESTION|MB_DEFBUTTON2 "是否同时删除 Arcwell 的本地收藏、设置和缓存？$\r$\n$\r$\n是：删除本地数据（移入回收站）。$\r$\n否：保留数据，重新安装后可继续使用。$\r$\n取消：停止卸载。$\r$\n$\r$\n自选目录中的备份和手动导出文件会保留。" IDYES arcwell_confirm_delete IDCANCEL arcwell_cancel_uninstall
    Call un.ArcwellPreserveData
    Goto arcwell_data_done
    arcwell_confirm_delete:
      MessageBox MB_YESNO|MB_ICONEXCLAMATION|MB_DEFBUTTON2 "确认将以下本地信息移入回收站？$\r$\n$\r$\n$arcwellDataDirectory$\r$\n$arcwellHtmlBackup$\r$\n$\r$\n包括收藏、文件夹、备注、星标、设置和缓存。自选目录备份不会删除。" IDYES arcwell_delete_data
      Call un.ArcwellPreserveData
      Goto arcwell_data_done
    arcwell_delete_data:
      Call un.ArcwellRecycleData
      Goto arcwell_data_done
    arcwell_cancel_uninstall:
      SetErrorLevel 1
      Quit
    arcwell_data_done:
  ${EndIf}
!macroend
