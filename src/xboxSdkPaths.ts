import * as fs from 'fs';
import * as path from 'path';
import { RxdkProjectManifest, resolveConfiguration } from './projectTypes';
import { getActiveConfiguration } from './activeConfig';

/** Strip a UTF-8 BOM if present -- PowerShell's ConvertFrom-Json (used before this
 * pipeline was ported to TS) silently tolerated one; JSON.parse does not, and at
 * least one shipped template's manifest actually has one. */
export function stripBom(text: string): string {
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
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
    const raw = stripBom(fs.readFileSync(manifestPath, 'utf8'));
    const parsed = JSON.parse(raw) as RxdkProjectManifest;
    // Collapse a multi-config manifest to the active configuration (and normalize path separators).
    // A flat manifest is returned as-is (bar normalization). This is what makes the whole build
    // path — including recursive projectReferences — build one consistent configuration.
    return resolveConfiguration(parsed, getActiveConfiguration());
}
