# Building the RXDK extension (maintainers)

Not shipped in the VSIX. End-user docs: [INSTALL.md](INSTALL.md).

## Prerequisites

- Windows 10/11 x64
- Node.js 18+ and npm
- .NET 8 SDK (to publish managed host tools during VSIX build)

## Submodules

Host tools live under `external/`:

```powershell
git submodule update --init external/RXDK-Tools external/xdvdfs
```

| Dependency | Provides |
|------------|----------|
| [RXDK-SDK](https://github.com/Team-Resurgent/RXDK-SDK) | Consumer headers/libs — **git-cloned on extension activate** to `%ProgramData%\RXDK\sdk` (Windows) or XDG equivalent |
| [RXDK-Tools](https://github.com/Team-Resurgent/RXDK-Tools) | Managed host tools (`xbcp`, `imagebld`, `xbox-launch`, `xboxdbg-bridge`) — published on CI via `dotnet` |
| [xdvdfs](https://github.com/antangelo/xdvdfs) | XISO packer — built with Rust + Zig for `win-x64`, `linux-x64`, `osx-x64`, `osx-arm64` |

## Build output (repo root)

Generated artifacts (gitignored):

| Path | Contents |
|------|----------|
| `dist/extension/` | Compiled extension host (`tsc` from `src/`) |
| `dist/debug/` | Compiled Xbox debug adapter (`tsc` from `debug/src/`) — entry point `./dist/debug/adapter.js` in `package.json` |
| `sdk/` | Assembled SDK scripts + host tools for the VSIX (including `xboxdbg-bridge`) |

Source for the debug adapter is under `debug/src/` (dev only; not included in the VSIX).

User Xbox projects still use their own `out/` folder for `.exe`/`.pdb` build output — that is unrelated to the extension install layout.

SDK build scripts are **source** under `scripts/sdk/` (tracked). `assemble-sdk.ps1` copies them into `sdk/scripts/` along with tools from RXDK-Tools.

## Assembly

`scripts/assemble-sdk.ps1` stages `sdk/`:

1. Copy `scripts/sdk/` → `sdk/scripts/`
2. Gather host tools into `sdk/tools/`:
   - `dotnet publish` from RXDK-Tools (default on CI and `build-vsix.ps1`)
   - `cargo build` from [antangelo/xdvdfs](https://github.com/antangelo/xdvdfs) (`scripts/build-xdvdfs.ps1`; requires Rust + Zig)
3. Write `sdk/VERSION.txt` with tool submodule SHA

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

Full sync path (assemble + compile + package):

```powershell
.\scripts\sync-all.ps1 -Package -CrossPlatformTools -BuildTools
```

### CI

GitHub Actions workflow [`.github/workflows/build-vsix.yml`](../.github/workflows/build-vsix.yml):

| Job | Runner | Purpose |
|-----|--------|---------|
| `build-xdvdfs-macos` | `macos-latest` | Build `xdvdfs` for `osx-x64` and `osx-arm64` (Xcode SDK) |
| `build` | `windows-latest` | Download macOS xdvdfs artifact, build win/linux xdvdfs (Zig), publish managed tools, package VSIX |
| `release` | `ubuntu-latest` | Attach VSIX to GitHub Release when applicable |

**macOS xdvdfs on CI:** the Windows job passes `-SkipXdvdfsMac` and uses the artifact from `build-xdvdfs-macos`. Local Windows/Linux builds can still cross-compile macOS xdvdfs with Zig (omit `-SkipXdvdfsMac`), or run `scripts/build-xdvdfs-macos.sh` on a Mac.

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
