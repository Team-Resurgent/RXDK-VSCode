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

export function hostToolExecutableName(baseName: string): string {
    return process.platform === 'win32' ? `${baseName}.exe` : baseName;
}

export function bridgeExecutableName(): string {
    return hostToolExecutableName('xboxdbg-bridge');
}

export function xbwatsonExecutableName(): string {
    return hostToolExecutableName('xbwatson');
}

// Last-resort locations for a host tool inside the extension install. The primary
// source is the staged tools root populated by the host-tools prerequisite (see
// src/hostTools.ts) or scripts/setup.ps1; these bundled paths only matter if
// neither has run.
export function defaultHostToolCandidates(extensionPath: string, baseName: string): string[] {
    const name = hostToolExecutableName(baseName);
    const rid = platformToolRid();
    return [
        path.join(extensionPath, 'sdk', 'tools', rid, name),
        path.join(extensionPath, 'sdk', 'tools', name),
        path.join(extensionPath, 'out', 'sdk', 'tools', rid, name),
        path.join(extensionPath, 'out', 'sdk', 'tools', name),
    ];
}

export function defaultBridgeCandidates(extensionPath: string): string[] {
    return defaultHostToolCandidates(extensionPath, 'xboxdbg-bridge');
}

export function resolveBundledHostToolPath(extensionPath: string, baseName: string): string {
    for (const candidate of defaultHostToolCandidates(extensionPath, baseName)) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }
    return path.join(extensionPath, 'sdk', 'tools', hostToolExecutableName(baseName));
}

export function resolveBundledBridgePath(extensionPath: string): string {
    const configured = process.env.XBOX_BRIDGE_PATH;
    if (configured && fs.existsSync(configured)) {
        return configured;
    }
    return resolveBundledHostToolPath(extensionPath, 'xboxdbg-bridge');
}

export function resolveBundledXbwatsonPath(extensionPath: string): string {
    const configured = process.env.RXDK_XBWATSON_PATH;
    if (configured && fs.existsSync(configured)) {
        return configured;
    }
    return resolveBundledHostToolPath(extensionPath, 'xbwatson');
}
