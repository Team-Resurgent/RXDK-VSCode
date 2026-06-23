import * as vscode from 'vscode';
import { readSdkVersion } from './sdkPath';
import { findProjectManifest } from './projectManager';
import { getXboxAddressInfo } from './xboxConsole';
import { sdkDocsAvailable } from './sdkDocs';
import { isPrebuiltManifest } from './projectTypes';
import { isPrerequisitesReadySync } from './prerequisites';

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
            const root: RxdkTreeItem[] = [
                new RxdkTreeItem(
                    'Devkit',
                    vscode.TreeItemCollapsibleState.Expanded
                ),
                new RxdkTreeItem(
                    'Create project',
                    vscode.TreeItemCollapsibleState.Expanded
                ),
                new RxdkTreeItem(
                    'Documentation',
                    vscode.TreeItemCollapsibleState.Expanded
                ),
            ];
            const project = await findProjectManifest();
            if (project) {
                root.push(
                    new RxdkTreeItem(
                        'Build / run',
                        vscode.TreeItemCollapsibleState.Expanded
                    )
                );
            }
            if (version) {
                root.push(
                    new RxdkTreeItem(
                        `SDK: ${version}`,
                        vscode.TreeItemCollapsibleState.Collapsed
                    )
                );
            }
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
                const sourceLabel =
                    info.source === 'registry'
                        ? 'registry'
                        : info.source === 'workspace'
                          ? process.platform === 'win32'
                              ? 'settings override'
                              : 'settings JSON'
                          : '';
                items.push(
                    new RxdkTreeItem(
                        info.address,
                        vscode.TreeItemCollapsibleState.None,
                        undefined,
                        sourceLabel,
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
                    'Launch xbWatson',
                    vscode.TreeItemCollapsibleState.None,
                    'rxdk.launchXbwatson',
                    'debug output viewer',
                    'output'
                )
            );
            return items;
        }

        if (element.label === 'Build / run') {
            const project = await findProjectManifest();
            if (project && isPrebuiltManifest(project.manifest)) {
                return [
                    new RxdkTreeItem('Deploy', vscode.TreeItemCollapsibleState.None, 'rxdk.deploy'),
                    new RxdkTreeItem('Debug', vscode.TreeItemCollapsibleState.None, 'rxdk.debug'),
                    new RxdkTreeItem(
                        'Refresh source folder',
                        vscode.TreeItemCollapsibleState.None,
                        'rxdk.refreshPrebuiltSource',
                        undefined,
                        'folder-opened'
                    ),
                ];
            }
            return [
                new RxdkTreeItem('Build', vscode.TreeItemCollapsibleState.None, 'rxdk.build'),
                new RxdkTreeItem('Deploy', vscode.TreeItemCollapsibleState.None, 'rxdk.deploy'),
                new RxdkTreeItem('Run', vscode.TreeItemCollapsibleState.None, 'rxdk.run'),
                new RxdkTreeItem('Debug', vscode.TreeItemCollapsibleState.None, 'rxdk.debug'),
            ];
        }

        const label = typeof element.label === 'string' ? element.label : element.label?.label ?? '';
        if (label.startsWith('SDK:')) {
            return [
                new RxdkTreeItem(
                    'Fetch latest SDK',
                    vscode.TreeItemCollapsibleState.None,
                    'rxdk.fetchLatestSdk',
                    'RXDK-SDK from GitHub',
                    'cloud-download'
                ),
                new RxdkTreeItem(
                    'Open SDK folder',
                    vscode.TreeItemCollapsibleState.None,
                    'rxdk.openSdkFolder',
                    'include + lib',
                    'folder-opened'
                ),
            ];
        }

        if (element.label === 'Documentation') {
            const items: RxdkTreeItem[] = [
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
