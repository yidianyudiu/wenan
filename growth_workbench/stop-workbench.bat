@echo off
setlocal EnableExtensions
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Workbench cannot be stopped by PID helper.
  pause
  exit /b 1
)
node "%CD%\scripts\stop-workbench.mjs"
pause
