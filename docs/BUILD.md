# Building the RXDK extension (maintainers)

Not shipped in the VSIX. End-user docs: [INSTALL.md](INSTALL.md).

## Prerequisites

- Windows 10/11 x64
- Node.js 18+ and npm
- .NET 8 SDK (to publish managed host tools during VSIX build)

For **rebuilding Xbox libs** locally (maintainers only):

- Visual Studio 2022+ with Desktop development with C++ (x86) — `cl.exe` / `link.exe`
- Run `.\scripts\sync-all.ps1 -Build` after changing RXDK-Libs, then commit `external/RXDK-Libs/out/include` and `out/lib`

## Submodules

Both dependencies live under `external/`:

```powershell
git submodule update --init --recursive external/RXDK-Libs external/RXDK-Tools
```

| Submodule | Provides |
|-----------|----------|
| [RXDK-Libs](https://github.com/Team-Resurgent/RXDK-Libs) | **Prebuilt** headers/libs in `out/include` and `out/lib` (committed); copied into `out/sdk/` |
| [RXDK-Tools](https://github.com/Team-Resurgent/RXDK-Tools) | Managed host tools (`xbcp`, `imagebld`, `xbox-launch`, `xboxdbg-bridge`) — published on CI via `dotnet` |

Vendored in-repo: `vendor/tools/xdvdfs.exe` (ISO pack; not in RXDK-Tools yet).

## Build output (`out/`)

All generated artifacts live under `out/` (gitignored):

| Path | Contents |
|------|----------|
| `out/extension/` | Compiled extension host (`tsc` from `src/`) |
| `out/debug/` | Compiled debug adapter (`tsc` from `debug/src/`) |
| `out/sdk/` | Assembled Xbox SDK bundle for the VSIX |

SDK build scripts are **source** under `scripts/sdk/` (tracked). `assemble-sdk.ps1` copies them into `out/sdk/scripts/` along with include/lib/tools from submodules.

## Assembly

`scripts/assemble-sdk.ps1` stages `out/sdk/`:

1. Copy `scripts/sdk/` → `out/sdk/scripts/`
2. Copy committed `include/` + `lib/` from `external/RXDK-Libs/out/`
3. Gather host tools into `out/sdk/tools/`:
   - `dotnet publish` from RXDK-Tools (default on CI and `build-vsix.ps1`)
   - `vendor/tools/xdvdfs.exe`
4. Write `out/sdk/VERSION.txt` with submodule SHAs

Shipped tools are listed in `scripts/required-tools.txt`.

Project templates are maintained in `templates/` (not copied from RXDK-Libs `samples/` during sync).

## Xbox SDK documentation

XDK reference HTML lives in `docs/xboxsdk/` (tracked in git, shipped in the VSIX) and is the source of truth — it is no longer regenerated from `XboxSDK.chm` at build time. The in-editor viewer renders it with a modern, theme-aware stylesheet. Open from the RXDK sidebar → **Documentation** → **Xbox SDK Reference**, or **RXDK: Xbox SDK Documentation**.

> The legacy `scripts/extract-xboxsdk-chm.ps1` importer remains for a one-off re-import only; the normal build does not run it.

## One command

```powershell
cd D:\Git\RXDK-VSCode
.\scripts\build-vsix.ps1
```

Or the full sync path (maintainer — rebuilds RXDK-Libs from source):

```powershell
.\scripts\sync-all.ps1 -Build -Package -CrossPlatformTools
```

Default VSIX/CI path uses **prebuilt** `RXDK-Libs/out/` and only publishes managed host tools (`-BuildTools`). `-Build` recompiles Xbox `.lib` files locally (requires MSVC + `sync-modern-stl`).

### CI

GitHub Actions workflow [`.github/workflows/build-vsix.yml`](../.github/workflows/build-vsix.yml):

| Job | Runner | Purpose |
|-----|--------|---------|
| `build` | `windows-latest` | checkout (with submodules), `setup-node`, `setup-dotnet`, `npm ci`, package VSIX, `upload-artifact` |
| `release` | `ubuntu-latest` | After a successful build on `master`/`main` (pre-release `vsix-<run>`), on `v*` tags (stable release), or manual **Publish release** |

**No MSVC on CI.** Xbox headers and `.lib` files come from committed `RXDK-Libs/out/`. After changing RXDK-Libs source, rebuild locally, commit `out/include` + `out/lib` in that repo, push, then bump the submodule pointer in RXDK-VSCode.

Triggers: push/PR to `main`/`master`, version tags `v*`, and **Actions → Run workflow**.

**Private submodules:** add a repository secret `SUBMODULES_TOKEN` — fine-grained PAT with **Contents: Read** on `RXDK-VSCode`, `RXDK-Libs`, and `RXDK-Tools`. The checkout step passes it to `actions/checkout` for submodule clones.

**Pinned submodule commits:** RXDK-VSCode records exact SHAs for `RXDK-Libs` / `RXDK-Tools`. After committing inside a submodule, **push that repo first**, then push RXDK-VSCode. If CI reports `not our ref <sha>`, the submodule commit is missing on GitHub.

Release assets use the built-in GitHub CLI (`gh release create`) with `GITHUB_TOKEN` — no third-party release actions.

### Install locally

```powershell
.\scripts\install-extension.ps1 -Target both
```

Installs into **VS Code** and **Cursor** when both are present. On macOS/Linux:

```bash
./scripts/install-extension.sh -Target both
```

Or from the repo root on Windows:

```cmd
install-extension.cmd -Build
```

## Platform notes

| Capability | Windows | macOS / Linux |
|------------|---------|---------------|
| VSIX install | Yes | Yes |
| Deploy / debug (xbcp, bridge) | Yes | Yes (.NET 8 runtime required) |
| Build Xbox titles (`cl.exe`) | Yes (VS2022 x86) | No |

Install into VS Code manually:

```powershell
& "$env:LOCALAPPDATA\Programs\Microsoft VS Code\bin\code.cmd" --install-extension D:\Git\RXDK-VSCode\rxdk-vscode-0.1.0.vsix --force
```
