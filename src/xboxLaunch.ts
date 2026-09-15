import * as fs from 'fs';
import * as path from 'path';
import { resolveConsoleSwitch } from './xboxConsole';
import { resolveHostTool } from './hostTools';
import { OutputLike, runStreamed } from './processRunner';

function resolveXboxLaunchTool(): { ok: true; launcher: string; name: string } | { ok: false; error: string } {
    const launcher = resolveHostTool('xbox-launch');
    const name = path.basename(launcher);
    if (!fs.existsSync(launcher)) {
        return {
            ok: false,
            error: `${name} not found at ${launcher}. Update the RXDK host tools (Complete Setup / Update All).`,
        };
    }
    return { ok: true, launcher, name };
}

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
    output?: OutputLike;
}

/**
 * Warm-reboot the console via `xbox-launch /rebootonly` (no title launched).
 * A DXT deployed to E:\dxt loads on the next boot: xbdm re-scans E:\dxt for
 * *.DXT at debug-monitor init.
 */
export async function rebootConsole(opts: {
    consoleName?: string;
    output?: OutputLike;
}): Promise<LaunchResult> {
    try {
        const tool = resolveXboxLaunchTool();
        if (!tool.ok) {
            return tool;
        }
        const args = ['-rebootonly'];
        const consoleSwitch = await resolveConsoleSwitch(opts.consoleName);
        if (consoleSwitch) {
            args.push('-x', consoleSwitch);
        }

        const result = await runStreamed(tool.launcher, args, { output: opts.output });
        if (result.exitCode === 2) {
            opts.output?.appendLine(
                'Warning: No Xbox console configured (set rxdk.defaultConsole or Xbox Neighborhood).'
            );
            return { ok: false, noConsoleConfigured: true };
        }
        if (result.exitCode !== 0) {
            return { ok: false, error: `${tool.name} -rebootonly failed (exit ${result.exitCode})` };
        }
        return { ok: true };
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
}

/** Launch a deployed Xbox title via xbox-launch. */
export async function launchProject(opts: LaunchProjectOptions): Promise<LaunchResult> {
    try {
        const remoteDir = opts.remoteDir || `xe:\\${opts.projectName}`;
        const title = opts.title || `${opts.projectName}.xbe`;
        const timeoutMs = opts.timeoutMs ?? 120000;

        const tool = resolveXboxLaunchTool();
        if (!tool.ok) {
            return tool;
        }
        const args = ['-dir', remoteDir, '-title', title, '-timeout', String(timeoutMs)];
        if (opts.cmdLine) {
            args.push('-cmd', opts.cmdLine);
        }
        const consoleSwitch = await resolveConsoleSwitch(opts.consoleName);
        if (consoleSwitch) {
            args.push('-x', consoleSwitch);
        }
        if (opts.reboot) {
            args.push('-reboot');
        }

        const result = await runStreamed(tool.launcher, args, { output: opts.output });
        if (result.exitCode === 2) {
            opts.output?.appendLine(
                'Warning: No Xbox console configured (set rxdk.defaultConsole or Xbox Neighborhood).'
            );
            return { ok: false, noConsoleConfigured: true };
        }
        if (result.exitCode !== 0) {
            return { ok: false, error: `${tool.name} failed (exit ${result.exitCode})` };
        }
        return { ok: true };
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
}
