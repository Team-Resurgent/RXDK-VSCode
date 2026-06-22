# Resolve the target Xbox devkit IP/hostname for host tools (xbcp / xboxdbg / xbox-launch).
# Windows: reads Xbox SDK registry (XboxName, Neighborhood). macOS/Linux: use -ConsoleName from VS Code settings JSON.
function Test-IPv4Address {
    param([string]$Value)
    return [bool]($Value -match '^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$')
}

function Get-XboxSdkRegistryRoot {
    foreach ($hive in @('HKCU', 'HKLM')) {
        $root = "$hive`:\Software\Microsoft\XboxSDK"
        if (Test-Path -LiteralPath $root) {
            return $root
        }
    }
    return $null
}

function Get-XboxShellExtRoot {
    foreach ($hive in @('HKCU', 'HKLM')) {
        $root = "$hive`:\Software\Microsoft\XboxSDK\xbshlext"
        if (Test-Path -LiteralPath $root) {
            return $root
        }
    }
    return $null
}

function Get-XboxNeighborhoodConsoleNames {
    param([string]$ShellExtRoot)
    $consolesPath = Join-Path $ShellExtRoot 'Consoles'
    if (-not (Test-Path -LiteralPath $consolesPath)) {
        return @()
    }
    $props = Get-ItemProperty -LiteralPath $consolesPath
    return @(
        $props.PSObject.Properties.Name |
            Where-Object { $_ -notmatch '^PS' -and $_ -ne '(default)' }
    )
}

function Resolve-XboxConsoleTarget {
    param([string]$NameOrAddress)
    if ([string]::IsNullOrWhiteSpace($NameOrAddress)) {
        return $null
    }
    $NameOrAddress = $NameOrAddress.Trim()
    if (Test-IPv4Address $NameOrAddress) {
        return $NameOrAddress
    }
    $shellExt = Get-XboxShellExtRoot
    if ($shellExt) {
        $addressesPath = Join-Path $shellExt 'Addresses'
        if (Test-Path -LiteralPath $addressesPath) {
            $address = (Get-ItemProperty -LiteralPath $addressesPath -ErrorAction SilentlyContinue).$NameOrAddress
            if ($address) {
                return [string]$address
            }
        }
    }
    return $NameOrAddress
}

function Test-XboxConsoleTargetResolvable {
    param([string]$NameOrAddress)
    if ([string]::IsNullOrWhiteSpace($NameOrAddress)) {
        return $false
    }
    $NameOrAddress = $NameOrAddress.Trim()
    if (Test-IPv4Address $NameOrAddress) {
        return $true
    }
    $shellExt = Get-XboxShellExtRoot
    if (-not $shellExt) {
        return $false
    }
    $addressesPath = Join-Path $shellExt 'Addresses'
    if (-not (Test-Path -LiteralPath $addressesPath)) {
        return $false
    }
    $props = Get-ItemProperty -LiteralPath $addressesPath
    return $props.PSObject.Properties.Name -contains $NameOrAddress
}

function Get-XboxNeighborhoodAddress {
    foreach ($hive in @('HKCU', 'HKLM')) {
        $shellExt = "$hive`:\Software\Microsoft\XboxSDK\xbshlext"
        if (Test-Path -LiteralPath $shellExt) {
            $addressesPath = Join-Path $shellExt 'Addresses'
            foreach ($name in (Get-XboxNeighborhoodConsoleNames -ShellExtRoot $shellExt)) {
                if (Test-Path -LiteralPath $addressesPath) {
                    $address = (Get-ItemProperty -LiteralPath $addressesPath -ErrorAction SilentlyContinue).$name
                    if ($address) {
                        return [string]$address
                    }
                }
            }
        }

        $rxdkConsoles = "$hive`:\Software\Microsoft\XboxSDK\RXDKNeighborhood\Consoles"
        if (Test-Path -LiteralPath $rxdkConsoles) {
            $props = Get-ItemProperty -LiteralPath $rxdkConsoles
            foreach ($prop in $props.PSObject.Properties) {
                if ($prop.Name -match '^PS') { continue }
                if (Test-IPv4Address $prop.Name) {
                    return [string]$prop.Name
                }
            }
        }
    }
    return $null
}

function Get-XboxConsole {
    param(
        [string]$SdkRoot,
        [string]$ConsoleName
    )
    $ErrorActionPreference = 'Stop'

    if ($ConsoleName) {
        return Resolve-XboxConsoleTarget $ConsoleName
    }
    if ($env:XBOX_CONSOLE) {
        return Resolve-XboxConsoleTarget $env:XBOX_CONSOLE
    }
    if ($env:XBOXIP) {
        return Resolve-XboxConsoleTarget $env:XBOXIP
    }

    foreach ($hive in @('HKCU', 'HKLM')) {
        $key = "$hive`:\Software\Microsoft\XboxSDK"
        if (-not (Test-Path -LiteralPath $key)) { continue }
        $xboxName = (Get-ItemProperty -LiteralPath $key -Name XboxName -ErrorAction SilentlyContinue).XboxName
        if ($xboxName -and (Test-XboxConsoleTargetResolvable $xboxName)) {
            return Resolve-XboxConsoleTarget $xboxName
        }
    }

    $fromNeighborhood = Get-XboxNeighborhoodAddress
    if ($fromNeighborhood) {
        return $fromNeighborhood
    }

    foreach ($hive in @('HKCU', 'HKLM')) {
        $key = "$hive`:\Software\Microsoft\XboxSDK"
        if (-not (Test-Path -LiteralPath $key)) { continue }
        $xboxName = (Get-ItemProperty -LiteralPath $key -Name XboxName -ErrorAction SilentlyContinue).XboxName
        if ($xboxName) {
            return Resolve-XboxConsoleTarget $xboxName
        }
    }

    return $null
}

function Get-XboxConsoleList {
    $consoles = @()
    foreach ($hive in @('HKCU', 'HKLM')) {
        $xbshlext = "$hive`:\Software\Microsoft\XboxSDK\xbshlext\Consoles"
        if (-not (Test-Path -LiteralPath $xbshlext)) { continue }
        Get-ChildItem -LiteralPath $xbshlext -ErrorAction SilentlyContinue | ForEach-Object {
            $name = $_.PSChildName
            if ($name) { $consoles += $name }
        }
        $props = Get-ItemProperty -LiteralPath $xbshlext -ErrorAction SilentlyContinue
        if ($props) {
            foreach ($name in $props.PSObject.Properties.Name) {
                if ($name -match '^PS' -or $name -eq '(default)') { continue }
                if ($consoles -notcontains $name) { $consoles += $name }
            }
        }
    }
    $default = Get-XboxConsole
    if ($default -and ($consoles -notcontains $default)) {
        $consoles = @($default) + $consoles
    }
    return $consoles
}
