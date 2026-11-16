@echo off
chcp 65001 >nul
cd /d "%~dp0"
set ELECTRON_RUN_AS_NODE=
if exist "src-tauri\target\release\asset-browser.exe" (
  start "" "src-tauri\target\release\asset-browser.exe"
) else (
  echo Release build not found.
  echo Build it with:  cd src-tauri ^&^& cargo build --release --features custom-protocol
  pause
)
