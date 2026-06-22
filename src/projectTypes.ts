export type RxdkTemplateId = 'd3d8-triangle' | 'dsound-tone' | 'xinput-gamepad' | 'xmv-play';

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

export interface RxdkProjectManifest {
    name: string;
    sources?: string[];
    libraries?: string[];
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
    /** Extra preprocessor defines (cl /D), appended after RXDK defaults. */
    defines?: string[];
}

export const TEMPLATE_LABELS: Record<RxdkTemplateId, string> = {
    'd3d8-triangle': 'D3D8 Triangle',
    'dsound-tone': 'DSound Tone',
    'xinput-gamepad': 'XInput Gamepad',
    'xmv-play': 'XMV Play',
};

export function manifestUsesCpp(manifest: RxdkProjectManifest): boolean {
    return (manifest.sources ?? []).some((s) => /\.(cpp|cxx)$/i.test(s));
}

export function isPrebuiltManifest(manifest: RxdkProjectManifest): boolean {
    return !!manifest.prebuilt && !!manifest.prebuilt.xbe;
}
