import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import type * as vscode from 'vscode';
import { formatBytes, getDirectorySize } from './downloadFile';

const execFileAsync = promisify(execFile);

// 'vscode' only resolves inside the extension host. getStagedSdkRoot (via
// sdkPath.ts) also needs to load as a plain `node` process spawned from a
// generated VS Code task -- outside the extension host -- so the import above is
// type-only and every real access goes through this lazy, failure-tolerant
// getter. The UI-only functions further down (ensureSdkStaging, fetchLatestSdk,
// openStagedSdkFolder) are never called from that context, where it always resolves.
function tryVscode(): typeof vscode | undefined {
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        return require('vscode');
    } catch {
        return undefined;
    }
}

export const DEFAULT_SDK_GIT_URL = 'https://github.com/Team-Resurgent/RXDK-SDK.git';
const ESTIMATED_SDK_BYTES = 45 * 1024 * 1024;

/** Default persistent include/lib root (ProgramData on Windows, XDG/App Support elsewhere). */
export function getDefaultStagedSdkRoot(): string {
    if (process.platform === 'win32') {
        const programData = process.env.ProgramData || 'C:\\ProgramData';
        return path.join(programData, 'RXDK', 'sdk');
    }
    if (process.platform === 'darwin') {
        return path.join(os.homedir(), 'Library', 'Application Support', 'RXDK', 'sdk');
    }
    const xdg = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
    return path.join(xdg, 'rxdk', 'sdk');
}

export function getStagedSdkRoot(context?: vscode.ExtensionContext): string {
    if (process.env.RXDK_STAGED_SDK?.trim()) {
        return path.normalize(process.env.RXDK_STAGED_SDK.trim());
    }
    try {
        const override = tryVscode()?.workspace.getConfiguration('rxdk').get<string>('stagedSdkPath')?.trim();
        if (override) {
            return path.normalize(override);
        }
    } catch {
        /* no workspace yet */
    }
    if (context) {
        const globalOverride = tryVscode()
            ?.workspace.getConfiguration('rxdk', null)
            .get<string>('stagedSdkPath')
            ?.trim();
        if (globalOverride) {
            return path.normalize(globalOverride);
        }
    }
    return getDefaultStagedSdkRoot();
}

function getSdkGitUrl(context?: vscode.ExtensionContext): string {
    if (process.env.RXDK_SDK_GIT_URL?.trim()) {
        return process.env.RXDK_SDK_GIT_URL.trim();
    }
    try {
        const configured = tryVscode()?.workspace.getConfiguration('rxdk').get<string>('sdkGitUrl')?.trim();
        if (configured) {
            return configured;
        }
    } catch {
        /* no workspace yet */
    }
    if (context) {
        const global = tryVscode()?.workspace.getConfiguration('rxdk', null).get<string>('sdkGitUrl')?.trim();
        if (global) {
            return global;
        }
    }
    return DEFAULT_SDK_GIT_URL;
}

function getSdkGitRef(context?: vscode.ExtensionContext): string | undefined {
    if (process.env.RXDK_SDK_GIT_REF?.trim()) {
        return process.env.RXDK_SDK_GIT_REF.trim();
    }
    try {
        const configured = tryVscode()?.workspace.getConfiguration('rxdk').get<string>('sdkGitRef')?.trim();
        if (configured) {
            return configured;
        }
    } catch {
        /* no workspace yet */
    }
    if (context) {
        const global = tryVscode()?.workspace.getConfiguration('rxdk', null).get<string>('sdkGitRef')?.trim();
        if (global) {
            return global;
        }
    }
    return undefined;
}

export function isStagedSdkPresent(context?: vscode.ExtensionContext): boolean {
    const root = getStagedSdkRoot(context);
    return fs.existsSync(path.join(root, 'include', 'd3d8.h'));
}

/**
 * True if the staged SDK's lib/ actually contains a linkable library, checked
 * independently of isStagedSdkPresent (which only verifies include/). Headers and
 * libs are always staged together in practice, but this mirrors the .lib-specific
 * marker check the build pipeline used to make before the TS port, so a
 * partially-staged SDK (include present, lib missing/stale) is still caught.
 *
 * The SDK ships libs either flat (lib/libc.lib) or split by build configuration
 * (lib/release/libc.lib + lib/debug/libc.lib); a marker in any of those counts,
 * so a split-layout SDK isn't mistaken for "no libs" and downgraded to the
 * stale bundled fallback. getSdkLibDir returns the lib/ root either way; the
 * build pipeline appends the configuration subdir (see resolveSdkLibVariantDir).
 */
export function isStagedSdkLibPresent(context?: vscode.ExtensionContext): boolean {
    const lib = path.join(getStagedSdkRoot(context), 'lib');
    const markers = ['libkernel.lib', 'libc.lib', 'xboxkrnl.lib', 'libcmt.lib'];
    const dirs = [lib, path.join(lib, 'release'), path.join(lib, 'debug')];
    return dirs.some((dir) => markers.some((marker) => fs.existsSync(path.join(dir, marker))));
}

export type SdkInstallProgress = (update: { message: string; percent?: number }) => void;

async function runGitWithProgress(
    args: string[],
    options: {
        cwd?: string;
        watchDir?: string;
        label: string;
        onProgress?: SdkInstallProgress;
    }
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
            const sizePct = Math.min(100, Math.round((bytes / ESTIMATED_SDK_BYTES) * 100));
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

async function gitClone(
    repoUrl: string,
    dest: string,
    gitRef?: string,
    onProgress?: SdkInstallProgress
): Promise<void> {
    const parent = path.dirname(dest);
    fs.mkdirSync(parent, { recursive: true });
    const args = ['clone', '--progress', '--depth', '1'];
    if (gitRef) {
        args.push('--branch', gitRef);
    }
    args.push(repoUrl, dest);
    await runGitWithProgress(args, {
        watchDir: dest,
        label: 'Cloning RXDK-SDK',
        onProgress,
    });
}

function isGitRepo(dir: string): boolean {
    return fs.existsSync(path.join(dir, '.git'));
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

async function gitPullLatest(
    repoDir: string,
    gitRef?: string,
    onProgress?: SdkInstallProgress
): Promise<void> {
    const branch = gitRef || (await gitCurrentBranch(repoDir)) || 'main';
    await runGitWithProgress(['fetch', '--progress', '--depth', '1', 'origin', branch], {
        cwd: repoDir,
        watchDir: repoDir,
        label: 'Fetching RXDK-SDK',
        onProgress,
    });
    onProgress?.({ message: 'Updating RXDK-SDK checkout…', percent: 96 });
    await execFileAsync(
        'git',
        ['-C', repoDir, 'reset', '--hard', `origin/${branch}`],
        { timeout: 60_000, windowsHide: true }
    );
}

async function runWithProgress<T>(message: string, task: () => Promise<T>): Promise<T> {
    const vs = tryVscode();
    if (!vs) {
        throw new Error('runWithProgress requires running inside the VS Code extension host.');
    }
    return vs.window.withProgress(
        {
            location: vs.ProgressLocation.Notification,
            title: 'RXDK',
            cancellable: false,
        },
        async (progress) => {
            progress.report({ message });
            return task();
        }
    );
}

/**
 * On first install, clone [RXDK-SDK](https://github.com/Team-Resurgent/RXDK-SDK) into the staged directory.
 * If the folder already exists it is never overwritten (replace files manually or delete the folder to re-clone).
 */
export async function ensureSdkStaging(
    context: vscode.ExtensionContext,
    output?: vscode.OutputChannel
): Promise<void> {
    const vs = tryVscode();
    if (!vs) {
        throw new Error('ensureSdkStaging requires running inside the VS Code extension host.');
    }
    const staged = getStagedSdkRoot(context);

    if (isStagedSdkPresent(context)) {
        output?.appendLine(`RXDK: SDK present at ${staged}`);
        return;
    }

    if (fs.existsSync(staged)) {
        output?.appendLine(
            `RXDK: SDK folder exists but headers are missing — not overwriting: ${staged}`
        );
        vs.window.showWarningMessage(
            `RXDK SDK folder exists but is incomplete. Fix or delete it, then reload: ${staged}`
        );
        return;
    }

    const repoUrl = getSdkGitUrl(context);
    const gitRef = getSdkGitRef(context);
    output?.appendLine(`RXDK: cloning ${repoUrl}${gitRef ? ` (${gitRef})` : ''} → ${staged}`);

    try {
        await runWithProgress('Cloning RXDK-SDK (headers + libraries)...', () =>
            gitClone(repoUrl, staged, gitRef)
        );
        output?.appendLine(`RXDK: SDK cloned to ${staged}`);
        vs.window.showInformationMessage(`RXDK SDK ready at ${staged}`);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        output?.appendLine(`RXDK: SDK clone failed: ${message}`);
        vs.window.showErrorMessage(
            `RXDK SDK clone failed. Install Git and ensure network access, or clone manually:\n` +
                `git clone --depth 1 ${repoUrl} "${staged}"`
        );
    }
}

/** Clone or pull the latest RXDK-SDK into the staged directory. */
export async function fetchLatestSdk(
    context: vscode.ExtensionContext,
    output?: vscode.OutputChannel,
    onProgress?: SdkInstallProgress
): Promise<boolean> {
    const staged = getStagedSdkRoot(context);
    const repoUrl = getSdkGitUrl(context);
    const gitRef = getSdkGitRef(context);
    const quietUi = Boolean(onProgress);

    if (isGitRepo(staged)) {
        output?.appendLine(`RXDK: fetching latest RXDK-SDK → ${staged}`);
        onProgress?.({ message: 'Fetching latest RXDK-SDK…', percent: 5 });
        try {
            if (quietUi) {
                await gitPullLatest(staged, gitRef, onProgress);
            } else {
                await runWithProgress('Fetching latest RXDK-SDK...', () =>
                    gitPullLatest(staged, gitRef, onProgress)
                );
            }
            output?.appendLine(`RXDK: SDK updated at ${staged}`);
            onProgress?.({ message: 'RXDK-SDK ready', percent: 100 });
            if (!quietUi) {
                tryVscode()?.window.showInformationMessage('RXDK SDK updated to the latest release.');
            }
            return true;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            output?.appendLine(`RXDK: SDK update failed: ${message}`);
            if (!quietUi) {
                tryVscode()?.window.showErrorMessage(`RXDK SDK update failed: ${message}`);
            }
            return false;
        }
    }

    if (fs.existsSync(staged)) {
        if (quietUi) {
            return false;
        }
        const pick = await tryVscode()?.window.showWarningMessage(
            'The SDK folder was not installed via git. Replace it with the latest RXDK-SDK from GitHub?',
            'Replace',
            'Cancel'
        );
        if (pick !== 'Replace') {
            return false;
        }
        fs.rmSync(staged, { recursive: true, force: true });
    }

    output?.appendLine(`RXDK: cloning ${repoUrl}${gitRef ? ` (${gitRef})` : ''} → ${staged}`);
    onProgress?.({ message: 'Cloning RXDK-SDK…', percent: 0 });
    try {
        if (quietUi) {
            await gitClone(repoUrl, staged, gitRef, onProgress);
        } else {
            await runWithProgress('Cloning RXDK-SDK (headers + libraries)...', () =>
                gitClone(repoUrl, staged, gitRef, onProgress)
            );
        }
        output?.appendLine(`RXDK: SDK cloned to ${staged}`);
        onProgress?.({ message: 'RXDK-SDK ready', percent: 100 });
        if (!quietUi) {
            tryVscode()?.window.showInformationMessage('RXDK SDK installed from GitHub.');
        }
        return true;
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        output?.appendLine(`RXDK: SDK clone failed: ${message}`);
        if (!quietUi) {
            tryVscode()?.window.showErrorMessage(
                `RXDK SDK clone failed. Install Git and ensure network access, or clone manually:\n` +
                    `git clone --depth 1 ${repoUrl} "${staged}"`
            );
        }
        return false;
    }
}

/** Reveal the persistent SDK folder (include/lib) in the system file manager. */
export async function openStagedSdkFolder(context: vscode.ExtensionContext): Promise<void> {
    const vs = tryVscode();
    if (!vs) {
        throw new Error('openStagedSdkFolder requires running inside the VS Code extension host.');
    }
    const staged = getStagedSdkRoot(context);
    if (!isStagedSdkPresent(context)) {
        const pick = await vs.window.showInformationMessage(
            `RXDK SDK not installed yet (${staged}). Clone from GitHub now?`,
            'Clone now',
            'Show path'
        );
        if (pick === 'Clone now') {
            await fetchLatestSdk(context);
        } else if (pick !== 'Show path') {
            return;
        }
    }
    if (fs.existsSync(staged)) {
        await vs.env.openExternal(vs.Uri.file(staged));
    } else {
        await vs.window.showInformationMessage(`RXDK SDK path: ${staged}`);
    }
}
