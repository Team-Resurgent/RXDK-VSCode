# RXDK VS Code Extension

All-in-one extension for original Xbox development in **VS Code** or **Cursor**. Bundles RXDK headers, libraries, and host tools so you can create projects, build, deploy, run, and debug without separate SDK checkouts.

## Quick start

1. **Install the extension** — from a [GitHub Release](https://github.com/Team-Resurgent/RXDK-VSCode/releases) VSIX, or build locally (see [Install](#install))
2. **Windows only:** Visual Studio 2022 with **Desktop development with C++** (x86 build tools) to compile titles
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
| **Build** Xbox titles (`cl.exe`) | Yes (VS2022 x86) | No |

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
| **Documentation** | In-editor Xbox SDK reference (`docs/xboxsdk/`) |

## Maintainers

Clone with submodules:

```powershell
git submodule update --init --recursive external/RXDK-Libs external/RXDK-Tools
```

Build a cross-platform VSIX (uses prebuilt `RXDK-Libs/out/`; publishes managed tools via .NET):

```powershell
.\scripts\build-vsix.ps1
```

To rebuild Xbox `.lib` files from source first (maintainers, requires MSVC):

```powershell
.\scripts\build-vsix.ps1 -Build
```

CI builds on push/PR via [`.github/workflows/build-vsix.yml`](.github/workflows/build-vsix.yml). It does **not** compile RXDK-Libs — commit `out/include` and `out/lib` in that submodule after local builds. Private submodules need a `SUBMODULES_TOKEN` repo secret (see **[docs/BUILD.md](docs/BUILD.md)**).

**Submodule workflow:** push commits in `RXDK-Libs` / `RXDK-Tools` first, then push RXDK-VSCode (updates the submodule pointer).

## What you provide

- **Build (Windows):** Visual Studio 2022 (`cl.exe` / `link.exe`, x86)
- Original Xbox devkit on the network
- Devkit IP or hostname (**Set Xbox IP**, XBSetIP, or `rxdk.defaultConsole` in settings)
