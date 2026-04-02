@echo off
setlocal
cd /d "%~dp0"

set "PORT=8080"

if not exist "server.exe" (
  echo [ERROR] server.exe not found.
  pause
  exit /b 1
)

if not exist "out\index.html" (
  echo [ERROR] out\index.html not found.
  pause
  exit /b 1
)

echo.
echo ==========================================
echo   Drone App Windows USB Launcher
echo   URL: http://127.0.0.1:%PORT%/
echo ==========================================
echo.
echo Keep this window open while using the app.
echo To stop: close this window or press Ctrl+C.
echo.

start "" "http://127.0.0.1:%PORT%/"
"%~dp0server.exe" file-server --root "%~dp0out" --listen ":%PORT%"
