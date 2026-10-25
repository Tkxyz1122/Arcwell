@echo off
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  echo Dependencies missing. Please install dependencies first.
  pause
  exit /b 1
)
start "" "node_modules\electron\dist\electron.exe" .
