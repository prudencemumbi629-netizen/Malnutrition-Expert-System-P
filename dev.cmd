@echo off
setlocal
set "NODE_DIR=%~dp0.tools\node-v24.22.3-win-x64"
if not exist "%NODE_DIR%\npm.cmd" (
    echo Project-local npm was not found in "%NODE_DIR%". 1>&2
    exit /b 1
)
set "PATH=%NODE_DIR%;%PATH%"
call "%NODE_DIR%\npm.cmd" --prefix "%~dp0Frontend" run dev -- %*
exit /b %errorlevel%
