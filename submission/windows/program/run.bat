@echo off
setlocal enableextensions
cd /d "%~dp0"

set "PORT=8080"

if not exist "index.exe" (
  echo [ERROR] index.exe not found in this folder.
  pause
  exit /b 1
)

if not exist "out\index.html" (
  echo [ERROR] out\index.html not found.
  pause
  exit /b 1
)

echo ==========================================
echo   Drone Coding - Windows Launcher
echo   URL: http://127.0.0.1:%PORT%/
echo ==========================================
echo Keep this window open while using the app.
echo To stop: close this window or press Ctrl+C.
echo.

rem Open the default browser a couple seconds after the server starts.
start "open-browser" /min cmd /c "timeout /t 2 /nobreak >nul & explorer http://127.0.0.1:%PORT%/ & exit"

rem Run the local web server in THIS window (closing it stops the server).
index.exe file-server --root "%~dp0out" --listen ":%PORT%"

echo.
echo [Server stopped] If you see an error above, please report it.
pause
