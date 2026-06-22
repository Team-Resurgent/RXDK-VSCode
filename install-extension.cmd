@echo off
REM Install rxdk-vscode VSIX into VS Code and/or Cursor.
REM   install-extension.cmd              Install newest rxdk-vscode-*.vsix in this folder
REM   install-extension.cmd -Build       Build cross-platform VSIX first, then install (repo dev only)
REM   install-extension.cmd -Target vscode|cursor|both

set "ROOT=%~dp0"
set "EXTROOT=%ROOT%"
if "%EXTROOT:~-1%"=="\" set "EXTROOT=%EXTROOT:~0,-1%"
set "TARGET=auto"
set "BUILD="

if exist "%ROOT%scripts\install-extension.ps1" (
    set "PS1=%ROOT%scripts\install-extension.ps1"
) else (
    set "PS1=%ROOT%install-extension.ps1"
)

if /i "%~1"=="-Build" (
    set "BUILD=-Build"
    shift
)

:parse
if "%~1"=="" goto run
if /i "%~1"=="-Target" (
    set "TARGET=%~2"
    shift
    shift
    goto parse
)
shift
goto parse

:run
if defined BUILD (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" -ExtensionRoot "%EXTROOT%" -Target %TARGET% %BUILD%
) else (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" -ExtensionRoot "%EXTROOT%" -Target %TARGET%
)
set "EXITCODE=%ERRORLEVEL%"
echo.
set /p "DONE=Press Enter to close... "
exit /b %EXITCODE%
