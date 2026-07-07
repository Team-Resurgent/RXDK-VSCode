import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// This module is intentionally free of any `vscode` import: it runs both inside
// the extension host and inside the plain-node CLI (src/cli.ts) that generated
// VS Code tasks spawn. Keep it dependency-light.

/**
 * Where the extension installs the private .NET runtime (see dotnetRuntime.ts,
 * `dotnet-install.sh --install-dir`). This is a NON-standard location: the .NET
 * apphost that fronts our framework-dependent host tools (imagebld, xbcp, …) does
 * not probe here by default — on macOS/Linux it looks at DOTNET_ROOT, the
 * registered install location, then /usr/local/share/dotnet. So unless we point
 * DOTNET_ROOT at this dir, the tools fail with "you must install .NET".
 */
export function managedDotnetRoot(): string {
    return path.join(os.homedir(), '.dotnet');
}

/** True if a shared runtime actually lives under the managed root. */
function managedRuntimeExists(): boolean {
    return fs.existsSync(path.join(managedDotnetRoot(), 'shared', 'Microsoft.NETCore.App'));
}

/**
 * Return a copy of `base` augmented so framework-dependent host tools can locate
 * the extension-managed .NET runtime: sets DOTNET_ROOT (unless already set — we
 * never clobber a runtime the user pointed us at) and prepends it to PATH. If no
 * managed runtime is present, `base` is returned unchanged so a system-wide
 * `dotnet` keeps winning.
 */
export function withManagedDotnet(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
    if (!managedRuntimeExists()) {
        return base;
    }
    const root = managedDotnetRoot();
    const env: NodeJS.ProcessEnv = { ...base };

    if (!env.DOTNET_ROOT) {
        env.DOTNET_ROOT = root;
    }

    // PATH is spelled "Path" on Windows; reuse whatever casing the inherited env
    // already has so we prepend rather than create a shadow entry.
    const pathKey = Object.keys(env).find((k) => k.toLowerCase() === 'path') ?? 'PATH';
    const sep = process.platform === 'win32' ? ';' : ':';
    const current = env[pathKey] ?? '';
    if (!current.split(sep).includes(root)) {
        env[pathKey] = current ? `${root}${sep}${current}` : root;
    }
    return env;
}

/**
 * Apply {@link withManagedDotnet} to the current process's own environment, so
 * every child it later spawns inherits DOTNET_ROOT/PATH. Call once at extension
 * activation and at CLI startup. No-op when no managed runtime is present.
 */
export function applyManagedDotnetToProcess(): void {
    const merged = withManagedDotnet(process.env);
    if (merged !== process.env) {
        Object.assign(process.env, merged);
    }
}
