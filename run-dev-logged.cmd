@echo off
rem Starts the stack and captures output so crashes are visible in the log.
cd /d "%~dp0"
call npm run dev > "%TEMP%\ols-dev.log" 2>&1
