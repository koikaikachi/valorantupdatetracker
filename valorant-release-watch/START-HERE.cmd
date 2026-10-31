@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Install Node.js LTS from https://nodejs.org/ first, then reopen this file.
  pause
  exit /b 1
)
echo Installing the project's pinned setup tools...
call npm ci --no-fund --no-audit
if errorlevel 1 goto failed
call npm run setup
if errorlevel 1 goto failed
echo Setup finished. You may close this window.
pause
exit /b 0
:failed
echo Setup did not finish. Read the error above, then reopen this file to retry.
pause
exit /b 1
