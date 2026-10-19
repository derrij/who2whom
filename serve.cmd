@echo off
cd /d "%~dp0"
echo Kto komu - local server: http://localhost:8080
echo Stop: Ctrl+C
echo.
python -m http.server 8080
