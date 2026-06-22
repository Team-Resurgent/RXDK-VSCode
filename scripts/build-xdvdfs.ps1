# Build antangelo/xdvdfs CLI for all VSIX host tool RIDs (win/linux/mac). No release downloads.
param(
    [string]$XdvdfsRoot = (Join-Path $PSScriptRoot '..\external\xdvdfs'),
    [switch]$Force,
    [switch]$SkipMac,
    [switch]$SkipBuild
)
$ErrorActionPreference = 'Stop'
$XdvdfsRoot = [IO.Path]::GetFullPath($XdvdfsRoot)

$PublishRoot = Join-Path $XdvdfsRoot 'out\publish'

$RidTargets = @(
    @{ Rid = 'win-x64';   Target = 'x86_64-pc-windows-msvc';  Ext = '.exe'; UseZig = $false }
    @{ Rid = 'linux-x64'; Target = 'x86_64-unknown-linux-musl'; Ext = '';     UseZig = $true }
    @{ Rid = 'osx-x64';   Target = 'x86_64-apple-darwin';      Ext = '';     UseZig = $true }
    @{ Rid = 'osx-arm64'; Target = 'aarch64-apple-darwin';     Ext = '';     UseZig = $true }
)

function Test-CargoAvailable {
    if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
        throw 'Rust cargo not found. Install from https://rustup.rs/'
    }
}

function Ensure-RustTarget([string]$Target) {
    $installed = @(rustup target list --installed 2>$null)
    if ($installed -notcontains $Target) {
        Write-Host "Adding rust target $Target ..." -ForegroundColor Cyan
        rustup target add $Target
        if ($LASTEXITCODE -ne 0) {
            throw "rustup target add $Target failed"
        }
    }
}

function Refresh-SessionPath {
    if ($IsWindows -or ($env:OS -eq 'Windows_NT')) {
        $machine = [System.Environment]::GetEnvironmentVariable('Path', 'Machine')
        $user = [System.Environment]::GetEnvironmentVariable('Path', 'User')
        $env:Path = if ($machine -and $user) { "$machine;$user" } elseif ($machine) { $machine } else { $user }
    }
}

function Resolve-ZigExecutable {
    Refresh-SessionPath
    $cmd = Get-Command zig -ErrorAction SilentlyContinue
    if ($cmd) {
        return $cmd.Source
    }

    $candidates = @(
        (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\zig.exe')
    )
    $wingetPackages = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages'
    if (Test-Path -LiteralPath $wingetPackages) {
        $wingetZig = Get-ChildItem -LiteralPath $wingetPackages -Filter 'zig.exe' -Recurse -ErrorAction SilentlyContinue |
            Sort-Object FullName -Descending |
            Select-Object -First 1
        if ($wingetZig) {
            $candidates += $wingetZig.FullName
        }
    }
    $candidates += @(
        (Join-Path ${env:ProgramFiles} 'Zig\zig.exe')
        (Join-Path ${env:ProgramFiles(x86)} 'Zig\zig.exe')
    )

    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate)) {
            $zigDir = Split-Path -Parent $candidate
            if ($env:Path -notlike "*$zigDir*") {
                $env:Path = "$zigDir;$env:Path"
            }
            return $candidate
        }
    }

    return $null
}

function Ensure-CargoZigbuild {
    $zig = Resolve-ZigExecutable
    if (-not $zig) {
        throw @'
Zig is required for linux/macOS xdvdfs cross builds.
Install: winget install zig.zig
Then open a new terminal, or re-run this script (PATH is refreshed automatically on Windows).
'@
    }
    Write-Host "Using zig: $zig" -ForegroundColor DarkGray
    $hasZigbuild = $false
    try {
        cargo zigbuild --version 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) { $hasZigbuild = $true }
    } catch {
        # cargo subcommand missing
    }
    if ($hasZigbuild) { return }
    Write-Host 'Installing cargo-zigbuild...' -ForegroundColor Cyan
    cargo install cargo-zigbuild --locked
    if ($LASTEXITCODE -ne 0) {
        throw 'cargo install cargo-zigbuild failed'
    }
}

function Get-XdvdfsArtifactPath([string]$Root, [string]$Target, [string]$Ext) {
    Join-Path $Root "target\$Target\release\xdvdfs$Ext"
}

function Copy-XdvdfsArtifact {
    param(
        [string]$Source,
        [string]$DestDir,
        [string]$Ext
    )
    if (-not (Test-Path -LiteralPath $Source)) {
        throw "Missing xdvdfs build output: $Source"
    }
    New-Item -ItemType Directory -Force -Path $DestDir | Out-Null
    $dest = Join-Path $DestDir "xdvdfs$Ext"
    Copy-Item -LiteralPath $Source -Destination $dest -Force
    Write-Host "OK: $dest" -ForegroundColor Green
}

function Build-XdvdfsTarget {
    param(
        [string]$Root,
        [hashtable]$RidSpec
    )
    $target = $RidSpec.Target
    $ext = $RidSpec.Ext
    $useZig = [bool]$RidSpec.UseZig
    $destDir = Join-Path $PublishRoot $RidSpec.Rid
    $dest = Join-Path $destDir "xdvdfs$ext"

    if ($SkipBuild) {
        if (-not (Test-Path -LiteralPath $dest)) {
            throw @"
xdvdfs missing at $dest (SkipBuild).
CI: run the macOS xdvdfs job first, or download its artifact into external/xdvdfs/out/publish/.
Local: run scripts/build-xdvdfs.ps1 without -SkipBuild.
"@
        }
        Write-Host "OK: using prebuilt $dest (SkipBuild)" -ForegroundColor DarkGray
        return
    }

    if ($SkipMac -and $RidSpec.Rid -like 'osx-*') {
        if (-not (Test-Path -LiteralPath $dest)) {
            throw @"
macOS xdvdfs missing at $dest (SkipMac).
CI: run the macOS xdvdfs job first, or download its artifact into external/xdvdfs/out/publish/.
Local: omit -SkipMac to cross-build with Zig, or run scripts/build-xdvdfs-ci.sh on macOS.
"@
        }
        Write-Host "OK: using macOS xdvdfs from $dest (SkipMac)" -ForegroundColor DarkGray
        return
    }

    if ((Test-Path -LiteralPath $dest) -and -not $Force) {
        Write-Host "OK: using existing $dest (pass -Force to rebuild)" -ForegroundColor DarkGray
        return
    }

    Ensure-RustTarget $target
    Push-Location $Root
    try {
        if ($useZig) {
            Ensure-CargoZigbuild
            Write-Host "Building xdvdfs for $($RidSpec.Rid) ($target via cargo-zigbuild)..." -ForegroundColor Cyan
            cargo zigbuild -p xdvdfs-cli --release --target $target
        } else {
            Write-Host "Building xdvdfs for $($RidSpec.Rid) ($target)..." -ForegroundColor Cyan
            cargo build -p xdvdfs-cli --release --target $target
        }
        if ($LASTEXITCODE -ne 0) {
            throw "cargo build failed for $target (exit $LASTEXITCODE)"
        }
        $artifact = Get-XdvdfsArtifactPath $Root $target $ext
        Copy-XdvdfsArtifact -Source $artifact -DestDir $destDir -Ext $ext
    } finally {
        Pop-Location
    }
}

if (-not (Test-Path -LiteralPath $XdvdfsRoot)) {
    throw @"
xdvdfs submodule not found at $XdvdfsRoot
Run: git submodule update --init external/xdvdfs
"@
}

if (-not $SkipBuild) {
    Test-CargoAvailable
}
Write-Host '=== xdvdfs (antangelo/xdvdfs) ===' -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $PublishRoot | Out-Null

foreach ($spec in $RidTargets) {
    Build-XdvdfsTarget -Root $XdvdfsRoot -RidSpec $spec
}

foreach ($spec in $RidTargets) {
    $dest = Join-Path (Join-Path $PublishRoot $spec.Rid) "xdvdfs$($spec.Ext)"
    if (-not (Test-Path -LiteralPath $dest)) {
        throw "xdvdfs missing for $($spec.Rid): $dest"
    }
}

Write-Host "OK: xdvdfs built for all RIDs under $PublishRoot" -ForegroundColor Green
