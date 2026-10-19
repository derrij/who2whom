@echo off
cd /d "%~dp0.."
echo === interest math ===
node "tools\test-calc.cjs"
if errorlevel 1 exit /b 1
echo.
echo === screens and actions ===
node "tools\test-ui.cjs"
if errorlevel 1 exit /b 1
echo.
echo All tests passed.
