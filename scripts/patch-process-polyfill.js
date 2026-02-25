/**
 * Post-build patch: inject process polyfill (Windows compatibility)
 *
 * The Codex webview bundle accesses the `process` global directly
 * (e.g. process.env, process.platform), which does not exist in a browser
 * context. The Electron preload script injects `process` on macOS/Linux,
 * but on Windows it may be missing, causing a blank screen.
 *
 * This script:
 *   1. Generates a process-polyfill.js file
 *   2. Injects a <script> tag into index.html (loaded before the bundle)
 *
 * Usage:
 *   node scripts/patch-process-polyfill.js          # apply patch
 *   node scripts/patch-process-polyfill.js --check  # dry-run status check, no modifications
 */
const fs = require("fs");
const path = require("path");

// ──────────────────────────────────────────────
//  Polyfill content
// ──────────────────────────────────────────────

const POLYFILL_CONTENT = `// Process polyfill for browser/Windows compatibility
(function() {
  if (typeof window.process === "object" && typeof window.process.cwd === "function") return;
  function detectPlatform() {
    var ua = navigator.userAgent.toLowerCase();
    if (ua.indexOf("win") !== -1) return "win32";
    if (ua.indexOf("mac") !== -1) return "darwin";
    if (ua.indexOf("linux") !== -1) return "linux";
    return "browser";
  }
  window.process = window.process || {
    cwd: function() { return "/"; },
    env: {},
    platform: detectPlatform(),
    version: "",
    versions: {},
    nextTick: function(fn) { setTimeout(fn, 0); }
  };
})();
`;

const POLYFILL_FILENAME = "process-polyfill.js";
const SCRIPT_TAG = `<script src="./assets/${POLYFILL_FILENAME}"></script>`;

// ──────────────────────────────────────────────
//  File location
// ──────────────────────────────────────────────

function locateFiles() {
  const webviewDir = path.join(__dirname, "..", "src", "webview");
  const indexHtml = path.join(webviewDir, "index.html");
  const assetsDir = path.join(webviewDir, "assets");
  const polyfillJs = path.join(assetsDir, POLYFILL_FILENAME);

  if (!fs.existsSync(indexHtml)) {
    console.error("❌ index.html not found:", indexHtml);
    process.exit(1);
  }

  return { webviewDir, indexHtml, assetsDir, polyfillJs };
}

// ──────────────────────────────────────────────
//  Status check
// ──────────────────────────────────────────────

function checkStatus({ indexHtml, polyfillJs }) {
  const htmlContent = fs.readFileSync(indexHtml, "utf-8");
  const hasScriptTag = htmlContent.includes(POLYFILL_FILENAME);
  const hasPolyfillFile = fs.existsSync(polyfillJs);

  return { htmlContent, hasScriptTag, hasPolyfillFile };
}

// ──────────────────────────────────────────────
//  Main
// ──────────────────────────────────────────────

function main() {
  const isCheck = process.argv.includes("--check");
  const files = locateFiles();
  const relHtml = path.relative(path.join(__dirname, ".."), files.indexHtml);
  const relPolyfill = path.relative(path.join(__dirname, ".."), files.polyfillJs);

  const status = checkStatus(files);

  // ── --check mode ──
  if (isCheck) {
    console.log("\n── process polyfill check (read-only) ──\n");
    console.log(`  📄 ${relPolyfill}: ${status.hasPolyfillFile ? "✅ present" : "🔧 missing"}`);
    console.log(`  📄 ${relHtml} <script> tag: ${status.hasScriptTag ? "✅ injected" : "🔧 missing"}`);

    if (status.hasPolyfillFile && status.hasScriptTag) {
      console.log("\n✅ process polyfill is ready");
    } else {
      console.log("\n💡 Run node scripts/patch-process-polyfill.js to fix");
    }
    return;
  }

  // ── patch mode ──
  let changes = 0;

  // 1. Ensure the polyfill file exists
  if (!status.hasPolyfillFile) {
    fs.writeFileSync(files.polyfillJs, POLYFILL_CONTENT);
    console.log(`  ✏️  Created ${relPolyfill}`);
    changes++;
  } else {
    // Check if the content needs updating
    const existing = fs.readFileSync(files.polyfillJs, "utf-8");
    if (existing !== POLYFILL_CONTENT) {
      fs.writeFileSync(files.polyfillJs, POLYFILL_CONTENT);
      console.log(`  ✏️  Updated ${relPolyfill}`);
      changes++;
    }
  }

  // 2. Ensure the <script> tag is present in index.html
  if (!status.hasScriptTag) {
    let html = status.htmlContent;

    // Insert polyfill script before the first <script type="module" ...>
    const moduleScriptRegex = /<script\s+type="module"/;
    const match = html.match(moduleScriptRegex);

    if (match && match.index !== undefined) {
      html =
        html.slice(0, match.index) +
        SCRIPT_TAG +
        "\n    " +
        html.slice(match.index);
      fs.writeFileSync(files.indexHtml, html);
      console.log(`  ✏️  Injected <script> into ${relHtml}`);
      changes++;
    } else {
      // Fallback: insert after </title>
      const titleEnd = html.indexOf("</title>");
      if (titleEnd !== -1) {
        const insertPos = titleEnd + "</title>".length;
        html =
          html.slice(0, insertPos) +
          "\n    " +
          SCRIPT_TAG +
          html.slice(insertPos);
        fs.writeFileSync(files.indexHtml, html);
        console.log(`  ✏️  Injected <script> into ${relHtml} (after </title>)`);
        changes++;
      } else {
        console.error("❌ Could not locate an injection point in index.html");
        process.exit(1);
      }
    }
  }

  if (changes === 0) {
    console.log("ℹ️  process polyfill already ready, no changes needed");
  } else {
    console.log(`\n✅ process polyfill injected: ${changes} change(s)`);
  }
}

main();
