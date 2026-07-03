import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getActiveXboxAddress, setActiveXboxAddress } from './xboxConsole';

// A curated RXDK settings screen. Unlike VS Code's native settings (which apply instantly and are
// scattered across the tree), this groups the settings users actually reach for and applies them as
// a batch on "Apply". Each field maps to either a configuration key (written to global settings) or
// a globalState key (remembered UI state, e.g. the new-project parent folder).

type FieldKind = 'text' | 'folder' | 'file' | 'bool' | 'enum';

interface FieldDef {
    id: string;
    label: string;
    desc?: string;
    kind: FieldKind;
    config?: string; // full configuration key, e.g. 'rxdk.defaultConsole'
    state?: string; // globalState key (mutually exclusive with config)
    // The active Xbox address (same value the sidebar shows). Read via
    // getActiveXboxAddress (workspace config override, else the Windows registry),
    // written via setActiveXboxAddress (validates + writes registry and config).
    console?: boolean;
    placeholder?: string;
    options?: { value: string; label: string }[]; // enum only
}

interface Section {
    title: string;
    fields: FieldDef[];
}

const LAST_PARENT_KEY = 'rxdk.newProjectWizard.lastParentFolder';

const SECTIONS: Section[] = [
    {
        title: 'Debugging',
        fields: [
            {
                id: 'globalsScope',
                label: 'Globals visibility',
                desc: 'Which symbols appear in the debugger Globals pane.',
                kind: 'enum',
                config: 'rxdk.debugger.globalsScope',
                options: [
                    { value: 'title', label: 'Title globals only (recommended)' },
                    { value: 'titleAndConstants', label: 'Title globals + constants' },
                    { value: 'all', label: 'All globals (incl. libraries)' },
                ],
            },
            {
                id: 'showTitleOutput',
                label: 'Reveal title output',
                desc: 'Open the Output panel when the title prints via OutputDebugStringA.',
                kind: 'bool',
                config: 'xbox.showTitleOutput',
            },
        ],
    },
    {
        title: 'Device',
        fields: [
            {
                id: 'defaultConsole',
                label: 'Default Xbox IP / hostname',
                desc: 'The active devkit shown in the sidebar. On Windows this reads/writes the Xbox SDK registry (XBSetIP / Neighborhood); clear it to fall back to the registry value.',
                kind: 'text',
                console: true,
                placeholder: 'e.g. 192.168.1.42 or my-devkit',
            },
        ],
    },
    {
        title: 'Projects',
        fields: [
            {
                id: 'defaultProjectFolder',
                label: 'Default parent folder for new projects',
                desc: 'Pre-filled in the New Project wizard.',
                kind: 'folder',
                state: LAST_PARENT_KEY,
                placeholder: 'Choose a folder where new projects are created',
            },
        ],
    },
];

const ALL_FIELDS: FieldDef[] = SECTIONS.flatMap((s) => s.fields);

let activePanel: vscode.WebviewPanel | undefined;

export function openSettingsPanel(context: vscode.ExtensionContext): void {
    if (activePanel) {
        activePanel.reveal();
        return;
    }

    const panel = vscode.window.createWebviewPanel(
        'rxdkSettings',
        'RXDK Settings',
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
        switch (String(msg.type ?? '')) {
            case 'ready':
                panel.webview.postMessage({ type: 'init', values: await readValues(context) });
                break;
            case 'browse': {
                const field = ALL_FIELDS.find((f) => f.id === String(msg.field ?? ''));
                if (!field) {
                    break;
                }
                const picked = await pickPath(field, String(msg.seed ?? ''));
                if (picked) {
                    panel.webview.postMessage({ type: 'path', field: field.id, value: picked });
                }
                break;
            }
            case 'apply': {
                const errors = await applyValues(context, (msg.values as Record<string, unknown>) ?? {});
                if (errors.length) {
                    void vscode.window.showErrorMessage(`RXDK settings: ${errors.join('; ')}`);
                }
                // Reflect the resolved/saved values (the console field may now show the
                // registry value that was actually written, or revert if it was invalid).
                panel.webview.postMessage({ type: 'init', values: await readValues(context) });
                panel.webview.postMessage({ type: 'saved' });
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

async function readValues(context: vscode.ExtensionContext): Promise<Record<string, string | boolean>> {
    const cfg = vscode.workspace.getConfiguration();
    const out: Record<string, string | boolean> = {};
    for (const f of ALL_FIELDS) {
        if (f.console) {
            out[f.id] = (await getActiveXboxAddress()) ?? '';
        } else if (f.state) {
            out[f.id] = context.globalState.get<string>(f.state) ?? '';
        } else if (f.kind === 'bool') {
            out[f.id] = cfg.get<boolean>(f.config!) ?? false;
        } else {
            out[f.id] = cfg.get<string>(f.config!) ?? '';
        }
    }
    return out;
}

/** Returns validation errors that blocked a field (empty = all applied). */
async function applyValues(
    context: vscode.ExtensionContext,
    values: Record<string, unknown>
): Promise<string[]> {
    const cfg = vscode.workspace.getConfiguration();
    const errors: string[] = [];
    for (const f of ALL_FIELDS) {
        if (!(f.id in values)) {
            continue;
        }
        const raw = values[f.id];
        if (f.console) {
            const value = String(raw ?? '').trim();
            if (value) {
                // Writes the registry (Windows) + config, same as "Set Xbox IP".
                try {
                    await setActiveXboxAddress(value);
                } catch (e) {
                    errors.push(`${f.label}: ${e instanceof Error ? e.message : String(e)}`);
                }
            } else {
                // Cleared: drop the config override so it falls back to the registry
                // (Windows) or simply unsets it (macOS/Linux).
                await cfg.update('rxdk.defaultConsole', '', vscode.ConfigurationTarget.Global);
                await cfg.update('xbox.defaultConsole', '', vscode.ConfigurationTarget.Global);
                if (vscode.workspace.workspaceFolders?.length) {
                    await cfg.update('rxdk.defaultConsole', undefined, vscode.ConfigurationTarget.Workspace);
                    await cfg.update('xbox.defaultConsole', undefined, vscode.ConfigurationTarget.Workspace);
                }
            }
        } else if (f.state) {
            await context.globalState.update(f.state, String(raw ?? '').trim());
        } else if (f.kind === 'bool') {
            await cfg.update(f.config!, Boolean(raw), vscode.ConfigurationTarget.Global);
        } else {
            const value = String(raw ?? '').trim();
            await cfg.update(f.config!, value, vscode.ConfigurationTarget.Global);
        }
    }
    return errors;
}

async function pickPath(field: FieldDef, seed: string): Promise<string | undefined> {
    const seedPath = seed.trim();
    const defaultUri =
        seedPath && fs.existsSync(seedPath) ? vscode.Uri.file(path.normalize(seedPath)) : undefined;
    const picked = await vscode.window.showOpenDialog({
        canSelectFiles: field.kind === 'file',
        canSelectFolders: field.kind === 'folder',
        canSelectMany: false,
        defaultUri,
        openLabel: 'Select',
        title: field.label,
    });
    return picked?.[0]?.fsPath;
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function renderField(f: FieldDef): string {
    const desc = f.desc ? `<div class="desc">${escapeHtml(f.desc)}</div>` : '';
    const label = `<label for="f_${f.id}">${escapeHtml(f.label)}</label>`;
    if (f.kind === 'bool') {
        return `<div class="field checkbox">
      <label class="inline"><input type="checkbox" id="f_${f.id}" data-id="${f.id}"> ${escapeHtml(f.label)}</label>
      ${desc}
    </div>`;
    }
    if (f.kind === 'enum') {
        const opts = (f.options ?? [])
            .map((o) => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`)
            .join('');
        return `<div class="field">
      ${label}
      <select id="f_${f.id}" data-id="${f.id}">${opts}</select>
      ${desc}
    </div>`;
    }
    const ph = f.placeholder ? ` placeholder="${escapeHtml(f.placeholder)}"` : '';
    const browse =
        f.kind === 'folder' || f.kind === 'file'
            ? `<button class="browse" type="button" data-field="${f.id}">Browse…</button>`
            : '';
    return `<div class="field">
      ${label}
      <div class="row">
        <input type="text" id="f_${f.id}" data-id="${f.id}"${ph}>
        ${browse}
      </div>
      ${desc}
    </div>`;
}

function buildHtml(webview: vscode.Webview): string {
    const cspSource = webview.cspSource;
    const body = SECTIONS.map(
        (s) => `<div class="card">
      <h2>${escapeHtml(s.title)}</h2>
      ${s.fields.map(renderField).join('\n')}
    </div>`
    ).join('\n');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src ${cspSource} 'unsafe-inline';">
  <title>RXDK Settings</title>
  <style>
    :root {
      --border: var(--vscode-panel-border, rgba(127,127,127,.3));
      --muted: var(--vscode-descriptionForeground);
      --accent: var(--vscode-textLink-foreground);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 0 28px 96px;
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
      padding: 16px 20px 18px;
      margin-bottom: 18px;
      background: var(--vscode-sideBar-background, transparent);
    }
    h2 { font-size: 1.05em; margin: 0 0 14px; }
    .field { margin-bottom: 14px; }
    .field:last-child { margin-bottom: 0; }
    label { display: block; font-weight: 600; margin-bottom: 5px; }
    label.inline { display: inline-flex; align-items: center; gap: 8px; font-weight: 600; margin: 0; }
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
    input[type=checkbox] { width: 16px; height: 16px; }
    select:focus, input:focus {
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
    .footer {
      position: fixed;
      left: 0; right: 0; bottom: 0;
      display: flex;
      justify-content: flex-end;
      align-items: center;
      gap: 12px;
      padding: 12px 28px;
      background: var(--vscode-editor-background);
      border-top: 1px solid var(--border);
    }
    .saved { color: var(--muted); margin-right: auto; opacity: 0; transition: opacity .15s; }
    .saved.show { opacity: 1; }
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <h1>RXDK Settings</h1>
      <p class="lead">Common RXDK options in one place. Changes are held until you press Apply.</p>
    </header>
    ${body}
  </div>
  <div class="footer">
    <span class="saved" id="saved">Settings saved ✓</span>
    <button id="cancel" type="button">Cancel</button>
    <button class="primary" id="apply" type="button">Apply</button>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const el = (id) => document.getElementById(id);

    function collect() {
      const values = {};
      document.querySelectorAll('[data-id]').forEach((node) => {
        const id = node.getAttribute('data-id');
        values[id] = node.type === 'checkbox' ? node.checked : node.value;
      });
      return values;
    }

    function apply(values) {
      Object.keys(values).forEach((id) => {
        const node = document.getElementById('f_' + id);
        if (!node) return;
        if (node.type === 'checkbox') node.checked = Boolean(values[id]);
        else node.value = values[id] == null ? '' : String(values[id]);
      });
    }

    document.querySelectorAll('button.browse').forEach((btn) => {
      btn.addEventListener('click', () => {
        const field = btn.getAttribute('data-field');
        const input = document.getElementById('f_' + field);
        vscode.postMessage({ type: 'browse', field, seed: input ? input.value : '' });
      });
    });

    el('apply').addEventListener('click', () => vscode.postMessage({ type: 'apply', values: collect() }));
    el('cancel').addEventListener('click', () => vscode.postMessage({ type: 'cancel' }));

    let savedTimer;
    window.addEventListener('message', (event) => {
      const m = event.data;
      if (m.type === 'init') {
        apply(m.values || {});
      } else if (m.type === 'path') {
        const node = document.getElementById('f_' + m.field);
        if (node) node.value = m.value || '';
      } else if (m.type === 'saved') {
        const s = el('saved');
        s.classList.add('show');
        clearTimeout(savedTimer);
        savedTimer = setTimeout(() => s.classList.remove('show'), 2000);
      }
    });

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
}
