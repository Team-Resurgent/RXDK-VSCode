# Convert a patched Win32 PE (.exe) into an Xbox executable (.xbe).
function Get-DefaultImageBuildSettings {
    [ordered]@{
        stackSize               = 65536
        debug                   = $true
        noLogo                  = $true
        noLibWarn               = $true
        limitMemory             = $false
        dontModifyHardDisk      = $false
        dontMountUtilityDrive   = $false
        formatUtilityDrive      = $false
        utilityDriveClusterSize = 0
        noPreload               = @()
    }
}

function Resolve-ImageBuildSettings {
    param([object]$ImageBuild)
    $defaults = Get-DefaultImageBuildSettings
    $settings = [ordered]@{}
    foreach ($key in @($defaults.Keys)) {
        $settings[$key] = $defaults[$key]
    }
    if (-not $ImageBuild) {
        return $settings
    }
    foreach ($key in @($settings.Keys)) {
        if ($null -ne $ImageBuild.$key) {
            $settings[$key] = $ImageBuild.$key
        }
    }
    if ($settings.noPreload -is [string]) {
        $settings.noPreload = @($settings.noPreload)
    }
    return $settings
}

function Invoke-ImageBuild {
    param(
        [Parameter(Mandatory)]
        [string]$InputExe,
        [string]$OutputXbe,
        [object]$ImageBuild,
        [string]$StackSize,
        [switch]$XbeDebug,
        [switch]$NoLibWarn,
        [string[]]$InsertFile,
        [string]$ToolPath
    )
    $inputFull = [IO.Path]::GetFullPath($InputExe)
    if (-not (Test-Path -LiteralPath $inputFull)) {
        throw "imagebld: input not found: $inputFull"
    }
    if (-not $OutputXbe) {
        $OutputXbe = [IO.Path]::ChangeExtension($inputFull, '.xbe')
    }
    $outputFull = [IO.Path]::GetFullPath($OutputXbe)
    if (-not $ToolPath) { throw 'imagebld: ToolPath required' }
    if (-not (Test-Path -LiteralPath $ToolPath)) {
        throw "imagebld: tool not found: $ToolPath"
    }

    $cfg = Resolve-ImageBuildSettings -ImageBuild $ImageBuild
    if ($PSBoundParameters.ContainsKey('StackSize') -and $StackSize) {
        $cfg.stackSize = [int]$StackSize
    }
    if ($PSBoundParameters.ContainsKey('XbeDebug')) {
        $cfg.debug = [bool]$XbeDebug
    }
    if ($PSBoundParameters.ContainsKey('NoLibWarn')) {
        $cfg.noLibWarn = [bool]$NoLibWarn
    }

    if ($cfg.formatUtilityDrive -and $cfg.dontMountUtilityDrive) {
        throw 'imageBuild: formatUtilityDrive and dontMountUtilityDrive cannot both be true'
    }

    $buildArgs = [System.Collections.Generic.List[string]]::new()
    $buildArgs.Add("/in:$inputFull") | Out-Null
    $buildArgs.Add("/out:$outputFull") | Out-Null
    if ($cfg.noLogo) { $buildArgs.Add('/nologo') | Out-Null }
    if ($cfg.stackSize -gt 0) { $buildArgs.Add("/stack:$($cfg.stackSize)") | Out-Null }
    if ($cfg.debug) { $buildArgs.Add('/debug') | Out-Null }
    if ($cfg.noLibWarn) { $buildArgs.Add('/nolibwarn') | Out-Null }
    if ($cfg.limitMemory) { $buildArgs.Add('/limitmem') | Out-Null }
    if ($cfg.dontModifyHardDisk) { $buildArgs.Add('/dontmodifyhd') | Out-Null }
    if ($cfg.dontMountUtilityDrive) { $buildArgs.Add('/dontmountud') | Out-Null }
    if ($cfg.formatUtilityDrive) { $buildArgs.Add('/formatud') | Out-Null }
    if ($cfg.utilityDriveClusterSize -gt 0) {
        $buildArgs.Add("/udcluster:$($cfg.utilityDriveClusterSize)") | Out-Null
    }
    foreach ($section in @($cfg.noPreload | Where-Object { $_ })) {
        $buildArgs.Add("/nopreload:$section") | Out-Null
    }
    foreach ($insert in @($InsertFile | Where-Object { $_ })) {
        $buildArgs.Add("/INSERTFILE:$insert") | Out-Null
    }

    Write-Host "$ToolPath $($buildArgs -join ' ')"
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $log = @( & $ToolPath @($buildArgs.ToArray()) 2>&1 )
    $ErrorActionPreference = $prevEap
    $log | ForEach-Object { Write-Host $_ }
    if ($LASTEXITCODE -ne 0) {
        throw "imagebld failed (exit $LASTEXITCODE)"
    }
    return $outputFull
}
