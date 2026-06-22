import * as fs from 'fs';
import * as path from 'path';

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

export function defaultBridgeCandidates(extensionPath: string, workspaceRoot?: string): string[] {
    const name = bridgeExecutableName();
    const rid = platformToolRid();
    const candidates = [
        path.join(extensionPath, 'sdk', 'tools', rid, name),
        path.join(extensionPath, 'sdk', 'tools', name),
        path.join(extensionPath, 'out', 'sdk', 'tools', rid, name),
        path.join(extensionPath, 'out', 'sdk', 'tools', name),
    ];
    if (workspaceRoot) {
        candidates.push(
            path.join(workspaceRoot, 'external', 'RXDK-Tools', 'out', 'publish', 'rxdk-vscode-win-x64', name),
            path.join(workspaceRoot, 'external', 'RXDK-Tools', 'out', 'publish', 'managed-cli-tools-win-x64', name),
            path.join(workspaceRoot, 'external', 'RXDK-Tools', 'out', 'bin', 'x64', 'Release', name)
        );
    }
    return candidates;
}

export function resolveBundledBridgePath(extensionPath: string, workspaceRoot?: string): string {
    const configured = process.env.XBOX_BRIDGE_PATH;
    if (configured && fs.existsSync(configured)) {
        return configured;
    }
    for (const candidate of defaultBridgeCandidates(extensionPath, workspaceRoot)) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }
    return path.join(extensionPath, 'sdk', 'tools', bridgeExecutableName());
}
