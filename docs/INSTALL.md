# Installing and using RXDK

## Prerequisites

On first launch after installing the VSIX, **RXDK opens a setup page** and stays disabled until you install:

| Item | Purpose |
|------|---------|
| **.NET 8 runtime** | Deploy, debug, and other managed host tools |
| **RXDK-SDK** | Headers and libraries (cloned from GitHub; requires Git) |
| **Zig** | Build tooling and cross-compilation workflows |

Use **Install** on each row in the setup page, or **Open download page** for manual installs. When everything shows **Ready**, click **Continue** to enable RXDK. Reload the window if `.NET` or `zig` were just added to PATH.

Additional requirements (not installed by the extension):

- **Windows 10/11 x64** — required to **compile** Xbox titles (`cl.exe` / VS2022 x86)
- **macOS / Linux** — deploy and debug only (host tools bundled per platform)
- [Visual Studio 2022](https://visualstudio.microsoft.com/) with **Desktop development with C++** and **MSVC v143** (x86 build tools) — Windows build only
- [Git](https://git-scm.com/downloads) — required for the RXDK-SDK clone
- Original Xbox devkit on the network
- PowerShell 5.1+ (Windows) or bash + `code`/`cursor` CLI (macOS/Linux install script)

Host tools ship in the VSIX. Headers/libs come from the RXDK-SDK clone above.

## Install the extension

### GitHub Release (recommended)

Download `rxdk-vscode-<version>.zip` from [Releases](https://github.com/Team-Resurgent/RXDK-VSCode/releases). It contains the VSIX plus install scripts for Windows, macOS, and Linux.

```cmd
REM Windows — extract zip, then double-click or run:
install-extension.cmd
```

```powershell
# Windows PowerShell
.\install-extension.ps1 -Target both
```

```bash
# macOS / Linux — extract zip, then (uses code/cursor CLI; no PowerShell)
chmod +x install-extension.sh
./install-extension.sh -Target both
```

See `README-INSTALL.txt` inside the zip for details.

### Quick install from a repo clone

From a clone of this repo:

```powershell
# Windows — build cross-platform VSIX and install into VS Code + Cursor
.\scripts\install-extension.ps1 -Build -Target both
```

```bash
# macOS / Linux (native bash; -Build still needs PowerShell to run build-vsix.ps1)
./scripts/install-extension.sh -Build -Target both
```

```cmd
REM Windows double-click / cmd
install-extension.cmd -Build
```

Use `-Target vscode`, `-Target cursor`, or `-Target both` (default: `auto` installs into every editor found).

### VS Code UI

1. Open VS Code
2. Extensions (`Ctrl+Shift+X`) → `...` → **Install from VSIX...**
3. Select `rxdk-vscode-<version>.vsix`
4. Reload when prompted

### From this repo (recommended)

See **Quick install** above, or install an existing VSIX without rebuilding:

```powershell
.\scripts\install-extension.ps1 -Target both
```

### Command line (manual)

```powershell
& "$env:LOCALAPPDATA\Programs\Microsoft VS Code\bin\code.cmd" --install-extension D:\path\to\rxdk-vscode-0.1.0.vsix --force
```

## Verify

1. Extensions list shows **RXDK** (`rxdk-libs.rxdk-vscode`) enabled
2. Complete the **RXDK setup** page (.NET, RXDK-SDK, Zig) if it opens
3. Activity Bar → **RXDK** icon (or Command Palette → **RXDK: Show RXDK Sidebar**)
4. Command Palette → **RXDK: New Project**

## First project

1. **RXDK: New Project** → template → parent folder
2. **Devkit** → **Set Xbox IP / Hostname** (Windows: also updates registry like XBSetIP; macOS/Linux: saves to `settings.json`)
3. Open the project folder in VS Code
4. **Build** or **F5**

## Updating / uninstalling

```powershell
& "$env:LOCALAPPDATA\Programs\Microsoft VS Code\bin\code.cmd" --uninstall-extension rxdk-libs.rxdk-vscode
```

Install a newer VSIX the same way as above, then reload.

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Extension in Cursor, not VS Code | Use VS Code’s `code.cmd` path (see above) |
| RXDK icon missing | Command Palette → **RXDK: Show RXDK Sidebar**; right-click Activity Bar → enable RXDK |
| Deploy fails, empty ConsoleName | **Windows:** set IP via XBSetIP / Neighborhood, or **RXDK: Set Xbox IP**. **macOS/Linux:** set `rxdk.defaultConsole` in workspace/user settings JSON |
| Build fails: missing sdk/include | Open **RXDK: Complete Setup** and install RXDK-SDK, or **RXDK: Open SDK Folder** → Clone now |
| Setup page keeps reappearing | Install all three items (.NET, RXDK-SDK, Zig), click **Continue**, then reload if PATH tools are still missing |
| Build fails: `cl.exe not found` | Install VS2022 C++ workload; restart VS Code |
| F5 hangs / LNK1201 | Shift+F5 to stop debug session (PDB locked) |
| F5 deploys but debug never starts | Reinstall extension (`install-extension.cmd`); DAP needs `@vscode/debugadapter` bundled in VSIX. Check **Debug Console** for `xbox-dap:` lines |
| Empty console on debug | **Windows:** registry / Neighborhood, or **RXDK: Set Xbox IP**. **macOS/Linux:** `rxdk.defaultConsole` in settings JSON |
| Xbox SDK docs missing in extension | Reinstall from a packaged VSIX built from this repo (`docs/xboxsdk/` is tracked in git and bundled). |
