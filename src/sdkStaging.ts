import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as vscode from 'vscode';

const execFileAsync = promisify(execFile);

export const DEFAULT_SDK_GIT_URL = 'https://github.com/Team-Resurgent/RXDK-SDK.git';

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
        const override = vscode.workspace.getConfiguration('rxdk').get<string>('stagedSdkPath')?.trim();
        if (override) {
            return path.normalize(override);
        }
    } catch {
        /* no workspace yet */
    }
    if (context) {
        const globalOverride = vscode.workspace
            .getConfiguration('rxdk', null)
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
        const configured = vscode.workspace.getConfiguration('rxdk').get<string>('sdkGitUrl')?.trim();
        if (configured) {
            return configured;
        }
    } catch {
        /* no workspace yet */
    }
    if (context) {
        const global = vscode.workspace.getConfiguration('rxdk', null).get<string>('sdkGitUrl')?.trim();
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
        const configured = vscode.workspace.getConfiguration('rxdk').get<string>('sdkGitRef')?.trim();
        if (configured) {
            return configured;
        }
    } catch {
        /* no workspace yet */
    }
    if (context) {
        const global = vscode.workspace.getConfiguration('rxdk', null).get<string>('sdkGitRef')?.trim();
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

async function gitClone(repoUrl: string, dest: string, gitRef?: string): Promise<void> {
    const parent = path.dirname(dest);
    fs.mkdirSync(parent, { recursive: true });
    const args = ['clone', '--depth', '1'];
    if (gitRef) {
        args.push('--branch', gitRef);
    }
    args.push(repoUrl, dest);
    await execFileAsync('git', args, { timeout: 600_000, windowsHide: true });
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

async function gitPullLatest(repoDir: string, gitRef?: string): Promise<void> {
    const branch = gitRef || (await gitCurrentBranch(repoDir)) || 'main';
    await execFileAsync(
        'git',
        ['-C', repoDir, 'fetch', '--depth', '1', 'origin', branch],
        { timeout: 600_000, windowsHide: true }
    );
    await execFileAsync(
        'git',
        ['-C', repoDir, 'reset', '--hard', `origin/${branch}`],
        { timeout: 60_000, windowsHide: true }
    );
}

async function runWithProgress<T>(message: string, task: () => Promise<T>): Promise<T> {
    return vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
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
    const staged = getStagedSdkRoot(context);

    if (isStagedSdkPresent(context)) {
        output?.appendLine(`RXDK: SDK present at ${staged}`);
        return;
    }

    if (fs.existsSync(staged)) {
        output?.appendLine(
            `RXDK: SDK folder exists but headers are missing — not overwriting: ${staged}`
        );
        vscode.window.showWarningMessage(
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
        vscode.window.showInformationMessage(`RXDK SDK ready at ${staged}`);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        output?.appendLine(`RXDK: SDK clone failed: ${message}`);
        vscode.window.showErrorMessage(
            `RXDK SDK clone failed. Install Git and ensure network access, or clone manually:\n` +
                `git clone --depth 1 ${repoUrl} "${staged}"`
        );
    }
}

/** Clone or pull the latest RXDK-SDK into the staged directory. */
export async function fetchLatestSdk(
    context: vscode.ExtensionContext,
    output?: vscode.OutputChannel
): Promise<boolean> {
    const staged = getStagedSdkRoot(context);
    const repoUrl = getSdkGitUrl(context);
    const gitRef = getSdkGitRef(context);

    if (isGitRepo(staged)) {
        output?.appendLine(`RXDK: fetching latest RXDK-SDK → ${staged}`);
        try {
            await runWithProgress('Fetching latest RXDK-SDK...', () => gitPullLatest(staged, gitRef));
            output?.appendLine(`RXDK: SDK updated at ${staged}`);
            vscode.window.showInformationMessage('RXDK SDK updated to the latest release.');
            return true;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            output?.appendLine(`RXDK: SDK update failed: ${message}`);
            vscode.window.showErrorMessage(`RXDK SDK update failed: ${message}`);
            return false;
        }
    }

    if (fs.existsSync(staged)) {
        const pick = await vscode.window.showWarningMessage(
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
    try {
        await runWithProgress('Cloning RXDK-SDK (headers + libraries)...', () =>
            gitClone(repoUrl, staged, gitRef)
        );
        output?.appendLine(`RXDK: SDK cloned to ${staged}`);
        vscode.window.showInformationMessage('RXDK SDK installed from GitHub.');
        return true;
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        output?.appendLine(`RXDK: SDK clone failed: ${message}`);
        vscode.window.showErrorMessage(
            `RXDK SDK clone failed. Install Git and ensure network access, or clone manually:\n` +
                `git clone --depth 1 ${repoUrl} "${staged}"`
        );
        return false;
    }
}

/** Reveal the persistent SDK folder (include/lib) in the system file manager. */
export async function openStagedSdkFolder(context: vscode.ExtensionContext): Promise<void> {
    const staged = getStagedSdkRoot(context);
    if (!isStagedSdkPresent(context)) {
        const pick = await vscode.window.showInformationMessage(
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
        await vscode.env.openExternal(vscode.Uri.file(staged));
    } else {
        await vscode.window.showInformationMessage(`RXDK SDK path: ${staged}`);
    }
}
