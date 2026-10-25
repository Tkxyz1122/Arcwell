@echo off
cd /d "%~dp0"
if not exist "release\0.5.1\win-unpacked\Arcwell.exe" (
  echo Arcwell executable not found. Run build first.
  pause
  exit /b 1
)
start "" "release\0.5.1\win-unpacked\Arcwell.exe"
