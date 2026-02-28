#!/usr/bin/env node
/**
 * Codex Desktop — interactive dev TUI
 *
 * Usage:
 *   node scripts/dev-menu.js   (or: npm run menu / run.cmd)
 */
'use strict';
const { spawnSync } = require('child_process');
const inquirerSelect = require('@inquirer/select');
const select        = inquirerSelect.default;
const { Separator } = inquirerSelect;
const confirm       = require('@inquirer/confirm').default;
const path          = require('path');
const fs            = require('fs');
const stringWidthModule = require('string-width');

const ROOT = path.join(__dirname, '..');
const NPM  = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const stringWidth = stringWidthModule.default ?? stringWidthModule;

// ── ANSI helpers ─────────────────────────────────────────────────────────────
const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  cyan:   '\x1b[36m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  red:    '\x1b[31m',
  white:  '\x1b[37m',
  bgBlue: '\x1b[44m',
};
const c = (color, text) => `${C[color]}${text}${C.reset}`;
const ANSI_RE = /\x1b\[[0-9;]*m/g;
const visibleWidth = (text = '') => text.replace(ANSI_RE, '').length;
const padAnsiEnd = (text = '', width = 0) => {
  const padding = width - visibleWidth(text);
  return padding > 0 ? `${text}${' '.repeat(padding)}` : text;
};
const centerAnsi = (text = '', width = 0) => {
  const remaining = width - visibleWidth(text);
  if (remaining <= 0) return text;
  const left = Math.floor(remaining / 2);
  const right = remaining - left;
  return `${' '.repeat(left)}${text}${' '.repeat(right)}`;
};

// ── Status probes ─────────────────────────────────────────────────────────────

function getPkg() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
}

function findFile(dir, pattern) {
  if (!fs.existsSync(dir)) return null;
  const f = fs.readdirSync(dir).find(n => pattern.test(n));
  return f ? path.join(dir, f) : null;
}

function patchStatus() {
  const buildDir   = path.join(ROOT, 'src', '.vite', 'build');
  const assetsDir  = path.join(ROOT, 'src', 'webview', 'assets');
  const indexHtml  = path.join(ROOT, 'src', 'webview', 'index.html');

  const mainJs    = findFile(buildDir,  /^main(-[^.]+)?\.js$/);
  const rendererJs = findFile(assetsDir, /^index-.*\.js$/);
  const html       = fs.existsSync(indexHtml) ? fs.readFileSync(indexHtml, 'utf-8') : '';
  const mainSrc    = mainJs    ? fs.readFileSync(mainJs,    'utf-8') : '';
  const rendSrc    = rendererJs ? fs.readFileSync(rendererJs, 'utf-8') : '';

  return {
    copyright: mainSrc.includes('PORTED by KAHME248'),
    chromium:  mainSrc.includes('/* chromium-flags-patch */'),
    polyfill:  html.includes('process-polyfill.js'),
    css:       html.includes('/* css-containment-patch */'),
    i18n:      !rendSrc.includes('"enable_i18n"') || rendSrc.includes('"enable_i18n"') && !rendSrc.match(/\.get\s*\(\s*"enable_i18n"/),
    sunset:    rendSrc.includes('/* app-sunset-patch */'),
  };
}

function cliStatus(platform, arch) {
  const key      = `${platform}-${arch}`;
  const binName  = platform === 'win32' ? 'codex.exe' : 'codex';
  const local    = path.join(ROOT, 'resources', 'bin', key, binName);
  if (fs.existsSync(local)) return { found: true, source: `resources/bin/${key}` };

  try {
    const { TARGET_TRIPLE_MAP } = require('./constants');
    const triple = TARGET_TRIPLE_MAP[key];
    if (triple) {
      const npm = path.join(ROOT, 'node_modules', '@cometix', 'codex', 'vendor', triple, 'codex', binName);
      if (fs.existsSync(npm)) return { found: true, source: '@cometix/codex' };
    }
  } catch { /* ignore */ }

  return { found: false, source: null };
}

// ── Status panel ──────────────────────────────────────────────────────────────

function renderHeader() {
  const pkg      = getPkg();
  const os       = require('os');
  const platform = process.platform;
  const arch     = os.arch();
  const patches  = patchStatus();
  const cli      = cliStatus(platform, arch);

  const W = 64; // inner width
  const line  = (txt = '') => `║  ${padAnsiEnd(txt, W - 4)}  ║`;
  const rule  = `╠${'═'.repeat(W)}╣`;
  const top   = `╔${'═'.repeat(W)}╗`;
  const bot   = `╚${'═'.repeat(W)}╝`;

  // Title row
  const title = 'Codex Desktop  —  Dev TUI';
  const titleRow = `║${centerAnsi(c('bold', c('cyan', title)), W)}║`;

  // Version row
  const verStr = `v${pkg.version}  |  Build #${pkg.codexBuildNumber}  |  ${pkg.codexBuildFlavor}`;
  const nodeStr = `Node ${process.version}`;
  const versionRow = line(
    c('green', verStr) + '  ' + c('dim', nodeStr)
  );

  // Patch row
  const tick = (ok) => ok ? c('green', '✔') : c('yellow', '✘');
  const patchRow = line(
    `Patches: ${tick(patches.copyright)} copy  ${tick(patches.chromium)} chromium  ` +
    `${tick(patches.polyfill)} poly  ${tick(patches.css)} css  ${tick(patches.i18n)} i18n  ${tick(patches.sunset)} sunset`
  );

  // CLI row
  const cliRow = line(
    `CLI binary: ${cli.found ? c('green', '✔ ' + cli.source) : c('red', '✘ not found')}` +
    `   Platform: ${c('dim', `${platform}-${arch}`)}`
  );

  console.log([top, titleRow, rule, versionRow, patchRow, cliRow, bot].join('\n'));
  console.log();
}

// ── Run helpers ───────────────────────────────────────────────────────────────

function run(cmd, args = [], opts = {}) {
  console.log(`\n${c('cyan', '▶')}  ${cmd} ${args.join(' ')}\n${'─'.repeat(60)}`);
  const result = spawnSync(cmd, args, { stdio: 'inherit', shell: true, cwd: ROOT, ...opts });
  const ok = result.status === 0;
  const exitInfo = result.status !== null ? `exit ${result.status}` : result.error ? result.error.message : 'killed by signal';
  console.log(`${'─'.repeat(60)}\n${ok ? c('green', '✅  Done') : c('red', '❌  Failed (' + exitInfo + ')')}`);
  return ok;
}

function runNode(script, args = []) {
  return run(process.execPath, [path.join(ROOT, script), ...args]);
}

function npmRun(scriptName) {
  return run(NPM, ['run', scriptName]);
}

function pause() {
  return new Promise(r => {
    process.stdout.write(`\n${c('dim', 'Press Enter to continue…')}`);
    process.stdin.once('data', r);
  });
}

// ── Menu ──────────────────────────────────────────────────────────────────────

const MENU_LABEL_WIDTH = 29;
const padMenuLabel = (text, width) => {
  const padding = width - stringWidth(text);
  return padding > 0 ? `${text}${' '.repeat(padding)}` : text;
};
const menuLabel = (icon, label, description) => `${padMenuLabel(`${icon}  ${label}`, MENU_LABEL_WIDTH)} - ${description}`;
const MENU_SEPARATOR = '-'.repeat(MENU_LABEL_WIDTH + 3 + 31);

const MENU = [
  { name: menuLabel('📥', 'Update source from DMG', 'extract latest Codex.dmg'), value: 'update-src'     },
  { name: menuLabel('🔧', 'Apply patches', 'copyright, i18n, sunset, polyfill, GPU, CSS'), value: 'patch' },
  { name: menuLabel('🔨', 'Rebuild native modules', 'node-pty + better-sqlite3'), value: 'rebuild-native' },
  { name: menuLabel('▶️', 'Start dev', 'launch Electron in dev mode'),           value: 'start'          },
  new Separator(MENU_SEPARATOR),
  { name: menuLabel('🏗️', 'Build (current platform)', 'patch + electron-forge make'), value: 'build-current'  },
  { name: menuLabel('🪟', 'Build Windows x64', 'electron-forge make win32/x64'), value: 'build-win'      },
  { name: menuLabel('🍎', 'Build macOS (arm64 + x64)', 'electron-forge make darwin'), value: 'build-mac'      },
  { name: menuLabel('🐧', 'Build Linux (x64 + arm64)', 'electron-forge make linux'), value: 'build-linux'    },
  { name: menuLabel('🌍', 'Build all platforms', 'mac + win + linux'),           value: 'build-all'      },
  new Separator(MENU_SEPARATOR),
  { name: menuLabel('🔢', 'Set version', 'update version / build / flavor'),     value: 'set-version'    },
  { name: menuLabel('📦', 'Install deps', 'npm install --ignore-scripts'),       value: 'install'        },
  new Separator(MENU_SEPARATOR),
  { name: menuLabel('🚪', 'Exit', 'quit the menu'),                              value: 'exit'           },
];

// ── Handlers ──────────────────────────────────────────────────────────────────

async function handleChoice(choice) {
  switch (choice) {
    case 'update-src': {
      const dmg = path.join(ROOT, 'Codex.dmg');
      if (!fs.existsSync(dmg)) {
        console.log(`\n${c('yellow', '⚠️')}  Codex.dmg not found at project root.`);
        const custom = await confirm({ message: 'Continue anyway (script will show exact error)?' });
        if (!custom) break;
      }
      runNode('scripts/update-from-dmg.js');
      break;
    }

    case 'patch':
      runNode('scripts/patch-copyright.js')   &&
      runNode('scripts/patch-i18n.js')         &&
      runNode('scripts/patch-app-sunset.js')   &&
      runNode('scripts/patch-process-polyfill.js') &&
      runNode('scripts/patch-chromium-flags.js')   &&
      runNode('scripts/patch-css-containment.js');
      break;

    case 'rebuild-native':
      runNode('scripts/rebuild-native.js');
      break;

    case 'start':
      runNode('scripts/start-dev.js');
      break;

    case 'build-current': npmRun('forge:make');     break;
    case 'build-win':     npmRun('build:win-x64');  break;
    case 'build-mac':     npmRun('build:mac');       break;
    case 'build-linux':   npmRun('build:linux');     break;

    case 'build-all': {
      const sure = await confirm({
        message: 'Build ALL platforms (mac + win + linux)? This takes a while.',
        default: false,
      });
      if (sure) npmRun('build:all');
      break;
    }

    case 'set-version': {
      const input = require('@inquirer/input').default;
      const pkg   = getPkg();
      console.log(`\n  Current: v${pkg.version}  |  Build #${pkg.codexBuildNumber}  |  ${pkg.codexBuildFlavor}\n`);
      const appV   = await input({ message: `App version   (Enter to keep ${pkg.version}):`,         default: pkg.version });
      const buildN = await input({ message: `Build number  (Enter to keep ${pkg.codexBuildNumber}):`, default: String(pkg.codexBuildNumber) });
      const flavor = await input({ message: `Build flavor  (Enter to keep ${pkg.codexBuildFlavor}):`, default: pkg.codexBuildFlavor });
      runNode('scripts/set-version.js', ['--app', appV, '--build', buildN, '--flavor', flavor]);
      break;
    }

    case 'install':
      run(NPM, ['install', '--ignore-scripts']);
      break;

    case 'exit':
      console.log(`\n${c('dim', 'Bye!')}\n`);
      process.exit(0);
  }
}

// ── Main loop ─────────────────────────────────────────────────────────────────

async function main() {
  console.clear();
  renderHeader();

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const choice = await select({
      message: 'What do you want to do?',
      choices: MENU,
      pageSize: MENU.length,
    });

    await handleChoice(choice);

    if (choice !== 'start') {
      await pause();
      console.clear();
      renderHeader(); // refresh status panel on every return
    }
  }
}

main().catch(err => {
  if (err.name === 'ExitPromptError') process.exit(0); // Ctrl+C
  console.error(c('red', '❌'), err.message);
  process.exit(1);
});
