import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { RxdkProjectManifest } from './projectTypes';
import { openPrebuiltWorkspace, scaffoldPrebuiltWorkspaceArtifacts } from './prebuiltWorkspace';

interface PrebuiltSpec {
    xbe: string;
    pdb: string;
    exe: string;
    map: string;
    srcRoot: string;
    remoteName: string;
    projectName: string;
    location: string;
}

const STATE_KEY = 'rxdk.prebuiltDebug.lastSpec';

let activePanel: vscode.WebviewPanel | undefined;

export async function openPrebuiltProjectSetup(context: vscode.ExtensionContext): Promise<void> {
    if (activePanel) {
        activePanel.reveal();
        return;
    }

    const panel = vscode.window.createWebviewPanel(
        'rxdkPrebuiltSetup',
        'New Prebuilt XBE Project',
        vscode.ViewColumn.Active,
        { enableScripts: true, retainContextWhenHidden: true }
    );
    activePanel = panel;
    panel.onDidDispose(() => {
        if (activePanel === panel) {
            activePanel = undefined;
        }
    });

    panel.webview.html = buildHtml(panel.webview);

    panel.webview.onDidReceiveMessage(async (msg: Record<string, unknown>) => {
        const type = String(msg.type ?? '');
        switch (type) {
            case 'ready': {
                const last = context.workspaceState.get<Partial<PrebuiltSpec>>(STATE_KEY) ?? {};
                const location =
                    last.location?.trim() ||
                    (vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '');
                panel.webview.postMessage({ type: 'init', spec: { ...last, location } });
                break;
            }
            case 'browseXbe': {
                const xbe = await pickFile('Select prebuilt .xbe', String(msg.seed ?? ''), ['xbe']);
                if (xbe) {
                    panel.webview.postMessage({ type: 'xbe', ...autoDiscover(xbe) });
                }
                break;
            }
            case 'browseFile': {
                const field = String(msg.field ?? '');
                const exts = Array.isArray(msg.exts) ? (msg.exts as string[]) : ['*'];
                const picked = await pickFile(String(msg.title ?? 'Select file'), String(msg.seed ?? ''), exts);
                if (picked) {
                    panel.webview.postMessage({ type: 'field', field, value: picked });
                }
                break;
            }
            case 'browseFolder': {
                const field = String(msg.field ?? '');
                const picked = await pickFolder(String(msg.title ?? 'Select folder'), String(msg.seed ?? ''));
                if (picked) {
                    panel.webview.postMessage({ type: 'field', field, value: picked });
                }
                break;
            }
            case 'create': {
                const spec = normalizeSpec(msg.spec as Partial<PrebuiltSpec>);
                const error = validateSpec(spec);
                if (error) {
                    panel.webview.postMessage({ type: 'error', message: error });
                    return;
                }
                await context.workspaceState.update(STATE_KEY, spec);
                const created = await scaffold(context, spec);
                if (created) {
                    panel.dispose();
                }
                break;
            }
            case 'cancel':
                panel.dispose();
                break;
            default:
                break;
        }
    });
}

function autoDiscover(xbe: string): {
    xbe: string;
    pdb: string;
    exe: string;
    map: string;
    remoteName: string;
    projectName: string;
} {
    const dir = path.dirname(xbe);
    const base = path.basename(xbe, path.extname(xbe));
    const sibling = (ext: string): string => {
        const candidate = path.join(dir, `${base}${ext}`);
        return fs.existsSync(candidate) ? candidate : '';
    };
    return {
        xbe,
        pdb: sibling('.pdb'),
        exe: sibling('.exe'),
        map: sibling('.map'),
        remoteName: base,
        projectName: sanitizeProjectName(base),
    };
}

function normalizeSpec(raw: Partial<PrebuiltSpec> | undefined): PrebuiltSpec {
    return {
        xbe: (raw?.xbe ?? '').trim(),
        pdb: (raw?.pdb ?? '').trim(),
        exe: (raw?.exe ?? '').trim(),
        map: (raw?.map ?? '').trim(),
        srcRoot: (raw?.srcRoot ?? '').trim(),
        remoteName: (raw?.remoteName ?? '').trim(),
        projectName: (raw?.projectName ?? '').trim(),
        location: (raw?.location ?? '').trim(),
    };
}

function validateSpec(spec: PrebuiltSpec): string | undefined {
    if (!spec.xbe) {
        return 'Select an .xbe file.';
    }
    if (!fs.existsSync(spec.xbe)) {
        return `XBE not found: ${spec.xbe}`;
    }
    if (!spec.remoteName || /[\\/:*?"<>|]/.test(spec.remoteName)) {
        return 'Remote name must be a single path segment (no \\ / : * ? " < > |).';
    }
    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(spec.projectName)) {
        return 'Project name must start with a letter and use only letters, digits, underscore, hyphen.';
    }
    if (!spec.location) {
        return 'Enter a location for the project (parent folder — created if needed).';
    }
    const projectRoot = path.join(spec.location, spec.projectName);
    if (fs.existsSync(projectRoot)) {
        return `Folder already exists: ${projectRoot}`;
    }
    return undefined;
}

async function scaffold(context: vscode.ExtensionContext, spec: PrebuiltSpec): Promise<boolean> {
    const projectRoot = path.join(spec.location, spec.projectName);
    const manifest: RxdkProjectManifest = {
        name: spec.projectName,
        prebuilt: {
            xbe: spec.xbe,
            remoteName: spec.remoteName,
            ...(spec.pdb ? { pdb: spec.pdb } : {}),
            ...(spec.map ? { map: spec.map } : {}),
            ...(spec.exe ? { exe: spec.exe } : {}),
            ...(spec.srcRoot ? { srcRoot: spec.srcRoot } : {}),
        },
    };
    try {
        fs.mkdirSync(projectRoot, { recursive: true });
        fs.writeFileSync(
            path.join(projectRoot, 'rxdk.project.json'),
            JSON.stringify(manifest, null, 2) + '\n',
            'utf8'
        );
        const workspacePath = await scaffoldPrebuiltWorkspaceArtifacts(context, projectRoot, manifest);
        const open = await vscode.window.showInformationMessage(
            `Created prebuilt-XBE project "${spec.projectName}". Open the workspace, set breakpoints in Source, then press F5.`,
            'Open Workspace'
        );
        if (open) {
            await openPrebuiltWorkspace(workspacePath);
        }
    } catch (e) {
        vscode.window.showErrorMessage(`Could not create prebuilt project: ${(e as Error).message}`);
        return false;
    }
    return true;
}

async function pickFile(title: string, seed: string, exts: string[]): Promise<string | undefined> {
    const defaultUri = seed && fs.existsSync(path.dirname(seed)) ? vscode.Uri.file(path.dirname(seed)) : undefined;
    const filters: Record<string, string[]> = {};
    filters[exts.join('/').toUpperCase()] = exts;
    filters['All files'] = ['*'];
    const picked = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        defaultUri,
        openLabel: 'Select',
        filters,
        title,
    });
    return picked?.[0]?.fsPath;
}

async function pickFolder(title: string, seed: string): Promise<string | undefined> {
    const defaultUri = seed && fs.existsSync(seed) ? vscode.Uri.file(seed) : vscode.workspace.workspaceFolders?.[0]?.uri;
    const picked = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        defaultUri,
        openLabel: 'Select folder',
        title,
    });
    return picked?.[0]?.fsPath;
}

function sanitizeProjectName(value: string): string {
    const cleaned = value.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/^-+/, '');
    return /^[a-zA-Z]/.test(cleaned) ? cleaned : `xbe-${cleaned || 'title'}`;
}

function buildHtml(webview: vscode.Webview): string {
    const cspSource = webview.cspSource;
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src ${cspSource} 'unsafe-inline';">
  <title>New Prebuilt XBE Project</title>
  <style>
    :root {
      --border: var(--vscode-panel-border, rgba(127,127,127,.3));
      --muted: var(--vscode-descriptionForeground);
      --accent: var(--vscode-textLink-foreground);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 0 28px 40px;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-background);
    }
    .wrap { max-width: 760px; margin: 0 auto; }
    header { padding: 28px 0 8px; }
    h1 { font-size: 1.5em; margin: 0 0 6px; }
    .lead { color: var(--muted); margin: 0 0 18px; line-height: 1.5; }
    .card {
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 18px 20px;
      margin-bottom: 18px;
      background: var(--vscode-sideBar-background, transparent);
    }
    .card h2 { font-size: 1.02em; margin: 0 0 4px; }
    .card .hint { color: var(--muted); font-size: .9em; margin: 0 0 14px; }
    .field { margin-bottom: 14px; }
    .field:last-child { margin-bottom: 0; }
    label { display: block; font-weight: 600; margin-bottom: 5px; }
    label .opt { font-weight: 400; color: var(--muted); }
    .row { display: flex; gap: 8px; align-items: center; }
    input[type=text] {
      flex: 1 1 auto;
      min-width: 0;
      padding: 6px 8px;
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, var(--border));
      border-radius: 4px;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }
    input[type=text]:focus { outline: none; border-color: var(--vscode-focusBorder, var(--accent)); }
    .desc { color: var(--muted); font-size: .85em; margin-top: 4px; }
    button {
      padding: 6px 12px;
      border: 1px solid var(--vscode-button-border, transparent);
      border-radius: 4px;
      cursor: pointer;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      background: var(--vscode-button-secondaryBackground, rgba(127,127,127,.18));
      color: var(--vscode-button-secondaryForeground, var(--vscode-editor-foreground));
      white-space: nowrap;
    }
    button:hover { background: var(--vscode-button-secondaryHoverBackground, rgba(127,127,127,.28)); }
    button.primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    button.primary:hover { background: var(--vscode-button-hoverBackground, var(--vscode-button-background)); }
    button.link { background: none; border: none; color: var(--accent); padding: 2px 4px; }
    button.link:hover { background: none; text-decoration: underline; }
    .actions { display: flex; gap: 10px; margin-top: 6px; }
    .status {
      min-height: 1.2em;
      margin: 0 0 12px;
      color: var(--vscode-inputValidation-errorForeground, var(--vscode-errorForeground));
    }
    .warn { color: var(--vscode-inputValidation-warningForeground, #c90); }
    .badge {
      display: inline-block; font-size: .8em; padding: 1px 6px; border-radius: 10px;
      background: rgba(127,127,127,.18); color: var(--muted); margin-left: 6px;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <h1>New Prebuilt XBE Project</h1>
      <p class="lead">Create a debug project for an already-built (including legacy XDK) Xbox title.
        Pick the <code>.xbe</code> and the matching files are found automatically. The project references
        your files in place and can be re-run and tweaked without reconfiguring.</p>
    </header>

    <div class="card">
      <h2>Title files</h2>
      <p class="hint">Choose the <code>.xbe</code>; sibling <code>.pdb</code> / <code>.exe</code> / <code>.map</code> are auto-filled.</p>

      <div class="field">
        <label for="xbe">XBE <span id="xbeBadge" class="badge">required</span></label>
        <div class="row">
          <input type="text" id="xbe" placeholder="Select the prebuilt .xbe">
          <button id="browseXbe">Browse…</button>
        </div>
      </div>

      <div class="field">
        <label for="pdb">PDB (symbols)</label>
        <div class="row">
          <input type="text" id="pdb" placeholder="Needed for breakpoints, stepping and locals">
          <button data-browse="pdb" data-exts="pdb">Browse…</button>
          <button class="link" data-clear="pdb">Clear</button>
        </div>
        <div class="desc" id="pdbDesc"></div>
      </div>

      <div class="field">
        <label for="exe">PE EXE <span class="opt">(optional)</span></label>
        <div class="row">
          <input type="text" id="exe" placeholder="Used for image size; falls back to the XBE header">
          <button data-browse="exe" data-exts="exe">Browse…</button>
          <button class="link" data-clear="exe">Clear</button>
        </div>
      </div>

      <div class="field">
        <label for="map">MAP <span class="opt">(optional)</span></label>
        <div class="row">
          <input type="text" id="map" placeholder="Used for global variables">
          <button data-browse="map" data-exts="map">Browse…</button>
          <button class="link" data-clear="map">Clear</button>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>Source</h2>
      <p class="hint">Leave empty to use the project/workspace. Set this when the PDB was built on another
        machine and its source paths differ — files resolve by name under this folder.</p>
      <div class="field">
        <label for="srcRoot">Source root <span class="opt">(optional)</span></label>
        <div class="row">
          <input type="text" id="srcRoot" placeholder="(workspace)">
          <button data-folder="srcRoot">Browse…</button>
          <button class="link" data-clear="srcRoot">Clear</button>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>Project</h2>
      <div class="field">
        <label for="remoteName">Remote name</label>
        <div class="row">
          <input type="text" id="remoteName" placeholder="Folder created under xe:\\ for deploy/launch">
        </div>
        <div class="desc" id="remoteDesc"></div>
      </div>
      <div class="field">
        <label for="projectName">Project name</label>
        <div class="row">
          <input type="text" id="projectName" placeholder="Folder name for the new project">
        </div>
      </div>
      <div class="field">
        <label for="location">Location</label>
        <div class="row">
          <input type="text" id="location" placeholder="Parent folder — created if it does not exist">
          <button data-folder="location">Browse…</button>
        </div>
        <div class="desc" id="locationDesc"></div>
      </div>
    </div>

    <p class="status" id="status"></p>
    <div class="actions">
      <button class="primary" id="create">Create Project</button>
      <button id="cancel">Cancel</button>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const ids = ['xbe','pdb','exe','map','srcRoot','remoteName','projectName','location'];
    const el = (id) => document.getElementById(id);
    const get = () => Object.fromEntries(ids.map((id) => [id, el(id).value.trim()]));

    function setStatus(msg, warn) {
      const s = el('status');
      s.textContent = msg || '';
      s.className = 'status' + (warn ? ' warn' : '');
    }

    function refreshDerived() {
      const v = get();
      el('pdbDesc').textContent = v.pdb ? '' : 'No PDB — source-level debugging will be unavailable.';
      el('remoteDesc').textContent = v.remoteName ? ('Deploys to xe:\\\\' + v.remoteName + '\\\\ and launches xe:\\\\' + v.remoteName + '\\\\' + baseName(v.xbe)) : '';
      el('locationDesc').textContent = (v.location && v.projectName) ? ('Creates ' + joinPath(v.location, v.projectName)) : '';
    }

    function baseName(p) {
      if (!p) return '<title>.xbe';
      const parts = p.split(/[\\\\/]/);
      return parts[parts.length - 1] || p;
    }
    function joinPath(a, b) {
      const sep = a.indexOf('/') >= 0 && a.indexOf('\\\\') < 0 ? '/' : '\\\\';
      return a.replace(/[\\\\/]+$/, '') + sep + b;
    }

    el('browseXbe').addEventListener('click', () => vscode.postMessage({ type: 'browseXbe', seed: el('xbe').value }));

    document.querySelectorAll('button[data-browse]').forEach((b) => {
      b.addEventListener('click', () => {
        const field = b.getAttribute('data-browse');
        const exts = (b.getAttribute('data-exts') || '*').split(',');
        vscode.postMessage({ type: 'browseFile', field, exts, title: 'Select ' + field, seed: el(field).value || el('xbe').value });
      });
    });
    document.querySelectorAll('button[data-folder]').forEach((b) => {
      b.addEventListener('click', () => {
        const field = b.getAttribute('data-folder');
        vscode.postMessage({ type: 'browseFolder', field, title: 'Select ' + field, seed: el(field).value });
      });
    });
    document.querySelectorAll('button[data-clear]').forEach((b) => {
      b.addEventListener('click', () => { el(b.getAttribute('data-clear')).value = ''; refreshDerived(); });
    });

    ids.forEach((id) => el(id).addEventListener('input', refreshDerived));

    el('create').addEventListener('click', () => {
      setStatus('');
      vscode.postMessage({ type: 'create', spec: get() });
    });
    el('cancel').addEventListener('click', () => vscode.postMessage({ type: 'cancel' }));

    window.addEventListener('message', (event) => {
      const m = event.data;
      if (m.type === 'init') {
        const s = m.spec || {};
        ids.forEach((id) => { if (s[id] !== undefined && s[id] !== null) el(id).value = s[id]; });
        refreshDerived();
      } else if (m.type === 'xbe') {
        el('xbe').value = m.xbe || '';
        el('pdb').value = m.pdb || '';
        el('exe').value = m.exe || '';
        el('map').value = m.map || '';
        if (!el('remoteName').value) el('remoteName').value = m.remoteName || '';
        if (!el('projectName').value) el('projectName').value = m.projectName || '';
        refreshDerived();
      } else if (m.type === 'field') {
        el(m.field).value = m.value || '';
        refreshDerived();
      } else if (m.type === 'error') {
        setStatus(m.message, false);
      }
    });

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
}
