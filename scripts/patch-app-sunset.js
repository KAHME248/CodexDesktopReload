/**
 * Post-build patch: bypass the unsupported-version sunset screen
 *
 * The webview bundle includes a wrapper component that replaces the full app
 * with an "Update required" screen behind a Statsig gate. Hashes and minified
 * symbol names change between versions, so this script:
 *   1. Resolves the active webview bundle from src/webview/index.html
 *   2. Parses the bundle with Acorn
 *   3. Finds the sunset component via stable appSunset i18n IDs
 *   4. Disables only the wrapper branch that renders that component
 *
 * Usage:
 *   node scripts/patch-app-sunset.js
 *   node scripts/patch-app-sunset.js --check
 */
const fs = require("fs");
const path = require("path");
const { parse } = require("acorn");
const { walk } = require("./ast-utils");

const PROJECT_ROOT = path.join(__dirname, "..");
const INDEX_HTML_PATH = path.join(PROJECT_ROOT, "src", "webview", "index.html");
const SUNSET_MARKERS = ["appSunset.title", "appSunset.body"];
const MARKER = "/* app-sunset-patch */";

function locateBundlePathFromIndexHtml(html) {
  const matches = [];
  const scriptTags = html.match(/<script\b[^>]*>/g) ?? [];

  for (const tag of scriptTags) {
    const isModuleScript = /\btype=["']module["']/.test(tag);
    const srcMatch = tag.match(/\bsrc=["']\.\/(assets\/index-[^"']+\.js)["']/);

    if (isModuleScript && srcMatch) {
      matches.push(srcMatch[1]);
    }
  }

  if (matches.length !== 1) {
    throw new Error(`Expected exactly 1 module index bundle in index.html, found ${matches.length}`);
  }

  return path.posix.join("src/webview", matches[0]);
}

function locateBundle() {
  if (!fs.existsSync(INDEX_HTML_PATH)) {
    throw new Error(`index.html not found: ${INDEX_HTML_PATH}`);
  }

  const html = fs.readFileSync(INDEX_HTML_PATH, "utf8");
  const relativeBundlePath = locateBundlePathFromIndexHtml(html);
  const absoluteBundlePath = path.join(PROJECT_ROOT, ...relativeBundlePath.split("/"));

  if (!fs.existsSync(absoluteBundlePath)) {
    throw new Error(`Resolved bundle does not exist: ${relativeBundlePath}`);
  }

  return {
    html,
    relativeBundlePath,
    absoluteBundlePath,
  };
}

function walkWithAncestors(node, visitor, ancestors = []) {
  if (!node || typeof node !== "object") return;

  visitor(node, ancestors);

  for (const key of Object.keys(node)) {
    const child = node[key];

    if (Array.isArray(child)) {
      for (const item of child) {
        if (item && typeof item.type === "string") {
          walkWithAncestors(item, visitor, ancestors.concat(node));
        }
      }
      continue;
    }

    if (child && typeof child.type === "string") {
      walkWithAncestors(child, visitor, ancestors.concat(node));
    }
  }
}

function isFunctionNode(node) {
  return (
    node.type === "FunctionDeclaration" ||
    node.type === "FunctionExpression" ||
    node.type === "ArrowFunctionExpression"
  );
}

function getFunctionName(node, parent) {
  if (node.type === "FunctionDeclaration" && node.id?.type === "Identifier") {
    return node.id.name;
  }

  if (
    parent?.type === "VariableDeclarator" &&
    parent.id?.type === "Identifier"
  ) {
    return parent.id.name;
  }

  if (
    parent?.type === "AssignmentExpression" &&
    parent.left?.type === "Identifier"
  ) {
    return parent.left.name;
  }

  return null;
}

function getMemberPropertyName(node) {
  if (!node || node.type !== "MemberExpression") return null;

  if (!node.computed && node.property?.type === "Identifier") {
    return node.property.name;
  }

  if (node.computed && node.property?.type === "Literal") {
    return node.property.value;
  }

  return null;
}

function isJsxFactoryCall(node, calleeName) {
  if (node?.type !== "CallExpression") return false;

  const helper = getMemberPropertyName(node.callee);
  if (helper !== "jsx" && helper !== "jsxs") return false;

  const target = node.arguments[0];
  return target?.type === "Identifier" && target.name === calleeName;
}

function containsSunsetMarker(text) {
  return SUNSET_MARKERS.some((marker) => text.includes(marker));
}

function collectNamedFunctions(ast, source) {
  const functions = [];

  walkWithAncestors(ast, (node, ancestors) => {
    if (!isFunctionNode(node)) return;

    const parent = ancestors[ancestors.length - 1] ?? null;
    const name = getFunctionName(node, parent);
    if (!name) return;

    functions.push({
      name,
      node,
      source: source.slice(node.start, node.end),
    });
  });

  return functions;
}

function findSunsetFunction(functions) {
  const matches = functions.filter((fn) => containsSunsetMarker(fn.source));

  if (matches.length !== 1) {
    throw new Error(`Expected exactly 1 sunset component, found ${matches.length}`);
  }

  return matches[0];
}

function consequentRendersFunction(node, functionName) {
  let found = false;

  walk(node, (child) => {
    if (!found && isJsxFactoryCall(child, functionName)) {
      found = true;
    }
  });

  return found;
}

function findSunsetGuard(functions, sunsetFunctionName) {
  const matches = [];

  for (const fn of functions) {
    if (fn.name === sunsetFunctionName) continue;

    let guardIfStatement = null;

    walk(fn.node.body ?? fn.node, (node) => {
      if (guardIfStatement || node.type !== "IfStatement") return;
      if (!consequentRendersFunction(node.consequent, sunsetFunctionName)) return;
      guardIfStatement = node;
    });

    if (guardIfStatement) {
      matches.push({
        functionName: fn.name,
        ifStatement: guardIfStatement,
      });
    }
  }

  if (matches.length !== 1) {
    throw new Error(`Expected exactly 1 sunset guard branch, found ${matches.length}`);
  }

  return matches[0];
}

function disableTestExpression(originalTest) {
  const trimmed = originalTest.trim();

  if (trimmed === "!1" || trimmed === "false" || trimmed.includes(MARKER)) {
    return null;
  }

  const existingPatchedMatch = trimmed.match(/^(?:!1|false)&&\(([\s\S]+)\)$/);
  const innerExpression = existingPatchedMatch ? existingPatchedMatch[1] : trimmed;

  return `!1&&(${MARKER}(${innerExpression}))`;
}

function patchAppSunsetGuard(source) {
  const ast = parse(source, {
    ecmaVersion: "latest",
    sourceType: "module",
  });

  const functions = collectNamedFunctions(ast, source);
  const sunsetFunction = findSunsetFunction(functions);
  const guard = findSunsetGuard(functions, sunsetFunction.name);
  const originalTest = source.slice(guard.ifStatement.test.start, guard.ifStatement.test.end);
  const replacement = disableTestExpression(originalTest);

  if (replacement == null) {
    return source;
  }

  return (
    source.slice(0, guard.ifStatement.test.start) +
    replacement +
    source.slice(guard.ifStatement.test.end)
  );
}

function main() {
  const isCheck = process.argv.includes("--check");
  const { relativeBundlePath, absoluteBundlePath } = locateBundle();
  const source = fs.readFileSync(absoluteBundlePath, "utf8");
  const patched = patchAppSunsetGuard(source);
  const alreadyPatched = patched === source;

  console.log(`📄 Target file: ${relativeBundlePath}`);

  if (isCheck) {
    console.log("\n── app sunset patch check (read-only) ──\n");
    console.log(
      `  📄 ${relativeBundlePath}: ${alreadyPatched ? "✅ already patched" : "🔧 not yet patched"}`
    );
    return;
  }

  if (alreadyPatched) {
    console.log("ℹ️  app sunset patch already applied, no changes needed");
    return;
  }

  fs.writeFileSync(absoluteBundlePath, patched);
  console.log(`  ✏️  Disabled sunset gate in ${relativeBundlePath}`);
  console.log("\n✅ app sunset patch applied");
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`❌ ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  disableTestExpression,
  locateBundlePathFromIndexHtml,
  patchAppSunsetGuard,
};
