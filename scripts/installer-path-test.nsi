Unicode true
Name "Arcwell installer path test"
OutFile "..\test-results\installer-path-test.exe"
RequestExecutionLevel user
SilentInstall silent
!include "LogicLib.nsh"
!include "..\build\installer.nsh"
!define MUI_PAGE_CUSTOMFUNCTION_PRE instFilesPre
Function instFilesPre
  ; Stand-in for the original framework guard: the wrapper must restore its input.
  StrCpy $INSTDIR "$INSTDIR\legacy-result"
FunctionEnd
!insertmacro customPageAfterChangeDir

!macro VerifyPath INPUT EXPECTED
  StrCpy $INSTDIR '${INPUT}'
  Call ArcwellInstallFilesPre
  !insertmacro customInit
  StrCmp $INSTDIR '${EXPECTED}' +3
    FileWrite $2 'FAIL: ${INPUT} -> $INSTDIR$\r$\n'
    StrCpy $3 1
  FileWrite $2 '${INPUT} -> $INSTDIR$\r$\n'
!macroend

Section
  FileOpen $2 "$EXEDIR\installer-path-results.txt" w
  IfErrors 0 +3
    SetErrorLevel 2
    Quit
  StrCpy $3 0
  !insertmacro VerifyPath 'D:\Tools' 'D:\Tools\Arcwell'
  !insertmacro VerifyPath 'D:\ArcwellDownloads' 'D:\ArcwellDownloads\Arcwell'
  !insertmacro VerifyPath 'D:\ArcwellDownloads\Apps' 'D:\ArcwellDownloads\Apps\Arcwell'
  !insertmacro VerifyPath 'D:\Tools\Arcwell' 'D:\Tools\Arcwell'
  !insertmacro VerifyPath 'D:\Tools\arcwell' 'D:\Tools\arcwell'
  !insertmacro VerifyPath 'D:\Tools\Arcwell\' 'D:\Tools\Arcwell'
  !insertmacro VerifyPath 'D:\' 'D:\Arcwell'
  !insertmacro VerifyPath 'D:\应用 程序\' 'D:\应用 程序\Arcwell'
  !insertmacro VerifyPath '\\server\share\' '\\server\share\Arcwell'
  FileClose $2
  SetErrorLevel $3
SectionEnd
