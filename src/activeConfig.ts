// The "active configuration" name consulted by readProjectManifestAt when it collapses a
// multi-config rxdk.project.json to one configuration during a build/deploy/generate. Kept in a
// tiny dependency-free module so both the low-level loader (xboxSdkPaths) and the UI/build layers
// can touch it without an import cycle. Undefined = use the manifest's defaultConfiguration/first.
let active: string | undefined;

export function getActiveConfiguration(): string | undefined {
    return active;
}

export function setActiveConfiguration(name: string | undefined): void {
    active = name;
}
