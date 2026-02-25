/**
 * Post-build patch: unlock i18n multi-language support
 *
 * Codex ships a full react-intl i18n system (59 languages, 1,598 translations),
 * but it is gated behind a Statsig feature gate `codex-i18n`.
 *
 * Changing .get()'s default value is not enough — when the Statsig backend is
 * reachable, the server-side enable_i18n=false overrides the default.
 *
 * This script replaces the entire gate call `?.get("enable_i18n", ...)` with
 * `!0`, bypassing Statsig control entirely.
 *
 * Usage:
 *   node scripts/patch-i18n.js          # apply patch
 *   node scripts/patch-i18n.js --check  # dry-run check only, no modifications
 */
const fs = require("fs");
const path = require("path");
const { parse } = require("acorn");
const { walk } = require("./ast-utils");

// ──────────────────────────────────────────────
//  Layer 2: Declarative patch rules
// ──────────────────────────────────────────────

/**
 * Rules array — extensible
 *
 * Strategy: replace the entire ?.get("enable_i18n", ...) call with !0
 * so that i18n is always enabled regardless of what Statsig returns.
 */
const RULES = [
  {
    id: "enable_i18n",
    description: "gate call ?.get(\"enable_i18n\", ...) → !0",
    /**
     * Match condition:
     *   CallExpression (possibly wrapped in a ChainExpression)
     *   - callee is a MemberExpression with property.name === "get"
     *   - arguments[0] is Literal "enable_i18n"
     *   - arguments[1] exists (any value)
     *
     * Replacement range: the entire CallExpression (including optional-chain wrapper)
     *   ?.get("enable_i18n", !1)  →  !0
     *   ?.get("enable_i18n", !0)  →  !0
     */
    match(node, source) {
      // Match CallExpression wrapped in ChainExpression, or a bare CallExpression
      let callNode = null;
      let replaceNode = null; // outermost node to replace

      if (node.type === "ChainExpression" && node.expression?.type === "CallExpression") {
        callNode = node.expression;
        replaceNode = node; // replace the entire ChainExpression
      } else if (node.type === "CallExpression") {
        callNode = node;
        replaceNode = node;
      }

      if (!callNode) return null;

      const callee = callNode.callee;
      if (!callee || callee.type !== "MemberExpression") return null;
      if (getPropertyName(callee) !== "get") return null;

      const args = callNode.arguments;
      if (!args || args.length < 2) return null;
      if (args[0].type !== "Literal" || args[0].value !== "enable_i18n") return null;

      const original = source.slice(replaceNode.start, replaceNode.end);

      // Already patched (expression is exactly !0) → skip
      if (original === "!0") return null;

      return {
        start: replaceNode.start,
        end: replaceNode.end,
        replacement: "!0",
        original,
      };
    },
  },
];

function getPropertyName(memberExpr) {
  if (!memberExpr || !memberExpr.property) return null;
  if (!memberExpr.computed && memberExpr.property.type === "Identifier") {
    return memberExpr.property.name;
  }
  if (memberExpr.computed && memberExpr.property.type === "Literal") {
    return memberExpr.property.value;
  }
  return null;
}

// ──────────────────────────────────────────────
//  Layer 3: File location + surgical replacement
// ──────────────────────────────────────────────

function locateBundle() {
  const assetsDir = path.join(__dirname, "..", "src", "webview", "assets");
  if (!fs.existsSync(assetsDir)) {
    console.error("❌ Assets directory not found:", assetsDir);
    process.exit(1);
  }

  const files = fs.readdirSync(assetsDir).filter((f) => /^index-.*\.js$/.test(f));

  if (files.length === 0) {
    console.error("❌ No index-*.js bundle file found");
    process.exit(1);
  }
  if (files.length > 1) {
    console.error("❌ Multiple index-*.js files found:", files.join(", "));
    process.exit(1);
  }

  return path.join(assetsDir, files[0]);
}

/**
 * Collect all patch locations matched by the rules
 */
function collectPatches(ast, source) {
  const patches = [];
  const details = [];
  const seen = new Set(); // prevent double-matching ChainExpression and inner CallExpression

  walk(ast, (node) => {
    for (const rule of RULES) {
      const result = rule.match(node, source);
      if (result && !seen.has(result.start)) {
        seen.add(result.start);
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
  const CONTEXT_CHARS = 40;
  const matches = [];
  const seen = new Set();

  walk(ast, (node) => {
    for (const rule of RULES) {
      const result = rule.match(node, source);
      if (result && !seen.has(result.start)) {
        seen.add(result.start);
        const ctxStart = Math.max(0, result.start - CONTEXT_CHARS);
        const ctxEnd = Math.min(source.length, result.end + CONTEXT_CHARS);
        matches.push({
          ruleId: rule.id,
          position: result.start,
          original: result.original,
          context: source.slice(ctxStart, ctxEnd),
          wouldPatch: true,
        });
      }
    }
  });

  return { matches };
}

/**
 * Count all enable_i18n references (patched and unpatched)
 */
function countAllOccurrences(source) {
  let total = 0;
  let idx = -1;
  while ((idx = source.indexOf('"enable_i18n"', idx + 1)) !== -1) {
    total++;
  }
  return total;
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

  // ── --check mode ──
  if (isCheck) {
    console.log("\n── Match check (read-only) ──\n");
    const { matches } = scanMatches(ast, source);
    const totalRefs = countAllOccurrences(source);

    if (matches.length === 0) {
      console.log(`📊 ${totalRefs} "enable_i18n" reference(s), 0 to patch`);
      console.log("✅ All gate calls already replaced with !0");
    } else {
      for (let i = 0; i < matches.length; i++) {
        const m = matches[i];
        console.log(`  #${i + 1}  [${m.ruleId}]  🔧 to patch`);
        console.log(`      Position: ${m.position}`);
        console.log(`      Original: ${m.original}`);
        console.log(`      Context: ...${m.context}...`);
        console.log();
      }
      console.log(
        `📊 ${totalRefs} "enable_i18n" reference(s), ${matches.length} to patch`
      );
    }
    return;
  }

  // ── patch mode ──
  const { patches, details } = collectPatches(ast, source);

  if (patches.length === 0) {
    const totalRefs = countAllOccurrences(source);
    if (totalRefs > 0) {
      console.log(`ℹ️  i18n already fully enabled (${totalRefs} reference(s), 0 to patch), no changes needed`);
    } else {
      console.warn("⚠️  enable_i18n feature flag not found");
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
  console.log(`\n✅ i18n unlocked: ${patches.length} gate call(s) → !0`);
}

main();
