import * as vscode from 'vscode';
import {
    getPrerequisiteStatuses,
    installPrerequisite,
    PrerequisiteId,
    PrerequisiteStatus,
    refreshPrerequisitesContext,
} from './prerequisites';
import { ensureVscodeForWorkspace } from './vscodeGenerator';

let activePanel: vscode.WebviewPanel | undefined;
let installing = false;

export async function openPrerequisitesSetup(
    context: vscode.ExtensionContext,
    output: vscode.OutputChannel,
    options?: { revealOnly?: boolean }
): Promise<void> {
    if (activePanel) {
        activePanel.reveal();
        await postStatuses(context, activePanel);
        return;
    }
    if (options?.revealOnly) {
        return;
    }

    const panel = vscode.window.createWebviewPanel(
        'rxdkPrerequisites',
        'RXDK Setup',
        { viewColumn: vscode.ViewColumn.One, preserveFocus: false },
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
            case 'ready':
            case 'refresh':
                await postStatuses(context, panel);
                break;
            case 'install': {
                const id = String(msg.id ?? '') as PrerequisiteId;
                if (
                    !['dotnet', 'sdk', 'docs', 'zig', 'tools', 'xbneighborhood'].includes(id) ||
                    installing
                ) {
                    return;
                }
                installing = true;
                panel.webview.postMessage({ type: 'installStarted', id });
                try {
                    const ok = await vscode.window.withProgress(
                        {
                            location: vscode.ProgressLocation.Notification,
                            title: 'RXDK',
                            cancellable: false,
                        },
                        async (progress) => {
                            return installPrerequisite(context, id, output, {
                                report: (update) => {
                                    progress.report({ message: update.message });
                                    panel.webview.postMessage({
                                        type: 'installProgress',
                                        id,
                                        message: update.message,
                                        percent: update.percent,
                                    });
                                },
                            });
                        }
                    );
                    if (!ok) {
                        panel.webview.postMessage({
                            type: 'installFailed',
                            id,
                            message: `${id} installation did not complete.`,
                        });
                    }
                } catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    output.appendLine(`RXDK: prerequisite install failed (${id}): ${message}`);
                    panel.webview.postMessage({ type: 'installFailed', id, message });
                } finally {
                    installing = false;
                    const ready = await refreshPrerequisitesContext(context);
                    await postStatuses(context, panel);
                    void vscode.commands.executeCommand('rxdk.refreshSidebar');
                    if (ready) {
                        panel.webview.postMessage({ type: 'allReady' });
                        await ensureVscodeForWorkspace(context);
                        vscode.window.showInformationMessage(
                            'RXDK setup complete. Reload the window if tools are still missing from PATH.'
                        );
                    }
                }
                break;
            }
            case 'openUrl': {
                const url = String(msg.url ?? '').trim();
                if (url.startsWith('https://')) {
                    await vscode.env.openExternal(vscode.Uri.parse(url));
                }
                break;
            }
            case 'continue':
                void refreshPrerequisitesContext(context).then(async () => {
                    await ensureVscodeForWorkspace(context);
                    void vscode.commands.executeCommand('rxdk.refreshSidebar');
                });
                panel.dispose();
                break;
            default:
                break;
        }
    });

    await postStatuses(context, panel);
}

async function postStatuses(
    context: vscode.ExtensionContext,
    panel: vscode.WebviewPanel
): Promise<void> {
    const items = await getPrerequisiteStatuses(context);
    panel.webview.postMessage({
        type: 'status',
        items: items.map(serializeStatus),
        allReady: items.filter((item) => item.required !== false).every((item) => item.ready),
    });
}

function serializeStatus(item: PrerequisiteStatus): Record<string, unknown> {
    return {
        id: item.id,
        label: item.label,
        description: item.description,
        ready: item.ready,
        required: item.required,
        detail: item.detail ?? '',
        canInstall: item.canInstall,
        downloadUrl: item.downloadUrl ?? '',
    };
}

function buildHtml(webview: vscode.Webview): string {
    const cspSource = webview.cspSource;
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src ${cspSource} 'unsafe-inline';">
  <title>RXDK Setup</title>
  <style>
    :root {
      --border: var(--vscode-panel-border, rgba(127,127,127,.3));
      --muted: var(--vscode-descriptionForeground);
      --accent: var(--vscode-textLink-foreground);
      --ok: var(--vscode-testing-iconPassed, #3fb950);
      --warn: var(--vscode-inputValidation-warningForeground, #d7ba7d);
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
    .banner {
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 14px 16px;
      margin-bottom: 18px;
      background: var(--vscode-inputValidation-warningBackground, rgba(255,204,0,.08));
      color: var(--vscode-editor-foreground);
    }
    .banner.ready {
      background: var(--vscode-inputValidation-infoBackground, rgba(0,127,255,.08));
    }
    .item {
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px 18px;
      margin-bottom: 12px;
      background: var(--vscode-sideBar-background, transparent);
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 12px;
      align-items: start;
    }
    .item.ready { border-color: color-mix(in srgb, var(--ok) 35%, var(--border)); }
    .title { font-weight: 600; margin: 0 0 4px; display: flex; gap: 8px; align-items: center; }
    .badge {
      font-size: .75em;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 999px;
      border: 1px solid var(--border);
      color: var(--muted);
    }
    .badge.ok { color: var(--ok); border-color: color-mix(in srgb, var(--ok) 40%, var(--border)); }
    .desc, .detail { color: var(--muted); margin: 0; line-height: 1.45; }
    .detail { font-size: .85em; margin-top: 6px; word-break: break-word; }
    .actions { display: flex; flex-direction: column; gap: 8px; min-width: 120px; }
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
    button:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground, rgba(127,127,127,.28)); }
    button.primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    button.primary:hover:not(:disabled) { background: var(--vscode-button-hoverBackground, var(--vscode-button-background)); }
    button:disabled { opacity: .55; cursor: default; }
    .footer { display: flex; gap: 10px; margin-top: 18px; align-items: center; }
    .status {
      flex: 1;
      min-height: 1.2em;
      color: var(--vscode-inputValidation-errorForeground, var(--vscode-errorForeground));
    }
    .install-progress {
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 14px 16px;
      margin-bottom: 18px;
      background: var(--vscode-sideBar-background, transparent);
    }
    .install-progress.hidden { display: none; }
    .progress-label { margin: 0 0 10px; line-height: 1.45; }
    .progress-track {
      height: 8px;
      border-radius: 999px;
      overflow: hidden;
      background: rgba(127,127,127,.18);
    }
    .progress-bar {
      height: 100%;
      width: 0;
      border-radius: 999px;
      background: var(--vscode-progressBar-background, var(--vscode-button-background, #0078d4));
      transition: width .15s ease;
    }
    .progress-bar.indeterminate {
      width: 35% !important;
      animation: rxdk-indeterminate 1.2s ease-in-out infinite;
    }
    @keyframes rxdk-indeterminate {
      0% { transform: translateX(-120%); }
      100% { transform: translateX(320%); }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <h1>RXDK setup &amp; updates</h1>
      <p class="lead">Install the prerequisites below (.NET, RXDK-SDK, documentation, Zig, host tools) before using build, deploy, debug, or documentation. RXDK stays disabled until everything is ready. Already installed? Use <strong>Update</strong> to pull the latest SDK, docs, and tools.</p>
    </header>

    <div class="banner" id="banner">Checking prerequisites…</div>
    <div id="installProgress" class="install-progress hidden">
      <p class="progress-label" id="installProgressLabel"></p>
      <div class="progress-track"><div id="installProgressBar" class="progress-bar"></div></div>
    </div>
    <div id="items"></div>

    <div class="footer">
      <p class="status" id="status"></p>
      <button id="refresh" type="button">Refresh</button>
      <button class="primary" id="continue" type="button">Close</button>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const el = (id) => document.getElementById(id);
    let items = [];

    function setStatus(msg) {
      el('status').textContent = msg || '';
    }

    function showInstallProgress(message, percent) {
      const box = el('installProgress');
      const bar = el('installProgressBar');
      box.classList.remove('hidden');
      el('installProgressLabel').textContent = message || '';
      if (percent !== undefined && percent !== null) {
        bar.classList.remove('indeterminate');
        bar.style.width = Math.max(0, Math.min(100, percent)) + '%';
      } else {
        bar.classList.add('indeterminate');
        bar.style.width = '35%';
      }
    }

    function hideInstallProgress() {
      el('installProgress').classList.add('hidden');
    }

    function renderItems(list) {
      items = list || [];
      const root = el('items');
      root.innerHTML = '';
      items.forEach((item) => {
        const row = document.createElement('div');
        row.className = 'item' + (item.ready ? ' ready' : '');
        row.innerHTML =
          '<div>' +
            '<p class="title">' + escapeHtml(item.label) +
              ' <span class="badge ' + (item.ready ? 'ok' : '') + '">' +
                (item.ready ? 'Ready' : (item.required === false ? 'Optional' : 'Required')) +
              '</span>' +
            '</p>' +
            '<p class="desc">' + escapeHtml(item.description) + '</p>' +
            (item.detail ? '<p class="detail">' + escapeHtml(item.detail) + '</p>' : '') +
          '</div>' +
          '<div class="actions">' +
            // Ready components stay updatable: re-running install fetches the latest
            // (sdk/docs git-pull, tools re-download) or repairs the pinned Zig.
            '<button type="button" data-action="install" data-id="' + escapeHtml(item.id) + '"' +
              (item.canInstall ? '' : ' disabled') + '>' + (item.ready ? 'Update' : 'Install') + '</button>' +
            (item.downloadUrl
              ? '<button type="button" data-action="open" data-url="' + escapeHtml(item.downloadUrl) + '">Open download page</button>'
              : '') +
          '</div>';
        root.appendChild(row);
      });

      root.querySelectorAll('button[data-action="install"]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-id');
          setStatus('');
          vscode.postMessage({ type: 'install', id });
        });
      });
      root.querySelectorAll('button[data-action="open"]').forEach((btn) => {
        btn.addEventListener('click', () => {
          vscode.postMessage({ type: 'openUrl', url: btn.getAttribute('data-url') });
        });
      });

      const mandatory = items.filter((item) => item.required !== false);
      const allReady = mandatory.length > 0 && mandatory.every((item) => item.ready);
      const banner = el('banner');
      banner.className = 'banner' + (allReady ? ' ready' : '');
      banner.textContent = allReady
        ? 'All prerequisites are installed. RXDK is ready to use.'
        : 'Complete each item below to enable RXDK.';
    }

    function escapeHtml(value) {
      return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    el('refresh').addEventListener('click', () => {
      setStatus('');
      vscode.postMessage({ type: 'refresh' });
    });
    el('continue').addEventListener('click', () => vscode.postMessage({ type: 'continue' }));

    window.addEventListener('message', (event) => {
      const m = event.data;
      if (m.type === 'status') {
        hideInstallProgress();
        renderItems(m.items || []);
      } else if (m.type === 'installStarted') {
        setStatus('');
        showInstallProgress('Starting ' + m.id + '…', 0);
        renderItems(items.map((item) =>
          item.id === m.id ? Object.assign({}, item, { detail: 'Installing…' }) : item
        ));
      } else if (m.type === 'installProgress') {
        showInstallProgress(m.message || ('Installing ' + m.id + '…'), m.percent);
      } else if (m.type === 'installFailed') {
        hideInstallProgress();
        setStatus(m.message || 'Installation failed.');
      } else if (m.type === 'allReady') {
        hideInstallProgress();
        setStatus('');
      }
    });

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
}
