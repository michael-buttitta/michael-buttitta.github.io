@echo off
REM Double-click this to edit the site's text.
REM Starts the local content editor and opens it in your browser.
REM Leave this window open while you edit; close it (or Ctrl-C) when done.
cd /d "%~dp0"
node tools\edit.js %*
echo.
echo Editor stopped. Press any key to close.
pause >nul
