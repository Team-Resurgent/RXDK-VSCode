# Generic Xbox title build from rxdk.project.json using staged SDK + Zig toolchain.
param(
    [Parameter(Mandatory)]
    [string]$SdkRoot,
    [Parameter(Mandatory)]
    [string]$ProjectRoot,
    [string]$IncludeDir,
    [string]$LibDir,
    [string]$ToolsDir,
    [string]$ZigExecutable,
    [switch]$CompileOnly
)
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'Get-XboxSdkPaths.ps1')
. (Join-Path $PSScriptRoot 'Get-ZigExecutable.ps1')
. (Join-Path $PSScriptRoot 'Invoke-XdkLink.ps1')
. (Join-Path $PSScriptRoot 'Invoke-ImageBuild.ps1')
. (Join-Path $PSScriptRoot 'Invoke-PackXiso.ps1')

function Get-XdkClangWarnings {
    return @(
        '-Wno-macro-redefined',
        '-Wno-deprecated-declarations',
        '-Wno-sign-compare',
        '-Wno-sign-conversion',
        '-Wno-implicit-int-conversion',
        '-Wno-shorten-64-to-32',
        '-Wno-pointer-to-int-cast',
        '-Wno-int-to-pointer-cast',
        '-Wno-unused-parameter',
        '-Wno-unused-variable',
        '-Wno-unused-function',
        '-Wno-missing-field-initializers',
        '-Wno-switch',
        '-Wno-ignored-qualifiers',
        '-Wno-invalid-source-encoding',
        '-Wno-pragma-pack',
        '-Wno-nonportable-include-path',
        '-Wno-main-return-type',
        '-Wno-missing-prototype-for-cc',
        '-Wno-ignored-pragma-intrinsic',
        '-Wno-multichar',
        '-Wno-comment',
        '-Wno-extra-tokens',
        '-Wno-unused-command-line-argument'
    )
}

# -I (not -isystem) everywhere: the SDK's clean-room windef.h/etc. must win over
# zig's bundled MinGW any-windows-any headers, which -isystem would let shadow them.

function Get-ProjectDefineArgs {
    param([object]$Manifest)
    $defineArgs = @()
    if ($Manifest.defines) {
        foreach ($define in $Manifest.defines) {
            if ([string]::IsNullOrWhiteSpace($define)) { continue }
            $defineArgs += "-D$define"
        }
    }
    return ,@($defineArgs)
}

function Invoke-ZigCompile {
    param(
        [Parameter(Mandatory)]
        [string]$Zig,
        [Parameter(Mandatory)]
        [string]$Source,
        [Parameter(Mandatory)]
        [string]$Object,
        [string[]]$IncludeArgs = @(),
        [string[]]$DefineArgs = @(),
        [string[]]$ExtraArgs = @(),
        [switch]$IsCpp
    )
    # Matches the RXDK SDK's own title compile recipe (build/xbox_target.zig):
    # x86-windows-gnu + -nostdinc + force-included picolibc.h, so the staged SDK
    # headers (<xtl.h> and friends) are the only ones on the path. -march=pentium3
    # is the Xbox CPU.
    $warnOff = @(Get-XdkClangWarnings)
    $common = @(
        '-target', 'x86-windows-gnu',
        '-O0', '-g', '-fno-sanitize=undefined',
        '-ffreestanding',
        '-fno-stack-protector',
        '-fms-extensions', '-fms-compatibility',
        '-nostdinc',
        '-include', 'picolibc.h',
        '-march=pentium3',
        # Without this, Clang is free to recognize a memmove/memcpy/RtlMoveMemory-
        # shaped call site as a known builtin and inline-expand it directly at the
        # call site, bypassing the SDK's own (correctly -fno-builtin-compiled)
        # picolibc implementation entirely. Matches every flag set in RXDK-Libs'
        # own build.zig (build/xbox_target.zig, libs/*/build.zig) - every title's
        # own source needs the same guarantee, not just the SDK libraries.
        '-fno-builtin'
    ) + $IncludeArgs + $DefineArgs + $ExtraArgs + $warnOff + @('-c', $Source, "-o$Object")

    if ($IsCpp) {
        $toolArgs = @(
            'c++',
            '-std=c++20',
            '-nostdinc++',
            '-fno-exceptions',
            '-frtti'
        ) + $common
    } else {
        $toolArgs = @('cc', '-std=c17') + $common
    }

    Write-Host "$Zig $($toolArgs -join ' ')"
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $log = @( & $Zig @toolArgs 2>&1 )
    $ErrorActionPreference = $prevEap
    $warnLines = $log | Where-Object {
        $_ -match ': warning:' -and $_ -match ([regex]::Escape([IO.Path]::GetFullPath($Source)))
    }
    if ($warnLines -and $IsCpp) {
        $warnLines | ForEach-Object { Write-Warning $_ }
        throw "Compile reported $($warnLines.Count) warning(s) in $Source"
    }
    if ($LASTEXITCODE -ne 0) {
        $log | ForEach-Object { Write-Host $_ }
        throw "Zig compile failed on $Source (exit $LASTEXITCODE)"
    }
    Write-Host "Compiled $Object"
}

# --- Multi-project (library reference) support -------------------------------

# Resolve a manifest's projectReferences to absolute library-project roots.
function Get-ProjectReferences {
    param([string]$ProjectRoot, [object]$Manifest)
    $refs = @()
    if ($Manifest.projectReferences) {
        foreach ($rel in $Manifest.projectReferences) {
            if ([string]::IsNullOrWhiteSpace($rel)) { continue }
            $dir = [IO.Path]::GetFullPath((Join-Path $ProjectRoot ($rel -replace '/', '\')))
            if (-not (Test-Path -LiteralPath (Join-Path $dir 'rxdk.project.json'))) {
                throw "projectReferences: no rxdk.project.json in $dir"
            }
            $refs += $dir
        }
    }
    return ,@($refs)
}

# Depth-first topological visit; appends $Dir's transitive library deps (deps first)
# to $Ordered. $State tracks visiting/done for cycle detection. $Ordered (List) and
# $State (Hashtable) are reference types, mutated in place.
function Add-DependencyOrder {
    param([string]$Dir, $Ordered, $State)
    $key = $Dir.ToLowerInvariant()
    if ($State[$key] -eq 'done') { return }
    if ($State[$key] -eq 'visiting') { throw "Cyclic projectReferences involving $Dir" }
    $State[$key] = 'visiting'
    $m = Get-XboxProjectManifest -ProjectRoot $Dir
    foreach ($ref in (Get-ProjectReferences -ProjectRoot $Dir -Manifest $m)) {
        Add-DependencyOrder -Dir $ref -Ordered $Ordered -State $State
    }
    $State[$key] = 'done'
    [void]$Ordered.Add($Dir)
}

# Transitive library dependencies of a project, in build (deps-first) order.
function Get-DependencyOrder {
    param([string]$ProjectRoot, [object]$Manifest)
    $ordered = [System.Collections.Generic.List[string]]::new()
    $state = @{}
    foreach ($ref in (Get-ProjectReferences -ProjectRoot $ProjectRoot -Manifest $Manifest)) {
        Add-DependencyOrder -Dir $ref -Ordered $ordered -State $state
    }
    return ,@($ordered.ToArray())
}

# Resolve a manifest field of project-relative dirs to absolute -I args.
function Resolve-IncludeArgs {
    param([string]$ProjectRoot, [object]$Values, [string]$Label)
    $out = @()
    if ($Values) {
        foreach ($rel in $Values) {
            if ([string]::IsNullOrWhiteSpace($rel)) { continue }
            $dir = [IO.Path]::GetFullPath((Join-Path $ProjectRoot ($rel -replace '/', '\')))
            if (-not (Test-Path -LiteralPath $dir)) { throw "${Label}: not found $dir" }
            $out += "-I$dir"
        }
    }
    return ,@($out)
}

# Public includes exported by every transitive library dependency (deduped -I args).
function Get-TransitivePublicIncludeArgs {
    param([string]$ProjectRoot, [object]$Manifest)
    $seen = @{}
    $out = @()
    foreach ($dep in (Get-DependencyOrder -ProjectRoot $ProjectRoot -Manifest $Manifest)) {
        $dm = Get-XboxProjectManifest -ProjectRoot $dep
        foreach ($arg in (Resolve-IncludeArgs -ProjectRoot $dep -Values $dm.publicIncludePaths -Label 'publicIncludePaths')) {
            if (-not $seen.ContainsKey($arg)) { $seen[$arg] = $true; $out += $arg }
        }
    }
    return ,@($out)
}

# Compile every source in a project to $OutDir; returns @{ Objs; UsesCpp }.
function Invoke-ProjectSources {
    param([string]$ProjectRoot, [object]$Manifest, [string]$Zig, [string]$OutDir, [string[]]$IncludeArgs, [string[]]$DefineArgs)
    $objs = @()
    $anyCpp = $false
    foreach ($relSrc in $Manifest.sources) {
        $src = Join-Path $ProjectRoot ($relSrc -replace '/', '\')
        if (-not (Test-Path -LiteralPath $src)) { throw "Source not found: $src" }
        $obj = Join-Path $OutDir "$([IO.Path]::GetFileNameWithoutExtension($src)).obj"
        $ext = [IO.Path]::GetExtension($src).ToLowerInvariant()
        $isCpp = ($ext -eq '.cpp' -or $ext -eq '.cxx')
        if ($isCpp) { $anyCpp = $true }
        Invoke-ZigCompile -Zig $Zig -Source $src -Object $obj -IncludeArgs $IncludeArgs -DefineArgs $DefineArgs -IsCpp:$isCpp
        $objs += $obj
    }
    return @{ Objs = $objs; UsesCpp = $anyCpp }
}

# Build one library project to a static .lib and return its path.
function Build-XboxLibrary {
    param([string]$LibRoot, [string]$Zig, [string]$SdkInclude)
    $m = Get-XboxProjectManifest -ProjectRoot $LibRoot
    if ($m.type -ne 'library') {
        throw "projectReferences must point to type:library projects - $($m.name) is not one"
    }
    $out = Get-XboxProjectOutDir -ProjectRoot $LibRoot -Manifest $m
    New-Item -ItemType Directory -Force -Path $out | Out-Null

    $inc = @('-I', $SdkInclude)
    $inc += Resolve-IncludeArgs -ProjectRoot $LibRoot -Values $m.includePaths -Label 'includePaths'
    $inc += Resolve-IncludeArgs -ProjectRoot $LibRoot -Values $m.publicIncludePaths -Label 'publicIncludePaths'
    $inc += Get-TransitivePublicIncludeArgs -ProjectRoot $LibRoot -Manifest $m
    $def = Get-ProjectDefineArgs -Manifest $m

    Write-Host "== Building library $($m.name) =="
    $r = Invoke-ProjectSources -ProjectRoot $LibRoot -Manifest $m -Zig $Zig -OutDir $out -IncludeArgs $inc -DefineArgs $def
    if (-not $r.Objs) { throw "Library $($m.name) has no sources to archive" }

    $lib = Join-Path $out "$($m.name).lib"
    if (Test-Path -LiteralPath $lib) { Remove-Item -LiteralPath $lib -Force }
    $arArgs = @('ar', 'rcs', $lib) + $r.Objs
    Write-Host "$Zig $($arArgs -join ' ')"
    & $Zig @arArgs
    if ($LASTEXITCODE -ne 0) { throw "Archiving $lib failed (exit $LASTEXITCODE)" }
    Write-Host "Archived $lib"
    return $lib
}

# --- Main --------------------------------------------------------------------

$paths = Get-XboxSdkPaths -SdkRoot $SdkRoot -IncludeDir $IncludeDir -LibDir $LibDir -ToolsDir $ToolsDir
$ProjectRoot = [IO.Path]::GetFullPath($ProjectRoot)
$manifest = Get-XboxProjectManifest -ProjectRoot $ProjectRoot
$projectName = $manifest.name
$outDir = Get-XboxProjectOutDir -ProjectRoot $ProjectRoot -Manifest $manifest
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

if (-not (Test-Path -LiteralPath $paths.Include)) {
    throw "Missing sdk/include - run RXDK prerequisites (SDK install)"
}

$zig = Resolve-ZigExecutable -Override $ZigExecutable

function Resolve-Lib([string]$Name) {
    $candidate = Join-Path $paths.Lib $Name
    if (Test-Path -LiteralPath $candidate) { return $candidate }
    return $null
}

# Build referenced library projects first, in dependency order, collecting their .libs.
$depOrder = Get-DependencyOrder -ProjectRoot $ProjectRoot -Manifest $manifest
$userLibs = @()
foreach ($dep in $depOrder) {
    $userLibs += Build-XboxLibrary -LibRoot $dep -Zig $zig -SdkInclude $paths.Include
}

# A library root builds to a .lib and stops (no link / imagebld / deploy).
if ($manifest.type -eq 'library') {
    $lib = Build-XboxLibrary -LibRoot $ProjectRoot -Zig $zig -SdkInclude $paths.Include
    Write-Host "OK: library $projectName build complete -> $lib"
    exit 0
}

# Compile this executable's own sources: SDK include + its own include paths +
# every referenced library's exported publicIncludePaths.
$projectIncludeArgs = @('-I', $paths.Include)
$projectIncludeArgs += Resolve-IncludeArgs -ProjectRoot $ProjectRoot -Values $manifest.includePaths -Label 'includePaths'
$projectIncludeArgs += Resolve-IncludeArgs -ProjectRoot $ProjectRoot -Values $manifest.publicIncludePaths -Label 'publicIncludePaths'
$projectIncludeArgs += Get-TransitivePublicIncludeArgs -ProjectRoot $ProjectRoot -Manifest $manifest
$projectDefineArgs = Get-ProjectDefineArgs -Manifest $manifest

Write-Host "== Building executable $projectName =="
$compiled = Invoke-ProjectSources -ProjectRoot $ProjectRoot -Manifest $manifest -Zig $zig -OutDir $outDir `
    -IncludeArgs $projectIncludeArgs -DefineArgs $projectDefineArgs
$objs = $compiled.Objs

if ($CompileOnly) {
    Write-Host "Compile OK (-CompileOnly)."
    exit 0
}

# SDK libraries to link: the executable's own plus every referenced library's,
# deduped in first-seen order, with libkernel forced last so libxapi and the other
# archives resolve their kernel imports from it (old SDKs shipped it as xboxkrnl.lib).
$libNames = [System.Collections.Generic.List[string]]::new()
function Add-LibName([string]$n) {
    if (-not [string]::IsNullOrWhiteSpace($n) -and -not $libNames.Contains($n)) { [void]$libNames.Add($n) }
}
foreach ($n in $manifest.libraries) { Add-LibName $n }
foreach ($dep in $depOrder) {
    $dm = Get-XboxProjectManifest -ProjectRoot $dep
    foreach ($n in $dm.libraries) { Add-LibName $n }
}
if ($libNames.Contains('libkernel')) { [void]$libNames.Remove('libkernel'); [void]$libNames.Add('libkernel') }

# Any title that links libxapi gets the XAPI + CRT + TLS bring-up before main
# (entry XapiTitleStartup); a bare libc title enters at 'start'.
$entry = if ($libNames.Contains('libxapi')) { 'XapiTitleStartup' } else { 'start' }

$linkLibs = @()
# Referenced library .libs go in a group so their inter-library (and back-)references
# resolve regardless of link order.
if ($userLibs.Count -gt 0) {
    $linkLibs += '-Wl,--start-group'
    $linkLibs += $userLibs
    $linkLibs += '-Wl,--end-group'
}
foreach ($libName in $libNames) {
    $resolved = Resolve-Lib "$libName.lib"
    if (-not $resolved -and $libName -eq 'libkernel') {
        $resolved = Resolve-Lib 'xboxkrnl.lib'
    }
    if (-not $resolved) {
        throw "Missing library: $libName.lib under sdk/lib - run RXDK SDK install"
    }
    $linkLibs += $resolved
}

# Single-pass link. imagebld (build-78+) zero-fills the emitted .data so the XBE
# loader copies the zeroed .bss tail -- uninitialized globals boot as zero with no
# runtime fixup, so no per-title image_init bootstrap is needed.
$exe = [IO.Path]::GetFullPath((Join-Path $outDir "$projectName.exe"))

$linkResult = Invoke-XdkLink -Zig $zig -Objs $objs -Libs $linkLibs -OutExe $exe -Entry $entry -LibDir $paths.Lib
if ($linkResult.ExitCode -ne 0) {
    throw "Link failed (exit $($linkResult.ExitCode))"
}
Write-Host "Linked $exe"

$imageBld = Get-HostToolPath -ToolsRoot $paths.Tools -Name 'imagebld'
$xdvdfs = Get-HostToolPath -ToolsRoot $paths.Tools -Name 'xdvdfs'
if (-not (Test-Path $imageBld)) { throw "Missing $imageBld" }
if (-not (Test-Path $xdvdfs)) { throw "Missing $xdvdfs" }

$insertFiles = @()
if ($manifest.embed) {
    foreach ($item in $manifest.embed) {
        if (-not $item.path -or -not $item.name) { continue }
        $embedPath = Join-Path $ProjectRoot ($item.path -replace '/', '\')
        if (Test-Path -LiteralPath $embedPath) {
            $insertFiles += "$([IO.Path]::GetFullPath($embedPath)),$($item.name),R"
            Write-Host "Embedding $($item.name) from $embedPath"
        } else {
            Write-Warning "embed path not found: $embedPath"
        }
    }
}

$xbe = Invoke-ImageBuild -InputExe $exe -ToolPath $imageBld -ImageBuild $manifest.imageBuild -InsertFile $insertFiles
Write-Host "Built $xbe"
try {
    $iso = Invoke-PackXiso -InputXbe $xbe -ProjectName $projectName -OutDir $outDir -ToolPath $xdvdfs
    Write-Host "Packed $iso"
} catch {
    Write-Host "Note: ISO pack skipped ($($_.Exception.Message))"
}
Write-Host "OK: $projectName build complete -> $outDir"
