/**
 * RT-3 — package isolation grep (ORCH-1138 A3 / I-MOR-0827-PACKAGE-ISOLATION).
 *
 * The new @mingla/offering-rendering package + the extracted
 * packages/event-rendering/themePalette.ts MUST be pure-presentational: NO
 * imports from any app's src/ or app/. All data flows via props. The shared
 * package-isolation strict-grep gate (meta-orch-0827-package-isolation.mjs)
 * already walks all of packages/; this test pins the offering-rendering files
 * specifically so a stray app import flips it red here too.
 *
 * fails-on-revert: add `import x from "../../mingla-business/src/..."` to any
 * offering-rendering file → this gate fails. Owner: mingla-implementor.
 */

import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";

import { describe, expect, test } from "@jest/globals";

const PKG_ROOT = path.join(process.cwd(), "..", "packages", "offering-rendering");
const THEME_PALETTE = path.join(
  process.cwd(),
  "..",
  "packages",
  "event-rendering",
  "themePalette.ts",
);

const FORBIDDEN: RegExp[] = [
  /from\s+["'][^"']*app-mobile\/(?:src|app)\//,
  /from\s+["'][^"']*mingla-business\/(?:src|app)\//,
  /from\s+["'][^"']*mingla-admin\/src\//,
  /from\s+["']\.\.\/\.\.\/(?:app-mobile|mingla-business|mingla-admin)\//,
  /require\(\s*["'][^"']*(?:app-mobile|mingla-business|mingla-admin)\/(?:src|app)\//,
];

const walk = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
};

describe("RT-3 ORCH-1138 — offering-rendering package isolation", () => {
  test("no offering-rendering file imports from an app's src/ or app/", () => {
    const files = walk(PKG_ROOT);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      for (const re of FORBIDDEN) {
        expect({ file, matched: re.test(src) }).toEqual({ file, matched: false });
      }
    }
  });

  test("themePalette.ts imports no app source", () => {
    const src = readFileSync(THEME_PALETTE, "utf8");
    for (const re of FORBIDDEN) {
      expect(re.test(src)).toBe(false);
    }
    // it depends ONLY on ./designTokens (the package's own tokens).
    expect(src).toContain('from "./designTokens"');
  });

  test("offering-rendering depends only on @mingla/event-rendering + RN + svg", () => {
    const files = walk(PKG_ROOT);
    const importLines = files
      .flatMap((f) => readFileSync(f, "utf8").split("\n"))
      .filter((l) => /^\s*import\s/.test(l) && /from\s+["']/.test(l));
    for (const line of importLines) {
      const m = /from\s+["']([^"']+)["']/.exec(line);
      if (m === null) continue;
      const spec = m[1];
      const allowed =
        spec.startsWith("./") ||
        spec === "react" ||
        spec === "react-native" ||
        spec === "react-native-svg" ||
        spec === "@mingla/event-rendering";
      expect({ spec, allowed }).toEqual({ spec, allowed: true });
    }
  });
});
