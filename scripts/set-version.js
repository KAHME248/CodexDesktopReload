#!/usr/bin/env node
/**
 * Version helper — view or update the three release fields in package.json:
 *
 *   version          Semver app version shown in the About panel / installer
 *   codexBuildNumber Upstream Codex build number bundled in this release
 *   codexBuildFlavor Build flavour: "prod" | "dev"
 *
 * Usage:
 *   node scripts/set-version.js                         # print current values
 *   node scripts/set-version.js --app 1.1.0             # set app version only
 *   node scripts/set-version.js --build 520             # set build number only
 *   node scripts/set-version.js --flavor dev            # set flavor only
 *   node scripts/set-version.js --app 1.1.0 --build 520 --flavor prod
 *
 * npm alias:
 *   npm run version:set -- --app 1.1.0 --build 520
 */
'use strict';
const fs   = require('fs');
const path = require('path');

const PKG_PATH = path.join(__dirname, '..', 'package.json');
const pkg      = JSON.parse(fs.readFileSync(PKG_PATH, 'utf-8'));

// ── Parse args ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);

function flag(name) {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : null;
}

const newApp    = flag('--app');
const newBuild  = flag('--build');
const newFlavor = flag('--flavor');

// ── No args → print current state ───────────────────────────────────────────
if (!newApp && !newBuild && !newFlavor) {
  console.log('\nCurrent version fields in package.json:\n');
  console.log(`  version          ${pkg.version}`);
  console.log(`  codexBuildNumber ${pkg.codexBuildNumber}`);
  console.log(`  codexBuildFlavor ${pkg.codexBuildFlavor}`);
  console.log('\nTo update, run:');
  console.log('  npm run version:set -- --app <semver> --build <number> --flavor <prod|dev>\n');
  process.exit(0);
}

// ── Validate ─────────────────────────────────────────────────────────────────
if (newApp && !/^\d+\.\d+\.\d+/.test(newApp)) {
  console.error(`❌ --app must be a semver string (e.g. 1.2.0), got: ${newApp}`);
  process.exit(1);
}
if (newBuild && !/^\d+$/.test(newBuild)) {
  console.error(`❌ --build must be a positive integer, got: ${newBuild}`);
  process.exit(1);
}
if (newFlavor && newFlavor !== 'prod' && newFlavor !== 'dev') {
  console.error(`❌ --flavor must be "prod" or "dev", got: ${newFlavor}`);
  process.exit(1);
}

// ── Apply changes ────────────────────────────────────────────────────────────
const before = {
  version:          pkg.version,
  codexBuildNumber: pkg.codexBuildNumber,
  codexBuildFlavor: pkg.codexBuildFlavor,
};

// Write back using targeted regex replacements so blank lines and
// comment-style spacing in package.json are preserved exactly.
let raw = fs.readFileSync(PKG_PATH, 'utf-8');

function replaceField(text, key, value) {
  return text.replace(
    new RegExp(`("${key}"\\s*:\\s*)"[^"]*"`),
    `$1"${value}"`
  );
}

if (newApp)    raw = replaceField(raw, 'version',          newApp);
if (newBuild)  raw = replaceField(raw, 'codexBuildNumber', newBuild);
if (newFlavor) raw = replaceField(raw, 'codexBuildFlavor', newFlavor);

fs.writeFileSync(PKG_PATH, raw);

console.log('\nVersion fields updated:\n');
if (newApp)    console.log(`  version          ${before.version} → ${newApp}`);
if (newBuild)  console.log(`  codexBuildNumber ${before.codexBuildNumber} → ${newBuild}`);
if (newFlavor) console.log(`  codexBuildFlavor ${before.codexBuildFlavor} → ${newFlavor}`);
console.log();
