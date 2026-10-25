@echo off
cd /d "%~dp0"
set "ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/"
".tools\node.exe" scripts\check.cjs
if errorlevel 1 exit /b 1
".tools\node.exe" --test tests/*.test.cjs
if errorlevel 1 exit /b 1
".tools\node.exe" node_modules\electron-builder\cli.js --win nsis --x64
if errorlevel 1 exit /b 1
".tools\node.exe" scripts\build-updater.cjs
if errorlevel 1 pause
