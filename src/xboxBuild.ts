import * as fs from 'fs';
import * as path from 'path';
import { OutputLike, runStreamed } from './processRunner';
import {
    DEFAULT_RXDK_CONFIGURATION,
    isRxdkConfiguration,
    RxdkConfiguration,
    RxdkProjectManifest,
} from './projectTypes';
import { getXboxProjectOutDir } from './sdkPath';
import { readProjectManifestAt } from './xboxSdkPaths';
import { resolveZigExecutable } from './zigRuntime';
import { resolveHostTool } from './hostTools';
import { linkXdk } from './xdkLink';
import { buildXbe, buildDxt } from './imageBuild';
import { packXiso, StageFileEntry } from './packXiso';
import { optimizeCompileFlags, optimizeKeepsDebugInfo, RxdkOptimizeMode } from './optimizeMode';
import { resolveDeployPaths } from './xboxDeploy';

export type BuildProjectResult = { ok: true; outDir: string } | { ok: false; error: string };

// Matches the RXDK SDK's own title compile recipe (build/xbox_target.zig):
// x86-windows-gnu + -nostdinc + force-included picolibc.h, so the staged SDK
// headers (<xtl.h> and friends) are the only ones on the path. -march=pentium3
// is the Xbox CPU. -I (not -isystem) everywhere: the SDK's clean-room
// windef.h/etc. must win over zig's bundled MinGW any-windows-any headers,
// which -isystem would let shadow them.
const XDK_CLANG_WARNINGS = [
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
    '-Wno-unused-command-line-argument',
];

function projectDefineArgs(manifest: RxdkProjectManifest): string[] {
    return (manifest.defines ?? []).filter((d) => d?.trim()).map((d) => `-D${d}`);
}

// Resolve the SDK library variant a project links, from its manifest's
// `configuration` field (default "release"). An invalid value warns and falls
// back to the default rather than failing the build.
function resolveConfiguration(manifest: RxdkProjectManifest, output?: OutputLike): RxdkConfiguration {
    const raw = manifest.configuration;
    if (raw === undefined) {
        return DEFAULT_RXDK_CONFIGURATION;
    }
    if (isRxdkConfiguration(raw)) {
        return raw;
    }
    output?.appendLine(
        `Warning: invalid configuration "${raw}" in rxdk.project.json (expected debug|release); using ${DEFAULT_RXDK_CONFIGURATION}`
    );
    return DEFAULT_RXDK_CONFIGURATION;
}

// Pick the lib directory to link from. A split SDK (lib/debug + lib/release)
// resolves to the requested variant's subdir; a legacy flat SDK (libs directly
// under sdkLib) resolves to sdkLib unchanged.
function resolveSdkLibVariantDir(sdkLib: string, configuration: RxdkConfiguration): string {
    const variantDir = path.join(sdkLib, configuration);
    try {
        if (fs.statSync(variantDir).isDirectory()) {
            return variantDir;
        }
    } catch {
        /* no split -- fall through to the flat layout */
    }
    return sdkLib;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface ZigCompileOptions {
    zig: string;
    source: string;
    object: string;
    includeArgs: string[];
    defineArgs: string[];
    isCpp: boolean;
    optimize: RxdkOptimizeMode;
    output?: OutputLike;
}

async function zigCompile(opts: ZigCompileOptions): Promise<void> {
    const common = [
        '-target', 'x86-windows-gnu',
        ...optimizeCompileFlags(opts.optimize),
        '-ffreestanding',
        '-fno-stack-protector',
        '-fms-extensions', '-fms-compatibility',
        '-nostdinc',
        '-include', 'picolibc.h',
        '-march=pentium3',
        // Without this, Clang is free to recognize a memmove/memcpy/RtlMoveMemory-
        // shaped call site as a known builtin and inline-expand it directly at the
        // call site, bypassing the SDK's own (correctly -fno-builtin-compiled)
        // picolibc implementation entirely. Matches every flag set in RXDK-Libs'
        // own build.zig (build/xbox_target.zig, libs/*/build.zig) - every title's
        // own source needs the same guarantee, not just the SDK libraries.
        '-fno-builtin',
        // RXDK ships retail SDK libraries (built DBG=0), so they never export the
        // debug-only parameter-check helpers (D3DDevice_SetRenderState_ParameterCheck
        // etc.). The public d3d8.h guards references to those behind #ifdef _DEBUG.
        // Some Clang builds predefine _DEBUG in ms-compatibility mode, which would
        // take that path and fail the link with an undefined ParameterCheck symbol.
        // Pin the retail path deterministically so titles link the same way on every
        // toolchain, regardless of whether the compiler predefines _DEBUG.
        '-U_DEBUG',
        // Thread-local storage: emulated TLS (a per-thread table reached via
        // __emutls_get_address, backed by libc tss/emutls.c) instead of the native
        // Windows __tls_index/TEB %fs model, which the RXDK runtime never sets up.
        // Without this, any title `__thread`/`thread_local` (e.g. stb_image's
        // stbi__g_failure_reason / vertically_flip_on_load) reads a wild fixed address
        // and bugchecks. Matches how libcpp is built (xbox_target.zig cppFlags).
        '-femulated-tls',
        ...opts.includeArgs,
        ...opts.defineArgs,
        ...XDK_CLANG_WARNINGS,
        '-c', opts.source, `-o${opts.object}`,
    ];
    // TLS debug-info handling. -femulated-tls makes clang emit a CodeView S_*THREAD32
    // record per thread_local pointing at the native per-var symbol emutls never defines
    // -> undefined-symbol at link. Blanket -gline-tables-only used to dodge that, but it
    // also stripped ALL local-variable and `this` records, leaving the debugger's
    // Locals/Autos empty in Debug builds. Only TUs that actually use TLS hit the link
    // problem, so: Debug/ReleaseSafe compile with full -g (locals + `this` inspectable),
    // then recompile just the TUs whose object uses emulated TLS (objUsesEmulatedTls)
    // with -gline-tables-only to keep their link clean. ReleaseFast/ReleaseSmall have no
    // -g and just get line tables (stepping + crash symbolization, no locals expected).
    const keepsDebug = optimizeKeepsDebugInfo(opts.optimize);
    if (!keepsDebug) {
        common.push('-gline-tables-only');
    }
    const toolArgs = opts.isCpp
        ? ['c++', '-std=c++23', '-nostdinc++', '-fno-exceptions', '-frtti', ...common]
        : ['cc', '-std=c23', ...common];

    let result = await runStreamed(opts.zig, toolArgs, { output: opts.output });
    if (keepsDebug && result.exitCode === 0 && objUsesEmulatedTls(opts.object)) {
        opts.output?.appendLine(
            `${path.basename(opts.source)}: uses thread_local; rebuilding with line-tables-only ` +
            'debug info (locals unavailable in this file) to keep the emulated-TLS link clean.');
        result = await runStreamed(opts.zig, [...toolArgs, '-gline-tables-only'], { output: opts.output });
    }
    const combined = (result.stdout + result.stderr).split(/\r?\n/);
    const sourcePattern = new RegExp(escapeRegExp(path.resolve(opts.source)));
    const warnLines = combined.filter((line) => line.includes(': warning:') && sourcePattern.test(line));
    if (warnLines.length > 0 && opts.isCpp) {
        throw new Error(`Compile reported ${warnLines.length} warning(s) in ${opts.source}`);
    }
    if (result.exitCode !== 0) {
        throw new Error(`Zig compile failed on ${opts.source} (exit ${result.exitCode})`);
    }
}

// True if a compiled object references emulated-TLS runtime symbols (___emutls_v.*,
// __emutls_get_address). -femulated-tls only emits these for TUs that actually use
// thread_local, and the names appear as plain ASCII in the COFF symbol/string table, so a
// substring scan detects TLS usage without parsing the object -- and it catches TLS pulled
// in through headers (e.g. stb_image), which a source-text scan would miss.
function objUsesEmulatedTls(objPath: string): boolean {
    try {
        if (!fs.existsSync(objPath)) {
            return false;
        }
        return fs.readFileSync(objPath).includes(Buffer.from('emutls', 'ascii'));
    } catch {
        return false;
    }
}

// --- Multi-project (library reference) support --------------------------------

function getProjectReferences(projectRoot: string, manifest: RxdkProjectManifest): string[] {
    const refs: string[] = [];
    for (const rel of manifest.projectReferences ?? []) {
        if (!rel?.trim()) {
            continue;
        }
        const dir = path.resolve(projectRoot, rel);
        if (!fs.existsSync(path.join(dir, 'rxdk.project.json'))) {
            throw new Error(`projectReferences: no rxdk.project.json in ${dir}`);
        }
        refs.push(dir);
    }
    return refs;
}

function addDependencyOrder(dir: string, ordered: string[], state: Map<string, 'visiting' | 'done'>): void {
    const key = dir.toLowerCase();
    if (state.get(key) === 'done') {
        return;
    }
    if (state.get(key) === 'visiting') {
        throw new Error(`Cyclic projectReferences involving ${dir}`);
    }
    state.set(key, 'visiting');
    const manifest = readProjectManifestAt(dir);
    for (const ref of getProjectReferences(dir, manifest)) {
        addDependencyOrder(ref, ordered, state);
    }
    state.set(key, 'done');
    ordered.push(dir);
}

/** Transitive library dependencies of a project, in build (deps-first) order. */
function getDependencyOrder(projectRoot: string, manifest: RxdkProjectManifest): string[] {
    const ordered: string[] = [];
    const state = new Map<string, 'visiting' | 'done'>();
    for (const ref of getProjectReferences(projectRoot, manifest)) {
        addDependencyOrder(ref, ordered, state);
    }
    return ordered;
}

function resolveIncludeArgs(projectRoot: string, values: string[] | undefined, label: string): string[] {
    const out: string[] = [];
    for (const rel of values ?? []) {
        if (!rel?.trim()) {
            continue;
        }
        const dir = path.resolve(projectRoot, rel);
        if (!fs.existsSync(dir)) {
            throw new Error(`${label}: not found ${dir}`);
        }
        out.push(`-I${dir}`);
    }
    return out;
}

/** Public includes exported by every transitive library dependency (deduped -I args). */
function getTransitivePublicIncludeArgs(projectRoot: string, manifest: RxdkProjectManifest): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const dep of getDependencyOrder(projectRoot, manifest)) {
        const depManifest = readProjectManifestAt(dep);
        for (const arg of resolveIncludeArgs(dep, depManifest.publicIncludePaths, 'publicIncludePaths')) {
            if (!seen.has(arg)) {
                seen.add(arg);
                out.push(arg);
            }
        }
    }
    return out;
}

interface CompiledSources { objs: string[]; usesCpp: boolean }

/** Compile every source in a project to outDir. */
/** Recursively find every *.rdf under a directory. */
function discoverRdfFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            out.push(...discoverRdfFiles(full));
        } else if (entry.name.toLowerCase().endsWith('.rdf')) {
            out.push(full);
        }
    }
    return out;
}

/**
 * Runs the bundler on the project's .rdf resource files, then xactbld on any .xap XACT projects.
 * Uses the explicit manifest.resources list if present, otherwise auto-discovers every *.rdf
 * under the project root. The bundler resolves out_header / out_packedresource paths relative to
 * each .rdf, so outputs land in the project tree (Resource.h next to the sources, the .xpr under
 * the media/deploy path in the .rdf). See compileXactProjects for the .xap step.
 */
async function compileResources(
    projectRoot: string,
    manifest: RxdkProjectManifest,
    output?: OutputLike
): Promise<void> {
    let rdfs: string[];
    if (manifest.resources && manifest.resources.length > 0) {
        rdfs = [];
        for (const rel of manifest.resources) {
            if (!rel || !rel.trim()) {
                continue;
            }
            if (!rel.toLowerCase().endsWith('.rdf')) {
                continue;
            }
            const p = path.join(projectRoot, rel.replace(/\//g, path.sep));
            if (!fs.existsSync(p)) {
                // Imported XDK vcprojs often list stale .rdf references (a shared
                // Font.rdf/Gamepad.rdf not shipped with the sample). Skip rather than
                // fail — a truly-needed resource surfaces as a missing-header compile error.
                output?.appendLine(`Warning: resource .rdf not found, skipping: ${p}`);
                continue;
            }
            rdfs.push(p);
        }
    } else {
        rdfs = discoverRdfFiles(projectRoot);
    }

    if (rdfs.length > 0) {
        const bundler = resolveHostTool('bundler');
        if (!fs.existsSync(bundler)) {
            throw new Error(
                `bundler host tool not found: ${bundler}. Update the RXDK tools (the resource pipeline needs the bundler).`
            );
        }

        for (const rdf of rdfs) {
            output?.appendLine(`Compiling resources: ${path.basename(rdf)}`);
            const result = await runStreamed(bundler, [rdf, '-q'], { output, cwd: path.dirname(rdf) });
            if (result.exitCode !== 0) {
                throw new Error(`bundler failed on ${path.basename(rdf)} (exit ${result.exitCode})`);
            }
        }
    }

    await compileXactProjects(projectRoot, manifest, output);
}

/** Find every *.xap under a directory (recursive). */
function discoverXapFiles(dir: string, recursive: boolean): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (recursive) {
                out.push(...discoverXapFiles(full, true));
            }
        } else if (entry.name.toLowerCase().endsWith('.xap')) {
            out.push(full);
        }
    }
    return out;
}

/**
 * Runs xactbld on the project's .xap XACT-project files. Each .xap produces the generated C
 * header (XactSounds.h, next to the .xap so sources can #include it) plus a wave bank (.xwb)
 * and sound bank (.xsb) written to the media paths named inside it. Uses the manifest's .xap
 * resources if listed, otherwise auto-discovers *.xap under the project root and its immediate
 * parent — XDK sound samples keep the .xap at the sample root next to the .cpp, one level above
 * the .vcxproj/manifest directory.
 */
async function compileXactProjects(
    projectRoot: string,
    manifest: RxdkProjectManifest,
    output?: OutputLike
): Promise<void> {
    const xaps: string[] = [];

    for (const rel of manifest.resources ?? []) {
        if (!rel || !rel.trim() || !rel.toLowerCase().endsWith('.xap')) {
            continue;
        }
        const p = path.resolve(projectRoot, rel.replace(/\//g, path.sep));
        if (fs.existsSync(p)) {
            xaps.push(p);
        }
    }

    for (const f of discoverXapFiles(projectRoot, true)) {
        xaps.push(path.resolve(f));
    }
    const parent = path.dirname(projectRoot.replace(/[\\/]+$/, ''));
    if (parent && fs.existsSync(parent)) {
        for (const f of discoverXapFiles(parent, false)) {
            xaps.push(path.resolve(f));
        }
    }

    const unique = [...new Set(xaps.map((x) => path.normalize(x)))];
    if (unique.length === 0) {
        return;
    }

    const xactbld = resolveHostTool('xactbld');
    if (!fs.existsSync(xactbld)) {
        throw new Error(
            `xactbld host tool not found: ${xactbld}. Update the RXDK tools (the XACT audio pipeline needs xactbld).`
        );
    }

    for (const xap of unique) {
        output?.appendLine(`Compiling XACT project: ${path.basename(xap)}`);
        const result = await runStreamed(xactbld, [xap, '-q'], { output, cwd: path.dirname(xap) });
        if (result.exitCode !== 0) {
            throw new Error(`xactbld failed on ${path.basename(xap)} (exit ${result.exitCode})`);
        }
    }
}

/** Recursively find every *.vsh/*.psh under a dir, skipping build-output trees (out/obj/bin). */
function discoverShaderFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            const lower = entry.name.toLowerCase();
            if (lower === 'out' || lower === 'obj' || lower === 'bin') {
                continue; // deployed shader copies live here — don't recompile them
            }
            out.push(...discoverShaderFiles(full));
        } else {
            const lower = entry.name.toLowerCase();
            if (lower.endsWith('.vsh') || lower.endsWith('.psh')) {
                out.push(full);
            }
        }
    }
    return out;
}

/**
 * True when a .vsh/.psh begins (past comments/blank lines) with a shader version directive such
 * as vs.1.1 / xvs.1.1 / xvss.1.1 / ps.1.1 / xps.1.1. Files without one are shared include
 * fragments (#included by others), not standalone shaders.
 */
function hasShaderVersionLine(file: string): boolean {
    let text: string;
    try {
        text = fs.readFileSync(file, 'utf8');
    } catch {
        return false;
    }
    for (const raw of text.split(/\r?\n/)) {
        let line = raw;
        const c = line.indexOf('//');
        if (c >= 0) {
            line = line.slice(0, c);
        }
        const s = line.indexOf(';');
        if (s >= 0) {
            line = line.slice(0, s);
        }
        line = line.trim();
        if (line.length === 0 || line.startsWith('#')) {
            continue;
        }
        return /^(xvss|xvsw|xvs|vs|xps|ps)\s*\.\s*\d/i.test(line);
    }
    return false;
}

/**
 * Assembles the project's shader sources to NV2A microcode with xsasm: each *.vsh -> *.xvu and
 * *.psh -> *.xpu, written next to the source so it deploys with the media tree (titles load e.g.
 * "Shaders\\Foo.xvu" at runtime). Uses the manifest's .vsh/.psh resources if listed, otherwise
 * auto-discovers under the project root (skipping build-output dirs). Files without a shader
 * version line are include fragments and skipped. A shader that fails to assemble fails the build.
 */
async function compileShaders(
    projectRoot: string,
    manifest: RxdkProjectManifest,
    output?: OutputLike
): Promise<void> {
    const isShaderSource = (p: string) => {
        const l = p.toLowerCase();
        return l.endsWith('.vsh') || l.endsWith('.psh');
    };

    let shaders: string[];
    const listed = (manifest.resources ?? []).filter((r) => r && r.trim() && isShaderSource(r));
    if (listed.length > 0) {
        shaders = [];
        for (const rel of listed) {
            const p = path.resolve(projectRoot, rel.replace(/\//g, path.sep));
            if (fs.existsSync(p)) {
                shaders.push(p);
            }
        }
    } else {
        shaders = discoverShaderFiles(projectRoot);
    }

    const unique = [...new Set(shaders.map((s) => path.normalize(s)))].filter(hasShaderVersionLine);
    if (unique.length === 0) {
        return;
    }

    const xsasm = resolveHostTool('xsasm');
    if (!fs.existsSync(xsasm)) {
        throw new Error(
            `xsasm host tool not found: ${xsasm}. Update the RXDK tools (the shader pipeline needs xsasm).`
        );
    }

    for (const src of unique) {
        const isPixel = src.toLowerCase().endsWith('.psh');
        const outPath = src.slice(0, src.length - 4) + (isPixel ? '.xpu' : '.xvu');
        const dir = path.dirname(src);
        output?.appendLine(`Compiling shader: ${path.basename(src)} -> ${path.basename(outPath)}`);
        // -I <dir>: fur/fin-style shaders #include sibling fragments from their own directory.
        const result = await runStreamed(xsasm, [src, '-o', outPath, '-I', dir], { output, cwd: dir });
        if (result.exitCode !== 0) {
            throw new Error(`xsasm failed on ${path.basename(src)} (exit ${result.exitCode})`);
        }
    }
}

async function compileProjectSources(
    projectRoot: string,
    manifest: RxdkProjectManifest,
    zig: string,
    outDir: string,
    includeArgs: string[],
    defineArgs: string[],
    optimize: RxdkOptimizeMode,
    output?: OutputLike
): Promise<CompiledSources> {
    const objs: string[] = [];
    let usesCpp = false;
    for (const relSrc of manifest.sources ?? []) {
        const src = path.join(projectRoot, relSrc.replace(/\//g, path.sep));
        if (!fs.existsSync(src)) {
            throw new Error(`Source not found: ${src}`);
        }
        const obj = path.join(outDir, `${path.basename(src, path.extname(src))}.obj`);
        const ext = path.extname(src).toLowerCase();
        const isCpp = ext === '.cpp' || ext === '.cxx';
        if (isCpp) {
            usesCpp = true;
        }
        await zigCompile({ zig, source: src, object: obj, includeArgs, defineArgs, isCpp, optimize, output });
        output?.appendLine(`Compiled ${obj}`);
        objs.push(obj);
    }
    return { objs, usesCpp };
}

/** Build one library project to a static .lib and return its path. */
async function buildXboxLibrary(
    libRoot: string,
    zig: string,
    sdkInclude: string,
    optimize: RxdkOptimizeMode,
    output?: OutputLike
): Promise<string> {
    const manifest = readProjectManifestAt(libRoot);
    if (manifest.type !== 'library') {
        throw new Error(`projectReferences must point to type:library projects - ${manifest.name} is not one`);
    }
    const outDir = getXboxProjectOutDir(libRoot, manifest);
    fs.mkdirSync(outDir, { recursive: true });

    const includeArgs = [
        '-I', sdkInclude,
        ...resolveIncludeArgs(libRoot, manifest.includePaths, 'includePaths'),
        ...resolveIncludeArgs(libRoot, manifest.publicIncludePaths, 'publicIncludePaths'),
        ...getTransitivePublicIncludeArgs(libRoot, manifest),
    ];
    const defineArgs = projectDefineArgs(manifest);

    output?.appendLine(`== Building library ${manifest.name} ==`);
    const compiled = await compileProjectSources(libRoot, manifest, zig, outDir, includeArgs, defineArgs, optimize, output);
    if (compiled.objs.length === 0) {
        throw new Error(`Library ${manifest.name} has no sources to archive`);
    }

    const lib = path.join(outDir, `${manifest.name}.lib`);
    if (fs.existsSync(lib)) {
        fs.rmSync(lib, { force: true });
    }
    const arResult = await runStreamed(zig, ['ar', 'rcs', lib, ...compiled.objs], { output });
    if (arResult.exitCode !== 0) {
        throw new Error(`Archiving ${lib} failed (exit ${arResult.exitCode})`);
    }
    output?.appendLine(`Archived ${lib}`);
    return lib;
}

// --- Main ----------------------------------------------------------------

export interface BuildXboxProjectOptions {
    projectRoot: string;
    sdkInclude: string;
    sdkLib: string;
    zigExecutable?: string;
    compileOnly?: boolean;
    /** Build type (Debug/ReleaseSafe/ReleaseFast/ReleaseSmall). Default 'Debug'. */
    optimize?: RxdkOptimizeMode;
    output?: OutputLike;
}

export async function buildXboxProject(opts: BuildXboxProjectOptions): Promise<BuildProjectResult> {
    try {
        const projectRoot = path.resolve(opts.projectRoot);
        const manifest = readProjectManifestAt(projectRoot);
        const projectName = manifest.name;
        const outDir = getXboxProjectOutDir(projectRoot, manifest);
        fs.mkdirSync(outDir, { recursive: true });
        const optimize: RxdkOptimizeMode = opts.optimize ?? 'Debug';

        // Resource pipeline: compile any .rdf files with the bundler BEFORE the C/C++ sources,
        // so the generated Resource.h exists at compile time and the packed .xpr is written
        // (to the out_packedresource path named in the .rdf) for deploy.
        await compileResources(projectRoot, manifest, opts.output);

        // Shader pipeline: assemble .vsh/.psh sources to .xvu/.xpu microcode with xsasm so titles
        // that load precompiled shaders (e.g. "Shaders\\Foo.xvu") find them in the media tree.
        await compileShaders(projectRoot, manifest, opts.output);

        if (!fs.existsSync(opts.sdkInclude)) {
            throw new Error('Missing sdk/include - run RXDK prerequisites (SDK install)');
        }
        const zig = await resolveZigExecutable(opts.zigExecutable);
        if (!zig) {
            throw new Error('Zig not found. Install Zig from the RXDK prerequisites panel, or add zig to PATH.');
        }

        // The staged SDK ships each library in two variants side by side --
        // lib/debug (Debug, -O0 -g) and lib/release (ReleaseSmall, -Os). The
        // manifest's "configuration" field picks which one this project links
        // (default "release": smaller, no debug info pulled into the title's own
        // link). Old/flat SDKs with no such subdir fall back to sdkLib itself,
        // so this stays backward compatible. libcompat.lib (whole-archive-linked
        // below) must come from the SAME variant dir, so linkXdk's libDir is
        // pointed here too.
        const configuration = resolveConfiguration(manifest, opts.output);
        const sdkLibDir = resolveSdkLibVariantDir(opts.sdkLib, configuration);
        opts.output?.appendLine(`Linking SDK libraries (configuration: ${configuration})`);
        const resolveLib = (name: string): string | undefined => {
            const candidate = path.join(sdkLibDir, name);
            return fs.existsSync(candidate) ? candidate : undefined;
        };

        // Build referenced library projects first, in dependency order, collecting their .libs.
        const depOrder = getDependencyOrder(projectRoot, manifest);
        const userLibs: string[] = [];
        for (const dep of depOrder) {
            userLibs.push(await buildXboxLibrary(dep, zig, opts.sdkInclude, optimize, opts.output));
        }

        // A library root builds to a .lib and stops (no link / imagebld / deploy).
        if (manifest.type === 'library') {
            const lib = await buildXboxLibrary(projectRoot, zig, opts.sdkInclude, optimize, opts.output);
            opts.output?.appendLine(`OK: library ${projectName} build complete -> ${lib}`);
            return { ok: true, outDir };
        }

        // Compile this executable's own sources: SDK include + its own include paths +
        // every referenced library's exported publicIncludePaths.
        const projectIncludeArgs = [
            '-I', opts.sdkInclude,
            ...resolveIncludeArgs(projectRoot, manifest.includePaths, 'includePaths'),
            ...resolveIncludeArgs(projectRoot, manifest.publicIncludePaths, 'publicIncludePaths'),
            ...getTransitivePublicIncludeArgs(projectRoot, manifest),
        ];
        const projectDefines = projectDefineArgs(manifest);

        opts.output?.appendLine(`== Building executable ${projectName} ==`);
        const compiled = await compileProjectSources(
            projectRoot, manifest, zig, outDir, projectIncludeArgs, projectDefines, optimize, opts.output
        );
        const objs = compiled.objs;

        if (opts.compileOnly) {
            opts.output?.appendLine('Compile OK (-CompileOnly).');
            return { ok: true, outDir };
        }

        // SDK libraries to link: the executable's own plus every referenced library's,
        // deduped in first-seen order, with libkernel forced last so libxapi and the other
        // archives resolve their kernel imports from it (old SDKs shipped it as xboxkrnl.lib).
        const libNames: string[] = [];
        const addLibName = (n: string): void => {
            if (n?.trim() && !libNames.includes(n)) {
                libNames.push(n);
            }
        };
        for (const n of manifest.libraries ?? []) { addLibName(n); }
        for (const dep of depOrder) {
            const depManifest = readProjectManifestAt(dep);
            for (const n of depManifest.libraries ?? []) { addLibName(n); }
        }
        if (libNames.includes('libkernel')) {
            libNames.splice(libNames.indexOf('libkernel'), 1);
            libNames.push('libkernel');
        }

        // A DXT is entered at DxtEntry by xbdm's loader. Otherwise: any title that
        // links libxapi gets the XAPI + CRT + TLS bring-up before main (entry
        // XapiTitleStartup); a bare libc title enters at 'start'.
        const isDxt = manifest.type === 'dxt';
        const entry = isDxt
            ? 'DxtEntry'
            : libNames.includes('libxapi')
              ? 'XapiTitleStartup'
              : 'start';

        const linkLibs: string[] = [];
        // A DXT must keep its base-relocation table (xbdm relocates the raw image
        // in place); a title doesn't (fixed XBE base), so relocs are stripped there.
        if (isDxt) {
            linkLibs.push('-Wl,--dynamicbase');
        }
        // Referenced library .libs go in a group so their inter-library (and back-)
        // references resolve regardless of link order.
        if (userLibs.length > 0) {
            linkLibs.push('-Wl,--start-group', ...userLibs, '-Wl,--end-group');
        }
        for (const libName of libNames) {
            const resolved = resolveLib(`${libName}.lib`) ?? (libName === 'libkernel' ? resolveLib('xboxkrnl.lib') : undefined);
            if (!resolved) {
                throw new Error(`Missing library: ${libName}.lib under sdk/lib - run RXDK SDK install`);
            }
            linkLibs.push(resolved);
        }

        // Single-pass link. imagebld (build-78+) zero-fills the emitted .data so the XBE
        // loader copies the zeroed .bss tail -- uninitialized globals boot as zero with no
        // runtime fixup, so no per-title image_init bootstrap is needed.
        const exe = path.resolve(path.join(outDir, `${projectName}.exe`));
        const linkResult = await linkXdk({
            zig, objs, libs: linkLibs, outExe: exe, entry, libDir: sdkLibDir,
            debugInfo: optimizeKeepsDebugInfo(optimize), output: opts.output,
        });
        if (linkResult.exitCode !== 0) {
            throw new Error(`Link failed (exit ${linkResult.exitCode})`);
        }
        opts.output?.appendLine(`Linked ${exe}`);

        // A DXT is a raw flat PE, not an XBE: run imagebld /DXT to flatten (file
        // offset == RVA) + set the Xbox subsystem, and stop. No XBE, no ISO.
        if (isDxt) {
            const imageBldPathDxt = resolveHostTool('imagebld');
            if (!fs.existsSync(imageBldPathDxt)) {
                throw new Error(`Missing ${imageBldPathDxt}`);
            }
            const dxt = await buildDxt({
                inputExe: exe,
                outputDxt: path.resolve(path.join(outDir, `${projectName}.dxt`)),
                toolPath: imageBldPathDxt,
                output: opts.output,
            });
            opts.output?.appendLine(`Built ${dxt}`);
            opts.output?.appendLine(`OK: DXT ${projectName} build complete -> ${outDir}`);
            return { ok: true, outDir };
        }

        const imageBldPath = resolveHostTool('imagebld');
        const xdvdfsPath = resolveHostTool('xdvdfs');
        if (!fs.existsSync(imageBldPath)) {
            throw new Error(`Missing ${imageBldPath}`);
        }
        if (!fs.existsSync(xdvdfsPath)) {
            throw new Error(`Missing ${xdvdfsPath}`);
        }

        const insertFiles: string[] = [];
        for (const item of manifest.embed ?? []) {
            if (!item.path || !item.name) {
                continue;
            }
            const embedPath = path.join(projectRoot, item.path.replace(/\//g, path.sep));
            if (fs.existsSync(embedPath)) {
                insertFiles.push(`${path.resolve(embedPath)},${item.name},R`);
                opts.output?.appendLine(`Embedding ${item.name} from ${embedPath}`);
            } else {
                opts.output?.appendLine(`Warning: embed path not found: ${embedPath}`);
            }
        }

        const xbe = await buildXbe({
            inputExe: exe,
            toolPath: imageBldPath,
            imageBuild: manifest.imageBuild,
            insertFiles,
            output: opts.output,
        });
        opts.output?.appendLine(`Built ${xbe}`);
        try {
            // deployPaths: project-relative files/dirs (e.g. "media") staged into the ISO next
            // to default.xbe, same layout a live deploy produces (xe:\<name>\... -> D:\...).
            const stageFiles: StageFileEntry[] = resolveDeployPaths(projectRoot, manifest.deployPaths, opts.output);
            if (stageFiles.length > 0) {
                opts.output?.appendLine(`Staging ${stageFiles.length} deployPaths file(s) into ISO`);
            }

            const iso = await packXiso({
                inputXbe: xbe, projectName, outDir, toolPath: xdvdfsPath, stageFiles, output: opts.output,
            });
            opts.output?.appendLine(`Packed ${iso}`);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            opts.output?.appendLine(`Note: ISO pack skipped (${message})`);
        }
        opts.output?.appendLine(`OK: ${projectName} build complete -> ${outDir}`);
        return { ok: true, outDir };
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
}
