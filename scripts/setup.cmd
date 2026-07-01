@echo off
rem One-shot dev bootstrap wrapper -> scripts\setup.ps1 (prefers PowerShell 7 if present).
where pwsh >nul 2>nul
if %errorlevel%==0 (
  pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1" %*
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1" %*
)
