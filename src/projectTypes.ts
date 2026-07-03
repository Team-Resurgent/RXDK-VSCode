export type RxdkTemplateId =
    | 'spinning-triangle'
    | 'spinning-cube'
    | 'music-visualizer'
    | 'controller-input'
    | 'video-player'
    | 'font-scroller'
    | 'network-server'
    | 'dxt'
    | 'library';

export interface RxdkEmbedFile {
    path: string;
    name: string;
}

/** Options passed to imagebld (/stack, /debug, /limitmem, …). Omitted keys use RXDK defaults. */
export interface RxdkImageBuildOptions {
    stackSize?: number;
    debug?: boolean;
    noLogo?: boolean;
    noLibWarn?: boolean;
    limitMemory?: boolean;
    dontModifyHardDisk?: boolean;
    dontMountUtilityDrive?: boolean;
    formatUtilityDrive?: boolean;
    /** 16384, 32768, or 65536 bytes. Omit or 0 for imagebld default. */
    utilityDriveClusterSize?: number;
    /** Section names for /nopreload:<section> */
    noPreload?: string[];
}

/** A prebuilt-XBE project references existing artifacts in place (no compile step). */
export interface RxdkPrebuiltConfig {
    /** Absolute local path to the .xbe. */
    xbe: string;
    /** Absolute local path to the .pdb (symbols). */
    pdb?: string;
    /** Absolute local path to the .map (globals). */
    map?: string;
    /** Optional host PE .exe; used for image size, falls back to the XBE header. */
    exe?: string;
    /** Optional source root for PDBs built on another machine. */
    srcRoot?: string;
    /** Remote folder name under xe:\\ for deploy/launch. */
    remoteName: string;
}

/**
 * "executable" (default) builds an .xbe; "library" builds a static .lib that other projects
 * reference via <see cref="RxdkProjectManifest.projectReferences"/> and is not deployed/run.
 */
export type RxdkProjectKind = 'executable' | 'library' | 'dxt';

/**
 * Which prebuilt SDK library variant this project links. The staged SDK ships every library
 * in both flavors side by side (lib/debug: Debug -O0 -g, lib/release: ReleaseSmall -Os).
 * Omitted = "release".
 */
export type RxdkConfiguration = 'debug' | 'release';

export const RXDK_CONFIGURATIONS: RxdkConfiguration[] = ['debug', 'release'];

export const DEFAULT_RXDK_CONFIGURATION: RxdkConfiguration = 'release';

export function isRxdkConfiguration(value: string): value is RxdkConfiguration {
    return (RXDK_CONFIGURATIONS as string[]).includes(value);
}

export interface RxdkProjectManifest {
    name: string;
    /** Output kind. Omitted = "executable". */
    type?: RxdkProjectKind;
    /** Which SDK library variant to link (lib/debug or lib/release). Omitted = "release". */
    configuration?: RxdkConfiguration;
    sources?: string[];
    libraries?: string[];
    /**
     * Project-relative paths to library projects (folders containing an rxdk.project.json with
     * type:"library") this project links. Resolved transitively (a library may reference libraries),
     * built in dependency order to static .libs, then linked into this project. Their
     * publicIncludePaths are added to this project's compile include path automatically.
     */
    projectReferences?: string[];
    /** When set, this is a prebuilt-XBE project (deploy + debug, no build). */
    prebuilt?: RxdkPrebuiltConfig;
    outputDir?: string;
    /** Project-relative directories copied recursively on deploy (e.g. "media" -> xe:\\<name>\\media). */
    deployPaths?: string[];
    /** Files embedded into the XBE at build time (imagebld /insertfile). */
    embed?: RxdkEmbedFile[];
    /** imagebld.exe switches for the PE -> XBE step. */
    imageBuild?: RxdkImageBuildOptions;
    /** Extra project-relative include directories (passed as cl /I after sdk/include). */
    includePaths?: string[];
    /**
     * Include directories a library project exports to projects that reference it (added to their
     * compile include path). For an executable this behaves like an extra local include path.
     */
    publicIncludePaths?: string[];
    /** Extra preprocessor defines (cl /D), appended after RXDK defaults. */
    defines?: string[];
}

export const TEMPLATE_LABELS: Record<RxdkTemplateId, string> = {
    'spinning-triangle': 'Spinning Triangle',
    'spinning-cube': 'Spinning Cube (Multi-Project)',
    'music-visualizer': 'Music Visualizer',
    'controller-input': 'Controller Input Monitor',
    'video-player': 'Video Player (Looping)',
    'font-scroller': 'Bitmap Font Scroller',
    'network-server': 'Network + Web Server',
    dxt: 'Debug-Monitor Extension (DXT)',
    library: 'Static Library',
};

/** One-line summary of each template, shown in the New Project picker. */
export const TEMPLATE_DESCRIPTIONS: Record<RxdkTemplateId, string> = {
    'spinning-triangle': 'Rotating Direct3D 8 triangle with a Z-buffer — the classic starting point.',
    'spinning-cube': 'Spinning RGB cube whose mesh comes from a referenced library project — a multi-project sample.',
    'music-visualizer': 'Streams an Ogg track through DirectSound with a Direct3D 8 spectrum visualizer — references a vorbis library project.',
    'controller-input': 'Reads gamepad, mouse, IR remote, and keyboard input and shows every event on an on-screen scrolling terminal.',
    'video-player': 'Plays a bundled XMV video clip on a continuous loop.',
    'font-scroller': 'Demoscene-style bitmap-font scroller using libxfont — sine bounce, stretch-blit scaling, rainbow color cycle, and a typing hacker-terminal background.',
    'network-server': 'Brings up XNet + DHCP and hosts a tiny HTTP server — shows the URL to open on screen with libxfont.',
    dxt: 'An Xbox debug-monitor extension (.dxt) that xbdm loads from E:\\dxt at boot — an FPS/memory overlay drawn via the NV2A video overlay. Deploys to E:\\dxt and warm-reboots; not an XBE.',
    library: 'A standalone static library (.lib) that other projects link via projectReferences.',
};

export function manifestUsesCpp(manifest: RxdkProjectManifest): boolean {
    return (manifest.sources ?? []).some((s) => /\.(cpp|cxx|cc)$/i.test(s));
}

/** True when the project has compilable sources that need C/C++ IntelliSense. */
export function manifestNeedsIntelliSense(manifest: RxdkProjectManifest): boolean {
    if (isPrebuiltManifest(manifest)) {
        return false;
    }
    return (manifest.sources ?? []).some((s) => /\.(c|cpp|cxx|cc|h|hpp)$/i.test(s));
}

export function isPrebuiltManifest(manifest: RxdkProjectManifest): boolean {
    return !!manifest.prebuilt && !!manifest.prebuilt.xbe;
}

/** True for a static-library project (builds a .lib, never deployed/run). */
export function isLibraryManifest(manifest: RxdkProjectManifest): boolean {
    return manifest.type === 'library';
}

/**
 * True for a DXT (debug-monitor extension) project. Builds a raw flat .dxt (entry
 * DxtEntry, via imagebld /DXT) instead of an XBE; deploys to xe:\dxt and loads on
 * a warm reboot. Not debuggable via attach (it runs inside the debug monitor).
 */
export function isDxtManifest(manifest: RxdkProjectManifest): boolean {
    return manifest.type === 'dxt';
}
