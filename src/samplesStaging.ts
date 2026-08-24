import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { getRxdkDataRoot } from './sdkDocsStaging';
import { gitCloneRepo, gitPullLatest, isGitRepo, StagingProgress } from './gitStaging';

// The RXDK sample projects ship as a git repository (RXDK-Samples), cloned like the SDK and docs.
// Layout:  <samples>/RxdkSamples/<Category>/<Name>/   — the individual sample project trees
//          <samples>/VERSION                          — installed samples version

export const DEFAULT_SAMPLES_GIT_URL = 'https://github.com/Team-Resurgent/RXDK-Samples.git';
export const DEFAULT_SAMPLES_REPO_PAGE = 'https://github.com/Team-Resurgent/RXDK-Samples';
const ESTIMATED_SAMPLES_BYTES = 60 * 1024 * 1024;

export type SamplesInstallProgress = StagingProgress;

/** Root of the cloned RXDK-Samples repo (ProgramData/RXDK/samples). */
export function getStagedSamplesRoot(context?: vscode.ExtensionContext): string {
    return path.join(getRxdkDataRoot(context), 'samples');
}

/** The folder that holds the sample project trees (<samples>/RxdkSamples). */
export function getSamplesTreeRoot(context?: vscode.ExtensionContext): string {
    return path.join(getStagedSamplesRoot(context), 'RxdkSamples');
}

/** True when the sample project trees are installed. */
export function isSamplesPresent(context?: vscode.ExtensionContext): boolean {
    return fs.existsSync(getSamplesTreeRoot(context));
}

/** Installed samples version from the repo's VERSION file, or 'not installed'. */
export function readSamplesVersion(context?: vscode.ExtensionContext): string {
    const root = getStagedSamplesRoot(context);
    for (const name of ['VERSION', 'VERSION.txt']) {
        try {
            return fs.readFileSync(path.join(root, name), 'utf8').trim();
        } catch {
            /* try next */
        }
    }
    return 'not installed';
}

function getSamplesGitUrl(): string {
    if (process.env.RXDK_SAMPLES_GIT_URL?.trim()) {
        return process.env.RXDK_SAMPLES_GIT_URL.trim();
    }
    try {
        const configured = vscode.workspace.getConfiguration('rxdk').get<string>('samplesGitUrl')?.trim();
        if (configured) {
            return configured;
        }
    } catch {
        /* no workspace yet */
    }
    return DEFAULT_SAMPLES_GIT_URL;
}

async function runWithProgress<T>(message: string, task: () => Promise<T>): Promise<T> {
    return vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'RXDK', cancellable: false },
        async (progress) => {
            progress.report({ message });
            return task();
        }
    );
}

/** Clone or pull the RXDK-Samples repository into the staged samples directory. */
export async function fetchLatestSamples(
    context: vscode.ExtensionContext,
    output?: vscode.OutputChannel,
    onProgress?: SamplesInstallProgress
): Promise<boolean> {
    const dest = getStagedSamplesRoot(context);
    const repoUrl = getSamplesGitUrl();
    const quietUi = Boolean(onProgress);
    const gitOpts = { label: 'RXDK-Samples', estimatedBytes: ESTIMATED_SAMPLES_BYTES, onProgress };

    if (isGitRepo(dest)) {
        output?.appendLine(`RXDK: fetching latest RXDK-Samples → ${dest}`);
        onProgress?.({ message: 'Fetching latest RXDK-Samples…', percent: 5 });
        try {
            await (quietUi
                ? gitPullLatest(dest, { ...gitOpts, label: 'Fetching RXDK-Samples' })
                : runWithProgress('Fetching latest RXDK-Samples…', () =>
                      gitPullLatest(dest, { ...gitOpts, label: 'Fetching RXDK-Samples' })
                  ));
            output?.appendLine(`RXDK: samples updated at ${dest} (${readSamplesVersion(context)})`);
            onProgress?.({ message: 'RXDK-Samples ready', percent: 100 });
            return isSamplesPresent(context);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            output?.appendLine(`RXDK: samples update failed: ${message}`);
            if (!quietUi) {
                vscode.window.showErrorMessage(`RXDK samples update failed: ${message}`);
            }
            return false;
        }
    }

    if (fs.existsSync(dest)) {
        // A non-git samples folder — replace it with the repo clone.
        try {
            fs.rmSync(dest, { recursive: true, force: true });
        } catch {
            /* fall through to clone attempt */
        }
    }

    output?.appendLine(`RXDK: cloning ${repoUrl} → ${dest}`);
    onProgress?.({ message: 'Cloning RXDK-Samples…', percent: 0 });
    try {
        await (quietUi
            ? gitCloneRepo(repoUrl, dest, { ...gitOpts, label: 'Cloning RXDK-Samples' })
            : runWithProgress('Cloning RXDK-Samples…', () =>
                  gitCloneRepo(repoUrl, dest, { ...gitOpts, label: 'Cloning RXDK-Samples' })
              ));
        output?.appendLine(`RXDK: samples cloned to ${dest} (${readSamplesVersion(context)})`);
        onProgress?.({ message: 'RXDK-Samples ready', percent: 100 });
        return isSamplesPresent(context);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        output?.appendLine(`RXDK: samples clone failed: ${message}`);
        if (!quietUi) {
            vscode.window.showErrorMessage(
                `RXDK samples clone failed. Install Git and ensure network access, or clone manually:\n` +
                    `git clone --depth 1 ${repoUrl} "${dest}"`
            );
        }
        return false;
    }
}

/** A single sample discovered under the staged tree, for the "Open Sample" picker. */
export interface SampleEntry {
    category: string;
    name: string;
    dir: string;
}

/** Enumerates the staged samples as <Category>/<Name> project folders (those with a project file). */
export function listSamples(context?: vscode.ExtensionContext): SampleEntry[] {
    const treeRoot = getSamplesTreeRoot(context);
    const out: SampleEntry[] = [];
    let categories: string[];
    try {
        categories = fs.readdirSync(treeRoot).filter((c) => safeIsDir(path.join(treeRoot, c)));
    } catch {
        return out;
    }
    for (const category of categories.sort()) {
        const catDir = path.join(treeRoot, category);
        let names: string[];
        try {
            names = fs.readdirSync(catDir).filter((n) => safeIsDir(path.join(catDir, n)));
        } catch {
            continue;
        }
        for (const name of names.sort()) {
            const dir = path.join(catDir, name);
            if (hasProjectFile(dir)) {
                out.push({ category, name, dir });
            }
        }
    }
    return out;
}

function safeIsDir(p: string): boolean {
    try {
        return fs.statSync(p).isDirectory();
    } catch {
        return false;
    }
}

function hasProjectFile(dir: string): boolean {
    try {
        return fs.readdirSync(dir).some((f) => f === 'rxdk.project.json' || f.toLowerCase().endsWith('.vcxproj'));
    } catch {
        return false;
    }
}
