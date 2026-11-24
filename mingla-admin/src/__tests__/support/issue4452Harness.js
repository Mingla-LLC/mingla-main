// #4452 test support: bundle real Admin components with esbuild and render
// them to static markup in node, the way the #4270 board suites do. Nothing
// here talks to Supabase; a component that needs services gets them stubbed
// through `stubs` (a map of import path -> module source).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
// [TEST-MOD-APPROVED #4522] #4523 puts the shared calendar (@mingla/calendar-web) in Admin components; harnesses need the same workspace alias Vite has.
import { workspacePackagesPlugin } from "../_workspacePackagesPlugin.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SRC = path.resolve(HERE, "..", "..");

/**
 * Build `contents` (JSX, resolved from src/__tests__) into an ES module and import it.
 * `stubs` replaces imports whose resolved path ends with a key.
 */
export async function buildHarness(contents, { stubs = {}, name = "issue4452" } = {}) {
  let esbuild;
  try {
    esbuild = await import("esbuild");
  } catch {
    throw new Error("esbuild is not installed: run `npm ci` in mingla-admin before this test");
  }
  const stubPlugin = {
    name: "issue4452-stubs",
    setup(build) {
      const keys = Object.keys(stubs);
      if (!keys.length) return;
      build.onResolve({ filter: /.*/ }, (args) => {
        const key = keys.find((k) => args.path === k || args.path.endsWith(k));
        return key ? { path: key, namespace: "issue4452-stub" } : undefined;
      });
      build.onLoad({ filter: /.*/, namespace: "issue4452-stub" }, (args) => ({
        contents: stubs[args.path],
        loader: "jsx",
        resolveDir: SRC,
      }));
    },
  };
  const out = await esbuild.build({
    stdin: { contents, resolveDir: HERE, sourcefile: `${name}.harness.jsx`, loader: "jsx" },
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    jsx: "automatic",
    plugins: [stubPlugin, workspacePackagesPlugin],
    banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' },
    logLevel: process.env.HARNESS_LOG || "silent",
    define: { "process.env.NODE_ENV": '"production"', "import.meta.env.VITE_SUPABASE_URL": '"http://stub.local"', "import.meta.env.VITE_SUPABASE_ANON_KEY": '"stub"' },
  });
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`)), "harness.mjs");
  fs.writeFileSync(file, out.outputFiles[0].text);
  return import(pathToFileURL(file).href);
}

/** Read a file under mingla-admin/src (SRC). */
export function readSrc(rel) {
  return fs.readFileSync(path.join(SRC, rel), "utf8");
}
