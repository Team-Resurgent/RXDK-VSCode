import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { platformToolRid } from './bridgePath';
import { RxdkProjectManifest } from './projectTypes';
import { getSdkIncludeDir, getSdkLibDir, getSdkRoot, getSdkScriptsDir, getSdkToolsDir } from './sdkPath';

export interface XboxSdkPaths {
    sdkRoot: string;
    include: string;
    lib: string;
    tools: string;
    toolRid: string;
    scripts: string;
}

/** Resolve every path the title build pipeline needs, in one call. */
export function getXboxSdkPaths(context: vscode.ExtensionContext): XboxSdkPaths {
    return {
        sdkRoot: getSdkRoot(context),
        include: getSdkIncludeDir(context),
        lib: getSdkLibDir(context),
        tools: getSdkToolsDir(context),
        toolRid: platformToolRid(),
        scripts: getSdkScriptsDir(context),
    };
}

/**
 * Read+parse an arbitrary project's rxdk.project.json, throwing if missing. Used
 * for recursive projectReferences walks, where the target directory isn't
 * necessarily an open workspace folder -- unlike projectManager.ts's
 * findProjectManifest, which only looks at vscode.workspace.workspaceFolders.
 */
export function readProjectManifestAt(projectRoot: string): RxdkProjectManifest {
    const manifestPath = path.join(projectRoot, 'rxdk.project.json');
    if (!fs.existsSync(manifestPath)) {
        throw new Error(`Missing rxdk.project.json in ${projectRoot}`);
    }
    const raw = fs.readFileSync(manifestPath, 'utf8');
    return JSON.parse(raw) as RxdkProjectManifest;
}
