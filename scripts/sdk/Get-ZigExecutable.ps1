# Resolve Zig for Xbox title builds (PATH, RXDK install dir, or -ZigExecutable override).
function Get-ZigInstallRoot {
    if ($env:RXDK_ZIG_ROOT) { return $env:RXDK_ZIG_ROOT }
    if ($PSVersionTable.PSVersion.Major -ge 6) {
        if ($IsWindows) {
            $local = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { Join-Path $env:USERPROFILE 'AppData\Local' }
            return Join-Path $local 'RXDK\zig'
        }
        if ($IsMacOS) {
            return Join-Path $env:HOME 'Library/Application Support/RXDK/zig'
        }
        if ($IsLinux) {
            $xdg = if ($env:XDG_DATA_HOME) { $env:XDG_DATA_HOME } else { Join-Path $env:HOME '.local/share' }
            return (Join-Path $xdg 'rxdk/zig')
        }
    }
    if ($env:OS -eq 'Windows_NT') {
        $local = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { Join-Path $env:USERPROFILE 'AppData\Local' }
        return Join-Path $local 'RXDK\zig'
    }
    if ($env:HOME) {
        $xdg = if ($env:XDG_DATA_HOME) { $env:XDG_DATA_HOME } else { Join-Path $env:HOME '.local/share' }
        return (Join-Path $xdg 'rxdk/zig')
    }
    return $null
}

function Get-ZigExecutable {
    param(
        [string]$Override,
        [string]$Version = '0.16.0'
    )
    if ($Override) {
        $p = [IO.Path]::GetFullPath($Override)
        if (-not (Test-Path -LiteralPath $p)) { throw "Zig not found: $p" }
        return $p
    }
    if ($env:RXDK_ZIG) {
        $p = [IO.Path]::GetFullPath($env:RXDK_ZIG)
        if (-not (Test-Path -LiteralPath $p)) { throw "RXDK_ZIG points to missing file: $p" }
        return $p
    }

    $cmd = Get-Command zig -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }

    $root = Get-ZigInstallRoot
    if (-not $root) { return $null }

    $exeName = if ($env:OS -eq 'Windows_NT' -or ($PSVersionTable.PSVersion.Major -ge 6 -and $IsWindows)) { 'zig.exe' } else { 'zig' }
    $archives = @(
        "zig-windows-x86_64-$Version",
        "zig-linux-x86_64-$Version",
        "zig-macos-x86_64-$Version",
        "zig-macos-aarch64-$Version"
    )
    foreach ($base in $archives) {
        $candidate = Join-Path $root (Join-Path $Version (Join-Path $base $exeName))
        if (Test-Path -LiteralPath $candidate) { return $candidate }
    }
    $flat = Join-Path (Join-Path $root $Version) $exeName
    if (Test-Path -LiteralPath $flat) { return $flat }
    return $null
}

function Resolve-ZigExecutable {
    param(
        [string]$Override,
        [string]$Version = '0.16.0'
    )
    $zig = Get-ZigExecutable -Override $Override -Version $Version
    if (-not $zig) {
        throw @"
Zig not found. Install Zig from the RXDK prerequisites panel, or add zig to PATH.
Expected under $(Get-ZigInstallRoot)\$Version\
"@
    }
    return $zig
}
