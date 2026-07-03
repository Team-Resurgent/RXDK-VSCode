import * as fs from 'fs';
import * as path from 'path';
import { OutputLike, runStreamed } from './processRunner';

export interface StageFileEntry {
    source: string;
    relativeDest: string;
}

export interface PackXisoOptions {
    inputXbe: string;
    projectName: string;
    outDir?: string;
    outputIso?: string;
    stageFiles?: StageFileEntry[];
    toolPath: string;
    output?: OutputLike;
}

/** Pack a .xbe (+ any staged files) into an XISO via the xdvdfs host tool. */
export async function packXiso(opts: PackXisoOptions): Promise<string> {
    const xbeFull = path.resolve(opts.inputXbe);
    if (!fs.existsSync(xbeFull)) {
        throw new Error(`xdvdfs: input XBE not found: ${xbeFull}`);
    }
    const outDir = path.resolve(opts.outDir || path.dirname(xbeFull));
    if (!opts.toolPath) {
        throw new Error('xdvdfs: toolPath required');
    }

    const packDir = path.join(outDir, 'Build', opts.projectName);
    const defaultXbe = path.join(packDir, 'default.xbe');
    const outputIso = path.resolve(opts.outputIso || path.join(outDir, 'XISO', `${opts.projectName}.iso`));

    fs.mkdirSync(packDir, { recursive: true });
    fs.mkdirSync(path.dirname(outputIso), { recursive: true });
    fs.copyFileSync(xbeFull, defaultXbe);

    for (const entry of opts.stageFiles ?? []) {
        const src = path.resolve(entry.source);
        if (!fs.existsSync(src)) {
            throw new Error(`StageFile source not found: ${src}`);
        }
        const dest = path.join(packDir, entry.relativeDest.replace(/\//g, path.sep));
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(src, dest);
    }

    const result = await runStreamed(opts.toolPath, ['pack', packDir, outputIso], { output: opts.output });
    if (result.exitCode !== 0) {
        throw new Error(`xdvdfs pack failed (exit ${result.exitCode})`);
    }
    return outputIso;
}
