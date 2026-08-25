import { execFile } from 'child_process';
import { promisify } from 'util';
import * as vscode from 'vscode';
import { DOTNET_MAJOR_VERSION, installDotNetRuntime, isDotNetRuntimeInstalled } from './dotnetRuntime';
import {
    DEFAULT_DOCS_REPO_PAGE,
    fetchLatestDocs,
    getStagedDocsRoot,
    isSdkDocsPresent,
    readDocsVersion,
} from './sdkDocsStaging';
import { DEFAULT_SDK_GIT_URL, fetchLatestSdk, getStagedSdkRoot, isStagedSdkPresent } from './sdkStaging';
import { readSdkVersion } from './sdkPath';
import {
    DEFAULT_SAMPLES_REPO_PAGE,
    fetchLatestSamples,
    getStagedSamplesRoot,
    isSamplesPresent,
    readSamplesVersion,
} from './samplesStaging';
import { getStagedToolsRoot, installHostTools, isHostToolsInstalled, readToolsVersion } from './hostTools';
import { getZigVersionLine, installZig, isZigInstalled, ZIG_DOWNLOAD_PAGE, ZIG_VERSION } from './zigRuntime';
import { installXboxNeighborhood, isXboxNeighborhoodShellRegistered } from './xboxNeighborhoodShell';
import { fetchLatestRepoVersion, isVersionNewer, versionsMatch } from './latestVersions';

const execFileAsync = promisify(execFile);

export type PrerequisiteId = 'dotnet' | 'sdk' | 'docs' | 'zig' | 'tools' | 'samples' | 'xbneighborhood';

/** All prerequisites must be installed before RXDK is enabled. */
export const MANDATORY_PREREQUISITE_IDS: readonly PrerequisiteId[] = [
    'dotnet',
    'sdk',
    'docs',
    'zig',
    'tools',
];

export interface PrerequisiteStatus {
    id: PrerequisiteId;
    label: string;
    description: string;
    ready: boolean;
    required: boolean;
    detail?: string;
    canInstall: boolean;
    downloadUrl?: string;
    /** Installed version (e.g. "v1.0.7"), when the component tracks one. */
    version?: string;
    /** Latest published version, when it could be determined (best-effort). */
    latestVersion?: string;
    /** True when installed and a newer version is available. */
    updateAvailable?: boolean;
    /** True when the latest published version is newer than the loaded extension can use, so the
     *  update is withheld until the extension itself is updated. */
    blockedByExtension?: boolean;
    /** The extension version the user must upgrade to in order to get `latestVersion`. */
    requiredExtensionVersion?: string;
}

let prerequisitesReadyCache = false;

export function isPrerequisitesReadySync(): boolean {
    return prerequisitesReadyCache;
}

export async function isGitAvailable(): Promise<boolean> {
    try {
        await execFileAsync('git', ['--version'], { windowsHide: true });
        return true;
    } catch {
        return false;
    }
}

export async function getPrerequisiteStatuses(
    context: vscode.ExtensionContext
): Promise<PrerequisiteStatus[]> {
    const [
        dotnetReady,
        sdkReady,
        docsReady,
        zigReady,
        toolsReady,
        samplesReady,
        gitReady,
        xbNeighborhoodReady,
    ] = await Promise.all([
        isDotNetRuntimeInstalled(),
        Promise.resolve(isStagedSdkPresent(context)),
        Promise.resolve(isSdkDocsPresent(context)),
        isZigInstalled(),
        Promise.resolve(isHostToolsInstalled()),
        Promise.resolve(isSamplesPresent(context)),
        isGitAvailable(),
        isXboxNeighborhoodShellRegistered(),
    ]);

    const sdkPath = getStagedSdkRoot(context);
    const docsPath = getStagedDocsRoot(context);
    const toolsPath = getStagedToolsRoot();
    const samplesPath = getStagedSamplesRoot(context);
    const zigLine = zigReady ? await getZigVersionLine() : undefined;

    // Installed versions + newest published versions (best-effort; latest lookups are network calls
    // bounded by a short timeout and may resolve undefined offline). A "versioned" helper attaches
    // version / latestVersion / updateAvailable so the panel can show an "up to date" hint.
    // Always fetch latest (not just when installed) so the extension-compatibility gate applies to
    // fresh installs too — a first install must not pull a component newer than the extension.
    const [latestSdk, latestDocs, latestTools, latestSamples] = await Promise.all([
        fetchLatestRepoVersion('RXDK-SDK'),
        fetchLatestRepoVersion('RXDK-Docs'),
        fetchLatestRepoVersion('RXDK-Tools'),
        fetchLatestRepoVersion('RXDK-Samples'),
    ]);
    // The loaded extension's version is the compatibility ceiling: a component whose latest published
    // version is newer must not be pulled (it may need extension features that aren't here yet). Such
    // a component is marked blockedByExtension and its update is withheld until the extension updates.
    const extensionVersion = context.extension.packageJSON.version as string | undefined;
    const versioned = (ready: boolean, installed: string | undefined, latest: string | undefined) => {
        const version = ready && installed && installed !== 'not installed' ? installed : undefined;
        const blockedByExtension = Boolean(latest && isVersionNewer(latest, extensionVersion));
        const updateAvailable =
            !blockedByExtension && Boolean(version && latest && !versionsMatch(version, latest));
        return {
            version,
            latestVersion: latest,
            updateAvailable,
            blockedByExtension,
            requiredExtensionVersion: blockedByExtension ? latest : undefined,
        };
    };

    const statuses: PrerequisiteStatus[] = [
        {
            id: 'dotnet',
            label: `.NET ${DOTNET_MAJOR_VERSION} runtime`,
            description: 'Required for deploy, debug, and other managed host tools.',
            ready: dotnetReady,
            required: true,
            detail: dotnetReady ? 'Installed' : 'Not found',
            canInstall: true,
            downloadUrl: 'https://dotnet.microsoft.com/download/dotnet/8.0',
        },
        {
            id: 'sdk',
            label: 'RXDK-SDK',
            description: 'Required headers and libraries cloned from GitHub.',
            ready: sdkReady,
            required: true,
            detail: sdkReady
                ? sdkPath
                : gitReady
                  ? `Not installed (${sdkPath})`
                  : 'Install Git, then clone RXDK-SDK',
            canInstall: gitReady,
            downloadUrl: DEFAULT_SDK_GIT_URL.replace(/\.git$/, ''),
            ...versioned(sdkReady, readSdkVersion(context), latestSdk),
        },
        {
            id: 'docs',
            label: 'Documentation',
            description: 'In-editor HTML docs (Xbox SDK reference + RXDK guide) cloned from RXDK-Docs.',
            ready: docsReady,
            required: true,
            detail: docsReady
                ? docsPath
                : gitReady
                  ? `Not installed (${docsPath})`
                  : 'Install Git, then clone RXDK-Docs',
            canInstall: gitReady,
            downloadUrl: DEFAULT_DOCS_REPO_PAGE,
            ...versioned(docsReady, readDocsVersion(context), latestDocs),
        },
        {
            id: 'zig',
            label: `Zig ${ZIG_VERSION}`,
            description: 'Required for some RXDK build tooling and cross-compilation workflows.',
            ready: zigReady,
            required: true,
            detail: zigReady ? (zigLine ?? 'Installed') : 'Not found',
            canInstall: Boolean(process.platform === 'win32' || process.platform === 'linux' || process.platform === 'darwin'),
            downloadUrl: ZIG_DOWNLOAD_PAGE,
            // Zig is pinned to a specific version, so "installed" is always the current one.
            ...(zigReady ? { version: ZIG_VERSION, latestVersion: ZIG_VERSION, updateAvailable: false } : {}),
        },
        {
            id: 'tools',
            label: 'RXDK host tools',
            description: 'Required imagebld, xdvdfs, xbcp, and debug tools downloaded for your platform.',
            ready: toolsReady,
            required: true,
            detail: toolsReady ? toolsPath : `Not installed (${toolsPath})`,
            canInstall: true,
            downloadUrl: 'https://github.com/Team-Resurgent/RXDK-Tools/releases/latest',
            ...versioned(toolsReady, readToolsVersion(), latestTools),
        },
        {
            id: 'samples',
            label: 'RXDK-Samples',
            description: 'Optional. Xbox sample projects cloned from GitHub — browse/open them with "RXDK: Open Sample".',
            ready: samplesReady,
            required: false,
            detail: samplesReady
                ? samplesPath
                : gitReady
                  ? `Not installed (${samplesPath})`
                  : 'Install Git, then clone RXDK-Samples',
            canInstall: gitReady,
            downloadUrl: DEFAULT_SAMPLES_REPO_PAGE,
            ...versioned(samplesReady, readSamplesVersion(context), latestSamples),
        },
    ];

    // Optional, Windows-only: the Xbox Neighborhood Explorer shell integration.
    // Detected via the registered shell-extension CLSID (same signal the sidebar
    // uses). Not required, so it never blocks RXDK readiness.
    if (process.platform === 'win32') {
        statuses.push({
            id: 'xbneighborhood',
            label: 'Xbox Neighborhood',
            description:
                'Optional. Explorer shell integration for browsing your devkit’s drives (adds Xbox Neighborhood to This PC).',
            ready: xbNeighborhoodReady,
            required: false,
            detail: xbNeighborhoodReady ? 'Installed and registered' : 'Not installed',
            canInstall: true,
            downloadUrl: 'https://github.com/Team-Resurgent/RXDK-Tools/releases/latest',
        });
    }

    return statuses;
}

export async function arePrerequisitesReady(context: vscode.ExtensionContext): Promise<boolean> {
    const statuses = await getPrerequisiteStatuses(context);
    return statuses.filter((item) => item.required).every((item) => item.ready);
}

export async function refreshPrerequisitesContext(context: vscode.ExtensionContext): Promise<boolean> {
    const ready = await arePrerequisitesReady(context);
    prerequisitesReadyCache = ready;
    await vscode.commands.executeCommand('setContext', 'rxdk.prerequisitesReady', ready);
    return ready;
}

export interface PrerequisiteInstallProgress {
    report: (update: { message: string; percent?: number }) => void;
}

/** Repo whose VERSION governs each versioned component (for the extension-compatibility gate). */
const COMPONENT_REPO: Partial<Record<PrerequisiteId, string>> = {
    sdk: 'RXDK-SDK',
    docs: 'RXDK-Docs',
    tools: 'RXDK-Tools',
    samples: 'RXDK-Samples',
};

/**
 * True when the component's latest published version is newer than the loaded extension can use.
 * The install/update is then withheld and the user is told to update the extension first — this keeps
 * the extension, host tools, SDK, and docs on a mutually compatible version. Fails safe (offline →
 * not blocked) so a transient network issue never wedges an install.
 */
async function isComponentBlockedByExtension(
    context: vscode.ExtensionContext,
    id: PrerequisiteId
): Promise<{ blocked: boolean; latest?: string }> {
    const repo = COMPONENT_REPO[id];
    if (!repo) {
        return { blocked: false };
    }
    const latest = await fetchLatestRepoVersion(repo);
    const extensionVersion = context.extension.packageJSON.version as string | undefined;
    return { blocked: isVersionNewer(latest, extensionVersion), latest };
}

export async function installPrerequisite(
    context: vscode.ExtensionContext,
    id: PrerequisiteId,
    output?: vscode.OutputChannel,
    progress?: PrerequisiteInstallProgress
): Promise<boolean> {
    const gate = await isComponentBlockedByExtension(context, id);
    if (gate.blocked) {
        const ext = context.extension.packageJSON.version;
        void vscode.window.showWarningMessage(
            `A newer ${id.toUpperCase()} (${gate.latest}) is available but needs a newer RXDK extension ` +
                `than the one loaded (v${ext}). Update the RXDK for VS Code extension first, then update ${id}.`,
            'Open Extensions'
        ).then((choice) => {
            if (choice === 'Open Extensions') {
                void vscode.commands.executeCommand('workbench.extensions.search', 'TeamResurgent.rxdk-vscode');
            }
        });
        output?.appendLine(`RXDK: ${id} update withheld — extension v${ext} is older than ${id} ${gate.latest}. Update the extension first.`);
        return false;
    }
    switch (id) {
        case 'dotnet':
            return installDotNetRuntime(output, (update) => progress?.report(update));
        case 'sdk':
            return fetchLatestSdk(context, output, (update) => progress?.report(update));
        case 'docs':
            return fetchLatestDocs(context, output, (update) => progress?.report(update));
        case 'zig':
            return installZig(output, (update) => progress?.report(update));
        case 'tools':
            return installHostTools(output, (update) => progress?.report(update));
        case 'samples':
            return fetchLatestSamples(context, output, (update) => progress?.report(update));
        case 'xbneighborhood':
            return installXboxNeighborhood(output, (update) => progress?.report(update));
        default:
            return false;
    }
}
