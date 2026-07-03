import * as fs from 'fs';
import * as path from 'path';
import { RxdkImageBuildOptions } from './projectTypes';
import { OutputLike, runStreamed } from './processRunner';

interface ResolvedImageBuildSettings {
    stackSize: number;
    debug: boolean;
    noLogo: boolean;
    noLibWarn: boolean;
    limitMemory: boolean;
    dontModifyHardDisk: boolean;
    dontMountUtilityDrive: boolean;
    formatUtilityDrive: boolean;
    utilityDriveClusterSize: number;
    noPreload: string[];
}

function defaultImageBuildSettings(): ResolvedImageBuildSettings {
    return {
        stackSize: 65536,
        debug: true,
        noLogo: true,
        noLibWarn: true,
        limitMemory: false,
        dontModifyHardDisk: false,
        dontMountUtilityDrive: false,
        formatUtilityDrive: false,
        utilityDriveClusterSize: 0,
        noPreload: [],
    };
}

function resolveImageBuildSettings(imageBuild?: RxdkImageBuildOptions): ResolvedImageBuildSettings {
    const settings = defaultImageBuildSettings();
    if (!imageBuild) {
        return settings;
    }
    for (const key of Object.keys(settings) as (keyof ResolvedImageBuildSettings)[]) {
        const value = imageBuild[key];
        if (value !== undefined && value !== null) {
            (settings[key] as unknown) = value;
        }
    }
    return settings;
}

export interface BuildXbeOptions {
    inputExe: string;
    outputXbe?: string;
    toolPath: string;
    imageBuild?: RxdkImageBuildOptions;
    /** Explicit overrides, applied only when provided (mirrors the .ps1's -StackSize/-XbeDebug/-NoLibWarn switches). */
    stackSizeOverride?: number;
    xbeDebugOverride?: boolean;
    noLibWarnOverride?: boolean;
    /** Pre-built "path,name,R"-style imagebld /INSERTFILE strings -- passed through opaquely, not parsed. */
    insertFiles?: string[];
    output?: OutputLike;
}

/** Convert a linked Win32 PE .exe into an Xbox .xbe via the imagebld host tool. */
export async function buildXbe(opts: BuildXbeOptions): Promise<string> {
    const inputFull = path.resolve(opts.inputExe);
    if (!fs.existsSync(inputFull)) {
        throw new Error(`imagebld: input not found: ${inputFull}`);
    }
    const outputFull = path.resolve(opts.outputXbe || inputFull.replace(/\.exe$/i, '.xbe'));
    if (!opts.toolPath) {
        throw new Error('imagebld: toolPath required');
    }
    if (!fs.existsSync(opts.toolPath)) {
        throw new Error(`imagebld: tool not found: ${opts.toolPath}`);
    }

    const cfg = resolveImageBuildSettings(opts.imageBuild);
    if (opts.stackSizeOverride) {
        cfg.stackSize = opts.stackSizeOverride;
    }
    if (opts.xbeDebugOverride !== undefined) {
        cfg.debug = opts.xbeDebugOverride;
    }
    if (opts.noLibWarnOverride !== undefined) {
        cfg.noLibWarn = opts.noLibWarnOverride;
    }

    if (cfg.formatUtilityDrive && cfg.dontMountUtilityDrive) {
        throw new Error('imageBuild: formatUtilityDrive and dontMountUtilityDrive cannot both be true');
    }

    const args: string[] = [`/in:${inputFull}`, `/out:${outputFull}`];
    if (cfg.noLogo) { args.push('/nologo'); }
    if (cfg.stackSize > 0) { args.push(`/stack:${cfg.stackSize}`); }
    if (cfg.debug) { args.push('/debug'); }
    if (cfg.noLibWarn) { args.push('/nolibwarn'); }
    if (cfg.limitMemory) { args.push('/limitmem'); }
    if (cfg.dontModifyHardDisk) { args.push('/dontmodifyhd'); }
    if (cfg.dontMountUtilityDrive) { args.push('/dontmountud'); }
    if (cfg.formatUtilityDrive) { args.push('/formatud'); }
    if (cfg.utilityDriveClusterSize > 0) { args.push(`/udcluster:${cfg.utilityDriveClusterSize}`); }
    for (const section of cfg.noPreload.filter(Boolean)) {
        args.push(`/nopreload:${section}`);
    }
    for (const insert of (opts.insertFiles ?? []).filter(Boolean)) {
        args.push(`/INSERTFILE:${insert}`);
    }

    const result = await runStreamed(opts.toolPath, args, { output: opts.output });
    if (result.exitCode !== 0) {
        throw new Error(`imagebld failed (exit ${result.exitCode})`);
    }
    return outputFull;
}
