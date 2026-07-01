import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { hostToolExecutableName, platformToolRid } from './bridgePath';
import { downloadFileToPath, formatDownloadProgress } from './downloadFile';
import { readZipEntries } from './unzip';

const RXDK_TOOLS_REPO = 'Team-Resurgent/RXDK-Tools';
const XDVDFS_REPO = 'Team-Resurgent/xdvdfs';

/**
 * Host tools that must be present for RXDK to build, pack, and deploy. Mirrors
 * scripts/required-tools.txt (kept here too because scripts/ is not shipped in the
 * VSIX). imagebld/xdvdfs build the ISO; xbcp/xbox-launch/xboxdbg-bridge/xbwatson
 * drive deploy and debug.
 */
export const REQUIRED_HOST_TOOLS = [
    'imagebld',
    'xbcp',
    'xbox-launch',
    'xboxdbg-bridge',
    'xbwatson',
    'xdvdfs',
] as const;

/** Default persistent tools root, a sibling of the staged SDK (…/RXDK/tools). */
export function getDefaultStagedToolsRoot(): string {
    if (process.platform === 'win32') {
        const programData = process.env.ProgramData || 'C:\\ProgramData';
        return path.join(programData, 'RXDK', 'tools');
    }
    if (process.platform === 'darwin') {
        return path.join(os.homedir(), 'Library', 'Application Support', 'RXDK', 'tools');
    }
    const xdg = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
    return path.join(xdg, 'rxdk', 'tools');
}

export function getStagedToolsRoot(): string {
    if (process.env.RXDK_STAGED_TOOLS?.trim()) {
        return path.normalize(process.env.RXDK_STAGED_TOOLS.trim());
    }
    try {
        const override = vscode.workspace.getConfiguration('rxdk').get<string>('stagedToolsPath')?.trim();
        if (override) {
            return path.normalize(override);
        }
    } catch {
        /* no workspace yet */
    }
    return getDefaultStagedToolsRoot();
}

/** Absolute path to a host tool in the staged tools root (may not exist yet). */
export function resolveHostTool(baseName: string): string {
    return path.join(getStagedToolsRoot(), hostToolExecutableName(baseName));
}

export function isHostToolsInstalled(): boolean {
    const root = getStagedToolsRoot();
    return REQUIRED_HOST_TOOLS.every((tool) =>
        fs.existsSync(path.join(root, hostToolExecutableName(tool)))
    );
}

function readConfig(key: string): string | undefined {
    try {
        return vscode.workspace.getConfiguration('rxdk').get<string>(key)?.trim() || undefined;
    } catch {
        return undefined;
    }
}

interface GitHubAsset {
    name: string;
    browser_download_url: string;
}
interface GitHubRelease {
    tag_name: string;
    assets: GitHubAsset[];
}

async function fetchRelease(repo: string, tag: string | undefined): Promise<GitHubRelease> {
    const url =
        tag && tag !== 'latest'
            ? `https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`
            : `https://api.github.com/repos/${repo}/releases/latest`;
    const headers: Record<string, string> = {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'RXDK-VSCode',
    };
    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }
    const res = await fetch(url, { headers });
    if (res.status === 403 || res.status === 429) {
        throw new Error(
            `GitHub API rate limit reached fetching ${repo}. Set GITHUB_TOKEN, or pin a release ` +
                `(rxdk.hostToolsTag / rxdk.xdvdfsTag), then retry.`
        );
    }
    if (!res.ok) {
        throw new Error(`GitHub API error ${res.status} for ${repo}`);
    }
    return (await res.json()) as GitHubRelease;
}

function xdvdfsAssetPrefix(): string {
    switch (platformToolRid()) {
        case 'linux-x64':
            return 'xdvdfs-linux-';
        case 'osx-x64':
            return 'xdvdfs-macos-x64-';
        case 'osx-arm64':
            return 'xdvdfs-macos-arm64-';
        case 'win-x64':
        default:
            return 'xdvdfs-windows-';
    }
}

export type HostToolsInstallProgress = (update: { message: string; percent?: number }) => void;

interface ExtractOptions {
    /** Predicate over the archive-relative entry name; matched files land flat in destRoot. */
    pick: (name: string) => boolean;
    label: string;
    output?: vscode.OutputChannel;
    onProgress?: HostToolsInstallProgress;
    /** [start, end] percent window this download+extract occupies. */
    phase: [number, number];
}

async function downloadAndExtract(url: string, destRoot: string, opts: ExtractOptions): Promise<number> {
    const [lo, hi] = opts.phase;
    const tmp = path.join(os.tmpdir(), `rxdk-hosttool-${Date.now()}-${Math.round(Math.random() * 1e9)}.zip`);
    try {
        await downloadFileToPath(url, tmp, (progress) => {
            const percent =
                progress.percent !== undefined
                    ? lo + Math.round((progress.percent / 100) * (hi - lo) * 0.8)
                    : undefined;
            opts.onProgress?.({
                message: `${opts.label}: ${formatDownloadProgress(progress.bytesReceived, progress.totalBytes)}`,
                percent,
            });
        });

        opts.onProgress?.({ message: `Extracting ${opts.label}…`, percent: lo + Math.round((hi - lo) * 0.85) });
        const entries = readZipEntries(fs.readFileSync(tmp));
        let wrote = 0;
        for (const entry of entries) {
            if (!opts.pick(entry.name)) {
                continue;
            }
            const target = path.join(destRoot, path.posix.basename(entry.name));
            fs.writeFileSync(target, entry.data);
            if (process.platform !== 'win32') {
                fs.chmodSync(target, 0o755);
            }
            wrote++;
        }
        if (wrote === 0) {
            throw new Error(`No matching files found inside the ${opts.label} archive`);
        }
        opts.output?.appendLine(`RXDK: extracted ${wrote} file(s) from ${opts.label}`);
        return wrote;
    } finally {
        try {
            fs.unlinkSync(tmp);
        } catch {
            /* ignore */
        }
    }
}

/**
 * Download the latest (or pinned) RXDK-Tools managed bundle + xdvdfs for the
 * current platform into the staged tools root. Pure Node — no external process.
 */
export async function installHostTools(
    output?: vscode.OutputChannel,
    onProgress?: HostToolsInstallProgress
): Promise<boolean> {
    const rid = platformToolRid();
    const root = getStagedToolsRoot();
    fs.mkdirSync(root, { recursive: true });

    // 1. RXDK-Tools managed bundle (imagebld, xbcp, xbox-launch, xboxdbg-bridge, xbwatson, …).
    onProgress?.({ message: 'Resolving RXDK-Tools release…', percent: 2 });
    const toolsRelease = await fetchRelease(RXDK_TOOLS_REPO, readConfig('hostToolsTag'));
    const toolsAssetName = `rxdk-managed-${rid}.zip`;
    const toolsAsset = toolsRelease.assets.find((asset) => asset.name === toolsAssetName);
    if (!toolsAsset) {
        throw new Error(`RXDK-Tools ${toolsRelease.tag_name} has no asset "${toolsAssetName}"`);
    }
    output?.appendLine(`RXDK: host tools ${toolsRelease.tag_name} → ${root}`);
    await downloadAndExtract(toolsAsset.browser_download_url, root, {
        // Files directly under a tools/ dir inside the archive (dist/rxdk-managed-<rid>/tools/*).
        pick: (name) => /(^|\/)tools\/[^/]+$/.test(name),
        label: 'RXDK-Tools',
        output,
        onProgress,
        phase: [5, 55],
    });

    // 2. xdvdfs (separate repo).
    onProgress?.({ message: 'Resolving xdvdfs release…', percent: 58 });
    const xdvdfsRelease = await fetchRelease(XDVDFS_REPO, readConfig('xdvdfsTag'));
    const prefix = xdvdfsAssetPrefix();
    const xdvdfsAsset = xdvdfsRelease.assets
        .filter(
            (asset) =>
                asset.name.startsWith(prefix) &&
                asset.name.endsWith('.zip') &&
                !asset.name.startsWith('xdvdfs-fsd-')
        )
        .sort((a, b) => b.name.localeCompare(a.name))[0];
    if (!xdvdfsAsset) {
        throw new Error(`xdvdfs ${xdvdfsRelease.tag_name} has no asset matching "${prefix}*.zip"`);
    }
    output?.appendLine(`RXDK: xdvdfs ${xdvdfsRelease.tag_name} (${xdvdfsAsset.name})`);
    const xdvdfsName = hostToolExecutableName('xdvdfs');
    await downloadAndExtract(xdvdfsAsset.browser_download_url, root, {
        pick: (name) => path.posix.basename(name) === xdvdfsName,
        label: 'xdvdfs',
        output,
        onProgress,
        phase: [60, 95],
    });

    const missing = REQUIRED_HOST_TOOLS.filter(
        (tool) => !fs.existsSync(path.join(root, hostToolExecutableName(tool)))
    );
    if (missing.length > 0) {
        throw new Error(`Host tools install incomplete — missing: ${missing.join(', ')}`);
    }

    onProgress?.({ message: 'Host tools ready', percent: 100 });
    output?.appendLine(`RXDK: host tools ready at ${root}`);
    return true;
}
