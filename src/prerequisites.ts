import { execFile } from 'child_process';
import { promisify } from 'util';
import * as vscode from 'vscode';
import { DOTNET_MAJOR_VERSION, installDotNetRuntime, isDotNetRuntimeInstalled } from './dotnetRuntime';
import { DEFAULT_SDK_GIT_URL, fetchLatestSdk, getStagedSdkRoot, isStagedSdkPresent } from './sdkStaging';
import { getZigVersionLine, installZig, isZigInstalled, ZIG_DOWNLOAD_PAGE, ZIG_VERSION } from './zigRuntime';

const execFileAsync = promisify(execFile);

export type PrerequisiteId = 'dotnet' | 'sdk' | 'zig';

export interface PrerequisiteStatus {
    id: PrerequisiteId;
    label: string;
    description: string;
    ready: boolean;
    detail?: string;
    canInstall: boolean;
    downloadUrl?: string;
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
    const [dotnetReady, sdkReady, zigReady, gitReady] = await Promise.all([
        isDotNetRuntimeInstalled(),
        Promise.resolve(isStagedSdkPresent(context)),
        isZigInstalled(),
        isGitAvailable(),
    ]);

    const sdkPath = getStagedSdkRoot(context);
    const zigLine = zigReady ? await getZigVersionLine() : undefined;

    return [
        {
            id: 'dotnet',
            label: `.NET ${DOTNET_MAJOR_VERSION} runtime`,
            description: 'Required for deploy, debug, and other managed host tools.',
            ready: dotnetReady,
            detail: dotnetReady ? 'Installed' : 'Not found',
            canInstall: true,
            downloadUrl: 'https://dotnet.microsoft.com/download/dotnet/8.0',
        },
        {
            id: 'sdk',
            label: 'RXDK-SDK',
            description: 'Headers and libraries cloned from GitHub on first use.',
            ready: sdkReady,
            detail: sdkReady
                ? sdkPath
                : gitReady
                  ? `Not installed (${sdkPath})`
                  : 'Install Git, then clone RXDK-SDK',
            canInstall: gitReady,
            downloadUrl: DEFAULT_SDK_GIT_URL.replace(/\.git$/, ''),
        },
        {
            id: 'zig',
            label: `Zig ${ZIG_VERSION}`,
            description: 'Required for some RXDK build tooling and cross-compilation workflows.',
            ready: zigReady,
            detail: zigReady ? (zigLine ?? 'Installed') : 'Not found',
            canInstall: Boolean(process.platform === 'win32' || process.platform === 'linux' || process.platform === 'darwin'),
            downloadUrl: ZIG_DOWNLOAD_PAGE,
        },
    ];
}

export async function arePrerequisitesReady(context: vscode.ExtensionContext): Promise<boolean> {
    const statuses = await getPrerequisiteStatuses(context);
    return statuses.every((item) => item.ready);
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

export async function installPrerequisite(
    context: vscode.ExtensionContext,
    id: PrerequisiteId,
    output?: vscode.OutputChannel,
    progress?: PrerequisiteInstallProgress
): Promise<boolean> {
    switch (id) {
        case 'dotnet':
            return installDotNetRuntime(output, (update) => progress?.report(update));
        case 'sdk':
            return fetchLatestSdk(context, output, (update) => progress?.report(update));
        case 'zig':
            return installZig(output, (update) => progress?.report(update));
        default:
            return false;
    }
}
