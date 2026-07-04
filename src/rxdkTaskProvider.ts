import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { buildXboxProject } from './xboxBuild';
import { deployProject, deployPrebuilt } from './xboxDeploy';
import { launchProject, rebootConsole } from './xboxLaunch';
import { getSdkIncludeDir, getSdkLibDir } from './sdkPath';
import { readProjectManifestAt } from './xboxSdkPaths';
import { OutputLike } from './processRunner';
import { isRxdkOptimizeMode, RxdkOptimizeMode } from './optimizeMode';

// The RXDK build/deploy/run pipeline runs as VS Code "custom execution" tasks: the work happens
// in the extension host (which is already Node) and streams to a pseudoterminal. This replaces the
// old `${execPath} cli.js` process tasks, which depended on ELECTRON_RUN_AS_NODE -- an env var
// newer VS Code strips from task environments, silently breaking the build (and therefore F5's
// preLaunchTask, and therefore debugging). Running in-process sidesteps that entirely and needs no
// external Node install. The cli.js entry point remains for headless/CI use.
export const RXDK_TASK_TYPE = 'rxdk';

export type RxdkTaskAction =
    | 'build'
    | 'deploy'
    | 'buildDeploy'
    | 'run'
    | 'reboot'
    | 'deployReboot'
    | 'deployPrebuilt';

interface RxdkTaskDefinition extends vscode.TaskDefinition {
    action: RxdkTaskAction;
}

/** Display label for each action; must match the labels the generator writes and launch.json's preLaunchTask references. */
const ACTION_LABEL: Record<RxdkTaskAction, string> = {
    build: 'rxdk: build',
    deploy: 'rxdk: deploy',
    buildDeploy: 'rxdk: build+deploy',
    run: 'rxdk: run',
    reboot: 'rxdk: reboot',
    deployReboot: 'rxdk: deploy & reboot',
    deployPrebuilt: 'rxdk: deploy',
};

export class RxdkTaskProvider implements vscode.TaskProvider {
    constructor(private readonly context: vscode.ExtensionContext) {}

    provideTasks(): vscode.Task[] {
        const folders = vscode.workspace.workspaceFolders ?? [];
        const tasks: vscode.Task[] = [];
        for (const folder of folders) {
            if (!fs.existsSync(path.join(folder.uri.fsPath, 'rxdk.project.json'))) {
                continue;
            }
            for (const action of ['build', 'deploy', 'buildDeploy', 'run'] as RxdkTaskAction[]) {
                tasks.push(this.createTask({ type: RXDK_TASK_TYPE, action }, folder));
            }
        }
        return tasks;
    }

    resolveTask(task: vscode.Task): vscode.Task | undefined {
        const action = (task.definition as RxdkTaskDefinition).action;
        if (!action || !(action in ACTION_LABEL)) {
            return undefined;
        }
        const scope = task.scope ?? vscode.TaskScope.Workspace;
        // Preserve the exact definition object VS Code passed (required by resolveTask).
        return this.createTask(task.definition as RxdkTaskDefinition, scope);
    }

    private createTask(
        definition: RxdkTaskDefinition,
        scope: vscode.WorkspaceFolder | vscode.TaskScope
    ): vscode.Task {
        const label = ACTION_LABEL[definition.action];
        const task = new vscode.Task(
            definition,
            scope,
            label.replace(/^rxdk:\s*/, ''),
            RXDK_TASK_TYPE,
            new vscode.CustomExecution(
                async () => new RxdkTaskTerminal(this.context, definition.action, scope)
            ),
            definition.action === 'build' ? ['$gcc'] : []
        );
        if (definition.action === 'build') {
            task.group = vscode.TaskGroup.Build;
        }
        return task;
    }
}

/** Pseudoterminal that runs one RXDK action in-process and streams its output to the task terminal. */
class RxdkTaskTerminal implements vscode.Pseudoterminal {
    private readonly writeEmitter = new vscode.EventEmitter<string>();
    private readonly closeEmitter = new vscode.EventEmitter<number>();
    readonly onDidWrite = this.writeEmitter.event;
    readonly onDidClose = this.closeEmitter.event;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly action: RxdkTaskAction,
        private readonly scope: vscode.WorkspaceFolder | vscode.TaskScope
    ) {}

    open(): void {
        void this.execute();
    }

    close(): void {
        /* nothing to cancel -- the pipeline runs to completion */
    }

    private line(value: string): void {
        // VS Code pseudoterminals need CRLF line endings.
        this.writeEmitter.fire(value.replace(/\r?\n/g, '\r\n') + '\r\n');
    }

    private async execute(): Promise<void> {
        const output: OutputLike = { appendLine: (v) => this.line(v) };
        try {
            const folder = this.resolveFolder();
            if (!folder) {
                this.line('RXDK: no workspace folder with an rxdk.project.json was found.');
                this.closeEmitter.fire(1);
                return;
            }
            const code = await runRxdkAction(this.context, this.action, folder, output);
            this.closeEmitter.fire(code);
        } catch (err) {
            this.line(`RXDK error: ${err instanceof Error ? err.message : String(err)}`);
            this.closeEmitter.fire(1);
        }
    }

    private resolveFolder(): vscode.WorkspaceFolder | undefined {
        if (typeof this.scope === 'object' && 'uri' in this.scope) {
            return this.scope;
        }
        const folders = vscode.workspace.workspaceFolders ?? [];
        return (
            folders.find((f) => fs.existsSync(path.join(f.uri.fsPath, 'rxdk.project.json'))) ??
            folders[0]
        );
    }
}

function getOptimize(): RxdkOptimizeMode {
    const value = vscode.workspace.getConfiguration('rxdk').get<string>('optimize')?.trim();
    return value && isRxdkOptimizeMode(value) ? value : 'Debug';
}

/** Run one action, returning a process-style exit code (0 = success). */
async function runRxdkAction(
    context: vscode.ExtensionContext,
    action: RxdkTaskAction,
    folder: vscode.WorkspaceFolder,
    output: OutputLike
): Promise<number> {
    const projectRoot = folder.uri.fsPath;

    const build = async (): Promise<number> => {
        const result = await buildXboxProject({
            projectRoot,
            sdkInclude: getSdkIncludeDir(context),
            sdkLib: getSdkLibDir(context),
            optimize: getOptimize(),
            output,
        });
        if (!result.ok) {
            output.appendLine(result.error);
            return 1;
        }
        return 0;
    };

    const deploy = async (): Promise<number> => {
        const result = await deployProject({ projectRoot, output });
        if (!result.ok) {
            output.appendLine(result.error);
            return 1;
        }
        return 0;
    };

    const deployPrebuiltAction = async (): Promise<number> => {
        const manifest = readProjectManifestAt(projectRoot);
        const p = manifest.prebuilt;
        if (!p) {
            output.appendLine('RXDK: this project has no prebuilt configuration.');
            return 1;
        }
        const result = await deployPrebuilt({
            xbePath: p.xbe,
            remoteName: p.remoteName,
            pdbPath: p.pdb,
            mapPath: p.map,
            output,
        });
        if (!result.ok) {
            output.appendLine(result.error);
            return 1;
        }
        return 0;
    };

    const run = async (): Promise<number> => {
        const manifest = readProjectManifestAt(projectRoot);
        const result = await launchProject({ projectName: manifest.name, output });
        if (!result.ok) {
            if ('noConsoleConfigured' in result) {
                output.appendLine('No Xbox console configured (set the Xbox IP via Set Xbox IP).');
                return 2;
            }
            output.appendLine(result.error);
            return 1;
        }
        return 0;
    };

    const reboot = async (): Promise<number> => {
        const result = await rebootConsole({ output });
        if (!result.ok) {
            if ('noConsoleConfigured' in result) {
                output.appendLine('No Xbox console configured (set the Xbox IP via Set Xbox IP).');
                return 2;
            }
            output.appendLine(result.error);
            return 1;
        }
        return 0;
    };

    // Sequences stop at the first non-zero step, matching the old dependsOrder:sequence behavior.
    const sequence = async (...steps: Array<() => Promise<number>>): Promise<number> => {
        for (const step of steps) {
            const code = await step();
            if (code !== 0) {
                return code;
            }
        }
        return 0;
    };

    switch (action) {
        case 'build':
            return build();
        case 'deploy':
            return deploy();
        case 'deployPrebuilt':
            return deployPrebuiltAction();
        case 'buildDeploy':
            return sequence(build, deploy);
        case 'run':
            return run();
        case 'reboot':
            return reboot();
        case 'deployReboot':
            return sequence(build, deploy, reboot);
        default:
            output.appendLine(`RXDK: unknown action '${action}'.`);
            return 1;
    }
}
