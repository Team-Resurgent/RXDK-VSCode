import * as fs from 'fs';
import * as path from 'path';
import { OutputLike, runStreamed } from './processRunner';
import { getActiveXboxAddress } from './xboxConsole';
import { resolveHostTool } from './hostTools';
import { readProjectManifestAt } from './xboxSdkPaths';
import { getXboxProjectOutDir } from './sdkPath';

export type DeployResult = { ok: true; deployed: string[] } | { ok: false; error: string };

/** Only `*.ext`-shaped patterns are ever used by callers today -- a full glob engine is out of scope. */
function matchesSimplePattern(fileName: string, pattern: string): boolean {
    if (pattern.startsWith('*.')) {
        return fileName.toLowerCase().endsWith(pattern.slice(1).toLowerCase());
    }
    return fileName.toLowerCase() === pattern.toLowerCase();
}

function listFilesMatching(dir: string, pattern: string): string[] {
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return [];
    }
    return entries
        .filter((e) => e.isFile() && matchesSimplePattern(e.name, pattern))
        .map((e) => e.name);
}

/** Every file under `localPath`, recursively, as paths relative to `localPath`. */
export function listFilesRecursive(localPath: string): string[] {
    const out: string[] = [];
    const walk = (dir: string): void => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(full);
            } else if (entry.isFile()) {
                out.push(path.relative(localPath, full));
            }
        }
    };
    walk(localPath);
    return out;
}

export interface ResolvedDeployFile {
    /** Absolute local source path. */
    source: string;
    /** Destination path relative to the deployed root (remote dir / ISO stage dir), forward-slash. */
    relativeDest: string;
}

/**
 * Resolve a manifest's `deployPaths` entries to concrete files. Each entry may name either a
 * single file (copied to the same relative path) or a directory (recursively copied, with the
 * entry's own relative path as the destination's leading directory) -- e.g. "media" -> every
 * file under it lands at "media/...", "readme.txt" -> lands at "readme.txt" directly.
 */
export function resolveDeployPaths(
    projectRoot: string,
    deployPaths: string[] | undefined,
    output?: OutputLike
): ResolvedDeployFile[] {
    const out: ResolvedDeployFile[] = [];
    for (const relPath of deployPaths ?? []) {
        if (!relPath?.trim()) {
            continue;
        }
        const cleanRel = relPath.replace(/\\/g, '/').replace(/\/+$/, '');
        const localPath = path.join(projectRoot, cleanRel.replace(/\//g, path.sep));

        let stat: fs.Stats;
        try {
            stat = fs.statSync(localPath);
        } catch {
            output?.appendLine(`Warning: deployPaths: not found ${localPath}`);
            continue;
        }

        if (stat.isFile()) {
            out.push({ source: localPath, relativeDest: cleanRel });
            continue;
        }
        if (!stat.isDirectory()) {
            output?.appendLine(`Warning: deployPaths: not a file or directory ${localPath}`);
            continue;
        }

        const files = listFilesRecursive(localPath);
        if (files.length === 0) {
            output?.appendLine(`Warning: deployPaths: no files under ${localPath}`);
            continue;
        }
        for (const relFile of files) {
            out.push({
                source: path.join(localPath, relFile),
                relativeDest: `${cleanRel}/${relFile.replace(/\\/g, '/')}`,
            });
        }
    }
    return out;
}

function normalizeRemoteDir(remoteDir: string, defaultName: string): string {
    const dir = remoteDir || `xe:\\${defaultName}`;
    if (/^x[eEdDcC]:\\/.test(dir)) {
        return dir.replace(/\\+$/, '');
    }
    return `xe:\\${dir}`.replace(/\\+$/, '');
}

async function xbcpCopy(
    xbcp: string,
    localFile: string,
    remoteDest: string,
    console: string | undefined,
    output?: OutputLike
): Promise<void> {
    const args = ['/y', '/t', '/q'];
    if (console) {
        args.push('/x', console);
    }
    const result = await runStreamed(xbcp, [...args, localFile, remoteDest], { output });
    if (result.exitCode !== 0) {
        throw new Error(`xbcp failed copying ${path.basename(localFile)} (exit ${result.exitCode})`);
    }
}

export interface DeployProjectOptions {
    projectRoot: string;
    projectName?: string;
    localDir?: string;
    remoteDir?: string;
    consoleName?: string;
    /** Filename patterns for the project's own build output. Default: *.xbe, *.pdb, *.map. */
    files?: string[];
    quiet?: boolean;
    output?: OutputLike;
}

export async function deployProject(opts: DeployProjectOptions): Promise<DeployResult> {
    try {
        const projectRoot = path.resolve(opts.projectRoot);
        const manifest = readProjectManifestAt(projectRoot);
        const projectName = opts.projectName || manifest.name;
        const localDir = path.resolve(opts.localDir || getXboxProjectOutDir(projectRoot, manifest));
        if (!fs.existsSync(localDir)) {
            return { ok: false, error: `Deploy source directory not found: ${localDir}` };
        }

        const remoteDir = normalizeRemoteDir(opts.remoteDir || '', projectName);
        const xbcp = resolveHostTool('xbcp');
        const consoleAddr = opts.consoleName || (await getActiveXboxAddress());
        opts.output?.appendLine(
            consoleAddr ? `Deploying to Xbox '${consoleAddr}' -> ${remoteDir}` : `Deploying to default Xbox -> ${remoteDir}`
        );

        const patterns = opts.files && opts.files.length > 0 ? opts.files : ['*.xbe', '*.pdb', '*.map'];
        const sent: string[] = [];
        for (const pattern of patterns) {
            for (const name of listFilesMatching(localDir, pattern)) {
                const dest = `${remoteDir}\\${name}`;
                if (!opts.quiet) {
                    opts.output?.appendLine(`${name} -> ${dest}`);
                }
                await xbcpCopy(xbcp, path.join(localDir, name), dest, consoleAddr, opts.output);
                sent.push(name);
            }
        }
        if (sent.length === 0) {
            return { ok: false, error: `No files matched in ${localDir} (patterns: ${patterns.join(', ')})` };
        }

        // deployPaths: project-relative files/dirs (e.g. "media", "readme.txt") copied next to
        // the project's own output on the console. xbcp's own directory/wildcard recursive-copy
        // has real bugs for a plain local folder source (silently no-ops in one code path;
        // embeds a literal "*" in the rebuilt path in another) -- sidestepped by copying each
        // file individually with an explicit destination path, reconstructing the relative
        // path so nested subfolders are preserved. (In the prior PowerShell version, this
        // per-file list was deliberately NOT named $files/$file, since PowerShell's
        // case-insensitive variables would have silently aliased the script's own typed
        // $Files parameter -- not a risk in TS's real block scoping, but the descriptive
        // names are kept for clarity.)
        const deployFiles = resolveDeployPaths(projectRoot, manifest.deployPaths, opts.output);
        for (const entry of deployFiles) {
            const dest = `${remoteDir}\\${entry.relativeDest.replace(/\//g, '\\')}`;
            if (!opts.quiet) {
                opts.output?.appendLine(`${entry.source} -> ${dest}`);
            }
            await xbcpCopy(xbcp, entry.source, dest, consoleAddr, opts.output);
        }

        let summary = `Deployed: ${sent.join(', ')} -> ${remoteDir}`;
        if (deployFiles.length > 0) {
            summary += `; deployPaths: ${deployFiles.length} file(s)`;
        }
        opts.output?.appendLine(summary);
        return { ok: true, deployed: sent };
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
}

export interface DeployPrebuiltOptions {
    xbePath: string;
    pdbPath?: string;
    mapPath?: string;
    remoteName?: string;
    consoleName?: string;
    quiet?: boolean;
    output?: OutputLike;
}

/** Manifest-less deploy of an explicit prebuilt XBE (+ optional PDB/MAP). */
export async function deployPrebuilt(opts: DeployPrebuiltOptions): Promise<DeployResult> {
    try {
        const xbePath = path.resolve(opts.xbePath);
        if (!fs.existsSync(xbePath)) {
            return { ok: false, error: `XBE not found: ${xbePath}` };
        }
        const remoteName = opts.remoteName || path.basename(xbePath, path.extname(xbePath));
        const remoteDir = `xe:\\${remoteName}`.replace(/\\+$/, '');

        const xbcp = resolveHostTool('xbcp');
        const consoleAddr = opts.consoleName || (await getActiveXboxAddress());
        opts.output?.appendLine(
            consoleAddr ? `Deploying to Xbox '${consoleAddr}' -> ${remoteDir}` : `Deploying to default Xbox -> ${remoteDir}`
        );

        const toCopy = [xbePath];
        if (opts.pdbPath) { toCopy.push(path.resolve(opts.pdbPath)); }
        if (opts.mapPath) { toCopy.push(path.resolve(opts.mapPath)); }

        const sent: string[] = [];
        for (const file of toCopy) {
            if (!fs.existsSync(file)) {
                opts.output?.appendLine(`Warning: skip missing file: ${file}`);
                continue;
            }
            const name = path.basename(file);
            const dest = `${remoteDir}\\${name}`;
            if (!opts.quiet) {
                opts.output?.appendLine(`${name} -> ${dest}`);
            }
            await xbcpCopy(xbcp, file, dest, consoleAddr, opts.output);
            sent.push(name);
        }
        if (sent.length === 0) {
            return { ok: false, error: `No files deployed for ${xbePath}` };
        }
        opts.output?.appendLine(`Deployed: ${sent.join(', ')} -> ${remoteDir}`);
        return { ok: true, deployed: sent };
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
}
