# Resolve bundled SDK layout under SdkRoot (extension sdk/).
function Get-PlatformToolRid {
    if ($PSVersionTable.PSVersion.Major -ge 6) {
        if ($IsWindows) { return 'win-x64' }
        if ($IsLinux) { return 'linux-x64' }
        if ($IsMacOS) {
            if ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -eq [System.Runtime.InteropServices.Architecture]::Arm64) {
                return 'osx-arm64'
            }
            return 'osx-x64'
        }
    }
    if ($env:OS -eq 'Windows_NT') { return 'win-x64' }
    return 'win-x64'
}

function Get-HostToolPath {
    param(
        [Parameter(Mandatory)]
        [string]$ToolsRoot,
        [Parameter(Mandatory)]
        [string]$Name
    )
    $base = [IO.Path]::GetFileNameWithoutExtension($Name)
    $rid = Get-PlatformToolRid
    $ext = if ($rid -eq 'win-x64') { '.exe' } else { '' }
    $platformPath = Join-Path $ToolsRoot (Join-Path $rid ($base + $ext))
    if (Test-Path -LiteralPath $platformPath) {
        return $platformPath
    }
    $flat = Join-Path $ToolsRoot ($base + '.exe')
    if (Test-Path -LiteralPath $flat) {
        return $flat
    }
    $flatNoExt = Join-Path $ToolsRoot $base
    if (Test-Path -LiteralPath $flatNoExt) {
        return $flatNoExt
    }
    throw "Missing host tool '$base' under $ToolsRoot (platform=$rid). Reinstall the RXDK extension or run scripts/sync-all.ps1 -BuildTools."
}

function Get-StagedSdkRoot {
    if ($env:RXDK_STAGED_SDK) {
        return $env:RXDK_STAGED_SDK
    }
    if ($PSVersionTable.PSVersion.Major -ge 6) {
        if ($IsWindows) {
            $pd = if ($env:ProgramData) { $env:ProgramData } else { 'C:\ProgramData' }
            return Join-Path $pd 'RXDK\sdk'
        }
        if ($IsMacOS) {
            return Join-Path $env:HOME 'Library/Application Support/RXDK/sdk'
        }
        if ($IsLinux) {
            $xdg = if ($env:XDG_DATA_HOME) { $env:XDG_DATA_HOME } else { Join-Path $env:HOME '.local/share' }
            return (Join-Path $xdg 'rxdk/sdk')
        }
    }
    if ($env:OS -eq 'Windows_NT') {
        $pd = if ($env:ProgramData) { $env:ProgramData } else { 'C:\ProgramData' }
        return Join-Path $pd 'RXDK\sdk'
    }
    if ($env:HOME) {
        if ($PSVersionTable.PSVersion.Major -ge 6 -and $IsMacOS) {
            return Join-Path $env:HOME 'Library/Application Support/RXDK/sdk'
        }
        $xdg = if ($env:XDG_DATA_HOME) { $env:XDG_DATA_HOME } else { Join-Path $env:HOME '.local/share' }
        return (Join-Path $xdg 'rxdk/sdk')
    }
    return $null
}

function Resolve-StagedIncludeDir {
    $staged = Get-StagedSdkRoot
    if (-not $staged) { return $null }
    $include = Join-Path $staged 'include'
    if (Test-Path -LiteralPath (Join-Path $include 'd3d8.h')) {
        return $include
    }
    return $null
}

function Resolve-StagedLibDir {
    $staged = Get-StagedSdkRoot
    if (-not $staged) { return $null }
    $lib = Join-Path $staged 'lib'
    foreach ($marker in @('xboxkrnl.lib', 'libcmt.lib')) {
        if (Test-Path -LiteralPath (Join-Path $lib $marker)) {
            return $lib
        }
    }
    return $null
}

function Get-XboxSdkPaths {
    param(
        [Parameter(Mandatory)]
        [string]$SdkRoot,
        [string]$IncludeDir,
        [string]$LibDir
    )
    $ErrorActionPreference = 'Stop'
    $SdkRoot = [IO.Path]::GetFullPath($SdkRoot)
    if (-not $IncludeDir) {
        $IncludeDir = Resolve-StagedIncludeDir
    }
    if (-not $IncludeDir) {
        $IncludeDir = Join-Path $SdkRoot 'include'
    }
    if (-not $LibDir) {
        $LibDir = Resolve-StagedLibDir
    }
    if (-not $LibDir) {
        $LibDir = Join-Path $SdkRoot 'lib'
    }
    return @{
        SdkRoot   = $SdkRoot
        Include   = [IO.Path]::GetFullPath($IncludeDir)
        Lib       = [IO.Path]::GetFullPath($LibDir)
        Tools     = Join-Path $SdkRoot 'tools'
        ToolRid   = Get-PlatformToolRid
        Scripts   = Join-Path $SdkRoot 'scripts'
        Extra     = Join-Path $SdkRoot 'extra'
    }
}

function Get-XboxProjectManifest {
    param([string]$ProjectRoot)
    $path = Join-Path $ProjectRoot 'rxdk.project.json'
    if (-not (Test-Path -LiteralPath $path)) {
        throw "Missing rxdk.project.json in $ProjectRoot"
    }
    return Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
}

function Get-XboxProjectOutDir {
    param(
        [string]$ProjectRoot,
        [object]$Manifest
    )
    $rel = if ($Manifest.outputDir) { $Manifest.outputDir } else { 'out' }
    return [IO.Path]::GetFullPath((Join-Path $ProjectRoot $rel))
}
