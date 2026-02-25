@echo off
setlocal enabledelayedexpansion
title Codex Desktop — Dev TUI

:: ── Move to repo root (wherever this .cmd lives) ─────────────────────────────
cd /d "%~dp0"

:: ── Check Node.js ─────────────────────────────────────────────────────────────
where node >nul 2>&1
if errorlevel 1 (
    echo.
    echo  [ERROR] Node.js not found in PATH.
    echo  Install it from https://nodejs.org  (LTS recommended)
    echo.
    pause
    exit /b 1
)

:: ── Bootstrap: install deps if node_modules is missing ───────────────────────
if not exist node_modules (
    echo.
    echo  [SETUP] node_modules not found — running npm install...
    echo.
    call npm install
    if errorlevel 1 (
        echo.
        echo  [ERROR] npm install failed. Check the output above.
        echo.
        pause
        exit /b 1
    )
)

:: ── Launch TUI ────────────────────────────────────────────────────────────────
:launch
node scripts/dev-menu.js
set EXIT_CODE=%errorlevel%

if %EXIT_CODE% neq 0 (
    echo.
    echo  [EXIT] TUI exited with code %EXIT_CODE%
    echo.
    pause
)

endlocal
exit /b %EXIT_CODE%
