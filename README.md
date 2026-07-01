# RXDK VS Code Extension

All-in-one extension for original Xbox development in **VS Code** or **Cursor**. Host tools and build scripts ship in the VSIX; headers and libraries are cloned from [RXDK-SDK](https://github.com/Team-Resurgent/RXDK-SDK) on first launch.

## Quick start

1. **Install the extension** — from a [GitHub Release](https://github.com/Team-Resurgent/RXDK-VSCode/releases) VSIX, or build locally (see [Install](#install))
2. **Zig** is installed automatically from the RXDK prerequisites panel (or use `zig` on PATH)
3. Connect an original Xbox devkit on your network
4. Open the **RXDK** sidebar → **Devkit** → **Set Xbox IP / Hostname**
5. **New Project** (or **New Prebuilt XBE Project** for an existing `.xbe`) → choose a parent folder
6. Open the project → **Build** or **F5** to debug

Full install steps and troubleshooting: **[docs/INSTALL.md](docs/INSTALL.md)**

## Install

### From GitHub Releases

Download `rxdk-vscode-*.vsix` from [Releases](https://github.com/Team-Resurgent/RXDK-VSCode/releases), then **Extensions → … → Install from VSIX…** and reload.

### From this repo

Cross-platform VSIX (bundles host tools for Windows, Linux, and macOS):

```powershell
# Windows — build and install into VS Code + Cursor
.\scripts\install-extension.ps1 -Build -Target both
```

```bash
# macOS / Linux (PowerShell 7+ required for the install script)
./scripts/install-extension.sh -Build -Target both
```

```cmd
REM Windows cmd
install-extension.cmd -Build
```

Install an existing VSIX without rebuilding: `.\scripts\install-extension.ps1 -Target both`

## Platform support

| Capability | Windows | macOS / Linux |
|------------|---------|---------------|
| Install extension | Yes | Yes |
| Deploy / debug devkit | Yes | Yes (.NET 8 runtime) |
| **Build** Xbox titles (Zig, x86 Windows target) | Yes | Yes |

## Project templates

| Template | Description |
|----------|-------------|
| D3D8 Triangle | D3D8 rotating triangle |
| DSound Tone | 500 Hz DirectSound test (includes `media/dsstdfx.bin`) |
| XInput Gamepad | Port 0 gamepad poll |
| XMV Play | XMV video playback sample |
| **Prebuilt XBE** | Debug/deploy an existing `.xbe` (+ `.pdb`, optional source root) without rebuilding in RXDK |

Each project uses `rxdk.project.json` at the workspace root. New projects get `.vscode/tasks.json`, `launch.json`, and related settings. Prebuilt projects can open a multi-root workspace with a **Source** folder for browsing title source.

## Sidebar

| Section | Actions |
|---------|---------|
| **Devkit** | Current Xbox IP (Windows: registry; macOS/Linux: settings JSON), Set Xbox IP |
| **Create project** | Templates, **New Prebuilt XBE Project** |
| **Build / run** | Build, Deploy, Run, Debug (when a project is open) |
| **Documentation** | In-editor Xbox SDK reference (installed from [RXDK-Docs](https://github.com/Team-Resurgent/RXDK-Docs) during setup) |
| **SDK** | Version, **Open SDK folder** (cloned include/lib) |

## Maintainers

Build a cross-platform VSIX:

```powershell
.\scripts\build-vsix.ps1
```

Host tools (`xbcp`, `imagebld`, `xbox-launch`, `xboxdbg-bridge`, `xbwatson`) are downloaded prebuilt from the [Team-Resurgent/RXDK-Tools releases](https://github.com/Team-Resurgent/RXDK-Tools/releases/latest) (pinned in [`scripts/rxdk-tools-release.txt`](scripts/rxdk-tools-release.txt)); `xdvdfs` from the [xdvdfs releases](https://github.com/Team-Resurgent/xdvdfs/releases/latest). No submodule or .NET SDK build step is needed.

CI builds on push/PR via [`.github/workflows/build-vsix.yml`](.github/workflows/build-vsix.yml).

## What you provide

- **Build:** [Zig](https://ziglang.org/) 0.16+ (installed by RXDK prerequisites, or on PATH)
- Original Xbox devkit on the network
- Devkit IP or hostname (**Set Xbox IP**, XBSetIP, or `rxdk.defaultConsole` in settings)
