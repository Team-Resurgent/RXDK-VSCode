@echo off
REM Install rxdk-vscode VSIX into VS Code and/or Cursor.
REM   install-extension.cmd              Install newest rxdk-vscode-*.vsix
REM   install-extension.cmd -Build       Build cross-platform VSIX first, then install
REM   install-extension.cmd -Target vscode|cursor|both

set "ROOT=%~dp0"
set "REPO=%ROOT%.."
set "ARGS=-ExtensionRoot \"%REPO%\" -Target auto"

if /i "%~1"=="-Build" (
    set "ARGS=%ARGS% -Build"
    shift
)

:parse
if "%~1"=="" goto run
if /i "%~1"=="-Target" (
    set "ARGS=%ARGS% -Target %~2"
    shift
    shift
    goto parse
)
shift
goto parse

:run
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%scripts\install-extension.ps1" %ARGS%
set "EXITCODE=%ERRORLEVEL%"
echo.
set /p "DONE=Press Enter to close... "
exit /b %EXITCODE%
