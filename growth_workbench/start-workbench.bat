@echo off
chcp 65001 >nul
cd /d "%~dp0"
call "%CD%\scripts\windows-launcher.bat"
if errorlevel 1 exit /b 1
