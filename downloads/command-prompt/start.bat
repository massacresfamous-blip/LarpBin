@echo off
setlocal
title BreachBin Command Prompt

where node >nul 2>nul
if errorlevel 1 (
    echo Node.js 18 or newer is required. Install it from https://nodejs.org/
    echo Then reopen this window and run start.bat again.
    pause
    exit /b 1
)

set "BREACHBIN_URL=https://spidery-spooky-monster-p795x44x6w5635x9-4000.app.github.dev"
set /p "SERVER_INPUT=Server URL [%BREACHBIN_URL%]: "
if not "%SERVER_INPUT%"=="" set "BREACHBIN_URL=%SERVER_INPUT%"

node "%~dp0cli.js"
if errorlevel 1 (
    echo.
    echo The command prompt client exited with an error.
    pause
)
endlocal
