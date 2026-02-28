/**
 * Update pre-built source files from a Codex.dmg
 *
 * Extracts the app.asar from a macOS DMG, pulls out the compiled main-process
 * bundle and webview UI assets, and copies them into the repo. After updating
 * it automatically re-runs all patch scripts so the new files are ready to
 * build.
 *
 * Requirements (already present in this project):
 *   • 7-Zip  – extracts the DMG          (must be in PATH or at default install path)
 *   • @electron/asar – reads the ASAR    (node_modules)
 *
 * Usage:
 *   node scripts/update-from-dmg.js [path/to/Codex.dmg]
 *
 * If no path is given the script looks for Codex.dmg in the project root.
 */
const fs   = require("fs");
const path = require("path");
const os   = require("os");
const { execFileSync, spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");

// ──────────────────────────────────────────────
//  Config
// ──────────────────────────────────────────────

// Path inside the DMG → ASAR location
const ASAR_IN_DMG  = "Codex Installer/Codex.app/Contents/Resources/app.asar";
// Path inside the DMG → macOS codex CLI binary
const CLI_IN_DMG_ARM64 = "Codex Installer/Codex.app/Contents/Resources/codex";

// Where to place files in the repo  (ASAR-internal prefix → repo dest)
const COPY_MAP = [
  { asarPrefix: ".vite/build",  repoDest: "src/.vite/build"  },
  { asarPrefix: "webview",      repoDest: "src/webview"       },
  { asarPrefix: "skills",       repoDest: "src/skills"        },
];

// Patch scripts to re-run after updating
const PATCH_SCRIPTS = [
  "scripts/patch-copyright.js",
  "scripts/patch-i18n.js",
  "scripts/patch-process-polyfill.js",
  "scripts/patch-chromium-flags.js",
  "scripts/patch-css-containment.js",
  "scripts/patch-app-sunset.js"
];

// ──────────────────────────────────────────────
//  Locate 7-Zip
// ──────────────────────────────────────────────

function find7zip() {
  const candidates = [
    "C:/Program Files/7-Zip/7z.exe",
    "C:/Program Files (x86)/7-Zip/7z.exe",
    "7z",
    "7z.exe",
  ];
  for (const c of candidates) {
    if (c.includes("/") && !fs.existsSync(c)) continue; // skip missing absolute paths
    try {
      const r = spawnSync(c, [], { stdio: "ignore", shell: false });
      // 7-zip exits 0 or 1 when called with no args – either means it's present
      if (r.pid) return c;
    } catch { /* try next */ }
  }
  throw new Error(
    "7-Zip not found. Install it from https://www.7-zip.org/ and ensure it is in PATH."
  );
}

// ──────────────────────────────────────────────
//  Extract ASAR from DMG using 7-Zip
// ──────────────────────────────────────────────

function run7z(sevenZip, args) {
  const result = spawnSync(sevenZip, args, {
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    windowsVerbatimArguments: false,
  });
  if (result.status !== 0) {
    throw new Error(`7-Zip failed:\n${result.stderr?.toString() || result.stdout?.toString()}`);
  }
  return result;
}

function extractAsarFromDmg(dmgPath, outDir, sevenZip) {
  console.log(`\n📦 Extracting app.asar from DMG …`);
  run7z(sevenZip, ["e", dmgPath, ASAR_IN_DMG, `-o${outDir}`, "-y"]);
  const asarPath = path.join(outDir, "app.asar");
  if (!fs.existsSync(asarPath)) {
    throw new Error(`app.asar not found in extracted output (${outDir})`);
  }
  console.log(`   ✅ app.asar extracted (${(fs.statSync(asarPath).size / 1024 / 1024).toFixed(1)} MB)`);
  return asarPath;
}

// ──────────────────────────────────────────────
//  Optionally extract macOS CLI binary
// ──────────────────────────────────────────────

function extractCliBinary(dmgPath, outDir, sevenZip) {
  const result = spawnSync(
    sevenZip,
    ["e", dmgPath, CLI_IN_DMG_ARM64, `-o${outDir}`, "-y"],
    { stdio: ["ignore", "pipe", "pipe"], shell: false }
  );
  if (result.status !== 0) return false;

  const extracted = path.join(outDir, "codex");
  if (!fs.existsSync(extracted)) return false;

  const destDir = path.join(ROOT, "resources", "bin", "darwin-arm64");
  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(extracted, path.join(destDir, "codex"));
  console.log(`   ✅ codex binary → resources/bin/darwin-arm64/codex`);
  return true;
}


// ──────────────────────────────────────────────
//  Re-run patch scripts
// ──────────────────────────────────────────────

function runPatches() {
  console.log("\n🔧 Re-applying patches …\n");
  for (const script of PATCH_SCRIPTS) {
    const scriptPath = path.join(ROOT, script);
    if (!fs.existsSync(scriptPath)) {
      console.log(`   ⚠️  ${script} not found – skipping`);
      continue;
    }
    process.stdout.write(`   ▶  ${script} … `);
    const result = spawnSync(process.execPath, [scriptPath], {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: ROOT,
    });
    if (result.status !== 0) {
      console.log("FAILED");
      console.error(result.stderr?.toString());
    } else {
      console.log("ok");
    }
  }
}

// ──────────────────────────────────────────────
//  Main
// ──────────────────────────────────────────────

async function main() {
  const dmgArg = process.argv[2];
  const dmgPath = dmgArg
    ? path.resolve(dmgArg)
    : path.join(ROOT, "Codex.dmg");

  if (!fs.existsSync(dmgPath)) {
    console.error(`❌ DMG not found: ${dmgPath}`);
    console.error("   Usage: node scripts/update-from-dmg.js [path/to/Codex.dmg]");
    process.exit(1);
  }

  console.log(`🍎 Source DMG : ${path.relative(ROOT, dmgPath)}`);
  console.log(`   Size       : ${(fs.statSync(dmgPath).size / 1024 / 1024).toFixed(1)} MB`);

  const sevenZip = find7zip();

  // Temp work directory (cleaned up at the end)
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-dmg-"));

  try {
    // 1. Pull app.asar out of the DMG
    const asarPath = extractAsarFromDmg(dmgPath, tmpDir, sevenZip);

    // 2. List all files in the ASAR and selectively extract the ones we need
    console.log("\n📂 Reading ASAR file list …");
    const asar = require("@electron/asar");
    const allFiles = asar.listPackage(asarPath);
    console.log(`   ✅ ${allFiles.length} entries in archive`);

    // Build a lookup: normalised path (forward slashes, no leading slash)
    //               → original path (as stored in the ASAR)
    const fileMap = new Map();
    for (const orig of allFiles) {
      const norm = orig.replace(/\\/g, "/").replace(/^\//, "");
      fileMap.set(norm, orig);
    }

    // Extract wanted files into repo
    console.log("\n📋 Extracting & copying files into repo …");
    let copied = 0;
    for (const { asarPrefix, repoDest } of COPY_MAP) {
      const prefix  = asarPrefix + "/";
      const destDir = path.join(ROOT, repoDest);
      const subset  = [...fileMap.keys()].filter(norm => norm.startsWith(prefix));

      if (subset.length === 0) {
        console.log(`   ⚠️  No files found for ${asarPrefix} – skipping`);
        continue;
      }

      // Wipe dest dir, then write each file fresh
      fs.rmSync(destDir, { recursive: true, force: true });
      fs.mkdirSync(destDir, { recursive: true });

      for (const norm of subset) {
        const orig     = fileMap.get(norm);           // original ASAR path (leading \ + backslashes)
        const asarKey  = orig.replace(/^\\/, "");     // extractFile wants no leading backslash
        const rel      = norm.slice(prefix.length);   // relative path inside dest
        const destFile = path.join(destDir, ...rel.split("/"));
        fs.mkdirSync(path.dirname(destFile), { recursive: true });
        let content;
        try {
          content = asar.extractFile(asarPath, asarKey);
        } catch (e) {
          if (e.message && e.message.includes("directory or link")) continue; // skip dir entries
          throw e;
        }
        fs.writeFileSync(destFile, content);
        copied++;
      }
      console.log(`   ✏️  ${asarPrefix}  →  ${repoDest}  (${subset.length} files)`);
    }
    console.log(`\n   ✅ ${copied} files updated`);

    // 4. Optionally pull darwin-arm64 CLI binary
    console.log("\n🔧 Checking codex CLI binary …");
    const cliDir = path.join(tmpDir, "cli");
    fs.mkdirSync(cliDir);
    const gotCli = extractCliBinary(dmgPath, cliDir, sevenZip);
    if (!gotCli) {
      console.log("   ℹ️  CLI binary not extracted (may need separate handling)");
    }

    // 5. Re-run patches on the fresh files
    runPatches();

    console.log("\n✅ Update complete — repo source files are now up to date.\n");

  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}


main().catch(err => {
  console.error("\n❌", err.message);
  process.exit(1);
});
