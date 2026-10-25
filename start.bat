@echo off
chcp 65001 >nul
title Ediholio
where cargo >nul 2>nul
if errorlevel 1 (
  echo Rust saknas. Installera från https://rustup.rs och kör sedan start.bat igen.
  pause
  exit /b 1
)
cd /d "%~dp0src-tauri"
echo Bygger och startar Ediholio... (första gången tar det 5-15 minuter)
cargo run --release
if errorlevel 1 pause
