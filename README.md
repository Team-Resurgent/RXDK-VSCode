# RXDK for VS Code

<p align="center"><b>Original Xbox development in VS Code / Cursor — project templates, build, deploy, and native debugging for the open RXDK SDK</b></p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=TeamResurgent.rxdk-vscode"><img src="https://img.shields.io/visual-studio-marketplace/v/TeamResurgent.rxdk-vscode?label=Marketplace&logo=visualstudiocode" alt="VS Marketplace"></a>
  <a href="https://github.com/Team-Resurgent/RXDK-VSCode/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-GPLv3-blue.svg" alt="License: GPL v3"></a>
  <a href="https://github.com/Team-Resurgent/RXDK-VSCode/actions/workflows/build-vsix.yml"><img src="https://github.com/Team-Resurgent/RXDK-VSCode/actions/workflows/build-vsix.yml/badge.svg" alt="Build"></a>
  <a href="https://discord.gg/VcdSfajQGK"><img src="https://img.shields.io/badge/chat-on%20discord-7289da.svg?logo=discord" alt="Discord"></a>
</p>

<p align="center">
  <a href="https://ko-fi.com/J3J7L5UMN"><img src="https://img.shields.io/badge/ko--fi-Support-FF5E5B?style=for-the-badge&logo=ko-fi&logoColor=white" alt="ko-fi"></a>
  <a href="https://www.patreon.com/teamresurgent"><img src="https://img.shields.io/badge/Patreon-F96854?style=for-the-badge&logo=patreon&logoColor=white" alt="Patreon"></a>
</p>

<p align="center">
  <a href="https://github.com/Team-Resurgent/RXDK-VSCode/releases/latest"><img src="https://img.shields.io/badge/download-latest-brightgreen.svg?style=for-the-badge&logo=github" alt="Download"></a>
</p>

Build homebrew for the **original Xbox** in **VS Code** or **Cursor** against
[RXDK](https://github.com/Team-Resurgent/RXDK-Libs) — the open, self-contained,
MSVC-free Xbox SDK. Everything you need to write, build, deploy, and debug an Xbox
title, without the legacy XDK — on **Windows, Linux, or macOS**.

## Features

- **Project templates** — Original Xbox Game, Empty, Static Lib, DXT, Controller
  Input, Font Scroller, Network Server, Video Player, plus multi-project samples
  (Cube, Music Visualizer).
- **Build, deploy & debug with F5** — compiles the `.xbe`, deploys it to your devkit
  over XBDM, and attaches the source-level debugger: breakpoints, stepping, locals,
  watches, and rich value / container visualizers (STL types, enums by name, strings,
  and drill-in for `this` and struct/class pointers). **Launch in xemu** runs the
  title in the emulator instead.
- **Sample browser** — browse the full RXDK sample suite in a gallery and open any
  sample in a new window.
- **RXDK sidebar** — set the devkit IP, warm-reboot, switch Debug / Release, open the
  SDK / host-tools / docs folders, launch xbWatson and Xbox Neighborhood, and read the docs.
- **Component management** — see installed-vs-available versions of the SDK, docs,
  host tools, and samples, and update any of them (or all) with one click.
- **One-click setup** — downloads the SDK, host tools, documentation, the Zig
  toolchain, and the .NET runtime into the RXDK data folder.
- **Prebuilt XBE debugging** — attach the debugger to an existing `.xbe` + `.pdb`,
  no rebuild required.
- **Cross-platform** — the same build / deploy / debug pipeline on Windows, Linux, and macOS.

## Getting started

1. Install the extension and reload.
2. Open the **RXDK** sidebar (Activity Bar) and run **Complete Setup** to install the
   prerequisites (SDK, host tools, docs, Zig, .NET).
3. **New Project** (or **Open Sample**) → choose a template and a parent folder.
4. Set your devkit IP in the sidebar (**Devkit ▸ Set Xbox IP / Hostname**), then press
   **F5** to build, deploy, and debug.

The devkit address comes from the Xbox SDK **registry** on Windows
(`HKCU\Software\Microsoft\XboxSDK\XboxName`) and from `rxdk.defaultConsole` in
`settings.json` on macOS / Linux. Full install steps and troubleshooting:
**[docs/INSTALL.md](docs/INSTALL.md)**.

## Building from source

```bash
npm ci
npm run compile
npm run package                        # -> rxdk-vscode-<version>.vsix
code --install-extension rxdk-vscode-*.vsix
```

Host tools (`imagebld`, `xdvdfs`, `xbcp`, `xbox-launch`, `xboxdbg-bridge`, `xbwatson`)
are downloaded per-platform at runtime from
[RXDK-Tools](https://github.com/Team-Resurgent/RXDK-Tools/releases/latest); nothing is
bundled in the VSIX, so no submodule or .NET SDK build step is required. CI builds the
`.vsix` on push via [`.github/workflows/build-vsix.yml`](.github/workflows/build-vsix.yml).

## Links

- **Source:** https://github.com/Team-Resurgent/RXDK-VSCode
- **Open SDK (RXDK-Libs):** https://github.com/Team-Resurgent/RXDK-Libs
- **Sample suite:** https://github.com/Team-Resurgent/RXDK-Samples
- **Community:** [Discord](https://discord.gg/VcdSfajQGK) · [Patreon](https://www.patreon.com/teamresurgent) · [ko-fi](https://ko-fi.com/J3J7L5UMN)

---

*RXDK is a clean, from-source Xbox SDK — not affiliated with or endorsed by Microsoft.
Licensed under GPLv3.*
