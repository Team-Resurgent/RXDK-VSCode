import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import {
    isSdkDocsPresent,
    resolveSdkDocsRoot,
    areExtensionDocsPresent,
    resolveExtensionDocsRoot,
} from './sdkDocsStaging';

const DEFAULT_PAGE = 'xbox_pk_welcome.htm';

/** Pages hidden from the table of contents (e.g. the legacy copyright/legal notice). */
const EXCLUDED_PAGES = new Set(['xbox_legal.htm']);

interface TocNode {
    name: string;
    page: string;
    children: TocNode[];
}

interface TocFile {
    title: string;
    defaultPage: string;
    toc: TocNode[];
}

/** Reads a UTF-8 JSON file, stripping a leading BOM that JSON.parse would otherwise reject. */
function readJsonText(filePath: string): string {
    return fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
}

interface Viewer {
    panel: vscode.WebviewPanel;
    docsRoot: string;
}

// One viewer panel per doc set (keyed by webview view type) so the Xbox SDK reference and the RXDK
// extension docs can be open side by side without clobbering each other.
const viewers = new Map<string, Viewer>();

export function getSdkDocsRoot(context: vscode.ExtensionContext): string {
    return resolveSdkDocsRoot(context);
}

export function sdkDocsAvailable(context: vscode.ExtensionContext): boolean {
    return isSdkDocsPresent(context);
}

export function extensionDocsAvailable(context: vscode.ExtensionContext): boolean {
    return areExtensionDocsPresent(context);
}

export async function openSdkDocs(context: vscode.ExtensionContext, page?: string): Promise<void> {
    if (!isSdkDocsPresent(context)) {
        vscode.window.showErrorMessage(
            'Xbox SDK documentation is required. Open RXDK Setup and install the docs prerequisite.'
        );
        return;
    }
    await openDocsViewer('rxdk.sdkDocs', resolveSdkDocsRoot(context), page, 'Xbox SDK Documentation');
}

export async function openExtensionDocs(
    context: vscode.ExtensionContext,
    page?: string
): Promise<void> {
    if (!areExtensionDocsPresent(context)) {
        vscode.window.showErrorMessage(
            'RXDK documentation is not installed. Open RXDK Setup and install the docs prerequisite.'
        );
        return;
    }
    await openDocsViewer('rxdk.extensionDocs', resolveExtensionDocsRoot(context), page, 'RXDK Documentation');
}

async function openDocsViewer(
    viewType: string,
    docsRoot: string,
    page: string | undefined,
    fallbackTitle: string
): Promise<void> {
    const toc = JSON.parse(readJsonText(path.join(docsRoot, 'toc.json'))) as TocFile;
    const startPage = page || toc.defaultPage || DEFAULT_PAGE;

    const existing = viewers.get(viewType);
    if (existing) {
        existing.docsRoot = docsRoot;
        existing.panel.reveal(vscode.ViewColumn.Beside);
        await postNavigate(existing, startPage);
        return;
    }

    const docsUri = vscode.Uri.file(docsRoot);
    const panel = vscode.window.createWebviewPanel(
        viewType,
        toc.title || fallbackTitle,
        vscode.ViewColumn.Beside,
        { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [docsUri] }
    );
    const viewer: Viewer = { panel, docsRoot };
    viewers.set(viewType, viewer);
    panel.webview.html = buildShellHtml(panel.webview, docsUri, toc, startPage);

    panel.webview.onDidReceiveMessage(async (msg: { type: string; page?: string }) => {
        if (msg.type === 'navigate' && msg.page) {
            await postNavigate(viewer, msg.page);
        }
    });

    panel.onDidDispose(() => {
        if (viewers.get(viewType) === viewer) {
            viewers.delete(viewType);
        }
    });

    await postNavigate(viewer, startPage);
}

async function postNavigate(viewer: Viewer, page: string): Promise<void> {
    const docsRoot = vscode.Uri.file(viewer.docsRoot);
    const html = await loadDocPage(docsRoot, viewer.panel.webview, page);
    viewer.panel.webview.postMessage({ type: 'content', page, html });
}

async function loadDocPage(
    docsRoot: vscode.Uri,
    webview: vscode.Webview,
    page: string
): Promise<string> {
    const safeName = path.basename(page);
    const filePath = path.join(docsRoot.fsPath, safeName);
    if (!fs.existsSync(filePath)) {
        return `<p>Topic not found: ${escapeHtml(safeName)}</p>`;
    }
    const raw = readDocFile(filePath);
    return transformDocHtml(raw, docsRoot, webview, safeName);
}

// The two doc sets use different encodings: the RXDK extension docs (rxdk/) are
// UTF-8, while the legacy Xbox SDK reference (xboxsdk/) is Windows-1252 (declared
// charset, with smart quotes/trademark bytes). Decode as UTF-8 when the bytes are
// valid UTF-8 (covers the RXDK docs and any pure-ASCII file), otherwise fall back
// to Windows-1252 -- whose high bytes (e.g. 0x91/0x92 smart quotes) are invalid
// UTF-8, so the fatal decode reliably rejects them. A fixed encoding can't serve
// both: latin1 mangled the UTF-8 docs (em-dash -> "aEUR"), utf8 would mangle the
// 1252 ones.
function readDocFile(filePath: string): string {
    const buf = fs.readFileSync(filePath);
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, '');
    } catch {
        return new TextDecoder('windows-1252').decode(buf);
    }
}

function extractBodyHtml(html: string): string {
    const match = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    return match ? match[1] : html;
}

function transformDocHtml(
    html: string,
    docsRoot: vscode.Uri,
    webview: vscode.Webview,
    pageName: string
): string {
    const baseUri = webview.asWebviewUri(vscode.Uri.joinPath(docsRoot, '/')).toString();
    let out = html;

    out = out.replace(
        /(href|src)\s*=\s*"([^"]+)"/gi,
        (_match, attr: string, target: string) => {
            if (
                !target ||
                target.startsWith('#') ||
                /^[a-z]+:/i.test(target)
            ) {
                return `${attr}="${target}"`;
            }
            // Preserve relative sub-paths (e.g. images/foo.gif) instead of flattening to the
            // basename, otherwise files in subfolders like images/ resolve to the wrong place.
            const segments = target
                .replace(/^\.?\//, '')
                .split('/')
                .filter((s) => s && s !== '.' && s !== '..');
            const resource = webview.asWebviewUri(vscode.Uri.joinPath(docsRoot, ...segments));
            return `${attr}="${resource}"`;
        }
    );

    const body = sanitizeLegacyHtml(extractBodyHtml(out));
    return `<base href="${baseUri}"><article class="doc">${body}</article>`;
}

/**
 * Strips the dated presentational markup the CHM export carries (fixed colors, <font> tags,
 * embedded scripts/styles) so the modern, theme-aware stylesheet in the shell can take over.
 */
function sanitizeLegacyHtml(body: string): string {
    return body
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        // Drop the boilerplate "Unpublished work. © 2000 Microsoft Corporation..." footer.
        .replace(/<div[^>]*\b(?:class|id)\s*=\s*["']?footer["']?[^>]*>[\s\S]*?<\/div>/gi, '')
        // Drop the legacy MS banner/button-bar header tables at the top of each page.
        .replace(/<table[^>]*\bclass\s*=\s*["']?buttonbar(?:shade|table)["']?[^>]*>[\s\S]*?<\/table>/gi, '')
        .replace(/<\/?font[^>]*>/gi, '')
        .replace(/<\/?basefont[^>]*>/gi, '')
        .replace(/\s(?:bgcolor|background|link|vlink|alink|text|color)\s*=\s*"[^"]*"/gi, '')
        .replace(/\s(?:bgcolor|background|link|vlink|alink|text|color)\s*=\s*'[^']*'/gi, '')
        .replace(/\sstyle\s*=\s*"([^"]*)"/gi, (_m, css: string) => {
            const cleaned = css
                .replace(/(?:background(?:-color)?|color)\s*:[^;"]*;?/gi, '')
                .trim();
            return cleaned ? ` style="${cleaned}"` : '';
        });
}

function buildShellHtml(
    webview: vscode.Webview,
    docsRoot: vscode.Uri,
    toc: TocFile,
    startPage: string
): string {
    const cspSource = webview.cspSource;
    const tocHtml = renderTocNodes(toc.toc, 0);
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} data:; style-src ${cspSource} 'unsafe-inline'; script-src ${cspSource} 'unsafe-inline';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    :root {
      color-scheme: light dark;
      --border: var(--vscode-panel-border, rgba(127,127,127,.3));
      --bg: var(--vscode-editor-background);
      --fg: var(--vscode-editor-foreground);
      --muted: var(--vscode-descriptionForeground);
      --accent: var(--vscode-textLink-foreground);
      --accent-active: var(--vscode-textLink-activeForeground, var(--accent));
      --hover: var(--vscode-list-hoverBackground);
      --active: var(--vscode-list-activeSelectionBackground);
      --active-fg: var(--vscode-list-activeSelectionForeground, var(--fg));
      --sidebar-bg: var(--vscode-sideBar-background, var(--bg));
      --code-bg: var(--vscode-textCodeBlock-background, rgba(127,127,127,.12));
      --content-width: 860px;
    }
    * { box-sizing: border-box; }
    html, body { height: 100%; }
    body {
      margin: 0;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--fg);
      background: var(--bg);
      display: grid;
      grid-template-columns: 300px 1fr;
    }
    aside {
      display: flex;
      flex-direction: column;
      min-height: 0;
      background: var(--sidebar-bg);
      border-right: 1px solid var(--border);
    }
    .side-head {
      padding: 14px 16px 10px;
      border-bottom: 1px solid var(--border);
    }
    .side-head .title {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: .08em;
      text-transform: uppercase;
      color: var(--muted);
    }
    .side-head .filter {
      margin-top: 10px;
      width: 100%;
      padding: 6px 9px;
      font: inherit;
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, var(--border));
      border-radius: 6px;
      outline: none;
    }
    .side-head .filter:focus { border-color: var(--vscode-focusBorder, var(--accent)); }
    nav.toc { overflow: auto; padding: 8px 6px 16px; flex: 1 1 auto; }
    .toc ul { list-style: none; margin: 0; padding-left: 10px; }
    .toc > ul { padding-left: 4px; }
    .toc li { margin: 1px 0; }
    .toc button {
      width: 100%;
      text-align: left;
      border: 0;
      background: transparent;
      color: inherit;
      padding: 5px 10px;
      border-radius: 6px;
      cursor: pointer;
      font: inherit;
      line-height: 1.35;
    }
    .toc button:hover { background: var(--hover); }
    .toc button.active { background: var(--active); color: var(--active-fg); }
    .toc .folder {
      display: block;
      padding: 8px 10px 3px;
      color: var(--muted);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: .04em;
      text-transform: uppercase;
    }
    .toc li.hidden { display: none; }
    main { overflow: auto; min-height: 0; }
    /* ---- Modern content typography (overrides legacy CHM markup) ---- */
    .doc {
      max-width: var(--content-width);
      margin: 0 auto;
      padding: 32px 40px 96px;
      line-height: 1.65;
      color: var(--fg);
    }
    .doc :first-child { margin-top: 0; }
    .doc h1, .doc h2, .doc h3, .doc h4 {
      line-height: 1.25;
      font-weight: 600;
      margin: 1.8em 0 .6em;
    }
    .doc h1 { font-size: 1.9em; margin-top: .2em; padding-bottom: .3em; border-bottom: 1px solid var(--border); }
    .doc h2 { font-size: 1.45em; padding-bottom: .25em; border-bottom: 1px solid var(--border); }
    .doc h3 { font-size: 1.2em; }
    .doc h4 { font-size: 1.05em; color: var(--muted); }
    .doc p, .doc ul, .doc ol, .doc dl { margin: 0 0 1em; }
    .doc ul, .doc ol { padding-left: 1.6em; }
    .doc li { margin: .25em 0; }
    .doc a { color: var(--accent); text-decoration: none; }
    .doc a:hover { color: var(--accent-active); text-decoration: underline; }
    .doc code, .doc kbd, .doc samp, .doc tt {
      font-family: var(--vscode-editor-font-family, ui-monospace, Consolas, monospace);
      font-size: .92em;
      background: var(--code-bg);
      padding: .12em .38em;
      border-radius: 4px;
    }
    .doc pre {
      background: var(--code-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 14px 16px;
      overflow: auto;
      line-height: 1.5;
    }
    .doc pre code, .doc pre tt { background: none; padding: 0; border-radius: 0; }
    .doc table {
      border-collapse: collapse;
      width: 100%;
      margin: 0 0 1.2em;
      font-size: .96em;
      overflow: hidden;
      border-radius: 8px;
      border: 1px solid var(--border);
    }
    .doc th, .doc td {
      border: 1px solid var(--border);
      padding: 7px 11px;
      text-align: left;
      vertical-align: top;
    }
    .doc th { background: var(--code-bg); font-weight: 600; }
    .doc tr:nth-child(even) td { background: rgba(127,127,127,.06); }
    .doc img { max-width: 100%; height: auto; }
    .doc hr { border: 0; border-top: 1px solid var(--border); margin: 2em 0; }
    .doc blockquote {
      margin: 0 0 1em;
      padding: .3em 1em;
      border-left: 3px solid var(--accent);
      color: var(--muted);
    }
    .doc dt { font-weight: 600; margin-top: .8em; }
    .doc dd { margin: 0 0 .5em 1.4em; }
  </style>
</head>
<body>
  <aside>
    <div class="side-head">
      <div class="title">${escapeHtml(toc.title || 'Xbox SDK')}</div>
      <input id="filter" class="filter" type="text" placeholder="Filter topics…" autocomplete="off" spellcheck="false">
    </div>
    <nav class="toc">${tocHtml}</nav>
  </aside>
  <main><div id="content">Loading…</div></main>
  <script>
    const vscode = acquireVsCodeApi();
    const content = document.getElementById('content');
    let activePage = ${JSON.stringify(startPage)};
    function setActive(page) {
      activePage = page;
      document.querySelectorAll('[data-page]').forEach((el) => {
        el.classList.toggle('active', el.getAttribute('data-page') === page);
      });
      const current = document.querySelector('[data-page].active');
      if (current && current.scrollIntoView) current.scrollIntoView({ block: 'nearest' });
    }
    document.querySelectorAll('[data-page]').forEach((el) => {
      el.addEventListener('click', () => {
        const page = el.getAttribute('data-page');
        if (!page) return;
        setActive(page);
        vscode.postMessage({ type: 'navigate', page });
      });
    });
    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg && msg.type === 'content') {
        setActive(msg.page);
        content.innerHTML = msg.html;
        content.parentElement.scrollTop = 0;
      }
    });
    content.addEventListener('click', (e) => {
      const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
      if (!a) return;
      const href = a.getAttribute('href') || '';
      if (!href || href.startsWith('#') || /^[a-z]+:/i.test(href)) return;
      const page = href.split('/').pop().split('?')[0];
      if (page && page.toLowerCase().endsWith('.htm')) {
        e.preventDefault();
        setActive(page);
        vscode.postMessage({ type: 'navigate', page });
      }
    }, true);
    const filter = document.getElementById('filter');
    filter.addEventListener('input', () => {
      const q = filter.value.trim().toLowerCase();
      document.querySelectorAll('.toc li').forEach((li) => {
        if (!q) { li.classList.remove('hidden'); return; }
        const btn = li.querySelector(':scope > button, :scope > .folder');
        const selfMatch = btn ? btn.textContent.toLowerCase().includes(q) : false;
        const childMatch = li.querySelector('li:not(.hidden)');
        li.classList.toggle('hidden', !(selfMatch || !!childMatch));
      });
      // Re-evaluate parents so a matching child keeps its ancestors visible.
      for (let i = 0; i < 6; i++) {
        document.querySelectorAll('.toc li.hidden').forEach((li) => {
          if (li.querySelector('li:not(.hidden)')) li.classList.remove('hidden');
        });
      }
    });
  </script>
</body>
</html>`;
}

function renderTocNodes(nodes: TocNode[], depth: number): string {
    if (!nodes.length) {
        return '';
    }
    const items = nodes
        .filter((node) => !(node.page && EXCLUDED_PAGES.has(node.page.toLowerCase())))
        .map((node) => {
            const childHtml =
                node.children && node.children.length
                    ? `<ul>${renderTocNodes(node.children, depth + 1)}</ul>`
                    : '';
            if (node.page) {
                return `<li><button type="button" data-page="${escapeHtmlAttr(node.page)}">${escapeHtml(node.name)}</button>${childHtml}</li>`;
            }
            return `<li><span class="folder">${escapeHtml(node.name)}</span>${childHtml}</li>`;
        })
        .join('');
    return depth === 0 ? `<ul>${items}</ul>` : items;
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function escapeHtmlAttr(value: string): string {
    return escapeHtml(value);
}
