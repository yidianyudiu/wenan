@echo off
setlocal EnableExtensions
cd /d "%~dp0"
if not exist "growth_workbench\stop-workbench.bat" (
  echo Complete project is missing.
  pause
  exit /b 1
)
call "growth_workbench\stop-workbench.bat"
