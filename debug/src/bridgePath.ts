import * as fs from 'fs';
import * as path from 'path';

/** Managed Rxdk.XboxDbgBridge.Cli host (self-contained; no xboxdbg.dll). */
export function platformToolRid(): string {
    if (process.platform === 'win32') {
        return 'win-x64';
    }
    if (process.platform === 'linux') {
        return 'linux-x64';
    }
    if (process.platform === 'darwin') {
        return process.arch === 'arm64' ? 'osx-arm64' : 'osx-x64';
    }
    return 'win-x64';
}

export function bridgeExecutableName(): string {
    return process.platform === 'win32' ? 'xboxdbg-bridge.exe' : 'xboxdbg-bridge';
}

export function defaultBridgeCandidates(extensionPath: string, workspaceRoot: string): string[] {
    const name = bridgeExecutableName();
    const rid = platformToolRid();
    return [
        path.join(extensionPath, 'out', 'sdk', 'tools', rid, name),
        path.join(extensionPath, 'out', 'sdk', 'tools', name),
        path.join(workspaceRoot, 'external', 'RXDK-Tools', 'out', 'publish', 'rxdk-vscode-win-x64', name),
        path.join(workspaceRoot, 'external', 'RXDK-Tools', 'out', 'publish', 'managed-cli-tools-win-x64', name),
        path.join(workspaceRoot, 'external', 'RXDK-Tools', 'out', 'bin', 'x64', 'Release', name),
    ];
}

export function resolveBridgePath(options: {
    extensionPath: string;
    workspaceRoot: string;
    override?: string;
    envPath?: string | undefined;
}): string {
    if (options.override) {
        const expanded = options.override
            .replace(/\$\{workspaceFolder\}/g, options.workspaceRoot)
            .replace(/\$\{extensionInstallPath\}/g, options.extensionPath);
        if (fs.existsSync(expanded)) {
            return expanded;
        }
    }

    const envPath = options.envPath ?? process.env.XBOX_BRIDGE_PATH;
    if (envPath && fs.existsSync(envPath)) {
        return envPath;
    }

    for (const candidate of defaultBridgeCandidates(options.extensionPath, options.workspaceRoot)) {
        if (candidate && fs.existsSync(candidate)) {
            return candidate;
        }
    }

    throw new Error(
        `${bridgeExecutableName()} not found. Set xbox.bridgePath, run scripts/sync-all.ps1 -Build, or reinstall the RXDK extension.`
    );
}
