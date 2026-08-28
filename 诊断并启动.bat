@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist "growth_workbench\scripts\windows-launcher.bat" (
  echo Complete project is missing. Extract the complete ZIP package again.
  pause
  exit /b 1
)
call "growth_workbench\scripts\windows-launcher.bat"
if errorlevel 1 exit /b 1
