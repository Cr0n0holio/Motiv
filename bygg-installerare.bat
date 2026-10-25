@echo off
chcp 65001 >nul
title Ediholio - bygg installerare
cd /d "%~dp0src-tauri"
where cargo-tauri >nul 2>nul
if errorlevel 1 (
  echo Installerar Tauri CLI ^(en gång^)...
  cargo install tauri-cli --version "^2" --locked || goto :fel
)
cargo tauri build || goto :fel
echo.
echo Klart! Installeraren finns i src-tauri\target\release\bundle\
explorer "%~dp0src-tauri\target\release\bundle"
pause
exit /b 0
:fel
echo Bygget misslyckades.
pause
exit /b 1
