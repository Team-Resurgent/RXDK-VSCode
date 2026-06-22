# Launch a deployed Xbox title via xbox-launch.exe.
param(
    [Parameter(Mandatory)]
    [string]$SdkRoot,
    [Parameter(Mandatory)]
    [string]$ProjectName,
    [string]$RemoteDir,
    [string]$Title,
    [string]$ConsoleName,
    [string]$CmdLine = '',
    [switch]$Reboot,
    [int]$TimeoutMs = 120000
)
$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($ConsoleName)) { $ConsoleName = $null }
. (Join-Path $PSScriptRoot 'Get-XboxSdkPaths.ps1')
. (Join-Path $PSScriptRoot 'Get-XboxConsole.ps1')

$paths = Get-XboxSdkPaths -SdkRoot $SdkRoot
if (-not $RemoteDir) { $RemoteDir = "xe:\$ProjectName" }
if (-not $Title) { $Title = "$ProjectName.xbe" }

$launcher = Get-HostToolPath -ToolsRoot $paths.Tools -Name 'xbox-launch'

$args = @('/dir', $RemoteDir, '/title', $Title, '/timeout', $TimeoutMs)
if ($CmdLine) { $args += @('/cmd', $CmdLine) }
$console = Get-XboxConsole -SdkRoot $paths.SdkRoot -ConsoleName $ConsoleName
if ($console) { $args += @('/x', $console) }
if ($Reboot) { $args += '/reboot' }

Write-Host "$launcher $($args -join ' ')"
& $launcher @args
$code = $LASTEXITCODE
if ($code -eq 2) {
    Write-Warning 'No Xbox console configured (set rxdk.defaultConsole or Xbox Neighborhood).'
    exit 2
}
if ($code -ne 0) {
    throw "xbox-launch.exe failed (exit $code)"
}
