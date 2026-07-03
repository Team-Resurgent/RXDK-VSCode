// Build type selector for RXDK projects, named after Zig's own optimize modes
// (this extension shells out to `zig cc`/`zig c++` per-file rather than
// `zig build -Doptimize=`, so these are hand-mapped to the closest matching
// raw clang flags rather than being the exact same knob).
export type RxdkOptimizeMode = 'Debug' | 'ReleaseSafe' | 'ReleaseFast' | 'ReleaseSmall';

export const RXDK_OPTIMIZE_MODES: RxdkOptimizeMode[] = ['Debug', 'ReleaseSafe', 'ReleaseFast', 'ReleaseSmall'];

export function isRxdkOptimizeMode(value: string): value is RxdkOptimizeMode {
    return (RXDK_OPTIMIZE_MODES as string[]).includes(value);
}

// Compile-time flags per mode:
// - Debug:        no optimization, full debug info, UB sanitizer left off (matches
//                  the extension's long-standing default -- unchanged behavior).
// - ReleaseSafe:   optimized, but keeps runtime safety checks -- via a trapping (not
//                  printing) UB sanitizer, since there's no libc/stdio to report
//                  through in this freestanding target.
// - ReleaseFast:   optimized for speed, no safety checks, no debug info.
// - ReleaseSmall:  optimized for size, no safety checks, no debug info.
export function optimizeCompileFlags(mode: RxdkOptimizeMode): string[] {
    switch (mode) {
        case 'Debug':
            return ['-O0', '-g', '-fno-sanitize=undefined'];
        case 'ReleaseSafe':
            return ['-O2', '-g', '-fsanitize=undefined', '-fsanitize-trap=undefined'];
        case 'ReleaseFast':
            return ['-O3', '-fno-sanitize=undefined'];
        case 'ReleaseSmall':
            return ['-Os', '-fno-sanitize=undefined'];
    }
}

// Whether the linked .exe should carry debug info (-g) for PDB/symbol generation.
export function optimizeKeepsDebugInfo(mode: RxdkOptimizeMode): boolean {
    return mode === 'Debug' || mode === 'ReleaseSafe';
}
