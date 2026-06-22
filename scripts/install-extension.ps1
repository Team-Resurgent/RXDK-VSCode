# Install rxdk-vscode VSIX into VS Code and/or Cursor.
param(
    [string]$ExtensionRoot = '',
    [string]$VsixPath = '',
    [ValidateSet('auto', 'vscode', 'cursor', 'both')]
    [string]$Target = 'auto',
    [switch]$Force,
    [switch]$Build
)
$ErrorActionPreference = 'Stop'

function Resolve-ExtensionRootPath {
    param([string]$ScriptRoot, [string]$Explicit)
    if ($Explicit) {
        $Explicit = $Explicit.Trim().Trim('"')
        return [IO.Path]::GetFullPath($Explicit)
    }
    foreach ($dir in @($ScriptRoot, (Split-Path -Parent $ScriptRoot))) {
        $full = [IO.Path]::GetFullPath($dir)
        $vsix = Get-ChildItem -LiteralPath $full -Filter 'rxdk-vscode-*.vsix' -ErrorAction SilentlyContinue |
            Select-Object -First 1
        if ($vsix) {
            return $full
        }
    }
    return [IO.Path]::GetFullPath((Split-Path -Parent $ScriptRoot))
}

$ExtensionRoot = Resolve-ExtensionRootPath -ScriptRoot $PSScriptRoot -Explicit $ExtensionRoot

function Resolve-VsixPath {
    param([string]$Root, [string]$Explicit)
    if ($Explicit) {
        $Explicit = $Explicit.Trim().Trim('"')
        $full = [IO.Path]::GetFullPath($Explicit)
        if (-not (Test-Path -LiteralPath $full)) {
            throw "VSIX not found: $full"
        }
        return $full
    }
    $vsix = Get-ChildItem -LiteralPath $Root -Filter 'rxdk-vscode-*.vsix' |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
    if (-not $vsix) {
        throw "No rxdk-vscode-*.vsix in $Root. Run: .\scripts\build-vsix.ps1"
    }
    return $vsix.FullName
}

function Get-EditorClis {
    param([string]$Mode)
    $editors = [ordered]@{}
    $candidates = @(
        @{ Id = 'vscode'; Paths = @(
                (Join-Path $env:LOCALAPPDATA 'Programs\Microsoft VS Code\bin\code.cmd')
                (Join-Path ${env:ProgramFiles} 'Microsoft VS Code\bin\code.cmd')
                '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code'
                '/usr/local/bin/code'
                '/usr/bin/code'
            )
        }
        @{ Id = 'cursor'; Paths = @(
                (Join-Path $env:LOCALAPPDATA 'Programs\cursor\resources\app\bin\cursor.cmd')
                (Join-Path ${env:ProgramFiles} 'Cursor\resources\app\bin\cursor.cmd')
                '/Applications/Cursor.app/Contents/Resources/app/bin/cursor'
                '/usr/local/bin/cursor'
                '/usr/bin/cursor'
            )
        }
    )

    foreach ($entry in $candidates) {
        if ($Mode -eq 'vscode' -and $entry.Id -ne 'vscode') { continue }
        if ($Mode -eq 'cursor' -and $entry.Id -ne 'cursor') { continue }
        foreach ($path in $entry.Paths) {
            if ($path -and (Test-Path -LiteralPath $path)) {
                $editors[$entry.Id] = $path
                break
            }
        }
    }

    foreach ($entry in $candidates) {
        if ($editors.Contains($entry.Id)) { continue }
        if ($Mode -eq 'vscode' -and $entry.Id -ne 'vscode') { continue }
        if ($Mode -eq 'cursor' -and $entry.Id -ne 'cursor') { continue }
        $cmd = if ($entry.Id -eq 'vscode') { 'code' } else { 'cursor' }
        $found = Get-Command $cmd -ErrorAction SilentlyContinue
        if ($found) {
            $editors[$entry.Id] = $found.Source
        }
    }

    return $editors
}

if ($Build) {
    & (Join-Path $ExtensionRoot 'scripts\build-vsix.ps1') -ExtensionRoot $ExtensionRoot
}

$vsix = Resolve-VsixPath -Root $ExtensionRoot -Explicit $VsixPath
$mode = switch ($Target) {
    'both' { 'both' }
    'vscode' { 'vscode' }
    'cursor' { 'cursor' }
    default { 'both' }
}
$clis = Get-EditorClis -Mode $mode
if ($clis.Count -eq 0) {
    throw @"
No VS Code or Cursor CLI found.
Install VS Code or Cursor, or pass -Target vscode / -Target cursor after adding its bin folder to PATH.
"@
}

$forceArg = if ($Force) { @('--force') } else { @() }
$prevNodeOptions = $env:NODE_OPTIONS
$env:NODE_OPTIONS = '--no-deprecation'
try {
    foreach ($pair in $clis.GetEnumerator()) {
        Write-Host "=== Installing into $($pair.Key) ===" -ForegroundColor Cyan
        Write-Host "CLI:  $($pair.Value)"
        Write-Host "VSIX: $vsix"
        & $pair.Value --install-extension $vsix @forceArg
        if ($LASTEXITCODE -ne 0) {
            throw "$($pair.Key) install failed (exit $LASTEXITCODE)"
        }
        Write-Host "OK: $($pair.Key)" -ForegroundColor Green
    }
}
finally {
    if ($null -eq $prevNodeOptions) {
        Remove-Item Env:NODE_OPTIONS -ErrorAction SilentlyContinue
    } else {
        $env:NODE_OPTIONS = $prevNodeOptions
    }
}

Write-Host ''
Write-Host 'Installed. Reload the editor window (Developer: Reload Window).' -ForegroundColor Green
