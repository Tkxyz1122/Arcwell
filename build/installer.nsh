!include "FileFunc.nsh"

!ifdef BUILD_UNINSTALLER
  !include "${BUILD_RESOURCES_DIR}\uninstall-data.nsh"
!else
  !ifdef UNINSTALLER_OUT_FILE
    ; Keep the exact compiled uninstaller for the in-app update package.
    !system 'node "${PROJECT_DIR}\scripts\build-updater.cjs" --capture-uninstaller "${UNINSTALLER_OUT_FILE}"' = 0
  !endif
!endif

!ifndef BUILD_UNINSTALLER
  Function ArcwellNormalizeInstallDirectory
    Push $0
    Push $1
    ; Compare only the final component, never a substring in an ancestor name.
    arcwell_trim:
      StrCpy $0 $INSTDIR 1 -1
      StrCmp $0 "\" 0 arcwell_check
      StrCpy $INSTDIR $INSTDIR -1
      Goto arcwell_trim
    arcwell_check:
      ${GetFileName} "$INSTDIR" $1
      StrCmp $1 "Arcwell" arcwell_done
      StrCpy $INSTDIR "$INSTDIR\Arcwell"
    arcwell_done:
      Pop $1
      Pop $0
  FunctionEnd

  !macro customInit
    ; Silent /D installs skip the directory and progress page callbacks.
    ${If} ${Silent}
      Call ArcwellNormalizeInstallDirectory
    ${EndIf}
  !macroend

  !macro customPageAfterChangeDir
    ; Replace electron-builder's substring-based progress-page path guard.
    !undef MUI_PAGE_CUSTOMFUNCTION_PRE
    !define MUI_PAGE_CUSTOMFUNCTION_PRE ArcwellInstallFilesPre
    Function ArcwellInstallFilesPre
      ; Retain the framework callback reference (its compiler rejects unused
      ; functions), then restore the choice and apply our final-component rule.
      Push $0
      Push $INSTDIR
      Call instFilesPre
      Pop $INSTDIR
      Pop $0
      Call ArcwellNormalizeInstallDirectory
    FunctionEnd
  !macroend
!endif
