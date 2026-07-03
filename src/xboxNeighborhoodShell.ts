import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import * as vscode from 'vscode';
import { resolveRxdkToolsAssetUrl } from './hostTools';
import { downloadFileToPath, formatDownloadProgress } from './downloadFile';

const execFileAsync = promisify(execFile);

// The native Xbox Neighborhood shell namespace extension registers this CLSID
// (regsvr32 on Rxdk.XbShellExt.Shell.dll — see RXDK-Tools XbShellExtDev.psm1's
// Get-XbShellExtRegisteredPath / Repair-XbShellExtRegistry).
const XB_SHELL_CLSID = '{DB15FEDD-96B8-4DA9-97E0-7E5CCA05CC44}';
const XB_NEIGHBORHOOD_DIR = 'C:\\Program Files\\Xbox Neighborhood';
const XB_SHELL_DLL = 'Rxdk.XbShellExt.Shell.dll';
const XB_NEIGHBORHOOD_SETUP_ASSET = 'XboxNeighborhood-Setup.exe';

export function getXboxNeighborhoodDir(): string {
    return XB_NEIGHBORHOOD_DIR;
}

export function getXboxNeighborhoodShellDll(): string {
    return path.join(XB_NEIGHBORHOOD_DIR, XB_SHELL_DLL);
}

/**
 * True only on Windows when the Xbox Neighborhood shell namespace extension has
 * been registered (its CLSID's InprocServer32 default value is present). Used to
 * decide whether to surface the "Open Xbox Neighborhood" sidebar entry.
 */
export async function isXboxNeighborhoodShellRegistered(): Promise<boolean> {
    if (process.platform !== 'win32') {
        return false;
    }
    try {
        const { stdout } = await execFileAsync(
            'reg.exe',
            ['query', `HKCR\\CLSID\\${XB_SHELL_CLSID}\\InprocServer32`, '/ve'],
            { windowsHide: true, encoding: 'utf8' }
        );
        // A registered coclass has a non-empty (Default) InprocServer32 value.
        return /REG_(SZ|EXPAND_SZ)\s+\S/i.test(stdout);
    } catch {
        // reg.exe exits non-zero when the key doesn't exist -> not registered.
        return false;
    }
}

/**
 * Open the Xbox Neighborhood Explorer shell namespace via
 * `rundll32 Rxdk.XbShellExt.Shell.dll,OpenNamespace` (mirrors RXDK-Tools'
 * Open-XbShellExtNamespace).
 */
export async function openXboxNeighborhood(output?: vscode.OutputChannel): Promise<boolean> {
    if (process.platform !== 'win32') {
        vscode.window.showErrorMessage('Xbox Neighborhood shell integration is Windows-only.');
        return false;
    }

    const shellDll = getXboxNeighborhoodShellDll();
    if (!fs.existsSync(shellDll)) {
        vscode.window.showErrorMessage(`Xbox Neighborhood shell DLL not found at ${shellDll}.`);
        return false;
    }

    const rundll32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'rundll32.exe');
    try {
        const child = spawn(rundll32, [shellDll, 'OpenNamespace'], {
            cwd: getXboxNeighborhoodDir(),
            detached: true,
            stdio: 'ignore',
            windowsHide: false,
        });
        child.unref();
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        output?.appendLine(`RXDK: failed to open Xbox Neighborhood: ${message}`);
        vscode.window.showErrorMessage(`Failed to open Xbox Neighborhood: ${message}`);
        return false;
    }

    output?.appendLine('RXDK: opened Xbox Neighborhood shell namespace');
    return true;
}

/**
 * Download XboxNeighborhood-Setup.exe from the latest (or pinned) RXDK-Tools
 * release and launch it. The setup registers the Explorer shell namespace
 * extension (needs elevation), so it runs interactively — readiness flips once
 * isXboxNeighborhoodShellRegistered() sees the CLSID after the user finishes.
 */
export async function installXboxNeighborhood(
    output?: vscode.OutputChannel,
    onProgress?: (update: { message: string; percent?: number }) => void
): Promise<boolean> {
    if (process.platform !== 'win32') {
        vscode.window.showErrorMessage('Xbox Neighborhood is Windows-only.');
        return false;
    }

    onProgress?.({ message: 'Resolving XboxNeighborhood-Setup.exe…', percent: 2 });
    const { url, tag } = await resolveRxdkToolsAssetUrl(XB_NEIGHBORHOOD_SETUP_ASSET);
    output?.appendLine(`RXDK: Xbox Neighborhood installer ${tag}`);

    const dest = path.join(os.tmpdir(), `XboxNeighborhood-Setup-${Date.now()}.exe`);
    await downloadFileToPath(url, dest, (p) => {
        onProgress?.({
            message: formatDownloadProgress(p.bytesReceived, p.totalBytes),
            percent: p.percent !== undefined ? Math.min(95, Math.round(p.percent * 0.95)) : undefined,
        });
    });

    onProgress?.({ message: 'Launching installer…', percent: 97 });
    await new Promise<void>((resolve, reject) => {
        const child = spawn(dest, [], { detached: true, stdio: 'ignore', windowsHide: false });
        child.once('error', reject);
        child.once('spawn', () => {
            child.unref();
            resolve();
        });
    });

    output?.appendLine('RXDK: launched Xbox Neighborhood installer');
    onProgress?.({ message: 'Complete the installer, then click Refresh.', percent: 100 });
    vscode.window.showInformationMessage(
        'Xbox Neighborhood installer launched. Finish setup, then click Refresh in RXDK Setup.'
    );
    return true;
}
