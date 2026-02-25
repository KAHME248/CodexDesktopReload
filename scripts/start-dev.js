#!/usr/bin/env node
/**
 * Smart development startup script
 * Automatically detects system architecture and sets correct CLI path.
 *
 * Resolution order:
 *   1) resources/bin/<platform-arch>/codex(.exe)
 *   2) node_modules/@cometix/codex/vendor/<target-triple>/codex/codex(.exe)
 */

const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const TARGET_TRIPLE_MAP = {
  'darwin-x64': 'x86_64-apple-darwin',
  'darwin-arm64': 'aarch64-apple-darwin',
  'linux-x64': 'x86_64-unknown-linux-musl',
  'linux-arm64': 'aarch64-unknown-linux-musl',
  'win32-x64': 'x86_64-pc-windows-msvc',
};

function resolveCodexCli(platform, arch) {
  const platformArch = `${platform}-${arch}`;
  const cliName = platform === 'win32' ? 'codex.exe' : 'codex';

  const attempts = [];

  const localPath = path.join(__dirname, '..', 'resources', 'bin', platformArch, cliName);
  attempts.push(localPath);
  if (fs.existsSync(localPath)) {
    return { cliPath: localPath, source: 'resources/bin', attempts };
  }

  const targetTriple = TARGET_TRIPLE_MAP[platformArch];
  if (targetTriple) {
    const npmPath = path.join(
      __dirname,
      '..',
      'node_modules',
      '@cometix',
      'codex',
      'vendor',
      targetTriple,
      'codex',
      cliName,
    );
    attempts.push(npmPath);
    if (fs.existsSync(npmPath)) {
      return { cliPath: npmPath, source: 'node_modules/@cometix/codex', attempts };
    }
  }

  return { cliPath: null, source: null, attempts };
}

const platform = process.platform;
const arch = os.arch();

if (!TARGET_TRIPLE_MAP[`${platform}-${arch}`]) {
  console.error(`Unsupported platform/arch: ${platform}/${arch}`);
  process.exit(1);
}

const resolved = resolveCodexCli(platform, arch);
if (!resolved.cliPath) {
  console.error(`CLI not found for ${platform}/${arch}`);
  console.error('Checked paths:');
  for (const attempted of resolved.attempts) {
    console.error(`  - ${attempted}`);
  }
  console.error('Run `npm install` (to fetch @cometix/codex) or add binaries under resources/bin/.');
  process.exit(1);
}

console.log(`[start-dev] Platform: ${platform}, Arch: ${arch}`);
console.log(`[start-dev] CLI Source: ${resolved.source}`);
console.log(`[start-dev] CLI Path: ${resolved.cliPath}`);

const electronBin = require('electron');
const child = spawn(electronBin, ['.'], {
  cwd: path.join(__dirname, '..'),
  stdio: 'inherit',
  env: {
    ...process.env,
    CODEX_CLI_PATH: resolved.cliPath,
    BUILD_FLAVOR: process.env.BUILD_FLAVOR || 'dev',
    // Use app:// protocol to load bundled renderer assets (not Vite dev server)
    ELECTRON_RENDERER_URL: process.env.ELECTRON_RENDERER_URL || 'app://-/index.html',
  },
});

child.on('close', (code) => {
  process.exit(code ?? 0);
});
