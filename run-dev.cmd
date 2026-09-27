@echo off
rem Starts the API and the web client together, detached from this shell.
cd /d "%~dp0"
call npm run dev
