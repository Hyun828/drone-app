Drone App USB Package (Windows)
===============================

How to run (offline)
--------------------
1) Double-click run.bat
2) Browser opens automatically
3) If not opened, go to:
   http://127.0.0.1:8080/

Stop
----
- Close the command window, or press Ctrl+C

Required files in this folder
-----------------------------
- run.bat
- server.exe   (see "Preparing server.exe" below)
- out\          (full folder, do not modify)

Preparing server.exe (one-time, on a PC with internet)
------------------------------------------------------
This package uses Caddy as a tiny offline static web server.
1) Download Caddy for Windows: https://caddyserver.com/download
   (choose: platform = windows, arch = amd64 -> download single .exe)
2) Rename the downloaded file to:  server.exe
3) Put server.exe in THIS folder (next to run.bat)
Caddy is a single, dependency-free binary, so it runs from USB without install.

(Alternative without Caddy)
If the PC has Python installed, you can instead run from this folder:
   python -m http.server 8080 --directory out
then open http://127.0.0.1:8080/

Install as an app (optional, fully offline afterward)
-----------------------------------------------------
While the page is open in Chrome/Edge:
- Click the "Install app" icon in the address bar (or menu -> Install)
- It then works offline as a standalone app window.

Updating the app
----------------
Re-run "npm run build" in the project, then copy the new "out" folder here,
replacing the old one.
