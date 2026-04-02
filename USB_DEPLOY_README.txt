USB deployment (Windows)
========================

1) Prepare these items in the same folder on USB:
   - out/                (static export folder)
   - run_windows.bat

2) On Windows PC:
   - Double-click run_windows.bat
   - Browser opens automatically at:
     http://127.0.0.1:8080/

3) Stop server:
   - Close the command window running the server
   - Or press Ctrl + C in that window

Notes
-----
- This runner needs Python 3 on the target PC.
- If Python is missing, install it from:
  https://www.python.org/downloads/windows/

How to rebuild out/ before copying to USB
-----------------------------------------
From project root:
  npm run build

Then copy the generated out/ folder to USB.
