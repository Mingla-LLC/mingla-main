// #4420 — the dev server serves a lazy `import("@mingla/<pkg>/<file>")` as an
// app-relative "./packages/<pkg>/<file>" chunk request. metro.config.js
// re-roots those at the workspace only for the packages it lists; a package
// missing from that list 404s on the dev server (the export and native builds
// still pass, so nothing else catches it). #4334 made the web address field
// lazy without listing location-input: brand edit crashed and the trip wizard
// address step never loaded. This gate scans the app source for every lazy
// workspace subpath import and proves the resolver re-roots each one.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";

import { describe, expect, test } from "@jest/globals";

type Resolution = { filePath?: string; type?: string; delegated?: string; platform?: string };
type MetroConfig = {
  resolver: { resolveRequest: (context: unknown, moduleName: string, platform: string) => Resolution };
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const metro = require("../metro.config.js") as MetroConfig;
const APP_ROOT = path.resolve(__dirname, "..");
const WORKSPACE = path.resolve(APP_ROOT, "..");
const context = {
  resolveRequest: (_ctx: unknown, moduleName: string, platform: string): Resolution => ({
    delegated: moduleName,
    platform,
  }),
};

const LAZY_WORKSPACE_IMPORT = /import\(\s*["']@mingla\/([a-z0-9-]+)\/([^"']+)["']\s*\)/g;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__tests__" || name.startsWith(".")) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx|js|jsx)$/.test(name)) out.push(full);
  }
  return out;
}

function lazyWorkspaceImports(): Array<{ pkg: string; subpath: string; file: string }> {
  const found: Array<{ pkg: string; subpath: string; file: string }> = [];
  for (const root of ["src", "app"]) {
    for (const file of sourceFiles(path.join(APP_ROOT, root))) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(LAZY_WORKSPACE_IMPORT)) {
        found.push({ pkg: match[1], subpath: match[2], file: path.relative(APP_ROOT, file) });
      }
    }
  }
  return found;
}

describe("#4420 every lazy workspace subpath import resolves on the dev server", () => {
  const imports = lazyWorkspaceImports();

  test("the scan finds the known lazy imports (guards against a silently empty scan)", () => {
    const pkgs = new Set(imports.map((entry) => entry.pkg));
    expect(pkgs.has("location-input")).toBe(true);
    expect(pkgs.has("brand-rendering")).toBe(true);
  });

  test.each(["web", "ios", "android"])("%s: each chunk request is re-rooted at the workspace package", (platform) => {
    const unresolved: string[] = [];
    for (const { pkg, subpath, file } of imports) {
      const request = `./packages/${pkg}/${subpath}`;
      const out = metro.resolver.resolveRequest(context, request, platform);
      const target = out.filePath ?? out.delegated ?? "";
      if (!target.startsWith(path.join(WORKSPACE, "packages", pkg) + path.sep)) {
        unresolved.push(`${request} (from ${file}) -> ${target}`);
      }
    }
    expect(unresolved).toEqual([]);
  });

  // [TEST-MOD-APPROVED #4420] — re-rooting alone could still point at a file
  // that is not there; every re-rooted chunk must land on a real module.
  test("each re-rooted chunk lands on a module that exists", async () => {
    const missing: string[] = [];
    for (const { pkg, subpath, file } of imports) {
      const out = metro.resolver.resolveRequest(context, `./packages/${pkg}/${subpath}`, "web");
      const target = out.filePath ?? out.delegated ?? "";
      let found = false;
      for (const ext of ["", ".ts", ".tsx", ".web.tsx", ".web.ts", ".js", "/index.ts", "/index.tsx"]) {
        try {
          await access(target + ext);
          if (statSync(target + ext).isFile()) { found = true; break; }
        } catch {
          /* try the next extension */
        }
      }
      if (!found) missing.push(`${pkg}/${subpath} (from ${file}) -> ${target}`);
    }
    expect(missing).toEqual([]);
  });

  test("the web address field chunk resolves to the shared AddressInput", () => {
    const out = metro.resolver.resolveRequest(context, "./packages/location-input/src/AddressInput", "web");
    expect(out).toEqual({
      delegated: path.join(WORKSPACE, "packages", "location-input", "src", "AddressInput"),
      platform: "web",
    });
  });
});
