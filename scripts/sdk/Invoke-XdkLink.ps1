# Link Xbox title objects with Zig, mirroring the SDK's own title link
# (build/link_pe.zig). A title is: the title's objects + the SDK libs, linked with
# -nostdlib -nostartfiles at the XBE image base, with compiler-rt for the 64-bit
# math/builtins and the title entry point (-e). The entry is XapiTitleStartup for
# titles that link libxapi (the XAPI+CRT+TLS bring-up runs before main), or 'start'
# for a bare libc title. The kernel build/descriptor data (xboxkrnl_xbld.obj) and
# the XapiTitleStartup entry are baked into libc.lib / libxapi.lib respectively, so
# they need no loose object on the command line.
function Invoke-XdkLink {
    param(
        [Parameter(Mandatory)]
        [string]$Zig,
        [Parameter(Mandatory)]
        [string[]]$Objs,
        [Parameter(Mandatory)]
        [string[]]$Libs,
        [Parameter(Mandatory)]
        [string]$OutExe,
        [string]$Entry = 'start'
    )
    $linkArgs = @('cc') + $Objs
    $linkArgs += $Libs
    $linkArgs += @(
        '-target', 'x86-windows-gnu',
        '-nostdlib', '-nostartfiles',
        '-Wl,--image-base=0x10000',
        '-O0', '-g',
        '-rtlib=compiler-rt',
        '-e', $Entry,
        '-o', $OutExe
    )

    Write-Host "$Zig $($linkArgs -join ' ')"
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $linkLog = @( & $Zig @linkArgs 2>&1 )
    $ErrorActionPreference = $prevEap
    $linkLog | Write-Host
    return @{
        ExitCode = $LASTEXITCODE
        Log      = $linkLog
    }
}
