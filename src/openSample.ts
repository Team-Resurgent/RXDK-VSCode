import * as vscode from 'vscode';
import { getSamplesTreeRoot, isSamplesPresent, listSamples, SampleEntry } from './samplesStaging';

let activePanel: vscode.WebviewPanel | undefined;

/**
 * A browser window (webview) listing the staged RXDK samples grouped by category. Each sample can be
 * opened in a new (or the current) VS Code window. Samples live under a shared ProgramData clone;
 * opening a folder is fine for browsing/building (its ..\..\Common references resolve on disk).
 */
export async function openSampleBrowser(context: vscode.ExtensionContext): Promise<void> {
    if (activePanel) {
        activePanel.reveal();
        return;
    }
    if (!isSamplesPresent(context)) {
        const choice = await vscode.window.showInformationMessage(
            'RXDK samples are not installed. Install RXDK-Samples from RXDK Setup, then browse them.',
            'Open RXDK Setup'
        );
        if (choice === 'Open RXDK Setup') {
            await vscode.commands.executeCommand('rxdk.setupPrerequisites');
        }
        return;
    }

    const panel = vscode.window.createWebviewPanel(
        'rxdkSampleBrowser',
        'RXDK Samples',
        { viewColumn: vscode.ViewColumn.One, preserveFocus: false },
        { enableScripts: true, retainContextWhenHidden: true }
    );
    activePanel = panel;
    panel.onDidDispose(() => {
        if (activePanel === panel) {
            activePanel = undefined;
        }
    });

    const treeRoot = getSamplesTreeRoot(context);
    panel.webview.html = buildHtml(panel.webview, listSamples(context));

    panel.webview.onDidReceiveMessage(async (msg: Record<string, unknown>) => {
        if (String(msg.type ?? '') !== 'open') {
            return;
        }
        const dir = String(msg.dir ?? '');
        // Only ever open a folder inside the staged samples tree.
        if (!dir || !dir.startsWith(treeRoot)) {
            return;
        }
        await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(dir), {
            forceNewWindow: Boolean(msg.newWindow),
        });
    });
}

function escapeHtml(value: string): string {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function buildHtml(webview: vscode.Webview, samples: SampleEntry[]): string {
    const cspSource = webview.cspSource;
    const byCategory = new Map<string, SampleEntry[]>();
    for (const s of samples) {
        (byCategory.get(s.category) ?? byCategory.set(s.category, []).get(s.category)!).push(s);
    }

    const sections = [...byCategory.entries()]
        .map(([category, entries]) => {
            const cards = entries
                .map(
                    (s) =>
                        `<div class="card" data-name="${escapeHtml((s.category + ' ' + s.name).toLowerCase())}">` +
                        `<div class="cardhead"><span class="name">${escapeHtml(s.name)}</span></div>` +
                        `<div class="path">${escapeHtml(s.dir)}</div>` +
                        `<div class="actions">` +
                        `<button class="primary" data-dir="${escapeHtml(s.dir)}" data-new="1">Open in new window</button>` +
                        `<button data-dir="${escapeHtml(s.dir)}" data-new="0">Open here</button>` +
                        `</div></div>`
                )
                .join('');
            return `<section><h2>${escapeHtml(category)} <span class="count">${entries.length}</span></h2><div class="grid">${cards}</div></section>`;
        })
        .join('');

    const empty = samples.length === 0 ? '<p class="lead">No samples found in the staged RXDK-Samples tree.</p>' : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src ${cspSource} 'unsafe-inline';">
  <title>RXDK Samples</title>
  <style>
    :root { --border: var(--vscode-panel-border, rgba(127,127,127,.3)); --muted: var(--vscode-descriptionForeground); }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 0 28px 40px; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-editor-foreground); background: var(--vscode-editor-background); }
    .wrap { max-width: 1000px; margin: 0 auto; }
    header { padding: 24px 0 6px; }
    h1 { font-size: 1.4em; margin: 0 0 6px; }
    .lead { color: var(--muted); margin: 0 0 16px; line-height: 1.5; }
    .search { width: 100%; padding: 8px 10px; margin: 8px 0 18px; border: 1px solid var(--border); border-radius: 6px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); }
    section { margin-bottom: 22px; }
    h2 { font-size: 1.05em; margin: 0 0 10px; display: flex; align-items: center; gap: 8px; }
    .count { font-size: .7em; color: var(--muted); border: 1px solid var(--border); border-radius: 999px; padding: 1px 8px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
    .card { border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px; background: var(--vscode-sideBar-background, transparent); display: flex; flex-direction: column; gap: 8px; }
    .name { font-weight: 600; }
    .path { color: var(--muted); font-size: .78em; word-break: break-all; }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 2px; }
    button { padding: 5px 10px; border: 1px solid var(--vscode-button-border, transparent); border-radius: 4px; cursor: pointer; font-family: var(--vscode-font-family); font-size: .9em; background: var(--vscode-button-secondaryBackground, rgba(127,127,127,.18)); color: var(--vscode-button-secondaryForeground, var(--vscode-editor-foreground)); }
    button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    button:hover { filter: brightness(1.08); }
    .hidden { display: none; }
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <h1>RXDK Samples</h1>
      <p class="lead">Pick a sample to open in VS Code. It opens the sample's folder; build/deploy work as usual.</p>
      <input id="search" class="search" type="text" placeholder="Filter samples…" autocomplete="off">
    </header>
    ${empty}
    <div id="list">${sections}</div>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    document.querySelectorAll('button[data-dir]').forEach((btn) => {
      btn.addEventListener('click', () => {
        vscode.postMessage({ type: 'open', dir: btn.getAttribute('data-dir'), newWindow: btn.getAttribute('data-new') === '1' });
      });
    });
    const search = document.getElementById('search');
    search.addEventListener('input', () => {
      const q = search.value.trim().toLowerCase();
      document.querySelectorAll('.card').forEach((card) => {
        const hit = !q || (card.getAttribute('data-name') || '').indexOf(q) !== -1;
        card.classList.toggle('hidden', !hit);
      });
      document.querySelectorAll('section').forEach((sec) => {
        const anyVisible = [...sec.querySelectorAll('.card')].some((c) => !c.classList.contains('hidden'));
        sec.classList.toggle('hidden', !anyVisible);
      });
    });
    search.focus();
  </script>
</body>
</html>`;
}
