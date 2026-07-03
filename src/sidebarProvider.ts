import * as vscode from 'vscode';
import { readSdkVersion } from './sdkPath';
import { readDocsVersion } from './sdkDocsStaging';
import { findProjectManifest } from './projectManager';
import { getXboxAddressInfo } from './xboxConsole';
import { sdkDocsAvailable, extensionDocsAvailable } from './sdkDocs';
import { isPrebuiltManifest, isDxtManifest } from './projectTypes';
import { isPrerequisitesReadySync } from './prerequisites';
import { isXboxNeighborhoodShellRegistered } from './xboxNeighborhoodShell';

export class RxdkTreeItem extends vscode.TreeItem {
    constructor(
        label: string,
        collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly commandId?: string,
        description?: string,
        iconId?: string
    ) {
        super(label, collapsibleState);
        this.description = description;
        if (iconId) {
            this.iconPath = new vscode.ThemeIcon(iconId);
        }
        if (commandId) {
            this.command = { command: commandId, title: label };
        }
    }
}

export class RxdkSidebarProvider implements vscode.TreeDataProvider<RxdkTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<RxdkTreeItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(private readonly context: vscode.ExtensionContext) {}

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: RxdkTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: RxdkTreeItem): Promise<RxdkTreeItem[]> {
        if (!element) {
            if (!isPrerequisitesReadySync()) {
                return [
                    new RxdkTreeItem(
                        'Setup required',
                        vscode.TreeItemCollapsibleState.Expanded
                    ),
                ];
            }

            const version = readSdkVersion(this.context).split('\n')[0] ?? '';
            // Every root section carries an icon so their labels line up: a
            // tree item with an icon indents its label past the icon, so mixing
            // icon and icon-less siblings at the same level looks misaligned.
            const root: RxdkTreeItem[] = [
                new RxdkTreeItem(
                    'Devkit',
                    vscode.TreeItemCollapsibleState.Expanded,
                    undefined,
                    undefined,
                    'device-desktop'
                ),
                new RxdkTreeItem(
                    'Create project',
                    vscode.TreeItemCollapsibleState.Expanded,
                    undefined,
                    undefined,
                    'new-folder'
                ),
                new RxdkTreeItem(
                    'Documentation',
                    vscode.TreeItemCollapsibleState.Expanded,
                    undefined,
                    undefined,
                    'book'
                ),
                new RxdkTreeItem(
                    'Tools',
                    vscode.TreeItemCollapsibleState.Expanded,
                    undefined,
                    undefined,
                    'tools'
                ),
            ];
            const project = await findProjectManifest();
            if (project) {
                root.push(
                    new RxdkTreeItem(
                        'Build / run',
                        vscode.TreeItemCollapsibleState.Expanded,
                        undefined,
                        undefined,
                        'run'
                    )
                );
            }
            if (version) {
                root.push(
                    new RxdkTreeItem(
                        'Components',
                        vscode.TreeItemCollapsibleState.Collapsed,
                        undefined,
                        undefined,
                        'package'
                    )
                );
            }
            root.push(
                new RxdkTreeItem(
                    'Settings',
                    vscode.TreeItemCollapsibleState.None,
                    'rxdk.openSettings',
                    undefined,
                    'gear'
                )
            );
            return root;
        }

        if (element.label === 'Setup required') {
            return [
                new RxdkTreeItem(
                    'Complete RXDK setup…',
                    vscode.TreeItemCollapsibleState.None,
                    'rxdk.setupPrerequisites',
                    '.NET, RXDK-SDK, docs, Zig',
                    'warning'
                ),
            ];
        }

        if (element.label === 'Devkit') {
            const info = await getXboxAddressInfo();
            const items: RxdkTreeItem[] = [];
            if (info.address) {
                items.push(
                    new RxdkTreeItem(
                        info.address,
                        vscode.TreeItemCollapsibleState.None,
                        undefined,
                        undefined,
                        'vm-active'
                    )
                );
            } else {
                items.push(
                    new RxdkTreeItem(
                        '(not set)',
                        vscode.TreeItemCollapsibleState.None,
                        undefined,
                        'run XBSetIP or Set Xbox IP',
                        'warning'
                    )
                );
            }
            items.push(
                new RxdkTreeItem(
                    'Set Xbox IP / Hostname',
                    vscode.TreeItemCollapsibleState.None,
                    'rxdk.setXboxIp',
                    undefined,
                    'edit'
                ),
                new RxdkTreeItem(
                    'Warm Reboot',
                    vscode.TreeItemCollapsibleState.None,
                    'rxdk.rebootConsole',
                    undefined,
                    'sync'
                )
            );
            return items;
        }

        if (element.label === 'Tools') {
            const items: RxdkTreeItem[] = [
                new RxdkTreeItem(
                    'Launch xbWatson',
                    vscode.TreeItemCollapsibleState.None,
                    'rxdk.launchXbwatson',
                    'debug output viewer',
                    'output'
                ),
                new RxdkTreeItem(
                    'Launch xbNeighborhood',
                    vscode.TreeItemCollapsibleState.None,
                    'rxdk.launchXbNeighborhood',
                    'console file browser',
                    'files'
                ),
            ];
            // Windows-only, and only when the Explorer shell namespace extension
            // (Rxdk.XbShellExt) is actually registered under C:\Program Files\Xbox Neighborhood.
            if (await isXboxNeighborhoodShellRegistered()) {
                items.push(
                    new RxdkTreeItem(
                        'Open Xbox Neighborhood',
                        vscode.TreeItemCollapsibleState.None,
                        'rxdk.openXboxNeighborhood',
                        'Explorer shell namespace',
                        'root-folder'
                    )
                );
            }
            return items;
        }

        if (element.label === 'Build / run') {
            const project = await findProjectManifest();
            if (project && isPrebuiltManifest(project.manifest)) {
                return [
                    new RxdkTreeItem('Deploy', vscode.TreeItemCollapsibleState.None, 'rxdk.deploy', undefined, 'cloud-upload'),
                    new RxdkTreeItem('Debug', vscode.TreeItemCollapsibleState.None, 'rxdk.debug', undefined, 'bug'),
                    new RxdkTreeItem(
                        'Refresh source folder',
                        vscode.TreeItemCollapsibleState.None,
                        'rxdk.refreshPrebuiltSource',
                        undefined,
                        'folder-opened'
                    ),
                ];
            }
            if (project && isDxtManifest(project.manifest)) {
                // A DXT deploys to E:\dxt and loads on a warm reboot; there's no
                // title to launch and it can't be attached to (it runs inside the
                // debug monitor), so no Debug entry. "Deploy & Reboot" is the
                // build+deploy+reboot make-it-live action (the Run analog); a
                // neutral (non-debug) icon avoids VS Code auto-coloring it green.
                return [
                    new RxdkTreeItem('Build', vscode.TreeItemCollapsibleState.None, 'rxdk.build', undefined, 'tools'),
                    new RxdkTreeItem('Deploy', vscode.TreeItemCollapsibleState.None, 'rxdk.deploy', 'copy .dxt to E:\\dxt', 'cloud-upload'),
                    new RxdkTreeItem(
                        'Deploy & Reboot',
                        vscode.TreeItemCollapsibleState.None,
                        'rxdk.run',
                        'build, deploy & warm reboot',
                        'rocket'
                    ),
                    new RxdkTreeItem(
                        'Remove & Reboot',
                        vscode.TreeItemCollapsibleState.None,
                        'rxdk.removeDxt',
                        'delete from E:\\dxt & reboot',
                        'trash'
                    ),
                ];
            }
            return [
                new RxdkTreeItem('Build', vscode.TreeItemCollapsibleState.None, 'rxdk.build', undefined, 'tools'),
                new RxdkTreeItem('Deploy', vscode.TreeItemCollapsibleState.None, 'rxdk.deploy', undefined, 'cloud-upload'),
                new RxdkTreeItem('Run', vscode.TreeItemCollapsibleState.None, 'rxdk.run', undefined, 'play'),
                new RxdkTreeItem('Debug', vscode.TreeItemCollapsibleState.None, 'rxdk.debug', undefined, 'bug'),
            ];
        }

        const label = typeof element.label === 'string' ? element.label : element.label?.label ?? '';
        if (label === 'Components') {
            const sdkVersion = readSdkVersion(this.context).split('\n')[0]?.trim() || '';
            const docsVersion = readDocsVersion(this.context).split('\n')[0]?.trim() || '';
            return [
                // The setup page manages/updates every component (SDK, docs, tools,
                // Zig, .NET) in one place -- more sensible than a lone "fetch SDK".
                new RxdkTreeItem(
                    'Check for updates…',
                    vscode.TreeItemCollapsibleState.None,
                    'rxdk.setupPrerequisites',
                    'SDK, docs & tools',
                    'cloud-download'
                ),
                new RxdkTreeItem(
                    'Open SDK folder',
                    vscode.TreeItemCollapsibleState.None,
                    'rxdk.openSdkFolder',
                    sdkVersion || 'include + lib',
                    'folder-opened'
                ),
                new RxdkTreeItem(
                    'Open tools folder',
                    vscode.TreeItemCollapsibleState.None,
                    'rxdk.openToolsFolder',
                    'imagebld, xdvdfs, xbcp…',
                    'folder-opened'
                ),
                new RxdkTreeItem(
                    'Open docs folder',
                    vscode.TreeItemCollapsibleState.None,
                    'rxdk.openDocsFolder',
                    docsVersion || 'Xbox SDK + RXDK docs',
                    'folder-opened'
                ),
            ];
        }

        if (element.label === 'Documentation') {
            const items: RxdkTreeItem[] = [
                new RxdkTreeItem(
                    'RXDK Extension Docs',
                    vscode.TreeItemCollapsibleState.None,
                    'rxdk.openExtensionDocs',
                    extensionDocsAvailable(this.context) ? undefined : 'Install docs from RXDK Setup',
                    'book'
                ),
                new RxdkTreeItem(
                    'Xbox SDK Reference',
                    vscode.TreeItemCollapsibleState.None,
                    'rxdk.openSdkDocs',
                    sdkDocsAvailable(this.context) ? undefined : 'Install Xbox SDK docs from RXDK Setup',
                    'book'
                ),
            ];
            return items;
        }

        if (element.label === 'Create project') {
            return [
                new RxdkTreeItem(
                    'New Project…',
                    vscode.TreeItemCollapsibleState.None,
                    'rxdk.newProject',
                    'template wizard',
                    'add'
                ),
                new RxdkTreeItem(
                    'New Prebuilt XBE Project',
                    vscode.TreeItemCollapsibleState.None,
                    'rxdk.debugPrebuiltXbe',
                    undefined,
                    'file-binary'
                ),
            ];
        }

        return [];
    }
}
