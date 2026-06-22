# Resolve bundled SDK layout under SdkRoot (extension out/sdk/).
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
    throw "Missing host tool '$base' under $ToolsRoot (platform=$rid). Reinstall the RXDK extension or run scripts/sync-all.ps1 -Build."
}

function Get-XboxSdkPaths {
    param(
        [Parameter(Mandatory)]
        [string]$SdkRoot
    )
    $ErrorActionPreference = 'Stop'
    $SdkRoot = [IO.Path]::GetFullPath($SdkRoot)
    return @{
        SdkRoot   = $SdkRoot
        Include   = Join-Path $SdkRoot 'include'
        Lib       = Join-Path $SdkRoot 'lib'
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
