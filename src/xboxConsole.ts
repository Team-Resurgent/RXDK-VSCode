import type * as vscode from 'vscode';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const REG_KEY = 'Software\\Microsoft\\XboxSDK';
const REG_VALUE = 'XboxName';

// 'vscode' only resolves inside the extension host. getActiveXboxAddress (and
// everything it calls) also needs to run as a plain `node` process spawned from a
// generated VS Code task -- outside the extension host -- so the import above is
// type-only and every real access goes through this lazy, failure-tolerant getter.
function tryVscode(): typeof vscode | undefined {
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        return require('vscode');
    } catch {
        return undefined;
    }
}

export function isWindowsHost(): boolean {
    return process.platform === 'win32';
}

/** Workspace / user settings JSON (`rxdk.defaultConsole` or `xbox.defaultConsole`). Empty outside the extension host. */
export function getWorkspaceXboxAddress(): string {
    const vs = tryVscode();
    if (!vs) {
        return '';
    }
    return (
        vs.workspace.getConfiguration('rxdk').get<string>('defaultConsole') ||
        vs.workspace.getConfiguration('xbox').get<string>('defaultConsole') ||
        ''
    ).trim();
}

/** @deprecated Use getWorkspaceXboxAddress */
export function getConfiguredXboxAddress(): string {
    return getWorkspaceXboxAddress();
}

export type XboxAddressSource = 'workspace' | 'registry' | 'none';

export interface XboxAddressInfo {
    address?: string;
    source: XboxAddressSource;
}

/**
 * Active Xbox target for deploy/debug. Single source of truth per platform:
 * Windows: the registry (XBSetIP / Neighborhood) — no settings-JSON override.
 * macOS/Linux: workspace or user settings JSON (no registry).
 */
export async function getActiveXboxAddress(): Promise<string | undefined> {
    if (isWindowsHost()) {
        return readRegistryXboxName();
    }
    const fromSettings = getWorkspaceXboxAddress();
    return fromSettings || undefined;
}

/** Sidebar / status: where the active Xbox address comes from. */
export async function getXboxAddressInfo(): Promise<XboxAddressInfo> {
    if (isWindowsHost()) {
        const fromReg = await readRegistryXboxName();
        if (fromReg) {
            return { address: fromReg, source: 'registry' };
        }
        return { source: 'none' };
    }

    const fromSettings = getWorkspaceXboxAddress();
    if (fromSettings) {
        return { address: fromSettings, source: 'workspace' };
    }
    return { source: 'none' };
}

export async function setActiveXboxAddress(address: string): Promise<void> {
    const trimmed = address.trim();
    if (!trimmed) {
        throw new Error('Xbox address cannot be empty.');
    }
    const err = validateXboxAddress(trimmed);
    if (err) {
        throw new Error(err);
    }

    if (isWindowsHost()) {
        // Windows: the registry is the single source of truth (XBSetIP / Neighborhood).
        // Deliberately do NOT mirror into settings JSON — a stale JSON value must
        // never shadow the registry.
        await writeRegistryXboxName(trimmed);
        return;
    }

    // macOS/Linux: no registry — settings JSON is the source of truth.
    const vs = tryVscode();
    if (!vs) {
        throw new Error('setActiveXboxAddress requires running inside the VS Code extension host.');
    }
    const target = vs.workspace.workspaceFolders?.length
        ? vs.ConfigurationTarget.Workspace
        : vs.ConfigurationTarget.Global;
    await vs.workspace.getConfiguration('rxdk').update('defaultConsole', trimmed, target);
    await vs.workspace.getConfiguration('xbox').update('defaultConsole', trimmed, target);
}

export async function promptSetXboxIp(): Promise<void> {
    const vs = tryVscode();
    if (!vs) {
        return;
    }
    const current = (await getActiveXboxAddress()) ?? '';
    const value = await vs.window.showInputBox({
        title: 'Set Xbox IP / Hostname',
        prompt: isWindowsHost()
            ? 'IP or hostname for xbcp, xbox-launch, and debug. Saved to the Windows registry (XBSetIP / Neighborhood).'
            : 'IP or hostname for xbcp, xbox-launch, and debug. Saved to VS Code settings JSON (workspace or user).',
        value: current,
        placeHolder: 'e.g. 192.168.1.100 or xbox-devkit',
        validateInput: (v) => {
            const t = v.trim();
            if (!t) {
                return 'Enter an IP address or hostname';
            }
            return validateXboxAddress(t);
        },
    });
    if (value === undefined) {
        return;
    }

    try {
        await setActiveXboxAddress(value);
        vs.window.showInformationMessage(`Xbox address set to: ${value.trim()}`);
    } catch (e) {
        vs.window.showErrorMessage((e as Error).message);
    }
}

function validateXboxAddress(address: string): string | null {
    if (address.length > 255) {
        return 'Address is too long (max 255 characters)';
    }
    if (/\s/.test(address)) {
        return 'Address cannot contain spaces';
    }
    const ipv4 =
        /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/.test(address);
    const hostname = /^[a-zA-Z][a-zA-Z0-9._-]*$/.test(address);
    if (!ipv4 && !hostname) {
        return 'Enter a valid IPv4 address or hostname';
    }
    return null;
}

/** Windows only: Xbox SDK registry + Neighborhood fallback. */
export async function readRegistryXboxName(): Promise<string | undefined> {
    if (!isWindowsHost()) {
        return undefined;
    }

    for (const hive of ['HKCU', 'HKLM'] as const) {
        const xboxName = (await readRawRegistryValue(hive, REG_KEY, REG_VALUE))?.trim();
        if (xboxName && (await isResolvableXboxTarget(xboxName))) {
            return resolveXboxTarget(xboxName, await readShellExtAddresses(hive));
        }
    }

    const fromNeighborhood = await readNeighborhoodXboxAddress();
    if (fromNeighborhood) {
        return fromNeighborhood;
    }

    for (const hive of ['HKCU', 'HKLM'] as const) {
        const xboxName = (await readRawRegistryValue(hive, REG_KEY, REG_VALUE))?.trim();
        if (xboxName) {
            return resolveXboxTarget(xboxName, await readShellExtAddresses(hive));
        }
    }
    return undefined;
}

function isIpv4Address(address: string): boolean {
    return /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/.test(address);
}

async function readShellExtAddresses(hive: 'HKCU' | 'HKLM'): Promise<Record<string, string>> {
    return readRegKeyValues(`${hive}\\Software\\Microsoft\\XboxSDK\\xbshlext\\Addresses`);
}

function resolveXboxTarget(nameOrAddress: string, addresses: Record<string, string>): string {
    if (isIpv4Address(nameOrAddress)) {
        return nameOrAddress;
    }
    return addresses[nameOrAddress] ?? nameOrAddress;
}

async function isResolvableXboxTarget(nameOrAddress: string): Promise<boolean> {
    if (isIpv4Address(nameOrAddress)) {
        return true;
    }
    for (const hive of ['HKCU', 'HKLM'] as const) {
        const addresses = await readShellExtAddresses(hive);
        if (nameOrAddress in addresses) {
            return true;
        }
    }
    return false;
}

async function readNeighborhoodXboxAddress(): Promise<string | undefined> {
    for (const hive of ['HKCU', 'HKLM'] as const) {
        const addresses = await readShellExtAddresses(hive);
        const consoles = await readRegKeyValues(`${hive}\\Software\\Microsoft\\XboxSDK\\xbshlext\\Consoles`);
        for (const name of Object.keys(consoles)) {
            if (name === '(default)') {
                continue;
            }
            const address = addresses[name]?.trim();
            if (address && validateXboxAddress(address) === null) {
                return address;
            }
        }

        const rxdk = await readRegKeyValues(`${hive}\\Software\\Microsoft\\XboxSDK\\RXDKNeighborhood\\Consoles`);
        for (const key of Object.keys(rxdk)) {
            if (validateXboxAddress(key) === null) {
                return key;
            }
        }
    }
    return undefined;
}

async function readRawRegistryValue(
    hive: 'HKCU' | 'HKLM',
    subkey: string,
    valueName: string
): Promise<string | undefined> {
    const fromPs = await readRegistryViaPowerShell(hive, subkey, valueName);
    if (fromPs) {
        return fromPs;
    }
    return readRegistryViaRegExe(hive, subkey, valueName);
}

async function readRegKeyValues(keyPath: string): Promise<Record<string, string>> {
    try {
        const { stdout } = await execFileAsync('reg.exe', ['query', keyPath], {
            windowsHide: true,
            encoding: 'utf8',
        });
        const values: Record<string, string> = {};
        for (const line of stdout.split(/\r?\n/)) {
            const match = line.trim().match(/^(\S+)\s+REG_SZ\s+(.+)$/i);
            if (match) {
                values[match[1]] = match[2].trim();
            }
        }
        return values;
    } catch {
        return {};
    }
}

async function readRegistryViaPowerShell(
    hive: 'HKCU' | 'HKLM',
    subkey: string = REG_KEY,
    valueName: string = REG_VALUE
): Promise<string | undefined> {
    const script = [
        `$k = "${hive}:\\${subkey}"`,
        'if (Test-Path -LiteralPath $k) {',
        `  $v = (Get-ItemProperty -LiteralPath $k -Name ${valueName} -ErrorAction SilentlyContinue).${valueName}`,
        '  if ($v) { Write-Output $v }',
        '}',
    ].join('; ');
    try {
        const { stdout } = await execFileAsync(
            'powershell.exe',
            ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
            { windowsHide: true, encoding: 'utf8' }
        );
        const val = stdout.trim();
        return val || undefined;
    } catch {
        return undefined;
    }
}

async function readRegistryViaRegExe(
    hive: 'HKCU' | 'HKLM',
    subkey: string = REG_KEY,
    valueName: string = REG_VALUE
): Promise<string | undefined> {
    try {
        const { stdout } = await execFileAsync(
            'reg.exe',
            ['query', `${hive}\\${subkey}`, '/v', valueName],
            { windowsHide: true, encoding: 'utf8' }
        );
        const match = stdout.match(new RegExp(`${valueName}\\s+REG_SZ\\s+(.+)`, 'i'));
        return match?.[1]?.trim() || undefined;
    } catch {
        return undefined;
    }
}

async function writeRegistryXboxName(address: string): Promise<void> {
    const escaped = address.replace(/'/g, "''");
    const script = [
        "New-Item -Path 'HKCU:\\Software\\Microsoft\\XboxSDK' -Force | Out-Null",
        `Set-ItemProperty -LiteralPath 'HKCU:\\Software\\Microsoft\\XboxSDK' -Name XboxName -Value '${escaped}'`,
    ].join('; ');
    await execFileAsync('powershell.exe', ['-NoProfile', '-Command', script], { windowsHide: true });
}
