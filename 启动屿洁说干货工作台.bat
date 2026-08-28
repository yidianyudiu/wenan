@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist "growth_workbench\start-workbench.bat" (
  echo Complete project is missing: growth_workbench\start-workbench.bat
  echo Extract the complete ZIP package before starting.
  pause
  exit /b 1
)
call "growth_workbench\start-workbench.bat"
if errorlevel 1 exit /b 1
