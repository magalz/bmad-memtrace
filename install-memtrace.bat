@echo off
setlocal enabledelayedexpansion

echo ============================================
echo   BMad-Memtrace Installer (Windows)
echo ============================================
echo.

:: Find Git Bash in common installation paths
set "BASH="
for %%p in (
    "%ProgramFiles%\Git\bin\bash.exe"
    "%ProgramFiles(x86)%\Git\bin\bash.exe"
    "%LocalAppData%\Programs\Git\bin\bash.exe"
) do if exist %%p set "BASH=%%~p"

:: Fallback: try PATH
if not defined BASH (
    where bash.exe 2>nul >nul
    if !errorlevel! equ 0 set "BASH=bash.exe"
)

if not defined BASH (
    echo.
    echo Error: Git for Windows not found.
    echo.
    echo Please install Git from: https://git-scm.com/download/win
    echo Make sure to select "Git from the command line and also from
    echo 3rd-party software" during installation.
    echo.
    pause
    exit /b 1
)

echo Found Git Bash at: %BASH%
echo.

"%BASH%" "%~dp0install-bmad-memtrace.sh" %*

if errorlevel 1 (
    echo.
    echo Installer finished with errors. Check output above.
    pause
    exit /b %errorlevel%
)

echo.
pause
