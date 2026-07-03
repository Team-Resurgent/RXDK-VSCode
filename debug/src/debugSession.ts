import {
    LoggingDebugSession,
    InitializedEvent,
    StoppedEvent,
    TerminatedEvent,
    OutputEvent,
    Breakpoint,
    BreakpointEvent,
    Thread,
    StackFrame,
    Scope,
    Source,
    Variable,
    InvalidatedEvent,
} from '@vscode/debugadapter';
import { DebugProtocol } from '@vscode/debugprotocol';
import * as fs from 'fs';
import * as path from 'path';
import { BridgeClient, BridgeEvent } from './bridgeClient';
import { resolveBridgePath } from './bridgePath';

interface XboxLaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
    __workspaceFolder?: string;
    __extensionPath?: string;
    __titleOutputFile?: string;
    __globalsFilter?: number;
    program?: string;
    xbePath: string;
    xbeDir?: string;
    xbeTitle?: string;
    xbe?: string;
    pdb?: string;
    map?: string;
    srcRoot?: string;
    consoleName?: string;
    reboot?: boolean;
    bridgePath?: string;
    // When set, the debug session ends right after preLaunchTask finishes --
    // no deploy, no hardware launch, no attach. Lets a "Build <project>" entry
    // sit in the same launch.json/dropdown as "Debug <project>" while reusing
    // the "xbox" debugger type purely for its preLaunchTask plumbing.
    buildOnly?: boolean;
}

interface XboxAttachRequestArguments extends DebugProtocol.AttachRequestArguments {
    __titleOutputFile?: string;
    program?: string;
    pdb?: string;
    consoleName?: string;
}

export class XboxDebugSession extends LoggingDebugSession {
    private bridge!: BridgeClient;
    private breakpointMap = new Map<string, string>();
    private stoppedThreadId = 1;
    private workspaceRoot = '';
    private srcRoot = '';
    private srcRootIndex: Map<string, string[]> | null = null;
    private extensionPath = '';
    private bridgePathOverride = '';
    private titleOutputFile = '';
    // Globals-pane visibility level forwarded to the bridge: 0 = title mutable globals (default),
    // 1 = + title const tables, 2 = + linked-library globals. Toggled live via a custom request.
    private globalsFilter = 0;
    private configurationDone = false;
    private launchFinished = false;
    private startupFinished = false;
    private startupGoInProgress = false;
    private stepInProgress = false;
    private ignoreBridgeStopUntil = 0;
    private configurationFallbackTimer: NodeJS.Timeout | null = null;
    private sessionReady: Promise<void> | null = null;
    private varChildren = new Map<number, string>();
    private nextChildRef = 100;
    private fileBreakpointAddrs = new Map<string, Map<number, string>>();
    private launchAutoRun = false;
    private launchStartupInProgress = false;
    private pendingLaunchArgs: XboxLaunchRequestArguments | null = null;
    private breakpointSetupInFlight = 0;
    private postLaunchHandled = false;
    private runAfterConfiguredTimer: NodeJS.Timeout | null = null;
    private shuttingDown = false;

    public constructor() {
        super('xbox-debug.txt');
        this.setDebuggerLinesStartAt1(true);
        this.setDebuggerColumnsStartAt1(true);
    }

    protected initializeRequest(
        response: DebugProtocol.InitializeResponse,
        args: DebugProtocol.InitializeRequestArguments
    ): void {
        response.body = response.body || {};
        response.body.supportsConfigurationDoneRequest = true;
        response.body.supportsEvaluateForHovers = true;
        response.body.supportsSetVariable = false;
        response.body.supportsConditionalBreakpoints = false;
        response.body.supportsHitConditionalBreakpoints = false;
        response.body.supportsLogPoints = false;
        response.body.supportsStepBack = false;
        response.body.supportsDelayedStackTraceLoading = false;
        response.body.supportsSingleThreadExecutionRequests = true;
        this.sendResponse(response);
        this.sendEvent(new InitializedEvent());
    }

    protected async configurationDoneRequest(
        response: DebugProtocol.ConfigurationDoneResponse,
        _args: DebugProtocol.ConfigurationDoneArguments
    ): Promise<void> {
        this.configurationDone = true;
        this.sendResponse(response);
        this.scheduleRunAfterConfigured();
    }

    protected async launchRequest(
        response: DebugProtocol.LaunchResponse,
        args: XboxLaunchRequestArguments
    ): Promise<void> {
        if (args.buildOnly) {
            // preLaunchTask (the build) has already run and succeeded by the time
            // VS Code calls launchRequest -- there's nothing left to do here.
            this.sendResponse(response);
            this.sendEvent(new TerminatedEvent());
            return;
        }
        try {
            this.launchStartupInProgress = true;
            this.srcRoot = args.srcRoot ? path.resolve(args.srcRoot) : '';
            this.workspaceRoot =
                args.__workspaceFolder ||
                this.srcRoot ||
                this.imageDir(args) ||
                process.cwd();
            this.extensionPath = args.__extensionPath || '';
            this.titleOutputFile = args.__titleOutputFile || '';
            this.globalsFilter = args.__globalsFilter ?? 0;
            if (args.bridgePath) {
                this.bridgePathOverride = args.bridgePath
                    .replace(/\$\{workspaceFolder\}/g, this.workspaceRoot)
                    .replace(/\$\{extensionInstallPath\}/g, this.extensionPath);
            }
            this.pendingLaunchArgs = args;
            this.sessionReady = this.prepareSession(args);
            await this.sessionReady;
            this.sendEvent(
                new OutputEvent(
                    'xbox-dap: launch deferred until configurationDone (breakpoints counted first)\n',
                    'console'
                )
            );
            this.sendResponse(response);
            this.armConfigurationDoneFallback();
            if (this.configurationDone) {
                this.scheduleRunAfterConfigured();
            }
        } catch (e) {
            this.launchStartupInProgress = false;
            this.pendingLaunchArgs = null;
            this.sendErrorResponse(response, 1, (e as Error).message);
        }
    }

    private async executeHardwareLaunch(args: XboxLaunchRequestArguments): Promise<void> {
        const xbePath = args.xbePath.replace(/\//g, '\\');
        const slash = xbePath.lastIndexOf('\\');
        let dir = args.xbeDir ?? (slash >= 0 ? xbePath.slice(0, slash) : 'xe:\\');
        if (!dir.endsWith('\\')) {
            dir = `${dir}\\`;
        }
        const title = args.xbeTitle ?? (slash >= 0 ? xbePath.slice(slash + 1) : xbePath);
        const bpCount = this.countUserBreakpoints();
        const autoRun = bpCount === 0;
        this.sendEvent(
            new OutputEvent(
                `xbox-dap: launch plan v0.1.30 breakpoints=${bpCount} autoRun=${autoRun}\n`,
                'console'
            )
        );
        if (bpCount > 0 && autoRun) {
            throw new Error('internal: autoRun with breakpoints');
        }
        const launch = await this.bridge.request('launch', {
            dir,
            title,
            reboot: args.reboot === true,
            timeout: 120000,
            console: args.consoleName || undefined,
            autoRun,
        });
        const threadId = Number(launch.threadId);
        if (threadId > 0) {
            this.stoppedThreadId = threadId;
            this.reportMainThread(threadId);
        }
        this.launchAutoRun = Boolean(launch.running);
        this.launchFinished = true;
        this.sendEvent(
            new OutputEvent(
                `xbox-dap: launch result threadId=${launch.threadId ?? '?'} moduleBase=${launch.moduleBase ?? '?'} running=${Boolean(launch.running)}\n`,
                'console'
            )
        );
        await this.printDiag('after launch');
    }

    protected async attachRequest(
        response: DebugProtocol.AttachResponse,
        args: XboxAttachRequestArguments & {
            __workspaceFolder?: string;
            __extensionPath?: string;
            program?: string;
            __titleOutputFile?: string;
            __globalsFilter?: number;
            bridgePath?: string;
        }
    ): Promise<void> {
        try {
            this.titleOutputFile = args.__titleOutputFile || '';
            this.extensionPath = args.__extensionPath || '';
            this.globalsFilter = args.__globalsFilter ?? 0;
            if (args.bridgePath) {
                this.bridgePathOverride = args.bridgePath
                    .replace(/\$\{workspaceFolder\}/g, this.workspaceRoot)
                    .replace(/\$\{extensionInstallPath\}/g, this.extensionPath);
            }
            if (args.__workspaceFolder) {
                this.workspaceRoot = args.__workspaceFolder;
            } else if (args.program) {
                this.workspaceRoot = path.dirname(path.resolve(args.program));
            }
            this.sessionReady = this.prepareSession(args);
            await this.sessionReady;
            await this.bridge.request('attach', { console: args.consoleName || undefined });
            this.sendResponse(response);
        } catch (e) {
            this.sendErrorResponse(response, 1, (e as Error).message);
        }
    }

    protected async setBreakPointsRequest(
        response: DebugProtocol.SetBreakpointsResponse,
        args: DebugProtocol.SetBreakpointsArguments
    ): Promise<void> {
        this.breakpointSetupInFlight++;
        try {
            await this.setBreakPointsRequestCore(response, args);
        } finally {
            this.breakpointSetupInFlight--;
            if (this.configurationDone && !this.postLaunchHandled) {
                this.scheduleRunAfterConfigured();
            }
        }
    }

    private async setBreakPointsRequestCore(
        response: DebugProtocol.SetBreakpointsResponse,
        args: DebugProtocol.SetBreakpointsArguments
    ): Promise<void> {
        if (this.sessionReady) {
            await this.sessionReady.catch(() => undefined);
        }
        const sourcePath = this.normalizeSourcePath(args.source.path || '');
        const lines = (args.breakpoints || []) as DebugProtocol.SourceBreakpoint[];
        const verified: DebugProtocol.Breakpoint[] = [];
        const prev = this.fileBreakpointAddrs.get(sourcePath) ?? new Map<number, string>();
        const nextLines = new Set(lines.map((bp) => bp.line));

        for (const [line, addr] of prev) {
            if (!nextLines.has(line) && addr) {
                try {
                    await this.bridge.request('removeBreakpoint', { address: addr });
                } catch {
                    /* ignore stale remove */
                }
                this.breakpointMap.delete(this.bpKey(sourcePath, line));
            }
        }

        const nextMap = new Map<number, string>();
        for (let i = 0; i < lines.length; ++i) {
            const bp = lines[i];
            const bpId = i + 1;
            const key = this.bpKey(sourcePath, bp.line);
            const installed = await this.installBreakpoint(sourcePath, bp.line, true);
            if (installed.address) {
                this.breakpointMap.set(key, installed.address);
                nextMap.set(bp.line, installed.address);
            } else {
                this.breakpointMap.delete(key);
            }
            verified.push({
                id: bpId,
                verified: installed.verified,
                line: bp.line,
                message: installed.message,
            });
        }
        this.fileBreakpointAddrs.set(sourcePath, nextMap);

        response.body = { breakpoints: verified };
        this.sendResponse(response);
    }

    protected async continueRequest(
        response: DebugProtocol.ContinueResponse,
        _args: DebugProtocol.ContinueArguments
    ): Promise<void> {
        try {
            await this.bridge.request('go');
            response.body = { allThreadsContinued: true };
            this.sendResponse(response);
            /* StoppedEvent arrives via onBridgeEvent when a breakpoint is hit. */
        } catch (e) {
            this.sendEvent(
                new OutputEvent(`continue failed: ${(e as Error).message}\n`, 'console')
            );
            this.sendErrorResponse(response, 1, (e as Error).message);
        }
    }

    protected async pauseRequest(
        response: DebugProtocol.PauseResponse,
        _args: DebugProtocol.PauseArguments
    ): Promise<void> {
        await this.bridge.request('stop');
        this.sendResponse(response);
        this.notifyStopped('pause', this.stoppedThreadId);
    }

    protected async nextRequest(
        response: DebugProtocol.NextResponse,
        args: DebugProtocol.NextArguments
    ): Promise<void> {
        await this.runStepAndWait(args.threadId, true);
        this.sendResponse(response);
    }

    protected async stepInRequest(
        response: DebugProtocol.StepInResponse,
        args: DebugProtocol.StepInArguments
    ): Promise<void> {
        await this.runStepAndWait(args.threadId);
        this.sendResponse(response);
    }

    protected async stepOutRequest(
        response: DebugProtocol.StepOutResponse,
        args: DebugProtocol.StepOutArguments
    ): Promise<void> {
        await this.runStepAndWait(args.threadId);
        this.sendResponse(response);
    }

    protected async threadsRequest(response: DebugProtocol.ThreadsResponse): Promise<void> {
        const fallbackId = this.stoppedThreadId > 0 ? this.stoppedThreadId : 1;
        try {
            const result = await this.bridge.request('getThreads');
            let ids = [...new Set((result.threads as number[]) || [])];
            // When stopped, only expose the stopped thread so VS Code does not fetch one stack per thread.
            if (this.stoppedThreadId > 0) {
                ids = [this.stoppedThreadId];
            } else if (ids.length === 0) {
                ids = [fallbackId];
            } else if (!ids.includes(fallbackId)) {
                ids = [fallbackId, ...ids];
            }
            response.body = {
                threads: ids.map((id) => new Thread(id, `Thread ${id}`)),
            };
        } catch {
            response.body = { threads: [new Thread(fallbackId, `Thread ${fallbackId}`)] };
        }
        this.sendResponse(response);
    }

    protected async stackTraceRequest(
        response: DebugProtocol.StackTraceResponse,
        args: DebugProtocol.StackTraceArguments
    ): Promise<void> {
        const startFrame = Math.max(0, args.startFrame ?? 0);
        const levels = args.levels ?? 0;
        let framesRaw: Array<Record<string, unknown>> = [];
        try {
            const result = await this.bridge.request('getStack', { threadId: args.threadId }, 15000);
            framesRaw = this.dedupeStackFrames(
                (result.frames as Array<Record<string, unknown>>) || []
            );
        } catch (e) {
            this.sendEvent(
                new OutputEvent(`stackTrace failed: ${(e as Error).message}\n`, 'console')
            );
        }
        const end = levels > 0 ? startFrame + levels : framesRaw.length;
        const slice = framesRaw.slice(startFrame, end);
        let stackFrames = slice.map((f, i) => {
            const name = String(f.name || '???');
            const file = String(f.file || '');
            const resolved = file ? this.resolveWorkspacePath(file) : '';
            const line = Number(f.line || 0);
            const idx = startFrame + i;
            return new StackFrame(
                idx,
                name,
                resolved ? new Source(path.basename(resolved), resolved) : undefined,
                line,
                0
            );
        });
        if (!stackFrames.length && startFrame === 0) {
            stackFrames = [new StackFrame(0, 'main', undefined, 0)];
        }
        response.body = { stackFrames, totalFrames: framesRaw.length || 1 };
        this.sendResponse(response);
    }

    protected scopesRequest(
        response: DebugProtocol.ScopesResponse,
        _args: DebugProtocol.ScopesArguments
    ): void {
        response.body = {
            scopes: [
                new Scope('Locals', 1, false),
                new Scope('Globals', 2, false),
                new Scope('Registers', 3, false),
            ],
        };
        this.sendResponse(response);
    }

    protected async variablesRequest(
        response: DebugProtocol.VariablesResponse,
        args: DebugProtocol.VariablesArguments
    ): Promise<void> {
        const scopeByRef: Record<number, string> = {
            1: 'locals',
            2: 'globals',
            3: 'registers',
        };
        const scope = scopeByRef[args.variablesReference];
        const childBase = this.varChildren.get(args.variablesReference);
        let variables: Variable[] = [];
        try {
            if (childBase) {
                const result = await this.bridge.request('getMembers', {
                    name: childBase,
                    threadId: this.stoppedThreadId,
                });
                const raw = (result.variables as Array<Record<string, unknown>>) || [];
                variables = raw.map(
                    (v, i) => new Variable(String(v.name || `field${i}`), String(v.value ?? '???'))
                );
            } else if (scope) {
                const result = await this.bridge.request(
                    'getVariables',
                    {
                        scope,
                        threadId: this.stoppedThreadId,
                        ...(scope === 'globals' ? { globalsFilter: this.globalsFilter } : {}),
                    },
                    scope === 'globals' ? 30000 : 15000
                );
                const raw = (result.variables as Array<Record<string, unknown>>) || [];
                variables = raw.map((v, i) => {
                    const name = String(v.name || `var${i}`);
                    const value = String(v.value ?? '???');
                    if (v.expandable) {
                        const ref = this.nextChildRef++;
                        this.varChildren.set(ref, String(v.base || name));
                        return new Variable(name, value, ref);
                    }
                    return new Variable(name, value);
                });
            }
        } catch (e) {
            this.sendEvent(
                new OutputEvent(`variables failed: ${(e as Error).message}\n`, 'console')
            );
        }
        response.body = { variables };
        this.sendResponse(response);
    }

    protected customRequest(
        command: string,
        response: DebugProtocol.Response,
        args: unknown
    ): void {
        if (command === 'setGlobalsFilter') {
            const level = Number((args as { level?: number })?.level);
            this.globalsFilter = Number.isFinite(level) ? Math.max(0, Math.min(2, level)) : 0;
            this.sendResponse(response);
            // Ask the client to re-fetch the Variables view so the new visibility takes effect
            // without stepping. Scoped to variables; locals/registers are unaffected.
            this.sendEvent(new InvalidatedEvent(['variables']));
            return;
        }
        super.customRequest(command, response, args);
    }

    protected async evaluateRequest(
        response: DebugProtocol.EvaluateResponse,
        args: DebugProtocol.EvaluateArguments
    ): Promise<void> {
        let resultText = '???';
        try {
            const result = await this.bridge.request('evaluate', {
                expression: args.expression,
                threadId: this.stoppedThreadId,
            });
            resultText = String(result.value ?? '???');
        } catch (e) {
            const msg = (e as Error).message;
            if (msg.includes('memberNotFound')) {
                resultText = 'member not found (try expanding struct in Locals, or d3pp.SwapEffect)';
            } else if (msg.includes('symbolNotFound')) {
                resultText = 'symbol not found';
            } else if (msg.includes('readFailed')) {
                resultText = 'could not read memory';
            } else {
                resultText = `error: ${msg}`;
            }
        }
        response.body = {
            result: resultText,
            variablesReference: 0,
        };
        this.sendResponse(response);
    }

    protected async disconnectRequest(
        response: DebugProtocol.DisconnectResponse,
        _args: DebugProtocol.DisconnectArguments
    ): Promise<void> {
        this.shuttingDown = true;
        try {
            this.sendEvent(
                new OutputEvent('xbox-dap: stopping — rebooting devkit to dashboard...\n', 'console')
            );
            await this.bridge?.shutdown(true);
        } catch (e) {
            this.sendEvent(
                new OutputEvent(
                    `xbox-dap: shutdown warning: ${(e as Error).message}\n`,
                    'console'
                )
            );
        }
        this.sendResponse(response);
    }

    private async startBridge(consoleName?: string): Promise<void> {
        const bridgePath = this.resolveBridgePath();
        this.bridge = new BridgeClient(bridgePath);
        this.bridge.on('log', (msg: string) => {
            for (const line of msg.split(/\r?\n/)) {
                const trimmed = line.trim();
                if (trimmed) {
                    this.sendEvent(new OutputEvent(`bridge: ${trimmed}\n`, 'console'));
                }
            }
        });
        this.bridge.on('bridge-event', (ev: BridgeEvent) => this.onBridgeEvent(ev));
        this.bridge.start();
        this.sendEvent(
            new OutputEvent(`xbox-dap: bridge ${bridgePath}\n`, 'console')
        );
        await new Promise<void>((resolve) => {
            const onReady = (ev: BridgeEvent) => {
                if (ev.event === 'ready') {
                    this.bridge.off('bridge-event', onReady);
                    resolve();
                }
            };
            this.bridge.on('bridge-event', onReady);
        });
        if (consoleName) {
            /* console is passed per launch/attach command */
        }
    }

    private async runStepAndWait(threadId: number, stepOver = false): Promise<void> {
        this.stoppedThreadId = threadId;
        this.stepInProgress = true;
        try {
            const result = await this.bridge.request('step', { threadId, over: stepOver });
            const tid = Number(result.threadId || threadId);
            if (tid > 0) {
                this.stoppedThreadId = tid;
            }
            this.notifyStopped('step', this.stoppedThreadId);
        } catch (e) {
            this.ignoreBridgeStopUntil = Date.now() + 1000;
            this.sendEvent(
                new OutputEvent(`step failed: ${(e as Error).message}\n`, 'console')
            );
        } finally {
            this.stepInProgress = false;
        }
    }

    private onBridgeEvent(ev: BridgeEvent): void {
        if (ev.event === 'break' || ev.event === 'singlestep') {
            if (
                this.launchStartupInProgress ||
                this.startupGoInProgress ||
                this.stepInProgress ||
                Date.now() < this.ignoreBridgeStopUntil
            ) {
                return;
            }
            this.stoppedThreadId = Number(ev.threadId || this.stoppedThreadId);
            const reason = ev.event === 'singlestep' ? 'step' : 'breakpoint';
            this.notifyStopped(reason, this.stoppedThreadId);
        } else if (ev.event === 'debugstr') {
            const text = String(ev.text ?? '').trim();
            if (text) {
                const line = text.endsWith('\n') ? text : `${text}\n`;
                this.writeTitleOutput(line);
                this.sendEvent(new OutputEvent(`title: ${text}\n`, 'console'));
            }
        } else if (ev.event === 'terminated' || ev.event === 'rip') {
            this.sendEvent(new TerminatedEvent());
        }
    }

    private resolveBridgePath(): string {
        return resolveBridgePath({
            extensionPath: this.extensionPath,
            workspaceRoot: this.workspaceRoot,
            override: this.bridgePathOverride || undefined,
        });
    }

    private async prepareSession(
        args: XboxLaunchRequestArguments | (XboxAttachRequestArguments & { program?: string })
    ): Promise<void> {
        const consoleName = 'consoleName' in args ? args.consoleName : undefined;
        await this.startBridge(consoleName);
        const exe = 'program' in args ? args.program : undefined;
        const xbe = 'xbe' in args ? (args as XboxLaunchRequestArguments).xbe : undefined;
        const map = 'map' in args ? (args as XboxLaunchRequestArguments).map : undefined;
        if (exe || xbe) {
            await this.loadSymbols({ exe, xbe, pdb: args.pdb, map });
        }
    }

    private imageDir(args: XboxLaunchRequestArguments): string {
        if (args.program) {
            return path.dirname(path.resolve(args.program));
        }
        if (args.xbe) {
            return path.dirname(path.resolve(args.xbe));
        }
        return '';
    }

    private bpKey(sourcePath: string, line: number): string {
        return `${sourcePath}|${line}`;
    }

    private parseBpKey(key: string): { file: string; line: number } | null {
        const sep = key.lastIndexOf('|');
        if (sep < 0) {
            return null;
        }
        const file = key.slice(0, sep);
        const line = Number(key.slice(sep + 1));
        if (!file || !line) {
            return null;
        }
        return { file, line };
    }

    private normalizeSourcePath(sourcePath: string): string {
        let p = sourcePath;
        if (p.startsWith('file:///')) {
            p = p.slice('file:///'.length);
        } else if (p.startsWith('file://')) {
            p = p.slice('file://'.length);
        }
        try {
            p = decodeURIComponent(p);
        } catch {
            /* keep raw path */
        }
        if (p.length >= 2 && p[1] === ':') {
            return `${p[0].toUpperCase()}:${p.slice(2).replace(/\//g, '\\')}`;
        }
        return p.replace(/\//g, '\\');
    }

    private async installBreakpoint(
        sourcePath: string,
        line: number,
        queue: boolean
    ): Promise<{ verified: boolean; address: string; message?: string }> {
        if (!this.bridge) {
            return { verified: false, address: '', message: 'debugger not ready' };
        }
        try {
            const resolved = await this.bridge.request('resolveLine', { file: sourcePath, line });
            const addr = String(resolved.address || '');
            const moduleBase = String(resolved.moduleBase || '');
            if (!addr || addr === '0x00000000' || addr === '0x0') {
                throw new Error(`no code at line ${line} (try a nearby statement line)`);
            }
            const set = await this.bridge.request('setBreakpoint', {
                file: sourcePath,
                line,
                queue,
                address: addr,
            });
            if (set.pending) {
                return {
                    verified: true,
                    address: String(set.address || addr),
                    message: `pending (module base ${moduleBase || 'unknown'})`,
                };
            }
            const armed = set.armed !== false;
            this.sendEvent(
                new OutputEvent(
                    `breakpoint ${path.basename(sourcePath)}:${line} -> ${addr}${armed ? '' : ' (NOT ARMED on devkit)'}\n`,
                    'console'
                )
            );
            return { verified: true, address: addr, message: addr };
        } catch (e) {
            const msg = (e as Error).message;
            this.sendEvent(
                new OutputEvent(`breakpoint failed ${path.basename(sourcePath)}:${line}: ${msg}\n`, 'console')
            );
            return { verified: false, address: '', message: msg };
        }
    }

    private reportMainThread(_threadId: number): void {
        /* Thread list comes from threadsRequest only — ThreadEvent('started') duplicates call stack nodes. */
    }

    private armConfigurationDoneFallback(): void {
        if (this.configurationFallbackTimer) {
            clearTimeout(this.configurationFallbackTimer);
        }
        this.configurationFallbackTimer = setTimeout(() => {
            this.configurationFallbackTimer = null;
            if (!this.configurationDone && !this.startupFinished && this.pendingLaunchArgs) {
                this.sendEvent(
                    new OutputEvent(
                        'xbox-dap: configurationDone not received; continuing anyway\n',
                        'console'
                    )
                );
                this.configurationDone = true;
                this.scheduleRunAfterConfigured();
            }
        }, 1000);
    }

    private scheduleRunAfterConfigured(): void {
        if (this.runAfterConfiguredTimer) {
            clearTimeout(this.runAfterConfiguredTimer);
        }
        this.runAfterConfiguredTimer = setTimeout(() => {
            this.runAfterConfiguredTimer = null;
            void this.runAfterConfigured();
        }, 50);
    }

    private async runAfterConfigured(): Promise<void> {
        if (!this.configurationDone || this.breakpointSetupInFlight > 0) {
            return;
        }
        if (!this.launchFinished) {
            if (!this.pendingLaunchArgs) {
                return;
            }
            const args = this.pendingLaunchArgs;
            this.pendingLaunchArgs = null;
            try {
                await this.executeHardwareLaunch(args);
            } catch (e) {
                this.launchStartupInProgress = false;
                this.sendEvent(
                    new OutputEvent(`xbox-dap: launch failed: ${(e as Error).message}\n`, 'console')
                );
                this.sendEvent(new TerminatedEvent());
                return;
            }
        }
        if (!this.launchFinished || this.postLaunchHandled) {
            return;
        }
        this.postLaunchHandled = true;
        this.startupFinished = true;
        this.launchStartupInProgress = false;
        if (this.configurationFallbackTimer) {
            clearTimeout(this.configurationFallbackTimer);
            this.configurationFallbackTimer = null;
        }
        const bpCount = this.countUserBreakpoints();
        this.sendEvent(
            new OutputEvent(
                `xbox-dap: startup path launchAutoRun=${this.launchAutoRun} breakpoints=${bpCount}\n`,
                'console'
            )
        );
        if (this.launchAutoRun) {
            if (this.hasUserBreakpoints()) {
                await this.applyAllBreakpoints(false);
                await this.ensureDebuggerConnected();
                if (await this.tryNotifyStoppedAtUserBreakpoint('startup autoRun')) {
                    return;
                }
                this.sendEvent(
                    new OutputEvent(
                        'xbox-dap: title running — waiting for a title breakpoint (e.g. InitD3D)...\n',
                        'console'
                    )
                );
                this.startupGoInProgress = true;
                try {
                    if (await this.continueToFirstBreakpoint('startup autoRun')) {
                        return;
                    }
                    this.sendEvent(new OutputEvent('xbox-dap: title running.\n', 'console'));
                    await this.printDiag('startup autoRun running');
                } catch (e) {
                    this.sendEvent(
                        new OutputEvent(`continue failed: ${(e as Error).message}\n`, 'console')
                    );
                } finally {
                    this.startupGoInProgress = false;
                }
            } else {
                this.sendEvent(
                    new OutputEvent(
                        'xbox-dap: title launched and running (clean start, no breakpoints).\n',
                        'console'
                    )
                );
                await this.printDiag('startup autoRun');
            }
            return;
        }
        await this.applyAllBreakpoints(false);
        if (!this.hasUserBreakpoints()) {
            this.sendEvent(
                new OutputEvent('xbox-dap: no breakpoints set — starting title (go)...\n', 'console')
            );
            try {
                await this.bridge.request('go');
                this.sendEvent(new OutputEvent('xbox-dap: title running.\n', 'console'));
                await this.printDiag('after go');
            } catch (e) {
                this.sendEvent(
                    new OutputEvent(`xbox-dap: go failed: ${(e as Error).message}\n`, 'console')
                );
            }
            return;
        }
        this.sendEvent(
            new OutputEvent(
                'xbox-dap: breakpoints armed at entry — continuing to first breakpoint...\n',
                'console'
            )
        );
        this.startupGoInProgress = true;
        try {
            if (await this.continueToFirstBreakpoint('after launch')) {
                return;
            }
            this.sendEvent(
                new OutputEvent(
                    'xbox-dap: timed out waiting for breakpoint — title may have run past main.\n',
                    'console'
                )
            );
            await this.printDiag('after continue timeout');
        } catch (e) {
            this.sendEvent(
                new OutputEvent(`continue failed: ${(e as Error).message}\n`, 'console')
            );
        } finally {
            this.startupGoInProgress = false;
        }
    }

    private countUserBreakpoints(): number {
        let n = 0;
        for (const lineMap of this.fileBreakpointAddrs.values()) {
            n += lineMap.size;
        }
        if (n === 0) {
            n = this.breakpointMap.size;
        }
        return n;
    }

    private hasUserBreakpoints(): boolean {
        return this.countUserBreakpoints() > 0;
    }

    private parseBridgeAddress(addr: unknown): number {
        const text = String(addr ?? '0');
        const n = Number.parseInt(text.replace(/^0x/i, ''), 16);
        return Number.isFinite(n) ? n : 0;
    }

    private addressMatchesUserBreakpoint(addr: unknown): boolean {
        const needle = this.parseBridgeAddress(addr);
        if (!needle) {
            return false;
        }
        for (const lineMap of this.fileBreakpointAddrs.values()) {
            for (const bpAddr of lineMap.values()) {
                if (this.parseBridgeAddress(bpAddr) === needle) {
                    return true;
                }
            }
        }
        for (const addr of this.breakpointMap.values()) {
            if (this.parseBridgeAddress(addr) === needle) {
                return true;
            }
        }
        return false;
    }

    private isBridgeUserBreakpointStop(ev: BridgeEvent, addr: string): boolean {
        if (ev.atUserBreakpoint === true) {
            return Boolean(addr);
        }
        return Boolean(addr) && this.addressMatchesUserBreakpoint(addr);
    }

    private isBridgeIncidentalStop(ev: BridgeEvent): boolean {
        return ev.incidental === true;
    }

    private async ensureDebuggerConnected(): Promise<void> {
        const d = await this.bridge.request('diag');
        if (!d.connected) {
            await this.bridge.request('attach', {});
        }
    }

    private isMainThreadStoppedOnKit(diag: Record<string, unknown>): boolean {
        if (diag.threadStopped || diag.mainStoppedOnKit) {
            return true;
        }
        const main = Number(diag.mainThread || 0);
        const threads = diag.threads as Array<{ id: number; stopped: boolean }> | undefined;
        if (main > 0 && threads) {
            const entry = threads.find((t) => t.id === main);
            if (entry?.stopped) {
                return true;
            }
        }
        return false;
    }

    private effectiveStoppedAddr(diag: Record<string, unknown>): unknown {
        const raw = diag.stoppedAddr;
        const text = String(raw ?? '');
        if (text && text !== '0x00000000' && text !== '0x0') {
            return raw;
        }
        return diag.mainEip ?? raw;
    }

    private async continueToFirstBreakpoint(label: string): Promise<boolean> {
        let run: BridgeEvent;
        try {
            run = await this.bridge.request('goUser');
        } catch (e) {
            this.sendEvent(
                new OutputEvent(`xbox-dap: goUser failed: ${(e as Error).message}\n`, 'console')
            );
            return false;
        }
        const threadId = Number(run.threadId || this.stoppedThreadId);
        if (threadId > 0) {
            this.stoppedThreadId = threadId;
            this.reportMainThread(threadId);
        }
        const addr = run.address ? String(run.address) : '';
        if (addr && this.isBridgeUserBreakpointStop(run, addr)) {
            this.sendEvent(new OutputEvent(`xbox-dap: stopped at ${addr}.\n`, 'console'));
            this.notifyStopped('breakpoint', this.stoppedThreadId);
            await this.printDiag(`${label} breakpoint`);
            return true;
        }
        if (run.running === true || addr) {
            this.sendEvent(
                new OutputEvent('xbox-dap: title running — waiting for a breakpoint...\n', 'console')
            );
            return this.waitForBreakpointLoop();
        }
        return false;
    }

    private async waitForBreakpointLoop(): Promise<boolean> {
        const deadline = Date.now() + 120_000;
        let lastSkip = '';
        let skipRepeats = 0;
        while (Date.now() < deadline && !this.shuttingDown) {
            let wb: BridgeEvent;
            try {
                wb = await this.bridge.request('waitBreak', { timeout: 2000 });
            } catch {
                continue;
            }
            const addr = wb.address ? String(wb.address) : '';
            if (!addr) {
                continue;
            }
            if (this.isBridgeUserBreakpointStop(wb, addr)) {
                const threadId = Number(wb.threadId || this.stoppedThreadId);
                if (threadId > 0) {
                    this.stoppedThreadId = threadId;
                    this.reportMainThread(threadId);
                }
                this.sendEvent(new OutputEvent(`xbox-dap: stopped at ${addr}.\n`, 'console'));
                this.notifyStopped('breakpoint', this.stoppedThreadId);
                return true;
            }

            if (addr === lastSkip) {
                skipRepeats++;
            } else {
                lastSkip = addr;
                skipRepeats = 0;
                this.sendEvent(
                    new OutputEvent(
                        `xbox-dap: skipping stop at ${addr} — continuing to your breakpoint...\n`,
                        'console'
                    )
                );
            }
            if (skipRepeats >= 8) {
                this.sendEvent(
                    new OutputEvent(
                        `xbox-dap: stuck at ${addr} after repeated continue attempts. ` +
                            'Set a breakpoint in title code (e.g. the first line of main) and try again.\n',
                        'console'
                    )
                );
                return false;
            }

            try {
                const run = await this.bridge.request('goUser');
                if (run.running === true) {
                    continue;
                }
                const runAddr = run.address ? String(run.address) : '';
                if (runAddr && this.isBridgeUserBreakpointStop(run, runAddr)) {
                    const threadId = Number(run.threadId || this.stoppedThreadId);
                    if (threadId > 0) {
                        this.stoppedThreadId = threadId;
                        this.reportMainThread(threadId);
                    }
                    this.sendEvent(new OutputEvent(`xbox-dap: stopped at ${runAddr}.\n`, 'console'));
                    this.notifyStopped('breakpoint', this.stoppedThreadId);
                    return true;
                }
            } catch (e) {
                this.sendEvent(
                    new OutputEvent(`xbox-dap: goUser failed: ${(e as Error).message}\n`, 'console')
                );
            }
        }
        return false;
    }

    private notifyUserBreakpointFromDiag(d: Record<string, unknown>): boolean {
        const stoppedAddr = this.effectiveStoppedAddr(d);
        const eip = d.mainEip;
        const atUserBp =
            d.atUserBreakpoint === true ||
            this.addressMatchesUserBreakpoint(stoppedAddr) ||
            this.addressMatchesUserBreakpoint(eip);
        if (!atUserBp) {
            return false;
        }
        if (
            !this.isMainThreadStoppedOnKit(d) &&
            !this.addressMatchesUserBreakpoint(eip) &&
            d.atUserBreakpoint !== true
        ) {
            return false;
        }
        const threadId = Number(d.stoppedThread || d.mainThread || this.stoppedThreadId);
        if (threadId > 0) {
            this.stoppedThreadId = threadId;
            this.reportMainThread(threadId);
        }
        this.sendEvent(
            new OutputEvent(
                `xbox-dap: stopped at ${String(this.addressMatchesUserBreakpoint(eip) ? eip : stoppedAddr)}.\n`,
                'console'
            )
        );
        this.notifyStopped('breakpoint', this.stoppedThreadId);
        return true;
    }

    private async tryNotifyStoppedAtUserBreakpoint(label: string): Promise<boolean> {
        await this.printDiag(label);
        const d = await this.bridge.request('diag');
        return this.notifyUserBreakpointFromDiag(d);
    }

    private async printDiag(label: string): Promise<void> {
        if (!this.bridge) {
            return;
        }
        try {
            const d = await this.bridge.request('diag');
            this.sendEvent(
                new OutputEvent(`xbox-dap diag [${label}]: ${JSON.stringify(d)}\n`, 'console')
            );
        } catch (e) {
            this.sendEvent(
                new OutputEvent(
                    `xbox-dap diag [${label}] failed: ${(e as Error).message}\n`,
                    'console'
                )
            );
        }
    }

    private async applyAllBreakpoints(queue: boolean): Promise<void> {
        let id = 1;
        for (const [sourcePath, lineMap] of this.fileBreakpointAddrs) {
            for (const line of lineMap.keys()) {
                const installed = await this.installBreakpoint(sourcePath, line, queue);
                const key = this.bpKey(sourcePath, line);
                if (installed.address) {
                    this.breakpointMap.set(key, installed.address);
                    lineMap.set(line, installed.address);
                }
                if (installed.verified) {
                    const bp = new Breakpoint(true, line);
                    bp.setId(id++);
                    this.sendEvent(new BreakpointEvent('changed', bp));
                }
            }
        }
    }

    private dedupeStackFrames(raw: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
        const seen = new Set<string>();
        const out: Array<Record<string, unknown>> = [];
        for (const f of raw) {
            const name = String(f.name || '???');
            const file = path.basename(String(f.file || '').replace(/\\/g, '/'));
            const line = Number(f.line || 0);
            const key = `${name}\0${file}\0${line}`;
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            out.push(f);
        }
        return out;
    }

    private resolveWorkspacePath(file: string): string {
        const norm = this.normalizeSourcePath(file);
        if (fs.existsSync(norm)) {
            return norm;
        }
        const base = path.basename(norm);
        const roots = [this.workspaceRoot, this.srcRoot].filter((r) => r);
        for (const root of roots) {
            const underRoot = path.join(root, base);
            if (fs.existsSync(underRoot)) {
                return underRoot;
            }
            const samplesRoot = path.join(root, 'samples');
            if (fs.existsSync(samplesRoot)) {
                for (const name of fs.readdirSync(samplesRoot)) {
                    const candidate = path.join(samplesRoot, name, base);
                    if (fs.existsSync(candidate)) {
                        return candidate;
                    }
                }
            }
        }
        // PDBs built on another machine carry absolute paths that won't exist locally.
        // Fall back to a recursive basename search under the chosen source root.
        const fromSrcRoot = this.findInSrcRoot(norm, base);
        if (fromSrcRoot) {
            return fromSrcRoot;
        }
        return norm;
    }

    private findInSrcRoot(requested: string, base: string): string {
        if (!this.srcRoot) {
            return '';
        }
        const index = this.getSrcRootIndex();
        const candidates = index.get(base.toLowerCase());
        if (!candidates || candidates.length === 0) {
            return '';
        }
        if (candidates.length === 1) {
            return candidates[0];
        }
        // Disambiguate by longest matching trailing path-segment run.
        const reqSegs = requested.toLowerCase().split(/[\\/]/).filter(Boolean).reverse();
        let best = candidates[0];
        let bestScore = -1;
        for (const candidate of candidates) {
            const candSegs = candidate.toLowerCase().split(/[\\/]/).filter(Boolean).reverse();
            let score = 0;
            while (score < reqSegs.length && score < candSegs.length && reqSegs[score] === candSegs[score]) {
                score++;
            }
            if (score > bestScore) {
                bestScore = score;
                best = candidate;
            }
        }
        return best;
    }

    private getSrcRootIndex(): Map<string, string[]> {
        if (this.srcRootIndex) {
            return this.srcRootIndex;
        }
        const index = new Map<string, string[]>();
        const skipDirs = new Set([
            'node_modules',
            '.git',
            '.vs',
            '.vscode',
            'out',
            'bin',
            'obj',
            '.cache',
        ]);
        const walk = (dir: string, depth: number): void => {
            if (depth > 12) {
                return;
            }
            let entries: fs.Dirent[];
            try {
                entries = fs.readdirSync(dir, { withFileTypes: true });
            } catch {
                return;
            }
            for (const entry of entries) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (!skipDirs.has(entry.name.toLowerCase())) {
                        walk(full, depth + 1);
                    }
                } else if (entry.isFile()) {
                    const key = entry.name.toLowerCase();
                    const list = index.get(key);
                    if (list) {
                        list.push(full);
                    } else {
                        index.set(key, [full]);
                    }
                }
            }
        };
        walk(this.srcRoot, 0);
        this.srcRootIndex = index;
        return index;
    }

    private writeTitleOutput(text: string): void {
        if (!this.titleOutputFile) {
            return;
        }
        try {
            fs.appendFileSync(this.titleOutputFile, text, 'utf8');
        } catch {
            /* ignore — extension watches the same path */
        }
    }

    private notifyStopped(reason: string, threadId: number): void {
        const tid = threadId > 0 ? threadId : 1;
        this.varChildren.clear();
        this.nextChildRef = 100;
        setTimeout(() => {
            this.sendEvent(
                new OutputEvent(`xbox-dap: StoppedEvent reason=${reason} thread=${tid}\n`, 'console')
            );
            this.sendStopped(reason, tid);
        }, 0);
    }

    private sendStopped(reason: string, threadId: number): void {
        const ev = new StoppedEvent(reason, threadId);
        // false: only the stopped thread's stack is shown; true makes VS Code stack every thread.
        (ev.body as DebugProtocol.StoppedEvent['body']).allThreadsStopped = false;
        this.sendEvent(ev);
    }

    private async loadSymbols(opts: {
        exe?: string;
        xbe?: string;
        pdb?: string;
        map?: string;
    }): Promise<void> {
        // Prefer the host PE .exe when available; fall back to the .xbe (image size
        // is read from the XBE header by the bridge) for prebuilt/legacy titles.
        const image = opts.exe
            ? { kind: 'exe' as const, path: path.resolve(opts.exe) }
            : opts.xbe
              ? { kind: 'xbe' as const, path: path.resolve(opts.xbe) }
              : null;
        if (!image) {
            throw new Error('No program or xbe provided for symbol loading.');
        }
        if (!fs.existsSync(image.path)) {
            throw new Error(`${image.kind === 'exe' ? 'Program' : 'XBE'} not found: ${image.path}`);
        }

        const stripExt = (p: string): string => p.replace(/\.(exe|xbe)$/i, '');
        const pdbPath = opts.pdb ? path.resolve(opts.pdb) : `${stripExt(image.path)}.pdb`;
        if (!fs.existsSync(pdbPath)) {
            throw new Error(
                `PDB not found: ${pdbPath}. Rebuild with /Zi and link /DEBUG:FULL (see scripts/Get-XdkDebugBuildFlags.ps1).`
            );
        }

        const args: Record<string, string> = { pdb: pdbPath };
        if (image.kind === 'exe') {
            args.exe = image.path;
        } else {
            args.xbe = image.path;
        }

        const mapPath = opts.map ? path.resolve(opts.map) : `${stripExt(image.path)}.map`;
        if (fs.existsSync(mapPath)) {
            args.map = mapPath;
        }
        await this.bridge.request('loadSymbols', args);
    }

    protected setExceptionBreakPointsRequest(
        response: DebugProtocol.SetExceptionBreakpointsResponse,
        _args: DebugProtocol.SetExceptionBreakpointsArguments
    ): void {
        this.sendResponse(response);
    }
}
