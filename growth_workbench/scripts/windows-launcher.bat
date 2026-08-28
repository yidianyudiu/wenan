@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0.."
if not exist "logs" mkdir "logs"
set "LAUNCH_LOG=%CD%\logs\windows-launcher.log"
echo ================================================== > "%LAUNCH_LOG%"
echo [%date% %time%] Yujie Growth Workbench V0.1 Launcher >> "%LAUNCH_LOG%"
echo [%date% %time%] Project directory: %CD% >> "%LAUNCH_LOG%"

call :CHECK_NODE
if errorlevel 1 goto :FAILED

echo Node.js check passed. Running full diagnostics and starting Workbench...
echo [%date% %time%] Node.js check passed. >> "%LAUNCH_LOG%"
node "%CD%\scripts\windows-diagnose.mjs"
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" goto :FAILED
exit /b 0

:CHECK_NODE
where node >nul 2>nul
if errorlevel 1 goto :INSTALL_NODE
for /f "delims=" %%V in ('node -p "Number(process.versions.node.split('.')[0])" 2^>nul') do set "NODE_MAJOR=%%V"
if not defined NODE_MAJOR goto :INSTALL_NODE
if %NODE_MAJOR% LSS 20 goto :INSTALL_NODE
node --version >> "%LAUNCH_LOG%" 2>&1
exit /b 0

:INSTALL_NODE
echo Node.js 20+ was not found. Installing or upgrading Node.js LTS automatically...
echo [%date% %time%] Starting automatic Node.js LTS installation. >> "%LAUNCH_LOG%"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%CD%\scripts\install-node.ps1" >> "%LAUNCH_LOG%" 2>&1
if errorlevel 1 exit /b 1
set "PATH=%ProgramFiles%\nodejs;%LOCALAPPDATA%\Programs\nodejs;%PATH%"
where node >nul 2>nul
if errorlevel 1 exit /b 1
for /f "delims=" %%V in ('node -p "Number(process.versions.node.split('.')[0])" 2^>nul') do set "NODE_MAJOR=%%V"
if not defined NODE_MAJOR exit /b 1
if %NODE_MAJOR% LSS 20 exit /b 1
node --version >> "%LAUNCH_LOG%" 2>&1
exit /b 0

:FAILED
echo.
echo Workbench startup failed. This window will remain open.
echo Please send BOTH log files below to the developer:
echo %CD%\logs\windows-launcher.log
echo %CD%\logs\windows-startup.log
echo.
if exist "%LAUNCH_LOG%" type "%LAUNCH_LOG%"
echo.
pause
exit /b 1
