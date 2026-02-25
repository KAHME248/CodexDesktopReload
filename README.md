# Codex Desktop Rebuild

Cross-platform Electron wrapper for the OpenAI Codex Desktop app.
Pre-built bundles are patched at build time; native modules are rebuilt for the target platform.

## Supported Platforms

| Platform | Architecture | Status |
|----------|--------------|--------|
| Windows  | x64          | ✅     |
| macOS    | x64, arm64   | ✅     |
| Linux    | x64, arm64   | ✅     |

---

## Quick Start

### Windows — double-click

```
run.cmd
```

Automatically installs dependencies on first run, then opens the interactive TUI.

### Any platform — terminal

```bash
npm install
npm run menu       # open TUI
npm run dev        # launch Electron directly
```

---

## Interactive TUI (`run.cmd` / `npm run menu`)

A live status panel is shown at the top of every screen and refreshes after each action:

```
╔══════════════════════════════════════════════════════════════╗
║                  Codex Desktop  —  Dev TUI                   ║
╠══════════════════════════════════════════════════════════════╣
║  v1.0.4  |  Build #517  |  prod    Node v24.x.x              ║
║  Patches: ✔ copyright  ✔ chromium  ✔ polyfill  ✔ css  ✔ i18n║
║  CLI binary: ✔ @cometix/codex   Platform: win32-x64          ║
╚══════════════════════════════════════════════════════════════╝
```

| Option | Description |
|--------|-------------|
| 📥 Update source from DMG | Extract latest bundles from `Codex.dmg` |
| 🔧 Apply patches | Re-run all post-build patch scripts |
| 🔨 Rebuild native modules | Rebuild `node-pty` + `better-sqlite3` for Electron |
| ▶️ Start dev | Launch Electron in dev mode |
| 🏗️ Build (current platform) | `patch` + `electron-forge make` |
| 🪟 Build Windows x64 | `electron-forge make win32/x64` |
| 🍎 Build macOS (arm64 + x64) | `electron-forge make darwin` |
| 🐧 Build Linux (x64 + arm64) | `electron-forge make linux` |
| 🌍 Build all platforms | mac + win + linux |
| 🔢 Set version | Inline prompts to update version / build / flavor |
| 📦 Install deps | `npm install --ignore-scripts` |

---

## Version Management

Three fields in `package.json` are grouped at the top for easy editing:

```json
"version":          "1.0.4",
"codexBuildNumber": "517",
"codexBuildFlavor": "prod"
```

Or use the script (also available via the TUI's **🔢 Set version** option):

```bash
# Show current values
npm run version:set

# Update all three at once
npm run version:set -- --app 1.1.0 --build 520 --flavor prod

# Update individually
npm run version:set -- --app 1.1.0
npm run version:set -- --build 520
npm run version:set -- --flavor dev
```

---

## Build Commands

```bash
# Current platform
npm run build

# Specific platform / arch
npm run build:win-x64
npm run build:mac-arm64
npm run build:mac-x64
npm run build:linux-x64
npm run build:linux-arm64

# All platforms
npm run build:all
```

---

## Patch Scripts

Run automatically before every build via `npm run patch`:

| Script | What it does |
|--------|-------------|
| `patch-copyright.js` | Replaces `© OpenAI` with `PORTED by KAHME248` |
| `patch-i18n.js` | Bypasses Statsig gate — forces `enable_i18n = true` |
| `patch-process-polyfill.js` | Injects `process` polyfill for renderer (Windows fix) |
| `patch-chromium-flags.js` | Prepends GPU rasterization + background-throttling flags |
| `patch-css-containment.js` | Injects `contain: content` on code blocks |

Each script is idempotent — safe to run multiple times.

---

## Updating Source Bundles from a DMG

Place a newer `Codex.dmg` in the project root, then run:

```bash
npm run update-src
# or via TUI: 📥 Update source from DMG
```

Extracts `app.asar` from the DMG, copies `.vite/build`, `webview`, and `skills` into `src/`,
then re-applies all patches automatically.

**Requires:** [7-Zip](https://www.7-zip.org/) installed and in `PATH`
(Windows: default install path `C:\Program Files\7-Zip\` is detected automatically).

---

## Project Structure

```
├── run.cmd                       ← Windows entry point (double-click)
├── forge.config.js               ← Electron Forge config (fuses, pruning, packaging)
├── package.json                  ← version / buildNumber / buildFlavor at top
├── src/
│   ├── .vite/build/              # Main-process bundle (Electron)
│   └── webview/                  # Renderer UI assets
├── resources/
│   ├── bin/                      # Optional local CLI binaries per platform
│   ├── electron.icns / .ico      # App icons
│   └── notification.wav
└── scripts/
    ├── dev-menu.js               # TUI (npm run menu / run.cmd)
    ├── start-dev.js              # Dev launcher (npm run dev)
    ├── set-version.js            # Version helper (npm run version:set)
    ├── update-from-dmg.js        # DMG source extractor
    ├── rebuild-native.js         # Native module rebuilder
    ├── constants.js              # Shared TARGET_TRIPLE_MAP
    ├── ast-utils.js              # Shared AST walk() helper
    ├── patch-copyright.js
    ├── patch-i18n.js
    ├── patch-process-polyfill.js
    ├── patch-chromium-flags.js
    └── patch-css-containment.js
```

---

## npm Scripts Reference

| Script | Description |
|--------|-------------|
| `npm run menu` / `npm run tui` | Open the interactive TUI |
| `npm run dev` / `npm start` | Launch Electron in dev mode |
| `npm run patch` | Apply all post-build patches |
| `npm run update-src` | Extract bundles from `Codex.dmg` |
| `npm run version:set` | View / update version fields |
| `npm run rebuild:native` | Rebuild native modules for current Electron |
| `npm run forge:package` | Package without making installers |
| `npm run forge:make` | Patch + package + make installers |
| `npm run build` | Alias for `forge:make` on current platform |
| `npm run build:all` | Build for all platforms |

---

## Requirements

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | ≥ 18 LTS | v24 recommended |
| npm | ≥ 9 | bundled with Node |
| Electron | ~40.x | pinned via `package.json` |
| 7-Zip | any | only needed for `update-src` |
| Visual Studio Build Tools | 2019+ | Windows only, for native modules |

---

## Credits

**Ported by KAHME248**

- [OpenAI Codex](https://github.com/openai/codex) — original Codex CLI (Apache-2.0)
- [Cometix Space](https://github.com/Haleclipse) — [@cometix/codex](https://www.npmjs.com/package/@cometix/codex) pre-built binaries
- [Electron Forge](https://www.electronforge.io/) — build toolchain

## License

This project packages the Codex Desktop app for cross-platform distribution.
The original Codex CLI by OpenAI is licensed under Apache-2.0.
