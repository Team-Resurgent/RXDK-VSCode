# Link Xbox title objects with Zig, mirroring the SDK's own title link
# (build/link_pe.zig). A title is: the title's objects + the SDK libs, linked with
# -nostdlib -nostartfiles at the XBE image base, with compiler-rt for the 64-bit
# math/builtins and the title entry point (-e). The entry is XapiTitleStartup for
# titles that link libxapi (the XAPI+CRT+TLS bring-up runs before main), or 'start'
# for a bare libc title. The kernel build/descriptor data (xboxkrnl_xbld.obj) and
# the XapiTitleStartup entry are baked into libc.lib / libxapi.lib respectively, so
# they need no loose object on the command line.
#
# The objects below (staged in $LibDir alongside the .lib archives) are the one
# exception and are ALWAYS force-included here, ahead of everything else. picolibc's
# copies (in libc.lib) are compiled -fno-builtin, but zig's own compiler-rt
# (auto-pulled in via -rtlib=compiler-rt below, for __divdi3/__alloca/etc) ALSO
# ships its own implementations of a surprisingly large set of ordinary libc/libm
# entry points, not just the builtins a title's link legitimately needs
# -rtlib=compiler-rt for. Both picolibc's and zig's versions are comdat "select
# any" (-ffunction-sections), so a real multi-library link resolves the tie by
# comdat order PER SYMBOL, not by library position on the command line, and not
# consistently either way -- confirmed on hardware: zig's compiler-rt `memmove`
# won and used SSE2 (movsd xmm0/xmm1), which the real Xbox's Pentium III can't
# execute (STATUS_ILLEGAL_INSTRUCTION, a hard crash mid-boot); separately, once
# memmove/memcpy were fixed, `fabs` ALSO turned out to have lost the tie-break
# (an ABI mismatch that corrupts the x87 FPU stack, surfacing as an
# unrelated-looking hang deep inside a math call chain), while `cos`/`sin`
# happened to resolve correctly. Since the tie-break is apparently arbitrary
# per-symbol, every overlapping symbol is force-included here rather than fixing
# them one at a time as each is discovered. A directly-specified loose object is
# unconditionally included before any archive/comdat candidate is even
# considered, which is what actually guarantees picolibc's versions win. This is
# invisible to a title's own rxdk.project.json -- no project needs to know about it.
$script:XdkLooseMathObjs = @(
    'memmove.o', 'memcpy.o',
    'fabs.o', 'fabsf.o',
    'sqrt.o', 'sqrtf.o',
    'floor.o', 'floorf.o',
    'ceil.o', 'ceilf.o',
    'round.o', 'roundf.o',
    'trunc.o', 'truncf.o',
    'fmod.o', 'fmodf.o',
    'fmax.o', 'fmaxf.o',
    'fmin.o', 'fminf.o',
    'exp.o', 'expf.o',
    'log.o', 'logf.o',
    'tan.o', 'tanf.o',
    'cos.o', 'cosf.o',
    'sin.o', 'sinf.o',
    'rem_pio2.o', 'rem_pio2f.o'
)

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
        foreach ($name in $script:XdkLooseMathObjs) {
            $obj = Join-Path $LibDir $name
            if (Test-Path -LiteralPath $obj) {
                $linkArgs += $obj
            } else {
                Write-Warning "Missing $obj -- SDK predates the compiler-rt comdat fix for this symbol; picolibc's version may lose to zig's compiler-rt on real hardware. Reinstall/update the RXDK SDK."
            }
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
