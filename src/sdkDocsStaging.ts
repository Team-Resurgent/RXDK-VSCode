import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as vscode from 'vscode';
import {
    downloadFileToPath,
    formatBytes,
    formatDownloadProgress,
    getDirectorySize,
} from './downloadFile';
import { getStagedSdkRoot } from './sdkStaging';

const execFileAsync = promisify(execFile);

export const DEFAULT_DOCS_RELEASES_PAGE =
    'https://github.com/Team-Resurgent/RXDK-Docs/releases/latest';
export const DEFAULT_DOCS_GITHUB_REPO = 'Team-Resurgent/RXDK-Docs';
export const DOCS_ARCHIVE_NAME = 'xboxsdk.tar.gz';
const ESTIMATED_DOCS_BYTES = 20 * 1024 * 1024;

interface GitHubReleaseAsset {
    name: string;
    browser_download_url: string;
}

interface GitHubRelease {
    tag_name: string;
    assets: GitHubReleaseAsset[];
}

export function getRxdkDataRoot(context?: vscode.ExtensionContext): string {
    return path.dirname(getStagedSdkRoot(context));
}

/** Persistent extracted Xbox SDK HTML docs (ProgramData/RXDK/docs/xboxsdk). */
export function getStagedDocsRoot(context?: vscode.ExtensionContext): string {
    return path.join(getRxdkDataRoot(context), 'docs', 'xboxsdk');
}

function getDocsGithubRepo(context?: vscode.ExtensionContext): string {
    if (process.env.RXDK_DOCS_GITHUB_REPO?.trim()) {
        return process.env.RXDK_DOCS_GITHUB_REPO.trim();
    }
    try {
        const configured = vscode.workspace.getConfiguration('rxdk').get<string>('docsGithubRepo')?.trim();
        if (configured) {
            return configured;
        }
    } catch {
        /* no workspace yet */
    }
    if (context) {
        const global = vscode.workspace
            .getConfiguration('rxdk', null)
            .get<string>('docsGithubRepo')
            ?.trim();
        if (global) {
            return global;
        }
    }
    return DEFAULT_DOCS_GITHUB_REPO;
}

function findArchiveAsset(release: GitHubRelease): GitHubReleaseAsset | undefined {
    return release.assets.find((asset) => asset.name === DOCS_ARCHIVE_NAME);
}

async function resolveDocsDownloadUrl(
    context?: vscode.ExtensionContext
): Promise<{ url: string; tag: string }> {
    const repo = getDocsGithubRepo(context);
    const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'RXDK-VSCode' };

    const latestResponse = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
        headers,
    });
    if (latestResponse.ok) {
        const release = (await latestResponse.json()) as GitHubRelease;
        const asset = findArchiveAsset(release);
        if (asset) {
            return { url: asset.browser_download_url, tag: release.tag_name };
        }
    }

    const listResponse = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=20`, {
        headers,
    });
    if (!listResponse.ok) {
        throw new Error(
            `RXDK-Docs releases not found (${listResponse.status}). Publish a release at ${DEFAULT_DOCS_RELEASES_PAGE}`
        );
    }

    const releases = (await listResponse.json()) as GitHubRelease[];
    for (const release of releases) {
        const asset = findArchiveAsset(release);
        if (asset) {
            return { url: asset.browser_download_url, tag: release.tag_name };
        }
    }

    throw new Error(
        `No ${DOCS_ARCHIVE_NAME} asset found in RXDK-Docs releases. See ${DEFAULT_DOCS_RELEASES_PAGE}`
    );
}

export function isSdkDocsPresent(context?: vscode.ExtensionContext): boolean {
    const staged = getStagedDocsRoot(context);
    return fs.existsSync(path.join(staged, 'toc.json'));
}

export type DocsInstallProgress = (update: { message: string; percent?: number }) => void;

async function extractDocsArchive(
    archivePath: string,
    destParent: string,
    staged: string,
    onProgress?: DocsInstallProgress
): Promise<void> {
    if (fs.existsSync(staged)) {
        fs.rmSync(staged, { recursive: true, force: true });
    }
    fs.mkdirSync(destParent, { recursive: true });

    let finished = false;
    const pollTimer = setInterval(() => {
        if (finished) {
            return;
        }
        void getDirectorySize(staged).then((bytes) => {
            if (finished || bytes === 0) {
                return;
            }
            const pct = Math.min(99, 88 + Math.round((bytes / ESTIMATED_DOCS_BYTES) * 10));
            onProgress?.({
                message: `Extracting Xbox SDK docs… ${formatBytes(bytes)}`,
                percent: pct,
            });
        });
    }, 500);

    try {
        await execFileAsync('tar', ['-xzf', archivePath, '-C', destParent], {
            timeout: 300_000,
            windowsHide: true,
        });
    } finally {
        finished = true;
        clearInterval(pollTimer);
    }

    if (!fs.existsSync(path.join(staged, 'toc.json'))) {
        throw new Error('Extracted archive did not contain xboxsdk/toc.json');
    }
}

/** Download and extract the latest RXDK-Docs release archive. */
export async function fetchLatestDocs(
    context: vscode.ExtensionContext,
    output?: vscode.OutputChannel,
    onProgress?: DocsInstallProgress
): Promise<boolean> {
    const staged = getStagedDocsRoot(context);
    const destParent = path.dirname(staged);
    const archivePath = path.join(os.tmpdir(), `rxdk-${DOCS_ARCHIVE_NAME}`);

    onProgress?.({ message: 'Resolving latest RXDK-Docs release…', percent: 2 });
    const { url, tag } = await resolveDocsDownloadUrl(context);
    output?.appendLine(`RXDK: downloading Xbox SDK docs (${tag}) from ${url}`);

    try {
        if (fs.existsSync(archivePath)) {
            fs.unlinkSync(archivePath);
        }
    } catch {
        /* ignore */
    }

    onProgress?.({ message: `Downloading Xbox SDK docs (${tag})…`, percent: 5 });
    let lastLoggedPercent = -1;
    await downloadFileToPath(url, archivePath, (progress) => {
        const message = formatDownloadProgress(progress.bytesReceived, progress.totalBytes);
        const percent =
            progress.percent !== undefined ? 5 + Math.round(progress.percent * 0.78) : undefined;
        onProgress?.({ message, percent });
        if (
            progress.percent !== undefined &&
            output &&
            (progress.percent === 0 ||
                progress.percent >= lastLoggedPercent + 5 ||
                progress.percent === 100)
        ) {
            lastLoggedPercent = progress.percent;
            output.appendLine(`RXDK: ${message}`);
        }
    });

    onProgress?.({ message: 'Extracting Xbox SDK docs…', percent: 85 });
    output?.appendLine(`RXDK: extracting docs to ${destParent}`);
    await extractDocsArchive(archivePath, destParent, staged, onProgress);

    try {
        fs.unlinkSync(archivePath);
    } catch {
        /* ignore */
    }

    output?.appendLine(`RXDK: Xbox SDK docs ready at ${staged}`);
    onProgress?.({ message: 'Xbox SDK docs ready', percent: 100 });
    return true;
}

/**
 * Docs are installed via RXDK Setup prerequisites; this only logs status.
 */
export async function ensureSdkDocsStaging(
    context: vscode.ExtensionContext,
    output?: vscode.OutputChannel
): Promise<void> {
    const staged = getStagedDocsRoot(context);
    if (isSdkDocsPresent(context)) {
        output?.appendLine(`RXDK: Xbox SDK docs present at ${staged}`);
        return;
    }
    output?.appendLine('RXDK: Xbox SDK docs not installed — open RXDK Setup to install.');
}

/** Resolved docs root for the in-editor viewer. */
export function resolveSdkDocsRoot(context: vscode.ExtensionContext): string {
    return getStagedDocsRoot(context);
}
