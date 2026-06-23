# Install rxdk-vscode VSIX into VS Code and/or Cursor.
param(
    [string]$ExtensionRoot = '',
    [string]$VsixPath = '',
    [ValidateSet('auto', 'vscode', 'cursor', 'both')]
    [string]$Target = 'auto',
    [switch]$Force,
    [switch]$Direct,
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

function Get-ExtensionsDir {
    param([string]$EditorId)
    switch ($EditorId) {
        'cursor' { return Join-Path $env:USERPROFILE '.cursor\extensions' }
        default { return Join-Path $env:USERPROFILE '.vscode\extensions' }
    }
}

function Get-VsixPackageInfo {
    param([string]$VsixPath)
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [System.IO.Compression.ZipFile]::OpenRead($VsixPath)
    try {
        $entry = $zip.Entries | Where-Object { $_.FullName -replace '\\', '/' -eq 'extension/package.json' } | Select-Object -First 1
        if (-not $entry) {
            throw "Invalid VSIX: missing extension/package.json ($VsixPath)"
        }
        $stream = $entry.Open()
        try {
            $reader = New-Object System.IO.StreamReader($stream)
            return $reader.ReadToEnd() | ConvertFrom-Json
        } finally {
            $stream.Dispose()
        }
    } finally {
        $zip.Dispose()
    }
}

function Test-IntegratedEditorShell {
    return [bool](
        $env:VSCODE_IPC_HOOK -or
        $env:VSCODE_PID -or
        $env:CURSOR_TRACE_ID -or
        $env:TERM_PROGRAM -eq 'vscode'
    )
}

function Test-EditorProcessRunning {
    param([string]$EditorId)
    $names = switch ($EditorId) {
        'cursor' { @('Cursor', 'cursor') }
        default { @('Code', 'code') }
    }
    foreach ($name in $names) {
        if (Get-Process -Name $name -ErrorAction SilentlyContinue) {
            return $true
        }
    }
    return $false
}

function Install-VsixDirect {
    param(
        [string]$VsixPath,
        [string]$ExtensionsDir
    )
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $temp = Join-Path $env:TEMP "rxdk-vsix-install-$([Guid]::NewGuid().ToString('n'))"
    try {
        [System.IO.Compression.ZipFile]::ExtractToDirectory($VsixPath, $temp)
        $pkgPath = Join-Path $temp 'extension\package.json'
        if (-not (Test-Path -LiteralPath $pkgPath)) {
            throw 'Invalid VSIX: missing extension/package.json'
        }
        $pkg = Get-Content -LiteralPath $pkgPath -Raw | ConvertFrom-Json
        $dest = Join-Path $ExtensionsDir "$($pkg.publisher).$($pkg.name)-$($pkg.version)"
        if (Test-Path -LiteralPath $dest) {
            Remove-Item -LiteralPath $dest -Recurse -Force
        }
        New-Item -ItemType Directory -Path $dest -Force | Out-Null
        Copy-Item -Path (Join-Path $temp 'extension\*') -Destination $dest -Recurse -Force
        return $dest
    } finally {
        if (Test-Path -LiteralPath $temp) {
            Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

function Invoke-EditorInstall {
    param(
        [string]$EditorId,
        [string]$CliPath,
        [string]$VsixPath,
        [string]$ExtensionId,
        [switch]$UseForce,
        [switch]$UseDirect
    )

    $extensionsDir = Get-ExtensionsDir -EditorId $EditorId
    Write-Host "=== Installing into $EditorId ===" -ForegroundColor Cyan
    Write-Host "CLI:  $CliPath"
    Write-Host "VSIX: $VsixPath"

    if ($UseDirect) {
        $dest = Install-VsixDirect -VsixPath $VsixPath -ExtensionsDir $extensionsDir
        Write-Host "OK: $EditorId (direct install -> $dest)" -ForegroundColor Green
        return
    }

    $forceArg = if ($UseForce) { @('--force') } else { @() }
    $stderrFile = Join-Path $env:TEMP "rxdk-install-$EditorId-$([Guid]::NewGuid().ToString('n')).err.txt"

    try {
        & $CliPath --uninstall-extension $ExtensionId --force 2>$null | Out-Null
        $LASTEXITCODE = 0
    } catch {
        # ignore uninstall errors
    }

    try {
        & $CliPath --install-extension $VsixPath @forceArg 2>&1 | Tee-Object -FilePath $stderrFile
        if ($LASTEXITCODE -eq 0) {
            Write-Host "OK: $EditorId" -ForegroundColor Green
            return
        }
    } catch {
        # fall through to direct install
    }

    $cliOutput = ''
    if (Test-Path -LiteralPath $stderrFile) {
        $cliOutput = Get-Content -LiteralPath $stderrFile -Raw -ErrorAction SilentlyContinue
    }
    $needsRestart = $cliOutput -match 'restart (?:VS Code|Cursor)|before reinstalling'

    if ($needsRestart -or $LASTEXITCODE -ne 0) {
        Write-Host "CLI install blocked while $EditorId is running; trying direct filesystem install..." -ForegroundColor Yellow
        try {
            $dest = Install-VsixDirect -VsixPath $VsixPath -ExtensionsDir $extensionsDir
            Write-Host "OK: $EditorId (direct install -> $dest)" -ForegroundColor Green
            Write-Host "Quit and reopen $EditorId so the new build loads (Reload Window is not enough after a reinstall)." -ForegroundColor Yellow
            return
        } catch {
            $directError = $_.Exception.Message
            throw @"
$EditorId install failed.

The editor CLI cannot hot-reinstall an extension that is already loaded, and direct
file copy failed (files may be locked): $directError

Do this:
  1. Quit ALL $EditorId windows (File -> Exit; check Task Manager for leftover $($EditorId) processes).
  2. From Windows Terminal or PowerShell OUTSIDE $EditorId, run:
       .\scripts\install-extension.ps1 -Target $EditorId -Force
     Or rebuild with install:
       .\scripts\build-vsix-windows.ps1

Do not run the install from $EditorId's integrated terminal while RXDK is active.
"@
        }
    }

    throw "$EditorId install failed (exit $LASTEXITCODE)"
}

if ($Build) {
    & (Join-Path $ExtensionRoot 'scripts\build-vsix.ps1') -ExtensionRoot $ExtensionRoot
}

$vsix = Resolve-VsixPath -Root $ExtensionRoot -Explicit $VsixPath
$pkg = Get-VsixPackageInfo -VsixPath $vsix
$extensionId = "$($pkg.publisher).$($pkg.name)"

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

if (Test-IntegratedEditorShell) {
    Write-Host @"
Note: Running inside an editor terminal. If install fails, quit the editor completely and rerun
this script from an external PowerShell/Windows Terminal session.
"@ -ForegroundColor Yellow
    Write-Host ''
}

$useForce = if ($PSBoundParameters.ContainsKey('Force')) { [bool]$Force } else { $true }
$prevNodeOptions = $env:NODE_OPTIONS
$env:NODE_OPTIONS = '--no-deprecation'
try {
    foreach ($pair in $clis.GetEnumerator()) {
        Invoke-EditorInstall -EditorId $pair.Key -CliPath $pair.Value -VsixPath $vsix `
            -ExtensionId $extensionId -UseForce:$useForce -UseDirect:$Direct
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
Write-Host 'Installed. Quit and reopen the editor (or Developer: Reload Window if direct install succeeded).' -ForegroundColor Green
