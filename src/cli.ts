#!/usr/bin/env node
// Plain-Node CLI entry point for the title build/deploy/run pipeline, invoked by
// the tasks.json a scaffolded project's .vscode folder generates (see
// vscodeGenerator.ts) -- e.g. `node cli.js build --project-root ... --sdk-include
// ... --sdk-lib ...`. This process is spawned by VS Code's task runner as a plain
// OS process, NOT inside the extension host, so none of the modules this touches
// (buildXboxProject/deployProject/launchProject and everything they call) may
// depend on the real 'vscode' module resolving -- see the tryVscode() lazy
// getters in hostTools.ts/xboxConsole.ts/sdkPath.ts/sdkStaging.ts.
//
// stdout/stderr stream straight to the console (VS Code's task terminal shows
// them live, same as the old `powershell -File ...` tasks did); the process exit
// code is what the task/problem-matcher machinery actually reacts to.
import { buildXboxProject } from './xboxBuild';
import { deployProject, deployPrebuilt } from './xboxDeploy';
import { launchProject } from './xboxLaunch';
import { isRxdkOptimizeMode } from './optimizeMode';

interface OutputChannelLike {
    appendLine(value: string): void;
}

const consoleOutput: OutputChannelLike = {
    appendLine: (value: string) => {
        process.stdout.write(value + '\n');
    },
};

function parseArgs(argv: string[]): Map<string, string | boolean> {
    const args = new Map<string, string | boolean>();
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (!arg.startsWith('--')) {
            continue;
        }
        const key = arg.slice(2);
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--')) {
            args.set(key, next);
            i++;
        } else {
            args.set(key, true);
        }
    }
    return args;
}

function requireArg(args: Map<string, string | boolean>, key: string): string {
    const value = args.get(key);
    if (typeof value !== 'string' || !value) {
        throw new Error(`Missing required --${key}`);
    }
    return value;
}

function stringArg(args: Map<string, string | boolean>, key: string): string | undefined {
    const value = args.get(key);
    return typeof value === 'string' ? value : undefined;
}

async function main(): Promise<number> {
    const [command, ...rest] = process.argv.slice(2);
    const args = parseArgs(rest);

    switch (command) {
        case 'build': {
            const optimizeArg = stringArg(args, 'optimize');
            if (optimizeArg !== undefined && !isRxdkOptimizeMode(optimizeArg)) {
                console.error(`Invalid --optimize "${optimizeArg}" (expected Debug|ReleaseSafe|ReleaseFast|ReleaseSmall)`);
                return 1;
            }
            const result = await buildXboxProject({
                projectRoot: requireArg(args, 'project-root'),
                sdkInclude: requireArg(args, 'sdk-include'),
                sdkLib: requireArg(args, 'sdk-lib'),
                zigExecutable: stringArg(args, 'zig-executable'),
                compileOnly: args.get('compile-only') === true,
                optimize: optimizeArg,
                output: consoleOutput,
            });
            if (!result.ok) {
                console.error(result.error);
                return 1;
            }
            return 0;
        }
        case 'deploy': {
            const result = await deployProject({
                projectRoot: requireArg(args, 'project-root'),
                projectName: stringArg(args, 'project-name'),
                consoleName: stringArg(args, 'console-name'),
                output: consoleOutput,
            });
            if (!result.ok) {
                console.error(result.error);
                return 1;
            }
            return 0;
        }
        case 'deploy-prebuilt': {
            const result = await deployPrebuilt({
                xbePath: requireArg(args, 'xbe-path'),
                remoteName: stringArg(args, 'remote-name'),
                pdbPath: stringArg(args, 'pdb-path'),
                mapPath: stringArg(args, 'map-path'),
                consoleName: stringArg(args, 'console-name'),
                output: consoleOutput,
            });
            if (!result.ok) {
                console.error(result.error);
                return 1;
            }
            return 0;
        }
        case 'run': {
            const result = await launchProject({
                projectName: requireArg(args, 'project-name'),
                remoteDir: stringArg(args, 'remote-dir'),
                title: stringArg(args, 'title'),
                consoleName: stringArg(args, 'console-name'),
                cmdLine: stringArg(args, 'cmd-line'),
                reboot: args.get('reboot') === true,
                timeoutMs: stringArg(args, 'timeout-ms') ? Number(stringArg(args, 'timeout-ms')) : undefined,
                output: consoleOutput,
            });
            if (!result.ok) {
                if ('noConsoleConfigured' in result) {
                    console.warn('No Xbox console configured (set rxdk.defaultConsole or Xbox Neighborhood).');
                    return 2;
                }
                console.error(result.error);
                return 1;
            }
            return 0;
        }
        default:
            console.error(`Unknown command: ${command ?? '(none)'}. Expected build|deploy|deploy-prebuilt|run.`);
            return 1;
    }
}

main()
    .then((code) => process.exit(code))
    .catch((err) => {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
    });
