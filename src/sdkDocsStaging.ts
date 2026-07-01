import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { getStagedSdkRoot } from './sdkStaging';
import { gitCloneRepo, gitPullLatest, isGitRepo, StagingProgress } from './gitStaging';

// The documentation set ships as a git repository (RXDK-Docs), cloned like the SDK libraries rather
// than downloaded as an archive. The repo contains two doc subsets and a VERSION file:
//   <docs>/xboxsdk/   — Xbox SDK API reference (HTML)
//   <docs>/rxdk/      — RXDK extension documentation (HTML)
//   <docs>/VERSION    — installed docs version (tracked like the SDK's VERSION)

export const DEFAULT_DOCS_GIT_URL = 'https://github.com/Team-Resurgent/RXDK-Docs.git';
export const DEFAULT_DOCS_REPO_PAGE = 'https://github.com/Team-Resurgent/RXDK-Docs';
const ESTIMATED_DOCS_BYTES = 24 * 1024 * 1024;

export type DocsInstallProgress = StagingProgress;

export function getRxdkDataRoot(context?: vscode.ExtensionContext): string {
    return path.dirname(getStagedSdkRoot(context));
}

/** Root of the cloned RXDK-Docs repo (ProgramData/RXDK/docs), holding xboxsdk/ and rxdk/. */
export function getStagedDocsRoot(context?: vscode.ExtensionContext): string {
    return path.join(getRxdkDataRoot(context), 'docs');
}

/** Xbox SDK API reference subset. */
export function getXboxSdkDocsRoot(context?: vscode.ExtensionContext): string {
    return path.join(getStagedDocsRoot(context), 'xboxsdk');
}

/** RXDK extension documentation subset. */
export function getExtensionDocsRoot(context?: vscode.ExtensionContext): string {
    return path.join(getStagedDocsRoot(context), 'rxdk');
}

function getDocsGitUrl(context?: vscode.ExtensionContext): string {
    if (process.env.RXDK_DOCS_GIT_URL?.trim()) {
        return process.env.RXDK_DOCS_GIT_URL.trim();
    }
    try {
        const configured = vscode.workspace.getConfiguration('rxdk').get<string>('docsGitUrl')?.trim();
        if (configured) {
            return configured;
        }
    } catch {
        /* no workspace yet */
    }
    if (context) {
        const global = vscode.workspace.getConfiguration('rxdk', null).get<string>('docsGitUrl')?.trim();
        if (global) {
            return global;
        }
    }
    return DEFAULT_DOCS_GIT_URL;
}

function getDocsGitRef(context?: vscode.ExtensionContext): string | undefined {
    if (process.env.RXDK_DOCS_GIT_REF?.trim()) {
        return process.env.RXDK_DOCS_GIT_REF.trim();
    }
    try {
        const configured = vscode.workspace.getConfiguration('rxdk').get<string>('docsGitRef')?.trim();
        if (configured) {
            return configured;
        }
    } catch {
        /* no workspace yet */
    }
    return undefined;
}

/** True when the Xbox SDK reference subset is installed. */
export function isSdkDocsPresent(context?: vscode.ExtensionContext): boolean {
    return fs.existsSync(path.join(getXboxSdkDocsRoot(context), 'toc.json'));
}

/** True when the RXDK extension documentation subset is installed. */
export function areExtensionDocsPresent(context?: vscode.ExtensionContext): boolean {
    return fs.existsSync(path.join(getExtensionDocsRoot(context), 'toc.json'));
}

/** Installed docs version from the repo's VERSION file, or 'not installed'. */
export function readDocsVersion(context?: vscode.ExtensionContext): string {
    const root = getStagedDocsRoot(context);
    for (const name of ['VERSION', 'VERSION.txt']) {
        try {
            return fs.readFileSync(path.join(root, name), 'utf8').trim();
        } catch {
            /* try next */
        }
    }
    return 'not installed';
}

async function runWithProgress<T>(message: string, task: () => Promise<T>): Promise<T> {
    return vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'RXDK', cancellable: false },
        async (progress) => {
            progress.report({ message });
            return task();
        }
    );
}

/** Clone or pull the RXDK-Docs repository into the staged docs directory. */
export async function fetchLatestDocs(
    context: vscode.ExtensionContext,
    output?: vscode.OutputChannel,
    onProgress?: DocsInstallProgress
): Promise<boolean> {
    const dest = getStagedDocsRoot(context);
    const repoUrl = getDocsGitUrl(context);
    const gitRef = getDocsGitRef(context);
    const quietUi = Boolean(onProgress);
    const gitOpts = { label: 'RXDK-Docs', estimatedBytes: ESTIMATED_DOCS_BYTES, gitRef, onProgress };

    if (isGitRepo(dest)) {
        output?.appendLine(`RXDK: fetching latest RXDK-Docs → ${dest}`);
        onProgress?.({ message: 'Fetching latest RXDK-Docs…', percent: 5 });
        try {
            await (quietUi
                ? gitPullLatest(dest, { ...gitOpts, label: 'Fetching RXDK-Docs' })
                : runWithProgress('Fetching latest RXDK-Docs…', () =>
                      gitPullLatest(dest, { ...gitOpts, label: 'Fetching RXDK-Docs' })
                  ));
            output?.appendLine(`RXDK: docs updated at ${dest} (${readDocsVersion(context)})`);
            onProgress?.({ message: 'RXDK-Docs ready', percent: 100 });
            return isSdkDocsPresent(context);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            output?.appendLine(`RXDK: docs update failed: ${message}`);
            if (!quietUi) {
                vscode.window.showErrorMessage(`RXDK docs update failed: ${message}`);
            }
            return false;
        }
    }

    if (fs.existsSync(dest)) {
        // A non-git docs folder (e.g. an old extracted archive). Replace it with the repo clone.
        try {
            fs.rmSync(dest, { recursive: true, force: true });
        } catch {
            /* fall through to clone attempt */
        }
    }

    output?.appendLine(`RXDK: cloning ${repoUrl}${gitRef ? ` (${gitRef})` : ''} → ${dest}`);
    onProgress?.({ message: 'Cloning RXDK-Docs…', percent: 0 });
    try {
        await (quietUi
            ? gitCloneRepo(repoUrl, dest, { ...gitOpts, label: 'Cloning RXDK-Docs' })
            : runWithProgress('Cloning RXDK-Docs (documentation)…', () =>
                  gitCloneRepo(repoUrl, dest, { ...gitOpts, label: 'Cloning RXDK-Docs' })
              ));
        output?.appendLine(`RXDK: docs cloned to ${dest} (${readDocsVersion(context)})`);
        onProgress?.({ message: 'RXDK-Docs ready', percent: 100 });
        return isSdkDocsPresent(context);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        output?.appendLine(`RXDK: docs clone failed: ${message}`);
        if (!quietUi) {
            vscode.window.showErrorMessage(
                `RXDK docs clone failed. Install Git and ensure network access, or clone manually:\n` +
                    `git clone --depth 1 ${repoUrl} "${dest}"`
            );
        }
        return false;
    }
}

/** Docs are installed via RXDK Setup prerequisites; this only logs status. */
export async function ensureSdkDocsStaging(
    context: vscode.ExtensionContext,
    output?: vscode.OutputChannel
): Promise<void> {
    if (isSdkDocsPresent(context)) {
        output?.appendLine(`RXDK: docs present at ${getStagedDocsRoot(context)} (${readDocsVersion(context)})`);
        return;
    }
    output?.appendLine('RXDK: docs not installed — open RXDK Setup to install.');
}

/** Resolved root for the Xbox SDK reference viewer. */
export function resolveSdkDocsRoot(context: vscode.ExtensionContext): string {
    return getXboxSdkDocsRoot(context);
}

/** Resolved root for the RXDK extension documentation viewer. */
export function resolveExtensionDocsRoot(context: vscode.ExtensionContext): string {
    return getExtensionDocsRoot(context);
}
