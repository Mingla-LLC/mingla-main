// ORCH-1296 [OTA boot-brick] — boot-safety regression test.
//
// ORCH-1295 shipped eventCoverVideoTusPatch.native.ts with TOP-LEVEL static
// imports of `expo/fetch` and expo-file-system's new `File` API. Expo Router
// eagerly require()s the whole app/ route tree at startup, and the
// venue/experience routes transitively import that module — so the top-level
// native imports EVALUATED during boot, before native modules were registered,
// and bricked the splash (OTA-only). The fix moves them to lazy `await import()`
// inside the functions. This source-structural test locks that in.
//
// Fails-on-revert: on origin/main the module has the top-level imports and no
// `await import(...)`, so every assertion below flips.

import { readFileSync } from "node:fs";
import { join } from "node:path";

const businessRoot = join(__dirname, "..", "..", "..");
const read = (rel: string): string => readFileSync(join(businessRoot, rel), "utf8");

// Strip comments so the assertions run against CODE, not the docblock (which
// mentions these module names in prose).
const stripComments = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

const NATIVE = stripComments(
  read("src/services/eventCoverVideoTusPatch.native.ts"),
);

describe("ORCH-1296 — eventCoverVideoTusPatch.native.ts uses boot-safe lazy native imports", () => {
  it("has NO top-level static import of expo/fetch", () => {
    expect(NATIVE).not.toMatch(
      /(?:^|\n)\s*import\s+[^\n;]*?\s+from\s+["']expo\/fetch["']/,
    );
    expect(NATIVE).not.toMatch(/(?:^|\n)\s*import\s+["']expo\/fetch["']/);
  });

  it("has NO top-level static import of the expo-file-system File API", () => {
    expect(NATIVE).not.toMatch(
      /(?:^|\n)\s*import\s*\{[^}]*\bFile\b[^}]*\}\s*from\s*["']expo-file-system["']/,
    );
  });

  it("loads expo/fetch and expo-file-system LAZILY via await import()", () => {
    expect(NATIVE).toMatch(/await import\(\s*["']expo\/fetch["']\s*\)/);
    expect(NATIVE).toMatch(/await import\(\s*["']expo-file-system["']\s*\)/);
  });
});
