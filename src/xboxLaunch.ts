import * as vscode from 'vscode';
import { getActiveXboxAddress } from './xboxConsole';
import { resolveHostTool } from './hostTools';
import { runStreamed } from './processRunner';

export type LaunchResult =
    | { ok: true }
    | { ok: false; noConsoleConfigured: true }
    | { ok: false; error: string };

export interface LaunchProjectOptions {
    projectName: string;
    remoteDir?: string;
    title?: string;
    consoleName?: string;
    cmdLine?: string;
    reboot?: boolean;
    timeoutMs?: number;
    output?: vscode.OutputChannel;
}

/** Launch a deployed Xbox title via xbox-launch.exe. */
export async function launchProject(opts: LaunchProjectOptions): Promise<LaunchResult> {
    try {
        const remoteDir = opts.remoteDir || `xe:\\${opts.projectName}`;
        const title = opts.title || `${opts.projectName}.xbe`;
        const timeoutMs = opts.timeoutMs ?? 120000;

        const launcher = resolveHostTool('xbox-launch');
        const args = ['/dir', remoteDir, '/title', title, '/timeout', String(timeoutMs)];
        if (opts.cmdLine) {
            args.push('/cmd', opts.cmdLine);
        }
        const consoleAddr = opts.consoleName || (await getActiveXboxAddress());
        if (consoleAddr) {
            args.push('/x', consoleAddr);
        }
        if (opts.reboot) {
            args.push('/reboot');
        }

        const result = await runStreamed(launcher, args, { output: opts.output });
        if (result.exitCode === 2) {
            opts.output?.appendLine(
                'Warning: No Xbox console configured (set rxdk.defaultConsole or Xbox Neighborhood).'
            );
            return { ok: false, noConsoleConfigured: true };
        }
        if (result.exitCode !== 0) {
            return { ok: false, error: `xbox-launch.exe failed (exit ${result.exitCode})` };
        }
        return { ok: true };
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
}
