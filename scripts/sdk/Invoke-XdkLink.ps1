# Link Xbox title objects with Zig, mirroring the SDK's own title link
# (build/link_pe.zig). A title is: the title's objects + the SDK libs, linked with
# -nostdlib -nostartfiles at the XBE image base, with compiler-rt for the 64-bit
# math/builtins and the title entry point (-e). The entry is XapiTitleStartup for
# titles that link libxapi (the XAPI+CRT+TLS bring-up runs before main), or 'start'
# for a bare libc title. The kernel build/descriptor data (xboxkrnl_xbld.obj) and
# the XapiTitleStartup entry are baked into libc.lib / libxapi.lib respectively, so
# they need no loose object on the command line.
#
# libcompat.lib (staged in $LibDir alongside the other .lib archives) is the
# one exception and is ALWAYS force-linked whole here, ahead of everything else.
# picolibc's copies (in libc.lib) are compiled -fno-builtin, but zig's own
# compiler-rt (auto-pulled in via -rtlib=compiler-rt below, for
# __divdi3/__alloca/etc) ALSO ships its own implementations of a surprisingly
# large set of ordinary libc/libm entry points, not just the builtins a title's
# link legitimately needs -rtlib=compiler-rt for. Both picolibc's and zig's
# versions are comdat "select any" (-ffunction-sections), so a real
# multi-library link resolves the tie by comdat order PER SYMBOL, not by
# library position on the command line, and not consistently either way --
# confirmed on hardware: zig's compiler-rt `memmove` won and used SSE2 (movsd
# xmm0/xmm1), which the real Xbox's Pentium III can't execute
# (STATUS_ILLEGAL_INSTRUCTION, a hard crash mid-boot); separately, once
# memmove/memcpy were fixed, `fabs` ALSO turned out to have lost the tie-break
# (an ABI mismatch that corrupts the x87 FPU stack, surfacing as an
# unrelated-looking hang deep inside a math call chain), while `cos`/`sin`
# happened to resolve correctly. Since the tie-break is apparently arbitrary
# per-symbol, every overlapping symbol is force-included rather than fixing
# them one at a time as each is discovered.
#
# -Wl,--whole-archive/--no-whole-archive force-extracts every member of
# libcompat.lib unconditionally, the same "already included before any
# archive/comdat candidate is even considered" guarantee a loose object gets --
# just packaged as one ordinary-looking .lib instead of 32 loose .o files
# cluttering the SDK's lib directory. Verified byte-identical (mod PE
# timestamp) linked output vs. the older loose-object-list approach. This is
# invisible to a title's own rxdk.project.json -- no project needs to know
# about it.
$script:XdkComdatFixLib = 'libcompat.lib'

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
        [string]$Entry = 'start',
        [string]$LibDir
    )
    $linkArgs = @('cc') + $Objs
    if ($LibDir) {
        $comdatFix = Join-Path $LibDir $script:XdkComdatFixLib
        if (Test-Path -LiteralPath $comdatFix) {
            $linkArgs += @('-Wl,--whole-archive', $comdatFix, '-Wl,--no-whole-archive')
        } else {
            Write-Warning "Missing $comdatFix -- SDK predates the compiler-rt comdat fix; picolibc's memmove/fabs/etc. may lose to zig's compiler-rt on real hardware. Reinstall/update the RXDK SDK."
        }
    }
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
