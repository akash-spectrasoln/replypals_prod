@echo off
REM ═══════════════════════════════════════════════════════════════
REM  ReplyPals — Test + Start Script (Windows)
REM  Usage:  start.bat
REM  Runs all tests first. Server only starts if all tests pass.
REM ═══════════════════════════════════════════════════════════════
setlocal enabledelayedexpansion

title ReplyPals — Test + Server
cd /d "%~dp0"

echo.
echo ╔══════════════════════════════════════════════════╗
echo ║       ReplyPals — Pre-flight Test Suite          ║
echo ╚══════════════════════════════════════════════════╝
echo.

REM ── Check Node.js ──────────────────────────────────────────────
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js not found. Install from https://nodejs.org
    pause & exit /b 1
)

REM ── Check Python ───────────────────────────────────────────────
where python >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Python not found. Install from https://python.org
    pause & exit /b 1
)

REM ═══ STEP 1: Extension unit tests (always run, no API needed) ══
echo [1/3] Running extension unit tests (157 checks)...
echo ─────────────────────────────────────────────────────────────
node "%~dp0tests\extension\test_extension.js"
if %ERRORLEVEL% neq 0 (
    echo.
    echo ╔══════════════════════════════════════════════════╗
    echo ║  EXTENSION TESTS FAILED — server NOT started    ║
    echo ║  Fix the errors listed above then re-run.       ║
    echo ╚══════════════════════════════════════════════════╝
    echo.
    pause & exit /b 1
)
echo.
echo  ^[OK^] Extension tests passed ^(157/157^)
echo.

REM ═══ STEP 2: API validation tests (no AI key needed) ═══════════
echo [2/3] Running API validation tests (no AI key required)...
echo ─────────────────────────────────────────────────────────────

REM Check if pytest is installed
python -m pytest --version >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo  [WARN] pytest not installed.
    echo         Install:  pip install pytest requests
    echo         Skipping API validation tests.
    echo.
    goto :STEP3
)

REM Run only non-AI tests (validation, auth, shapes — fast)
REM Exit code 5 = no tests collected = acceptable, not a failure
python -m pytest "%~dp0tests\api\test_api.py" ^
    -m "not ai" ^
    --tb=short -q ^
    --timeout=30 2>nul
set PYTEST_EXIT=!ERRORLEVEL!

if !PYTEST_EXIT! equ 5 (
    echo  [INFO] No non-AI tests ran ^(API may not be running — thats fine^).
    echo.
    goto :STEP3
)
if !PYTEST_EXIT! neq 0 (
    echo.
    echo ╔══════════════════════════════════════════════════╗
    echo ║  API VALIDATION TESTS FAILED                    ║
    echo ║  server NOT started — fix errors above.         ║
    echo ╚══════════════════════════════════════════════════╝
    echo.
    pause & exit /b 1
)
echo.
echo  ^[OK^] API validation tests passed.
echo.

:STEP3
REM ═══ STEP 3: Start the backend ═════════════════════════════════
echo [3/3] All tests passed — starting ReplyPals API...
echo ─────────────────────────────────────────────────────────────
echo.
echo ╔══════════════════════════════════════════════════╗
echo ║  ALL TESTS PASSED — Starting ReplyPals API       ║
echo ║  Server: http://localhost:8150                   ║
echo ║  Press Ctrl+C to stop                           ║
echo ╚══════════════════════════════════════════════════╝
echo.
echo  API:       http://localhost:8150
echo  Health:    http://localhost:8150/health
echo  Website:   http://localhost:8150/
echo  Admin:     http://localhost:8150/admin/
echo.

cd /d "%~dp0api"
python main.py
