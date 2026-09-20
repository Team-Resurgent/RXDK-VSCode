import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as vscode from 'vscode';
import { downloadFileToPath, formatBytes, formatDownloadProgress, getDirectorySize } from './downloadFile';

const execFileAsync = promisify(execFile);

// The RXDK LLVM toolchain (Team-Resurgent clang/lld/llvm-ar fork for the xboxog target). Published
// as xboxog-<os>-<arch>.zip on the shared rolling "latest" release; the tag is fixed so the asset
// URL is stable and needs no GitHub API call. Mirrors Rxdk.Engine's LlvmInstaller/LlvmRuntime.
export const LLVM_RELEASE = 'https://github.com/Team-Resurgent/llvm-project/releases/download/latest';

function exeName(base: string): string {
    return process.platform === 'win32' ? `${base}.exe` : base;
}

function archiveDirName(): string | undefined {
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
    if (process.platform === 'win32') { return `xboxog-windows-${arch}`; }
    if (process.platform === 'linux') { return `xboxog-linux-${arch}`; }
    if (process.platform === 'darwin') { return `xboxog-macos-${arch}`; }
    return undefined;
}

export function getLlvmInstallRoot(): string {
    // Under the shared RXDK data root (a sibling of sdk/tools/docs), honoring the RXDK override.
    const over = process.env.RXDK?.trim();
    if (over) {
        return path.join(over, 'llvm');
    }
    if (process.platform === 'win32') {
        const programData = process.env.PROGRAMDATA || 'C:\\ProgramData';
        return path.join(programData, 'RXDK', 'llvm');
    }
    if (process.platform === 'darwin') {
        return path.join(os.homedir(), 'Library', 'Application Support', 'RXDK', 'llvm');
    }
    const xdg = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
    return path.join(xdg, 'rxdk', 'llvm');
}

function installedRootCandidates(): string[] {
    const root = getLlvmInstallRoot();
    const dir = archiveDirName();
    const candidates: string[] = [];
    if (dir) { candidates.push(path.join(root, dir)); }
    candidates.push(root); // unpacked flat
    return candidates;
}

/**
 * Resolve the LLVM toolchain root (the dir containing bin/clang), or undefined. Order:
 *   1. explicit `override` (e.g. the `rxdk.llvmPath` setting)
 *   2. `RXDK_LLVM` env (must point to a root with bin/clang)
 *   3. the RXDK-managed install (downloaded by the prereq)
 */
export function resolveLlvmRoot(override?: string): string | undefined {
    const isRoot = (dir: string): boolean =>
        !!dir && fs.existsSync(path.join(dir, 'bin', exeName('clang')));
    if (override) {
        const resolved = path.resolve(override);
        if (!isRoot(resolved)) { throw new Error(`RXDK LLVM root has no bin/clang: ${resolved}`); }
        return resolved;
    }
    const envOverride = process.env.RXDK_LLVM?.trim();
    if (envOverride) {
        const resolved = path.resolve(envOverride);
        if (!isRoot(resolved)) { throw new Error(`RXDK_LLVM has no bin/clang: ${resolved}`); }
        return resolved;
    }
    for (const candidate of installedRootCandidates()) {
        if (isRoot(candidate)) { return candidate; }
    }
    return undefined;
}

export async function isLlvmInstalled(): Promise<boolean> {
    try { return resolveLlvmRoot() !== undefined; } catch { return false; }
}

export async function getLlvmVersionLine(): Promise<string | undefined> {
    let root: string | undefined;
    try { root = resolveLlvmRoot(); } catch { return undefined; }
    if (!root) { return undefined; }
    try {
        const { stdout } = await execFileAsync(path.join(root, 'bin', exeName('clang')), ['--version'], { windowsHide: true });
        return stdout.trim().split(/\r?\n/)[0];
    } catch {
        return undefined;
    }
}

export type LlvmInstallProgress = (update: { message: string; percent?: number }) => void;

async function extractArchive(archivePath: string, destDir: string, onProgress?: LlvmInstallProgress): Promise<void> {
    fs.mkdirSync(destDir, { recursive: true });
    const archiveBytes = fs.statSync(archivePath).size;
    const expected = Math.round(archiveBytes * 2.2);
    const started = Date.now();
    let finished = false;
    const report = (): void => {
        if (finished) { return; }
        const elapsedSec = Math.round((Date.now() - started) / 1000);
        void getDirectorySize(destDir).then((bytes) => {
            if (finished) { return; }
            const pct = expected > 0 ? Math.min(100, Math.round((bytes / expected) * 100)) : undefined;
            const percent = pct !== undefined ? 86 + Math.min(10, Math.round(pct * 0.1)) : 88;
            const sizeHint = bytes > 0 ? ` ${formatBytes(bytes)} extracted` : '';
            const timingHint = elapsedSec >= 30 ? ' — large archive; can take 1–3 minutes' : elapsedSec >= 10 ? ' — still working' : '';
            onProgress?.({ message: `Extracting LLVM toolchain…${sizeHint} (${elapsedSec}s${timingHint})`, percent });
        });
    };
    const timer = setInterval(report, 1000);
    report();
    try {
        // tar handles .zip on Windows 10+ and everywhere modern; the xboxog assets are .zip.
        await execFileAsync('tar', ['-xf', archivePath, '-C', destDir], { timeout: 900_000, windowsHide: true });
    } finally {
        finished = true;
        clearInterval(timer);
    }
}

export async function installLlvm(output?: vscode.OutputChannel, onProgress?: LlvmInstallProgress): Promise<boolean> {
    const dir = archiveDirName();
    if (!dir) { throw new Error(`Automatic LLVM install is not supported on ${process.platform}/${process.arch}.`); }
    const url = `${LLVM_RELEASE}/${dir}.zip`;
    const installRoot = getLlvmInstallRoot();
    const extractDir = path.join(installRoot, 'extract');
    const archivePath = path.join(os.tmpdir(), `rxdk-${dir}.zip`);

    fs.mkdirSync(installRoot, { recursive: true });
    if (fs.existsSync(extractDir)) { fs.rmSync(extractDir, { recursive: true, force: true }); }

    output?.appendLine(`RXDK: downloading LLVM toolchain from ${url}`);
    onProgress?.({ message: 'Downloading LLVM toolchain…', percent: 0 });
    let lastLogged = -1;
    await downloadFileToPath(url, archivePath, (progress) => {
        const message = formatDownloadProgress(progress.bytesReceived, progress.totalBytes);
        const percent = progress.percent !== undefined ? Math.min(85, Math.round(progress.percent * 0.85)) : undefined;
        onProgress?.({ message, percent });
        if (progress.percent !== undefined && (progress.percent === 0 || progress.percent >= lastLogged + 5 || progress.percent === 100)) {
            lastLogged = progress.percent;
            output?.appendLine(`RXDK: ${message}`);
        }
    });

    output?.appendLine(`RXDK: extracting LLVM toolchain to ${installRoot}`);
    await extractArchive(archivePath, extractDir, onProgress);

    // The zip may hold a top-level xboxog-<os>-<arch>/ dir or unpack flat. Normalize to
    // <installRoot>/<dir>/ (the first candidate resolveLlvmRoot searches).
    const destRoot = path.join(installRoot, dir);
    const hasClang = (d: string): boolean => fs.existsSync(path.join(d, 'bin', exeName('clang')));
    const nested = path.join(extractDir, dir);
    if (hasClang(nested)) {
        if (fs.existsSync(destRoot)) { fs.rmSync(destRoot, { recursive: true, force: true }); }
        fs.renameSync(nested, destRoot);
    } else if (hasClang(extractDir)) {
        if (fs.existsSync(destRoot)) { fs.rmSync(destRoot, { recursive: true, force: true }); }
        fs.renameSync(extractDir, destRoot);
        fs.mkdirSync(extractDir, { recursive: true });
    } else {
        throw new Error('LLVM archive did not contain bin/clang at the expected layout.');
    }

    fs.rmSync(extractDir, { recursive: true, force: true });
    try { fs.unlinkSync(archivePath); } catch { /* ignore */ }

    if (!(await isLlvmInstalled())) {
        throw new Error('The RXDK LLVM toolchain was not detected after installation. Reload the window and try again.');
    }
    output?.appendLine('RXDK: LLVM toolchain ready');
    onProgress?.({ message: 'LLVM toolchain ready', percent: 100 });
    return true;
}
