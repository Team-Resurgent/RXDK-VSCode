# Building the RXDK extension (maintainers)

Not shipped in the VSIX. End-user docs: [INSTALL.md](INSTALL.md).

## Prerequisites

- Windows 10/11 x64
- Node.js 18+ and npm
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

Vendored in-repo: `vendor/tools/xdvdfs.exe` (ISO pack; not in RXDK-Tools yet).

## Build output (`out/`)

All generated artifacts live under `out/` (gitignored):

| Path | Contents |
|------|----------|
| `out/extension/` | Compiled extension host (`tsc` from `src/`) |
| `out/debug/` | Compiled debug adapter (`tsc` from `debug/src/`) |
| `out/sdk/` | Assembled SDK scripts + host tools for the VSIX |

SDK build scripts are **source** under `scripts/sdk/` (tracked). `assemble-sdk.ps1` copies them into `out/sdk/scripts/` along with tools from RXDK-Tools.

## Assembly

`scripts/assemble-sdk.ps1` stages `out/sdk/`:

1. Copy `scripts/sdk/` → `out/sdk/scripts/`
2. Gather host tools into `out/sdk/tools/`:
   - `dotnet publish` from RXDK-Tools (default on CI and `build-vsix.ps1`)
   - `vendor/tools/xdvdfs.exe`
3. Write `out/sdk/VERSION.txt` with tool submodule SHA

Headers/libs are **not** bundled — the extension clones [RXDK-SDK](https://github.com/Team-Resurgent/RXDK-SDK) on first launch.

Shipped tools are listed in `scripts/required-tools.txt`.

Project templates are maintained in `templates/`.

## Xbox SDK documentation

XDK reference HTML lives in `docs/xboxsdk/` (tracked in git, shipped in the VSIX). Open from the RXDK sidebar → **Documentation** → **Xbox SDK Reference**, or **RXDK: Xbox SDK Documentation**.

## One command

```powershell
cd D:\Git\RXDK-VSCode
.\scripts\build-vsix.ps1
```

Full sync path (assemble + compile + package):

```powershell
.\scripts\sync-all.ps1 -Package -CrossPlatformTools -BuildTools
```

### CI

GitHub Actions workflow [`.github/workflows/build-vsix.yml`](../.github/workflows/build-vsix.yml):

| Job | Runner | Purpose |
|-----|--------|---------|
| `build` | `windows-latest` | checkout (RXDK-Tools submodule), `setup-node`, `setup-dotnet`, `npm ci`, package VSIX, `upload-artifact` |
| `release` | `ubuntu-latest` | After a successful build on `master`/`main` (pre-release `vsix-<run>`), on `v*` tags (stable release), or manual **Publish release** |

**No MSVC on CI.** Xbox headers and `.lib` files are installed from [RXDK-SDK](https://github.com/Team-Resurgent/RXDK-SDK) when the user activates the extension.

Triggers: push/PR to `main`/`master`, version tags `v*`, and **Actions → Run workflow**.

**Private RXDK-Tools submodule:** add a repository secret `SUBMODULES_TOKEN` — fine-grained PAT with **Contents: Read** on `RXDK-VSCode` and `RXDK-Tools`.

**Pinned submodule commits:** push commits in `RXDK-Tools` first, then push RXDK-VSCode (updates the submodule pointer).

### Install locally

```powershell
.\scripts\install-extension.ps1 -Build -Target both
```

Installs into **VS Code** and **Cursor** when both are present. On macOS/Linux:

```bash
./scripts/install-extension.sh -Build -Target both
```

## Platform notes

| Capability | Windows | macOS / Linux |
|------------|---------|---------------|
| VSIX install | Yes | Yes |
| Deploy / debug (xbcp, bridge) | Yes | Yes (.NET 8 runtime required) |
| Build Xbox titles (`cl.exe`) | Yes (VS2022 x86) | No |
