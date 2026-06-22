# Building the RXDK extension (maintainers)

Not shipped in the VSIX. End-user docs: [INSTALL.md](INSTALL.md).

## Prerequisites

- Windows 10/11 x64
- Node.js 22+ and npm
- .NET 8 SDK (to publish managed host tools during VSIX build)

## Submodules

Host tools live under `external/`:

```powershell
git submodule update --init external/RXDK-Tools
```

| Dependency | Provides |
|------------|----------|
| [RXDK-SDK](https://github.com/Team-Resurgent/RXDK-SDK) | Consumer headers/libs — **git-cloned on extension activate** to `%ProgramData%\RXDK\sdk` (Windows) or XDG equivalent |
| [RXDK-Tools](https://github.com/Team-Resurgent/RXDK-Tools) | Managed host tools (`xbcp`, `imagebld`, `xbox-launch`, `xboxdbg-bridge`) — published on CI via `dotnet` |
| [xdvdfs](https://github.com/Team-Resurgent/xdvdfs/releases/latest) | XISO packer — **downloaded** at build time for `win-x64`, `linux-x64`, `osx-x64`, `osx-arm64` (tag pinned in `scripts/xdvdfs-release.txt`; no submodule, no Rust/Zig) |

## Build output (repo root)

Generated artifacts (gitignored):

| Path | Contents |
|------|----------|
| `dist/extension/` | Compiled extension host (`tsc` from `src/`) |
| `dist/debug/` | Compiled Xbox debug adapter (`tsc` from `debug/src/`) — entry point `./dist/debug/adapter.js` in `package.json` |
| `sdk/` | Assembled SDK scripts + host tools for the VSIX |
| `vendor/xdvdfs/publish/` | Cached xdvdfs release binaries per RID |
| `rxdk-vscode-*.vsix` | Packaged extension |
| `rxdk-vscode-*.zip` | Release bundle: VSIX + `install-extension.*` + `README-INSTALL.txt` |

User Xbox projects still use their own `out/` folder for `.exe`/`.pdb` build output — that is unrelated to the extension install layout.

SDK build scripts are **source** under `scripts/sdk/` (tracked). `assemble-sdk.ps1` copies them into `sdk/scripts/` along with tools from RXDK-Tools.

## Assembly

`scripts/assemble-sdk.ps1` stages `sdk/`:

1. Copy `scripts/sdk/` → `sdk/scripts/`
2. Gather host tools into `sdk/tools/`:
   - `dotnet publish` from RXDK-Tools (default on CI and `build-vsix.ps1`)
   - `scripts/fetch-xdvdfs.ps1` — downloads [Team-Resurgent/xdvdfs](https://github.com/Team-Resurgent/xdvdfs/releases/latest) release zips
3. Write `sdk/VERSION.txt` with tool submodule SHA and xdvdfs release tag

Headers/libs are **not** bundled — the extension clones [RXDK-SDK](https://github.com/Team-Resurgent/RXDK-SDK) on first launch.

Shipped tools are listed in `scripts/required-tools.txt`.

Project templates are maintained in `templates/`.

## Xbox SDK documentation

XDK reference HTML lives in `docs/xboxsdk/` (tracked in git). At package time `scripts/bundle-xboxsdk-docs.ps1` creates `docs/xboxsdk.tar.gz` (~19 MB); only the archive ships in the VSIX. The extension extracts it to `%ProgramData%\RXDK\docs\xboxsdk` on activate.

## One command

```powershell
cd D:\Git\RXDK-VSCode
.\scripts\build-vsix.ps1
```

Produces `rxdk-vscode-<version>.vsix` and `rxdk-vscode-<version>.zip` (VSIX + cross-platform install scripts).

Full sync path (assemble + compile + package):

```powershell
.\scripts\sync-all.ps1 -Package -CrossPlatformTools -BuildTools
```

Fetch xdvdfs only:

```powershell
.\scripts\fetch-xdvdfs.ps1
```

Pin or bump the release in `scripts/xdvdfs-release.txt` (default `v0.8.3-TR`). CI uses `GITHUB_TOKEN`/`GH_TOKEN` for GitHub API calls (unauthenticated API is limited to **60 requests/hour per IP**, which shared Actions runners exceed quickly).

### CI

GitHub Actions workflow [`.github/workflows/build-vsix.yml`](../.github/workflows/build-vsix.yml):

| Job | Runner | Purpose |
|-----|--------|---------|
| `build` | `windows-latest` | Fetch xdvdfs release, publish managed tools, package VSIX + release zip |
| `release` | `ubuntu-latest` | Attach `rxdk-vscode-*.zip` and `.vsix` to GitHub Release when applicable |

**No Rust/Zig on CI.** xdvdfs comes from [Team-Resurgent/xdvdfs releases](https://github.com/Team-Resurgent/xdvdfs/releases/latest).

Triggers: push/PR to `main`/`master`, version tags `v*`, and **Actions → Run workflow**.

**Private RXDK-Tools submodule:** add a repository secret `SUBMODULES_TOKEN` — fine-grained PAT with **Contents: Read** on `RXDK-VSCode` and `RXDK-Tools`.

**Pinned submodule commits:** push commits in `RXDK-Tools` first, then push RXDK-VSCode (updates the submodule pointer).

### Install locally

```powershell
.\scripts\install-extension.ps1 -Build -Target both
```

Installs into **VS Code** and **Cursor** when both are present. On macOS/Linux the shell script uses the `code` / `cursor` CLI directly (no PowerShell). Use `-Build` from a repo clone only if PowerShell 7+ is installed.

## Platform notes

| Capability | Windows | macOS / Linux |
|------------|---------|---------------|
| VSIX install | Yes | Yes |
| Deploy / debug (xbcp, bridge) | Yes | Yes (.NET 8 runtime required) |
| Build Xbox titles (`cl.exe`) | Yes (VS2022 x86) | No |
