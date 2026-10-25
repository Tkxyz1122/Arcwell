; Isolated harness: uses the same uninstall hook without registry, shortcuts,
; real APPDATA, or program removal. Paths can only be under the supplied root.
Unicode true
Name "Arcwell uninstall data test"
OutFile "${FIXTURE_OUTPUT}"
RequestExecutionLevel user
SilentInstall silent
SilentUnInstall silent
!include "LogicLib.nsh"
!include "FileFunc.nsh"
Var fixtureUpdated
!define isUpdated '$fixtureUpdated == 1'
!include "${BUILD_RESOURCES_DIR}\uninstall-data.nsh"

Function un.onInit
  ReadEnvStr $0 "ARCWELL_UNINSTALL_TEST_ROOT"
  ${If} $0 == ""
    SetErrorLevel 9
    Quit
  ${EndIf}
  GetFullPathName $0 "$0"
  GetFullPathName $INSTDIR "$INSTDIR"
  StrCpy $0 "$0\"
  StrLen $1 $0
  StrCpy $2 "$INSTDIR\" $1
  ${If} $2 != $0
    SetErrorLevel 9
    Quit
  ${EndIf}
  ${GetParent} "$INSTDIR" $0
  StrCpy $arcwellDataDirectory "$0\profile\Arcwell"
  StrCpy $arcwellHtmlBackup "$INSTDIR\网址备份.html"
  StrCpy $fixtureUpdated 0
  ${GetParameters} $0
  ClearErrors
  ${GetOptions} $0 "--recycle-direct" $1
  ${IfNot} ${Errors}
    ; Failure injection exercises the same data function without creating a
    ; foreground error dialog; production has no such command-line option.
    Call un.ArcwellRecycleData
    SetErrorLevel 0
    Quit
  ${EndIf}
  ClearErrors
  ${GetOptions} $0 "--interactive" $1
  ${IfNot} ${Errors}
    SetSilent normal
  ${EndIf}
  ClearErrors
  ${GetOptions} $0 "--updated" $1
  ${IfNot} ${Errors}
    StrCpy $fixtureUpdated 1
  ${EndIf}
  !insertmacro customUnInstall
  SetErrorLevel 0
  Quit
FunctionEnd

Section
  SetOutPath $INSTDIR
  WriteUninstaller "$INSTDIR\Uninstall Arcwell.exe"
SectionEnd
Section "Uninstall"
SectionEnd
