@echo off
setlocal

set "PORT=8080"
set "ROOT=%~dp0"
set "OUT_DIR=%ROOT%out"

if not exist "%OUT_DIR%\index.html" (
  echo [ERROR] out\index.html not found.
  echo Put this file next to the "out" folder.
  pause
  exit /b 1
)

echo.
echo =====================================
echo  Drone App USB Runner (Windows)
echo  Serving: %OUT_DIR%
echo  URL: http://127.0.0.1:%PORT%/
echo =====================================
echo.

where py >nul 2>nul
if %errorlevel%==0 (
  start "" "http://127.0.0.1:%PORT%/"
  py -m http.server %PORT% --directory "%OUT_DIR%"
  goto :eof
)

where python >nul 2>nul
if %errorlevel%==0 (
  start "" "http://127.0.0.1:%PORT%/"
  python -m http.server %PORT% --directory "%OUT_DIR%"
  goto :eof
)

where python3 >nul 2>nul
if %errorlevel%==0 (
  start "" "http://127.0.0.1:%PORT%/"
  python3 -m http.server %PORT% --directory "%OUT_DIR%"
  goto :eof
)

echo [ERROR] Python not found.
echo Install Python 3, then run this file again.
echo https://www.python.org/downloads/windows/
pause
exit /b 1
