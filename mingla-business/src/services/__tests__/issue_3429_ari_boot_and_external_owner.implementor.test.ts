/**
 * #3429 CI pass — two defects CI caught that a local subset did not.
 *
 * Both are behavioural, both are the kind that only bite in production, and
 * both were green in every gate I ran locally before CI ran the whole lane.
 *
 * ORCH-1296 — `ariAttachmentFileReader.native.ts` imported `expo-file-system`'s
 * new `File` API at MODULE SCOPE. A top-level import of a native module is
 * evaluated at boot, so when the native side is missing or version-mismatched
 * it throws before the first frame: the app bricks on the splash screen. This
 * branch ships over OTA, which is exactly how that reaches every installed app
 * at once. The fix is a lazy `await import(...)` inside each function.
 *
 * ORCH-1381 — `ariAttachmentService.openAriAttachment` re-rolled
 * `window.open(dest, "_blank", "noopener,noreferrer")` inline instead of
 * calling this package's `openExternal` owner. Either token makes `open()`
 * return null EVEN WHEN IT SUCCEEDED, so the owner's popup-block fallback
 * fires on every tap and the page double-navigates. The owner opens bare,
 * severs `win.opener` to keep the security property, and falls back only on a
 * genuine failure.
 *
 * These are source-shape assertions on purpose. Both defects are about WHERE a
 * call lives — module scope versus function body, inline versus the owner —
 * and neither is observable from the module's return values: a lazily imported
 * `File` and a top-level one behave identically once the native module loads,
 * which is why this shipped. The runtime half of ORCH-1381 is already covered
 * by the owner's own suite.
 *
 * fails-on-revert (proven by real mutation, never a comment-out):
 *   - restore the top-level `import { File } from "expo-file-system"` -> T-1/T-2 fail
 *   - restore the inline `window.open(..., "noopener,noreferrer")` -> T-3/T-4 fail
 */

import fs from "node:fs";
import path from "node:path";

const SERVICES = path.join(__dirname, "..");
const read = (name: string): string => fs.readFileSync(path.join(SERVICES, name), "utf8");

/** Strip comments so prose describing the trap can never satisfy an assertion
 *  (the #3429 R-3 lesson: a docblock quoting the code is not the code). */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("#3429 · ORCH-1296 — the native file reader is not evaluated at boot", () => {
  const source = code(read("ariAttachmentFileReader.native.ts"));

  it("T-1 does NOT import expo-file-system at module scope", () => {
    // A top-level import runs at boot. That is the splash brick.
    expect(source).not.toMatch(/^\s*import\s[^;]*from\s*["']expo-file-system["']/m);
    expect(source).not.toMatch(/^\s*import\s*\{[^}]*\bFile\b[^}]*\}\s*from/m);
  });

  it("T-2 imports it lazily inside every function that uses the File API", () => {
    const lazy = [...source.matchAll(/const\s*\{\s*File\s*\}\s*=\s*await\s+import\(\s*["']expo-file-system["']\s*\)/g)];
    const uses = [...source.matchAll(/new\s+File\s*\(/g)];
    expect(uses.length).toBeGreaterThan(0);
    // One lazy import per function that constructs a File — not one shared
    // module-scope binding wearing a dynamic-import disguise.
    expect(lazy.length).toBe(uses.length);
    // ...and each lazy import is inside a function body, never at column 0.
    for (const m of lazy) {
      const lineStart = source.lastIndexOf("\n", m.index ?? 0) + 1;
      expect((m.index ?? 0) - lineStart).toBeGreaterThan(0);
    }
  });
});

describe("#3429 · ORCH-1381 — opening an attachment goes through the ONE owner", () => {
  const source = code(read("ariAttachmentService.ts"));

  it("T-3 does not re-roll window.open with noopener/noreferrer", () => {
    // Either token makes open() return null on SUCCESS, which double-navigates.
    expect(source).not.toMatch(/window\.open\s*\([^)]*noopener/i);
    expect(source).not.toMatch(/window\.open\s*\([^)]*noreferrer/i);
    expect(source).not.toMatch(/\bwindow\.open\s*\(/);
  });

  it("T-4 calls this package's openExternal owner instead", () => {
    expect(source).toMatch(/import\s*\{[^}]*\bopenExternal\b[^}]*\}\s*from\s*["']\.\/guestFunnelLink["']/);
    expect(source).toMatch(/openExternal\s*\(\s*data\.signed_url\s*\)/);
  });

  it("T-5 the owner still opens BARE and severs opener (the property T-4 relies on)", () => {
    const owner = code(read("guestFunnelLink.ts"));
    const fn = owner.slice(owner.indexOf("export function openExternal"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    expect(body).toMatch(/\.open\(\s*dest\s*,\s*["']_blank["']\s*\)/);
    expect(body).not.toMatch(/noopener|noreferrer/i);
    expect(body).toMatch(/opener\s*=\s*null/);
  });
});
