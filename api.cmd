@echo off
setlocal
set "PYTHON=%~dp0Backend\.venv\Scripts\python.exe"
if exist "%PYTHON%" goto start
set "PYTHON="
if exist "%~dp0.tools\fym-python-path.txt" set /p "PYTHON="<"%~dp0.tools\fym-python-path.txt"
if not defined PYTHON goto missing
if not exist "%PYTHON%" goto missing
set "PYTHONPATH=%~dp0.tools\python-deps;%PYTHONPATH%"

:start
"%PYTHON%" "%~dp0Backend\server.py"
exit /b %errorlevel%

:missing
echo Python environment missing. Follow Backend\README.md to set it up. 1>&2
exit /b 1
