/**
 * Post-build patch: update copyright text
 *
 * Uses AST to precisely locate `setAboutPanelOptions({ copyright: "© OpenAI" })`
 * and replaces the copyright text with a custom value.
 *
 * Usage:
 *   node scripts/patch-copyright.js          # apply patch
 *   node scripts/patch-copyright.js --check  # dry-run check only, no modifications
 */
const fs = require("fs");
const path = require("path");
const { parse } = require("acorn");
const { walk } = require("./ast-utils");

// ──────────────────────────────────────────────
//  Config
// ──────────────────────────────────────────────

const OLD_COPYRIGHT = "\u00A9 OpenAI"; // © OpenAI  (original value from DMG source)
const NEW_COPYRIGHT = "PORTED by KAHME248";

// ──────────────────────────────────────────────
//  Layer 2: Declarative patch rules
// ──────────────────────────────────────────────

const RULES = [
  {
    id: "copyright",
    description: `copyright text: "${OLD_COPYRIGHT}" → "${NEW_COPYRIGHT}"`,
    /**
     * Match condition:
     *   Property node:
     *     key.name === "copyright" or key.value === "copyright"
     *     value is a Literal with value === OLD_COPYRIGHT
     *
     * Replacement target: the Literal node of the value (including quotes)
     */
    match(node) {
      if (node.type !== "Property") return null;

      // key matches "copyright"
      const keyName =
        node.key.type === "Identifier"
          ? node.key.name
          : node.key.type === "Literal"
            ? node.key.value
            : null;
      if (keyName !== "copyright") return null;

      // value is a Literal with the old copyright text
      if (
        node.value.type === "Literal" &&
        node.value.value === OLD_COPYRIGHT
      ) {
        return {
          start: node.value.start,
          end: node.value.end,
          replacement: JSON.stringify(NEW_COPYRIGHT),
          original: JSON.stringify(OLD_COPYRIGHT),
        };
      }

      return null;
    },
  },
];

// ──────────────────────────────────────────────
//  Layer 3: File location + surgical replacement
// ──────────────────────────────────────────────

/**
 * Auto-locate the main bundle file.
 * Prefers main-{hash}.js, falls back to main.js.
 */
function locateBundle() {
  const buildDir = path.join(__dirname, "..", "src", ".vite", "build");
  if (!fs.existsSync(buildDir)) {
    console.error("❌ Build directory not found:", buildDir);
    process.exit(1);
  }

  const files = fs.readdirSync(buildDir).filter((f) => /^main(-[^.]+)?\.js$/.test(f));

  if (files.length === 0) {
    console.error("❌ No main*.js bundle file found");
    process.exit(1);
  }

  // Prefer the hashed file (main-xxx.js), fall back to main.js
  const hashed = files.find((f) => f !== "main.js");
  const target = hashed || files[0];
  return path.join(buildDir, target);
}

/**
 * Collect all patch locations matched by the rules
 */
function collectPatches(ast) {
  const patches = [];
  const details = [];

  walk(ast, (node) => {
    for (const rule of RULES) {
      const result = rule.match(node);
      if (result) {
        patches.push({ ...result, ruleId: rule.id });
        details.push({
          ruleId: rule.id,
          position: result.start,
          change: `${result.original} → ${result.replacement}`,
        });
      }
    }
  });

  return { patches, details };
}

/**
 * Scan all matches (used in --check mode)
 */
function scanMatches(ast, source) {
  const CONTEXT_CHARS = 50;
  const matches = [];

  walk(ast, (node) => {
    if (node.type !== "Property") return;

    const keyName =
      node.key.type === "Identifier"
        ? node.key.name
        : node.key.type === "Literal"
          ? node.key.value
          : null;
    if (keyName !== "copyright") return;
    if (node.value.type !== "Literal") return;

    const ctxStart = Math.max(0, node.start - CONTEXT_CHARS);
    const ctxEnd = Math.min(source.length, node.end + CONTEXT_CHARS);

    // Check whether a rule would patch this node
    let wouldPatch = false;
    for (const rule of RULES) {
      if (rule.match(node)) {
        wouldPatch = true;
        break;
      }
    }

    matches.push({
      ruleId: "copyright",
      position: node.start,
      currentValue: node.value.value,
      snippet: source.slice(node.start, node.end),
      context: source.slice(ctxStart, ctxEnd),
      wouldPatch,
    });
  });

  return { matches };
}

// ──────────────────────────────────────────────
//  Main
// ──────────────────────────────────────────────

function main() {
  const isCheck = process.argv.includes("--check");
  const bundlePath = locateBundle();
  const relPath = path.relative(path.join(__dirname, ".."), bundlePath);

  console.log(`📄 Target file: ${relPath}`);

  const source = fs.readFileSync(bundlePath, "utf-8");
  console.log(`📏 File size: ${(source.length / 1024 / 1024).toFixed(1)} MB`);

  const t0 = Date.now();
  const ast = parse(source, {
    ecmaVersion: "latest",
    sourceType: "module",
  });
  const parseTime = Date.now() - t0;
  console.log(`🔍 AST parse: ${parseTime}ms`);

  // ── --check mode: show matches, do not modify ──
  if (isCheck) {
    console.log("\n── Match check (read-only) ──\n");
    const { matches } = scanMatches(ast, source);

    if (matches.length === 0) {
      console.log("⚠️  No copyright property nodes found");
      return;
    }

    for (let i = 0; i < matches.length; i++) {
      const m = matches[i];
      const tag = m.wouldPatch ? "🔧 to patch" : "── skip";
      console.log(`  #${i + 1}  [${m.ruleId}]  ${tag}`);
      console.log(`      Position: ${m.position}  Current value: "${m.currentValue}"`);
      console.log(`      Node: ${m.snippet}`);
      console.log(`      Context: ...${m.context}...`);
      console.log();
    }

    const patchable = matches.filter((m) => m.wouldPatch).length;
    console.log(
      `📊 ${matches.length} match(es), ${patchable} to patch, ${matches.length - patchable} skipped`
    );
    return;
  }

  // ── patch mode ──
  const { patches, details } = collectPatches(ast);

  if (patches.length === 0) {
    const { matches } = scanMatches(ast, source);
    if (matches.length > 0) {
      console.log(
        `ℹ️  Copyright is already up to date (${matches.length} match(es), 0 to patch), no changes needed`
      );
    } else {
      console.warn("⚠️  No copyright property nodes found");
    }
    return;
  }

  // Sort descending by start offset to avoid drift
  patches.sort((a, b) => b.start - a.start);

  let code = source;
  for (const p of patches) {
    code = code.slice(0, p.start) + p.replacement + code.slice(p.end);
  }

  fs.writeFileSync(bundlePath, code);

  for (const d of details) {
    console.log(`  ✏️  Position ${d.position}: ${d.change}`);
  }
  console.log(`\n✅ Copyright updated: ${NEW_COPYRIGHT}`);
}

main();
