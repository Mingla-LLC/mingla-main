/**
 * ORCH-1098 Stage 5 — Residual 1 regression gate (compose OOM).
 *
 * Root cause (device-proven on a physical Samsung SM-A725F, heap bisect):
 * `/marketing/campaigns/compose` OOM-crashed phone Chrome ("Aw, Snap").
 * The offender was NOT the Tiptap editor and NOT the BottomNav — it was the
 * `TemplatePreviewDrawer` NARROW-WEB path, which delegated to the NATIVE base
 * component (`TemplatePreviewDrawer.tsx`, imported as `MobileDrawer`). That
 * native-targeted component drives an unbounded re-render / allocation loop
 * the instant it mounts on phone Chrome under React 19 — EVEN while
 * `visible === false` (it returns null but its hooks still run): the route
 * climbs ~12 MB → ~870 MB in ~5 s and SIGSEGVs.
 *
 * Fix (web-gate, mirrors BottomNav.web.tsx): narrow mobile web now renders a
 * NEW loop-free `MobileWebDrawer` (plain Views, renders null until visible,
 * no native Modal / no native base component). Desktop web keeps the inline
 * right-rail; iOS/Android keep the full native base drawer.
 *
 * This test asserts the web gate stays in place so the OOM can never silently
 * regress. It parses real source structure (no DOM render — these RN-web
 * components are fragile under jsdom).
 *
 * Fails-on-revert: restore the `MobileDrawer` re-export + `return <MobileDrawer/>`
 * narrow branch and this file goes RED (the import edge + the narrow-branch
 * delegation assertions fail). Device-proven at origin/main `56f0da9e2`.
 */
import { readFileSync } from "fs";
import { join } from "path";

const COMPOSER = join(
  __dirname,
  "..",
  "src",
  "components",
  "marketing",
  "ComposerV2",
);
const WEB = join(COMPOSER, "TemplatePreviewDrawer.web.tsx");
const NATIVE = join(COMPOSER, "TemplatePreviewDrawer.tsx");

/** Remove `// line` and `/* block *​/` comments so matches are on real code. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

describe("ORCH-1098 Stage 5 — compose drawer loop fix (Residual 1)", () => {
  const webRaw = readFileSync(WEB, "utf8");
  const web = stripComments(webRaw);
  const nativeRaw = readFileSync(NATIVE, "utf8");

  test("narrow-web path renders the loop-free MobileWebDrawer (not the native base)", () => {
    // The narrow branch must delegate to MobileWebDrawer.
    expect(web).toMatch(/return\s*<MobileWebDrawer\b/);
    // And MobileWebDrawer must be defined IN this web file.
    expect(web).toMatch(/const\s+MobileWebDrawer\s*:/);
  });

  test("web file NO LONGER imports/re-exports the native base drawer as MobileDrawer", () => {
    // The pre-fix vector: `import { TemplatePreviewDrawer as MobileDrawer } from "./TemplatePreviewDrawer"`.
    // Any import edge that binds a name from "./TemplatePreviewDrawer" and
    // renders it as a component is the regression we forbid (the value import;
    // a `import type` for props is still allowed).
    const valueImportEdge =
      /import\s+\{[^}]*\bTemplatePreviewDrawer\s+as\s+MobileDrawer[^}]*\}\s+from\s+["']\.\/TemplatePreviewDrawer["']/;
    expect(web).not.toMatch(valueImportEdge);
    // And the native base must never be rendered on the web path.
    expect(web).not.toMatch(/<MobileDrawer\b/);
  });

  test("MobileWebDrawer renders nothing until visible (no hooks-driven work at mount)", () => {
    // Locate the MobileWebDrawer component body and assert the early
    // `if (!visible) return null;` guard exists so a closed drawer is free.
    const start = web.indexOf("const MobileWebDrawer");
    expect(start).toBeGreaterThan(-1);
    const body = web.slice(start, start + 1600);
    expect(body).toMatch(/if\s*\(\s*!visible\s*\)\s*return null/);
  });

  test("MobileWebDrawer does NOT use the native-only Modal or useWindowDimensions", () => {
    const start = web.indexOf("const MobileWebDrawer");
    const body = web.slice(start, start + 2000);
    // The loop class lived in the native base drawer's Modal + window-dims +
    // debounce machinery. The web drawer must avoid native Modal and
    // useWindowDimensions entirely (it's a plain absolute overlay).
    expect(body).not.toMatch(/<Modal\b/);
    expect(body).not.toMatch(/useWindowDimensions/);
  });

  test("PARITY: native base TemplatePreviewDrawer.tsx is untouched (still the full Modal drawer)", () => {
    // The native swipe + live-preview drawer must remain — the fix is a
    // web-gate, not a global rip-out. iOS/Android still render the rich Modal.
    expect(nativeRaw).toMatch(/<Modal\b/);
    expect(nativeRaw).toMatch(/useWindowDimensions/);
  });
});
