import * as fs from "fs";
import * as path from "path";

/**
 * Issue #1035 — TESTER adversarial regression (DIFFERENT ANGLE).
 *
 * Root cause (proven on-device): `themeSheetOpen` (a useState GETTER) was read
 * inside the memoized `renderSectionBody` useCallback via
 * `<ThemeSheet visible={themeSheetOpen}>`, while it was ABSENT from that
 * callback's dependency array. Tapping the Theme row flipped the state but
 * changed no listed dep, so React returned the cached closure that still closed
 * over `themeSheetOpen === false` — the sheet never presented.
 *
 * The implementor's happy-path test asserts WHERE `<ThemeSheet>` is rendered
 * (structural placement below the memo). This tester test attacks the ROOT
 * CAUSE directly and GENERALLY: it proves the stale-closure hazard cannot
 * recur by asserting the `themeSheetOpen` GETTER is never read anywhere inside
 * the `renderSectionBody` useCallback body — only the stable SETTER
 * (`setThemeSheetOpen`, safe because its identity never changes) may appear
 * there. Any future edit that re-introduces a getter read into that memo
 * without adding it to the deps re-opens the exact bug and trips this test.
 *
 * Structural-assertion pattern (jest here has no component renderer); repo
 * precedent: app/event/[id]/__tests__/manage-menu-unmount-on-close.test.tsx.
 * Source is comment-stripped first so the fix's own explanatory comments
 * (which mention `themeSheetOpen`) can never satisfy or trip the assertions.
 */

const FILE = path.resolve(__dirname, "../EditPublishedScreen.tsx");

function stripComments(src: string): string {
  // block comments (incl. JSX {/* ... */}) first, then line comments.
  // The line-comment rule preserves `scheme://` by requiring the char before
  // `//` to not be a colon.
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** Return the full `useCallback( ... )` call text for renderSectionBody, via paren-matching. */
function extractRenderSectionBodyCall(src: string): string {
  const marker = "renderSectionBody = useCallback(";
  const start = src.indexOf(marker);
  if (start === -1) {
    throw new Error("renderSectionBody = useCallback( not found in source");
  }
  const openParenIdx = start + marker.length - 1; // index of the '(' after useCallback
  let depth = 0;
  for (let i = openParenIdx; i < src.length; i++) {
    const c = src[i];
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return src.slice(openParenIdx, i + 1);
    }
  }
  throw new Error("Could not paren-match the renderSectionBody useCallback call");
}

describe("#1035 tester adversarial — themeSheetOpen getter never re-enters the renderSectionBody memo", () => {
  const raw = fs.readFileSync(FILE, "utf8");
  const src = stripComments(raw);
  const callbackCall = extractRenderSectionBodyCall(src);
  const openParenIdx = src.indexOf(callbackCall);
  const callbackEndIdx = openParenIdx + callbackCall.length;

  it("sanity: the memoized renderSectionBody callback is present and still owns the Theme row's stable setter", () => {
    expect(callbackCall.length).toBeGreaterThan(100);
    // The Theme row (ThemeControlRow) stays inside the Visual section body and
    // opens the sheet via the STABLE setter — that must remain.
    expect(callbackCall).toContain("setThemeSheetOpen(true)");
  });

  it("FAILS-ON-REVERT: the `themeSheetOpen` getter is never READ inside renderSectionBody (only the stable setter may appear)", () => {
    // The getter is lowercase `themeSheetOpen`; the setter is `setThemeSheetOpen`
    // (capital T after "set"). A word-boundary lowercase match therefore counts
    // ONLY bare getter reads and never the stable setter calls.
    const bareGetterReads = (callbackCall.match(/\bthemeSheetOpen\b/g) || [])
      .length;
    // pre-fix: `visible={themeSheetOpen}` lives in the memo -> >= 1 -> FAIL
    // post-fix: only setThemeSheetOpen(...) in the memo      -> 0    -> PASS
    expect(bareGetterReads).toBe(0);
  });

  it("the sole `visible={themeSheetOpen}` reader lives in LIVE render scope, strictly after the memo closes", () => {
    const readers = src.match(/visible=\{themeSheetOpen\}/g) || [];
    // exactly one reader in the whole component
    expect(readers.length).toBe(1);
    const readerIdx = src.indexOf("visible={themeSheetOpen}");
    // and it is evaluated OUTSIDE (after) the renderSectionBody useCallback call
    expect(readerIdx).toBeGreaterThan(callbackEndIdx);
  });
});
