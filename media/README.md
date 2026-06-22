# RXDK extension icons

| File | Size | Used for |
|------|------|----------|
| **`rxdk-icon.svg`** | 24×24 viewBox, mono `currentColor` | **Activity Bar** — RXDK lettermark (`package.json` → `viewsContainers.activitybar`) |
| **`extension-icon.png`** | 128×128 | **Extensions list** — marketplace / installed extension tile (`package.json` → `"icon"`) |

VS Code activity bar icons are always shown at **~24×24 CSS pixels** on screen — a 128×128 source is scaled down to that slot. Inactive icons also render at **60% opacity**. Use artwork that fills the square edge-to-edge; thin line art tends to look tiny.

After replacing icons: `install-extension.cmd -Build` or commit an updated `rxdk-vscode-*.vsix`.

## Codicons (not in this folder)

Command and sidebar row icons use VS Code built-in icons in `package.json` and `src/sidebarProvider.ts` — change `$(name)` or `ThemeIcon` ids there.
