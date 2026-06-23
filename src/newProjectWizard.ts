import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import {
    RxdkTemplateId,
    TEMPLATE_LABELS,
} from './projectTypes';
import {
    scaffoldProjectFromTemplate,
    suggestProjectName,
    validateProjectName,
} from './projectManager';

interface NewProjectSpec {
    template: RxdkTemplateId;
    projectName: string;
    location: string;
}

const STATE_KEY = 'rxdk.newProjectWizard.lastSpec';
const TEMPLATE_IDS = Object.keys(TEMPLATE_LABELS) as RxdkTemplateId[];

let activePanel: vscode.WebviewPanel | undefined;

export async function openNewProjectWizard(
    context: vscode.ExtensionContext,
    initialTemplate?: RxdkTemplateId
): Promise<void> {
    if (activePanel) {
        activePanel.reveal();
        if (initialTemplate) {
            activePanel.webview.postMessage({ type: 'selectTemplate', template: initialTemplate });
        }
        return;
    }

    const panel = vscode.window.createWebviewPanel(
        'rxdkNewProject',
        'New RXDK Project',
        vscode.ViewColumn.Active,
        { enableScripts: true, retainContextWhenHidden: true }
    );
    activePanel = panel;
    panel.onDidDispose(() => {
        if (activePanel === panel) {
            activePanel = undefined;
        }
    });

    panel.webview.html = buildHtml(panel.webview, initialTemplate);

    panel.webview.onDidReceiveMessage(async (msg: Record<string, unknown>) => {
        const type = String(msg.type ?? '');
        switch (type) {
            case 'ready': {
                const last = context.workspaceState.get<Partial<NewProjectSpec>>(STATE_KEY) ?? {};
                const template =
                    initialTemplate ??
                    (last.template && TEMPLATE_IDS.includes(last.template)
                        ? last.template
                        : 'd3d8-triangle');
                const location =
                    last.location?.trim() ||
                    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ||
                    '';
                const projectName =
                    last.projectName?.trim() || suggestProjectName(template);
                panel.webview.postMessage({
                    type: 'init',
                    spec: { template, projectName, location },
                    templates: TEMPLATE_IDS.map((id) => ({
                        id,
                        label: TEMPLATE_LABELS[id],
                    })),
                });
                break;
            }
            case 'browseLocation': {
                const picked = await pickFolder(
                    'Choose parent folder for the new project',
                    String(msg.seed ?? '')
                );
                if (picked) {
                    panel.webview.postMessage({ type: 'location', value: picked });
                }
                break;
            }
            case 'suggestName': {
                const template = String(msg.template ?? '') as RxdkTemplateId;
                if (TEMPLATE_IDS.includes(template)) {
                    panel.webview.postMessage({
                        type: 'projectName',
                        value: suggestProjectName(template),
                    });
                }
                break;
            }
            case 'create': {
                const spec = normalizeSpec(msg.spec as Partial<NewProjectSpec>);
                const error = validateSpec(spec);
                if (error) {
                    panel.webview.postMessage({ type: 'error', message: error });
                    return;
                }
                await context.workspaceState.update(STATE_KEY, spec);
                const result = await scaffoldProjectFromTemplate(
                    context,
                    spec.template,
                    spec.location,
                    spec.projectName
                );
                if (result.ok) {
                    panel.dispose();
                } else {
                    panel.webview.postMessage({ type: 'error', message: result.error });
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

function normalizeSpec(raw: Partial<NewProjectSpec>): NewProjectSpec {
    const template = TEMPLATE_IDS.includes(raw.template as RxdkTemplateId)
        ? (raw.template as RxdkTemplateId)
        : 'd3d8-triangle';
    return {
        template,
        projectName: String(raw.projectName ?? '').trim(),
        location: String(raw.location ?? '').trim(),
    };
}

function validateSpec(spec: NewProjectSpec): string | undefined {
    const nameError = validateProjectName(spec.projectName);
    if (nameError) {
        return nameError;
    }
    if (!spec.location) {
        return 'Choose a parent folder for the project.';
    }
    if (!fs.existsSync(spec.location)) {
        return `Parent folder not found: ${spec.location}`;
    }
    const projectRoot = path.join(spec.location, spec.projectName);
    if (fs.existsSync(projectRoot)) {
        return `Folder already exists: ${projectRoot}`;
    }
    return undefined;
}

async function pickFolder(title: string, seed: string): Promise<string | undefined> {
    const defaultUri =
        seed && fs.existsSync(seed)
            ? vscode.Uri.file(seed)
            : vscode.workspace.workspaceFolders?.[0]?.uri;
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

function buildHtml(webview: vscode.Webview, initialTemplate?: RxdkTemplateId): string {
    const cspSource = webview.cspSource;
    const initial = initialTemplate && TEMPLATE_IDS.includes(initialTemplate) ? initialTemplate : '';
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src ${cspSource} 'unsafe-inline';">
  <title>New RXDK Project</title>
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
    .wrap { max-width: 720px; margin: 0 auto; }
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
    .field { margin-bottom: 14px; }
    .field:last-child { margin-bottom: 0; }
    label { display: block; font-weight: 600; margin-bottom: 5px; }
    .row { display: flex; gap: 8px; align-items: center; }
    select, input[type=text] {
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
    select:focus, input[type=text]:focus {
      outline: none;
      border-color: var(--vscode-focusBorder, var(--accent));
    }
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
    .actions { display: flex; gap: 10px; margin-top: 6px; }
    .status {
      min-height: 1.2em;
      margin: 0 0 12px;
      color: var(--vscode-inputValidation-errorForeground, var(--vscode-errorForeground));
    }
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <h1>New RXDK Project</h1>
      <p class="lead">Choose a sample template, project name, and parent folder. A workspace file and VS Code tasks are created automatically.</p>
    </header>

    <div class="card">
      <div class="field">
        <label for="template">Template</label>
        <select id="template"></select>
      </div>
      <div class="field">
        <label for="projectName">Project name</label>
        <input type="text" id="projectName" placeholder="Folder and executable name">
        <div class="desc">Letters, digits, underscore, and hyphen. Must start with a letter.</div>
      </div>
      <div class="field">
        <label for="location">Parent folder</label>
        <div class="row">
          <input type="text" id="location" placeholder="Choose where to create the project folder">
          <button id="browseLocation" type="button">Browse…</button>
        </div>
        <div class="desc" id="locationDesc"></div>
      </div>
    </div>

    <p class="status" id="status"></p>
    <div class="actions">
      <button class="primary" id="ok" type="button">OK</button>
      <button id="cancel" type="button">Cancel</button>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const initialTemplate = ${JSON.stringify(initial)};
    const el = (id) => document.getElementById(id);
    let nameTouched = false;

    function setStatus(msg) {
      el('status').textContent = msg || '';
    }

    function joinPath(a, b) {
      const sep = a.indexOf('/') >= 0 && a.indexOf('\\\\') < 0 ? '/' : '\\\\';
      return a.replace(/[\\\\/]+$/, '') + sep + b;
    }

    function refreshDerived() {
      const location = el('location').value.trim();
      const projectName = el('projectName').value.trim();
      el('locationDesc').textContent =
        location && projectName ? ('Creates ' + joinPath(location, projectName)) : '';
    }

    function getSpec() {
      return {
        template: el('template').value,
        projectName: el('projectName').value.trim(),
        location: el('location').value.trim(),
      };
    }

    el('browseLocation').addEventListener('click', () => {
      vscode.postMessage({ type: 'browseLocation', seed: el('location').value });
    });

    el('template').addEventListener('change', () => {
      if (!nameTouched) {
        vscode.postMessage({ type: 'suggestName', template: el('template').value });
      }
      refreshDerived();
    });

    el('projectName').addEventListener('input', () => {
      nameTouched = true;
      refreshDerived();
    });
    el('location').addEventListener('input', refreshDerived);

    el('ok').addEventListener('click', () => {
      setStatus('');
      vscode.postMessage({ type: 'create', spec: getSpec() });
    });
    el('cancel').addEventListener('click', () => vscode.postMessage({ type: 'cancel' }));

    window.addEventListener('message', (event) => {
      const m = event.data;
      if (m.type === 'init') {
        const select = el('template');
        select.innerHTML = '';
        (m.templates || []).forEach((t) => {
          const opt = document.createElement('option');
          opt.value = t.id;
          opt.textContent = t.label;
          select.appendChild(opt);
        });
        const s = m.spec || {};
        if (s.template) select.value = s.template;
        if (initialTemplate) select.value = initialTemplate;
        if (s.projectName) el('projectName').value = s.projectName;
        if (s.location) el('location').value = s.location;
        nameTouched = false;
        refreshDerived();
      } else if (m.type === 'selectTemplate') {
        el('template').value = m.template;
        if (!nameTouched) {
          vscode.postMessage({ type: 'suggestName', template: m.template });
        }
        refreshDerived();
      } else if (m.type === 'location') {
        el('location').value = m.value || '';
        refreshDerived();
      } else if (m.type === 'projectName') {
        if (!nameTouched) el('projectName').value = m.value || '';
        refreshDerived();
      } else if (m.type === 'error') {
        setStatus(m.message);
      }
    });

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
}
