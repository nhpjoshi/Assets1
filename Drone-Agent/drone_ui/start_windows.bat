@echo off
REM LabAtHome Ground Control - double-click launcher (Windows)
REM
REM First run: creates a venv and installs dependencies (takes a minute).
REM Every run after that: starts instantly.
REM
REM Closing this window stops the server.

cd /d "%~dp0backend"

if not exist venv (
    echo First run - setting up ^(this takes a minute^)...
    python -m venv venv
    call venv\Scripts\activate.bat
    pip install -q -r requirements.txt
) else (
    call venv\Scripts\activate.bat
)

echo.
echo Starting LabAtHome Ground Control...
echo Dashboard will open automatically. Close this window to stop the server.
echo.

start "" "http://localhost:8765"
timeout /t 2 /nobreak >nul

python -m uvicorn server:app --port 8765
pause
