import * as fs from 'fs';
import * as path from 'path';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { formatBytes, getDirectorySize } from './downloadFile';

// Generic "clone-or-pull a repo into a staged directory" helpers, shared by any RXDK asset that ships
// as a git repository (currently the documentation set; the SDK has its own copy for now). Progress is
// reported both from git's "Receiving objects" output and by polling the destination directory size.

const execFileAsync = promisify(execFile);

export type StagingProgress = (update: { message: string; percent?: number }) => void;

export interface GitStagingOptions {
    /** Progress label prefix, e.g. "Cloning RXDK-Docs". */
    label: string;
    /** Rough total size for percent estimation from directory growth. */
    estimatedBytes: number;
    /** Optional branch/tag. */
    gitRef?: string;
    onProgress?: StagingProgress;
}

export function isGitRepo(dir: string): boolean {
    return fs.existsSync(path.join(dir, '.git'));
}

async function runGitWithProgress(
    args: string[],
    options: { cwd?: string; watchDir?: string; label: string; estimatedBytes: number; onProgress?: StagingProgress }
): Promise<void> {
    const started = Date.now();
    let finished = false;
    let lastPercent = 8;

    const reportProgress = (message: string, percent?: number): void => {
        if (percent !== undefined) {
            lastPercent = Math.max(lastPercent, percent);
        }
        options.onProgress?.({ message, percent: percent ?? lastPercent });
    };

    const pollTimer = setInterval(() => {
        if (finished || !options.watchDir) {
            return;
        }
        const elapsedSec = Math.round((Date.now() - started) / 1000);
        void getDirectorySize(options.watchDir).then((bytes) => {
            if (finished) {
                return;
            }
            const sizePct = Math.min(100, Math.round((bytes / options.estimatedBytes) * 100));
            const percent = Math.max(lastPercent, 10 + Math.min(85, Math.round(sizePct * 0.85)));
            const sizeHint = bytes > 0 ? ` ${formatBytes(bytes)} received` : '';
            reportProgress(`${options.label}…${sizeHint} (${elapsedSec}s)`, percent);
        });
    }, 1000);

    try {
        await new Promise<void>((resolve, reject) => {
            const proc = spawn('git', args, { cwd: options.cwd, windowsHide: true });
            let stderr = '';
            proc.stderr?.on('data', (chunk: Buffer) => {
                const text = chunk.toString();
                stderr += text;
                const match = text.match(/Receiving objects:\s+(\d+)%/);
                if (match) {
                    const gitPct = parseInt(match[1], 10);
                    const percent = Math.max(lastPercent, 10 + Math.round(gitPct * 0.85));
                    reportProgress(`${options.label}… ${gitPct}%`, percent);
                }
            });
            proc.on('error', reject);
            proc.on('close', (code) => {
                if (code === 0) {
                    resolve();
                    return;
                }
                reject(new Error(stderr.trim() || `git exited with code ${code}`));
            });
        });
    } finally {
        finished = true;
        clearInterval(pollTimer);
    }
}

export async function gitCloneRepo(repoUrl: string, dest: string, options: GitStagingOptions): Promise<void> {
    const parent = path.dirname(dest);
    fs.mkdirSync(parent, { recursive: true });
    const args = ['clone', '--progress', '--depth', '1'];
    if (options.gitRef) {
        args.push('--branch', options.gitRef);
    }
    args.push(repoUrl, dest);
    await runGitWithProgress(args, {
        watchDir: dest,
        label: options.label,
        estimatedBytes: options.estimatedBytes,
        onProgress: options.onProgress,
    });
}

async function gitCurrentBranch(repoDir: string): Promise<string | undefined> {
    try {
        const { stdout } = await execFileAsync(
            'git',
            ['-C', repoDir, 'rev-parse', '--abbrev-ref', 'HEAD'],
            { windowsHide: true }
        );
        const branch = stdout.trim();
        return branch && branch !== 'HEAD' ? branch : undefined;
    } catch {
        return undefined;
    }
}

export async function gitPullLatest(repoDir: string, options: GitStagingOptions): Promise<void> {
    const branch = options.gitRef || (await gitCurrentBranch(repoDir)) || 'main';
    await runGitWithProgress(['fetch', '--progress', '--depth', '1', 'origin', branch], {
        cwd: repoDir,
        watchDir: repoDir,
        label: options.label,
        estimatedBytes: options.estimatedBytes,
        onProgress: options.onProgress,
    });
    options.onProgress?.({ message: 'Updating checkout…', percent: 96 });
    await execFileAsync('git', ['-C', repoDir, 'reset', '--hard', `origin/${branch}`], {
        timeout: 60_000,
        windowsHide: true,
    });
}
