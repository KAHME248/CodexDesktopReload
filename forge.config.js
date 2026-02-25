const { FuseV1Options, FuseVersion } = require("@electron/fuses");
const path = require("path");
const fs = require("fs");
const { TARGET_TRIPLE_MAP } = require("./scripts/constants");

// Resolve codex binary path (local resources/bin takes priority, then npm)
function getCodexBinaryPath(platform, arch) {
  const platformArch = `${platform}-${arch}`;
  const binaryName = platform === "win32" ? "codex.exe" : "codex";

  // Path 1: local resources/bin/
  const localPath = path.join(__dirname, "resources", "bin", platformArch, binaryName);
  if (fs.existsSync(localPath)) {
    return localPath;
  }

  // Path 2: npm @cometix/codex/vendor/
  const targetTriple = TARGET_TRIPLE_MAP[platformArch];
  if (targetTriple) {
    const npmPath = path.join(
      __dirname, "node_modules", "@cometix", "codex", "vendor",
      targetTriple, "codex", binaryName
    );
    if (fs.existsSync(npmPath)) {
      return npmPath;
    }
  }

  return null;
}

module.exports = {
  packagerConfig: {
    name: "Codex",
    executableName: "Codex",
    appBundleId: "com.openai.codex",
    icon: "./resources/electron",
    asar: {
      unpack: "{**/*.node,**/node-pty/build/Release/spawn-helper,**/node-pty/prebuilds/*/spawn-helper}",
    },
    extraResource: ["./resources/notification.wav"],
    // Layer 1: file allowlist — only pass through files required at runtime, excluding Codex.app/, .github/, etc.
    ignore: (filePath) => {
      // The root directory itself must always be allowed
      if (filePath === "") return false;

      // Allowed prefixes: top-level paths needed at runtime (mirrors the official asar layout).
      // The ignore callback receives both directory and file paths, so we must match
      // both the full path and any intermediate parent directory.
      const allowedPrefixes = [
        "/src/.vite/build", // compiled main-process code
        "/src/webview",     // frontend UI assets
        "/src/skills",      // skills directory
        "/node_modules",    // native dependencies (pruned to native-only modules in afterPrune)
      ];

      // Exact match for package.json
      if (filePath === "/package.json") return false;

      // Check whether filePath is a parent of an allowed prefix (ancestor directory),
      // or is located under an allowed prefix (child file/directory)
      for (const prefix of allowedPrefixes) {
        if (prefix.startsWith(filePath) || filePath.startsWith(prefix)) {
          return false;
        }
      }

      return true;
    },
    // macOS code signing
    osxSign: process.env.SKIP_SIGN
      ? undefined
      : {
          identity: process.env.APPLE_IDENTITY,
          identityValidation: false,
        },
    osxNotarize: process.env.SKIP_NOTARIZE
      ? undefined
      : {
          appleId: process.env.APPLE_ID,
          appleIdPassword: process.env.APPLE_PASSWORD,
          teamId: process.env.APPLE_TEAM_ID,
        },
    // Windows metadata
    win32metadata: {
      CompanyName: "OpenAI",
      ProductName: "Codex",
    },
  },
  rebuildConfig: {},
  makers: [
    // macOS DMG
    {
      name: "@electron-forge/maker-dmg",
      config: {
        format: "ULFO",
        icon: "./resources/electron.icns",
      },
    },
    // macOS ZIP
    {
      name: "@electron-forge/maker-zip",
      platforms: ["darwin"],
    },
    // Windows Squirrel
    {
      name: "@electron-forge/maker-squirrel",
      config: {
        name: "Codex",
        authors: "OpenAI, Cometix Space",
        description: "Codex Desktop App",
        setupIcon: "./resources/electron.ico",
        iconUrl: "https://raw.githubusercontent.com/Haleclipse/CodexDesktop-Rebuild/master/resources/electron.ico",
      },
    },
    // Windows ZIP
    {
      name: "@electron-forge/maker-zip",
      platforms: ["win32"],
    },
    // Linux DEB
    {
      name: "@electron-forge/maker-deb",
      config: {
        options: {
          name: "codex",
          productName: "Codex",
          genericName: "AI Coding Assistant",
          categories: ["Development", "Utility"],
          bin: "Codex",
          maintainer: "Cometix Space",
          homepage: "https://github.com/Haleclipse/CodexDesktop-Rebuild",
          icon: "./resources/electron.png",
        },
      },
    },
    // Linux RPM
    {
      name: "@electron-forge/maker-rpm",
      config: {
        options: {
          name: "codex",
          productName: "Codex",
          genericName: "AI Coding Assistant",
          categories: ["Development", "Utility"],
          bin: "Codex",
          license: "Apache-2.0",
          homepage: "https://github.com/Haleclipse/CodexDesktop-Rebuild",
          icon: "./resources/electron.png",
        },
      },
    },
    // Linux ZIP
    {
      name: "@electron-forge/maker-zip",
      platforms: ["linux"],
    },
  ],
  plugins: [
    {
      name: "@electron-forge/plugin-auto-unpack-natives",
      config: {},
    },
    {
      name: "@electron-forge/plugin-fuses",
      config: {
        version: FuseVersion.V1,
        [FuseV1Options.RunAsNode]: false,
        [FuseV1Options.EnableCookieEncryption]: true,
        [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
        [FuseV1Options.EnableNodeCliInspectArguments]: false,
        [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
        [FuseV1Options.OnlyLoadAppFromAsar]: true,
      },
    },
  ],
  hooks: {
    // Layer 2: native module platform filtering — after Forge prunes devDependencies, further clean non-target platform artifacts
    packageAfterPrune: async (
      config,
      buildPath,
      electronVersion,
      platform,
      arch,
    ) => {
      const platformArch = `${platform}-${arch}`;
      console.log(
        `\n🧹 Pruning non-target platform files for ${platformArch}...`,
      );

      // --- Helper functions ---
      const removeDirRecursive = (dirPath) => {
        if (fs.existsSync(dirPath)) {
          fs.rmSync(dirPath, { recursive: true, force: true });
          console.log(`   🗑️  Removed: ${path.relative(buildPath, dirPath)}`);
        }
      };

      const removeFile = (filePath) => {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          console.log(
            `   🗑️  Removed: ${path.relative(buildPath, filePath)}`,
          );
        }
      };

      // Recursively walk a directory and invoke callback for each file
      const walkDir = (dir, callback) => {
        if (!fs.existsSync(dir)) return;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walkDir(fullPath, callback);
          } else {
            callback(fullPath);
          }
        }
      };

      const nodeModulesPath = path.join(buildPath, "node_modules");

      // 0. Native module allowlist — Vite has already bundled all pure-JS deps into main.js,
      //    so node_modules only needs to keep native modules and their runtime binding helpers.
      //    Mirrors the 7 packages in the official build: better-sqlite3, bindings,
      //    file-uri-to-path, node-addon-api, node-gyp-build, node-pty, electron-liquid-glass
      const allowedModules = new Set([
        "better-sqlite3",        // SQLite native module
        "bindings",              // .node file locator for native modules (runtime require by better-sqlite3)
        "file-uri-to-path",      // runtime dependency of bindings
        "node-addon-api",        // N-API helper (needed by better-sqlite3 at runtime)
        "node-pty",              // terminal emulation native module
        "node-gyp-build",        // node-pty runtime require (all platforms)
      ]);

      // Platform-conditional dependencies
      if (platform === "darwin") {
        allowedModules.add("electron-liquid-glass"); // macOS liquid glass effect
      }

      console.log(
        `   📋 Native module whitelist: ${allowedModules.size} packages`,
      );

      // Remove all node_modules packages that are not in the allowlist
      if (fs.existsSync(nodeModulesPath)) {
        let removedPkgCount = 0;
        const entries = fs.readdirSync(nodeModulesPath);
        for (const entry of entries) {
          // Skip hidden entries (.bin, .package-lock.json)
          if (entry.startsWith(".")) continue;

          if (entry.startsWith("@")) {
            // Scoped package: check each sub-directory individually
            const scopePath = path.join(nodeModulesPath, entry);
            if (!fs.statSync(scopePath).isDirectory()) continue;
            const scopedEntries = fs.readdirSync(scopePath);
            for (const scopedEntry of scopedEntries) {
              const fullName = `${entry}/${scopedEntry}`;
              if (!allowedModules.has(fullName)) {
                removeDirRecursive(path.join(scopePath, scopedEntry));
                removedPkgCount++;
              }
            }
            // Remove the scope directory if it is now empty
            if (fs.readdirSync(scopePath).length === 0) {
              removeDirRecursive(scopePath);
            }
          } else {
            if (!allowedModules.has(entry)) {
              removeDirRecursive(path.join(nodeModulesPath, entry));
              removedPkgCount++;
            }
          }
        }
        console.log(
          `   🗑️  Removed ${removedPkgCount} non-native packages from node_modules`,
        );
      }

      // Remove the .bin directory (bin symlinks are not needed at runtime)
      const binDir = path.join(nodeModulesPath, ".bin");
      if (fs.existsSync(binDir)) {
        removeDirRecursive(binDir);
      }

      // 1. Remove non-target-platform directories from node-pty prebuilds
      const nodePtyPrebuilds = path.join(
        nodeModulesPath,
        "node-pty",
        "prebuilds",
      );
      if (fs.existsSync(nodePtyPrebuilds)) {
        const dirs = fs.readdirSync(nodePtyPrebuilds);
        for (const dir of dirs) {
          if (dir !== platformArch) {
            removeDirRecursive(path.join(nodePtyPrebuilds, dir));
          }
        }
      }

      // 2. Delete all .pdb debug symbol files (Windows debugging only, not needed at runtime)
      walkDir(nodeModulesPath, (filePath) => {
        if (filePath.endsWith(".pdb")) {
          removeFile(filePath);
        }
      });

      // 3. Remove non-target-platform prebuilds from electron-liquid-glass
      const liquidGlassPrebuilds = path.join(
        nodeModulesPath,
        "electron-liquid-glass",
        "prebuilds",
      );
      if (fs.existsSync(liquidGlassPrebuilds)) {
        const dirs = fs.readdirSync(liquidGlassPrebuilds);
        for (const dir of dirs) {
          if (dir !== platformArch) {
            removeDirRecursive(path.join(liquidGlassPrebuilds, dir));
          }
        }
      }

      // 4. Deep-clean better-sqlite3 — keep only build/Release/*.node, lib/, package.json, binding.gyp
      const betterSqlitePath = path.join(nodeModulesPath, "better-sqlite3");
      if (fs.existsSync(betterSqlitePath)) {
        // Remove compiled source and SQLite source
        removeDirRecursive(path.join(betterSqlitePath, "deps"));
        removeDirRecursive(path.join(betterSqlitePath, "src"));
        // Remove everything in build/ except Release/*.node
        const bsBuild = path.join(betterSqlitePath, "build");
        if (fs.existsSync(bsBuild)) {
          const bsEntries = fs.readdirSync(bsBuild);
          for (const entry of bsEntries) {
            if (entry !== "Release") {
              const entryPath = path.join(bsBuild, entry);
              if (fs.statSync(entryPath).isDirectory()) {
                removeDirRecursive(entryPath);
              } else {
                removeFile(entryPath);
              }
            }
          }
          // Inside Release, keep only .node files
          const bsRelease = path.join(bsBuild, "Release");
          if (fs.existsSync(bsRelease)) {
            walkDir(bsRelease, (fp) => {
              if (!fp.endsWith(".node")) removeFile(fp);
            });
          }
        }
      }

      // 5. Deep-clean node-pty — platform-specific differential cleanup
      const nodePtyPath = path.join(nodeModulesPath, "node-pty");
      if (fs.existsSync(nodePtyPath)) {
        // Remove compiled source, winpty deps, scripts, typings, and test files
        removeDirRecursive(path.join(nodePtyPath, "src"));
        removeDirRecursive(path.join(nodePtyPath, "deps"));
        removeDirRecursive(path.join(nodePtyPath, "scripts"));
        removeDirRecursive(path.join(nodePtyPath, "typings"));

        // third_party/conpty/ — required on Windows at runtime; remove entirely on all other platforms
        const thirdPartyPath = path.join(nodePtyPath, "third_party");
        if (platform === "win32") {
          // Windows: keep only the conpty binaries for the target arch
          const conptyBase = path.join(
            thirdPartyPath,
            "conpty",
          );
          if (fs.existsSync(conptyBase)) {
            // Iterate version directories (e.g. 1.23.251008001/)
            for (const ver of fs.readdirSync(conptyBase)) {
              const verPath = path.join(conptyBase, ver);
              if (!fs.statSync(verPath).isDirectory()) continue;
              for (const platDir of fs.readdirSync(verPath)) {
                // Directory format: win10-x64, win10-arm64
                if (!platDir.includes(arch)) {
                  removeDirRecursive(path.join(verPath, platDir));
                }
              }
            }
          }
        } else {
          // Non-Windows: conpty is not needed at all
          removeDirRecursive(thirdPartyPath);
        }

        // bin/{platform}-{arch}-{abi}/ — keep only the target platform's prebuild
        const binPath = path.join(nodePtyPath, "bin");
        if (fs.existsSync(binPath)) {
          for (const dir of fs.readdirSync(binPath)) {
            if (!dir.startsWith(`${platform}-${arch}-`)) {
              removeDirRecursive(path.join(binPath, dir));
            }
          }
        }
        // Remove everything in build/ except Release/{pty.node, spawn-helper}
        const nptBuild = path.join(nodePtyPath, "build");
        if (fs.existsSync(nptBuild)) {
          const nptEntries = fs.readdirSync(nptBuild);
          for (const entry of nptEntries) {
            if (entry !== "Release") {
              const entryPath = path.join(nptBuild, entry);
              if (fs.statSync(entryPath).isDirectory()) {
                removeDirRecursive(entryPath);
              } else {
                removeFile(entryPath);
              }
            }
          }
          // Inside Release, keep only pty.node and spawn-helper
          const nptRelease = path.join(nptBuild, "Release");
          if (fs.existsSync(nptRelease)) {
            const releaseEntries = fs.readdirSync(nptRelease, {
              withFileTypes: true,
            });
            for (const entry of releaseEntries) {
              const fullPath = path.join(nptRelease, entry.name);
              if (
                entry.name !== "pty.node" &&
                entry.name !== "spawn-helper"
              ) {
                if (entry.isDirectory()) {
                  removeDirRecursive(fullPath);
                } else {
                  removeFile(fullPath);
                }
              }
            }
          }
        }
        // Remove node_modules/node-pty/node_modules (nested node-addon-api build artifacts)
        removeDirRecursive(path.join(nodePtyPath, "node_modules"));
        // Remove test files
        walkDir(path.join(nodePtyPath, "lib"), (fp) => {
          if (fp.endsWith(".test.js")) removeFile(fp);
        });
      }

      // 6. Remove all non-runtime files from node_modules
      const junkPatterns = [
        /\.md$/i,
        /LICENSE(\..*)?$/i,
        /LICENCE(\..*)?$/i,
        /CHANGELOG(\..*)?$/i,
        /HISTORY(\..*)?$/i,
        /\.npmignore$/,
        /\.travis\.yml$/,
        /\.eslintrc(\..*)?$/,
        /\.prettierrc(\..*)?$/,
        /\.editorconfig$/,
        /\.jshintrc$/,
        /tsconfig\.json$/,
        /\.github$/,
        /\.gitattributes$/,
        /Makefile$/,
        /Gruntfile\.js$/,
        /Gulpfile\.js$/,
        /\.DS_Store$/,
        /\.map$/,
        /\.ts$/,           // TypeScript source files (keep .d.ts)
        /\.cc$/,           // C++ source files
        /\.cpp$/,
        /\.hpp$/,
        /\.h$/,            // C/C++ header files
        /\.c$/,            // C source files
        /\.o$/,            // compiled intermediate objects
        /\.gyp$/,          // gyp build files
        /\.gypi$/,
        /\.mk$/,           // Makefile fragments
        /\.stamp$/,        // build stamp files
        /\.d$/,            // dependency tracking files
      ];

      let cleanedCount = 0;
      walkDir(nodeModulesPath, (filePath) => {
        const basename = path.basename(filePath);
        // Always keep .d.ts and .node files
        if (basename.endsWith(".d.ts") || basename.endsWith(".node")) return;
        if (junkPatterns.some((p) => p.test(basename))) {
          fs.unlinkSync(filePath);
          cleanedCount++;
        }
      });

      console.log(
        `   ✅ Cleaned ${cleanedCount} non-runtime files from node_modules`,
      );
    },

    // After packaging: copy the platform-specific codex binary
    packageAfterCopy: async (config, buildPath, electronVersion, platform, arch) => {
      console.log(`\n📦 Packaging for ${platform}-${arch}...`);
      console.log(`   buildPath: ${buildPath}`);

      const codexSrc = getCodexBinaryPath(platform, arch);
      const binaryName = platform === "win32" ? "codex.exe" : "codex";

      // buildPath points to the app directory; its parent is Resources (macOS) or resources (other platforms)
      const resourcesPath = path.dirname(buildPath);
      const codexDest = path.join(resourcesPath, binaryName);

      if (codexSrc && fs.existsSync(codexSrc)) {
        fs.copyFileSync(codexSrc, codexDest);
        fs.chmodSync(codexDest, 0o755);
        console.log(`✅ Copied codex binary: ${codexSrc} -> ${codexDest}`);
      } else {
        throw new Error(`Codex binary not found for ${platform}-${arch}`);
      }
    },
  },
};
