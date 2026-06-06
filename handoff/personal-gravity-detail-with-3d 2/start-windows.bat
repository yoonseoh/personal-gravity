@echo off
cd /d "%~dp0"
py -m http.server 8080
if errorlevel 1 python -m http.server 8080
pause
