/**
 * ORCH-1098 Stage 5 — Residual 2 regression gate (event/create React #300).
 *
 * Root cause: `app/_layout.tsx` (the ROOT layout wrapping EVERY route) placed
 * its signed-out + mobile-web-route recovery EARLY RETURNS
 * (`<Orch1092SignedOutRecovery>` / `<Orch1093MobileRouteRecovery>`) BEFORE ~9
 * hooks (usePushPermissionMoment + several useEffect/useState). When the
 * auth/route gate flipped between renders (e.g. `loading`→resolved while
 * signed-out, or a route-status change), React saw a DIFFERENT hook count
 * between renders → "Minified React error #300" → the app error boundary
 * ("Something broke") → redirect to `/`. Device-repro'd on the Samsung at
 * `/event/create` via deep-link AND the in-app "Create event" CTA (the wizard
 * mounts exactly as auth resolves). ESLint flagged 9 `react-hooks/rules-of-hooks`
 * errors on the file (hooks-after-early-return) — the static signature of #300.
 *
 * Fix: every hook is called UNCONDITIONALLY; the two recovery `return`s are
 * DEFERRED to after all hooks (computed as `shouldShow*` booleans early, but
 * the actual returns run just before the JSX return). All renders now call the
 * same hooks in the same order.
 *
 * This test asserts the structural invariant: NO recovery `return` statement
 * appears before the LAST React-hook call in the component. It parses real
 * source (no render — _layout pulls the whole provider tree).
 *
 * Fails-on-revert: move either recovery `return` back above the hooks and this
 * test goes RED. ESLint fails-on-revert independently proven: 9 rules-of-hooks
 * errors with the bug → 0 with the fix.
 */
import { readFileSync } from "fs";
import { join } from "path";

const LAYOUT = join(__dirname, "..", "app", "_layout.tsx");

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

describe("ORCH-1098 Stage 5 — _layout hooks-order fix (Residual 2 / React #300)", () => {
  const raw = readFileSync(LAYOUT, "utf8");
  const src = stripComments(raw);

  // Isolate the RootLayoutInner component body (the buggy component) — from
  // its declaration to the start of the next top-level `const ...Styles` or
  // `export default function RootLayout`.
  const innerStart = src.search(/function RootLayoutInner\b/);
  const innerEndCandidates = [
    src.indexOf("const orch1092Styles", innerStart),
    src.search(/export default function RootLayout\b/),
  ].filter((n) => n > innerStart);
  const innerEnd = Math.min(...innerEndCandidates);
  const inner = src.slice(innerStart, innerEnd);

  test("RootLayoutInner body was located", () => {
    expect(innerStart).toBeGreaterThan(-1);
    expect(innerEnd).toBeGreaterThan(innerStart);
  });

  // Position of the LAST React-hook CALL in the component body.
  const HOOK_CALL = /\b(useEffect|useState|useRef|usePushPermissionMoment|useCurrentBrandRecovery|useBrand|useCurrentBrandId|useAuth|usePathname|useRouter)\s*\(/g;
  function lastHookCallIndex(body: string): number {
    let m: RegExpExecArray | null;
    let last = -1;
    while ((m = HOOK_CALL.exec(body)) !== null) last = m.index;
    return last;
  }

  test("both recovery returns are DEFERRED to after the last hook call (no hooks after an early return)", () => {
    const lastHook = lastHookCallIndex(inner);
    expect(lastHook).toBeGreaterThan(-1);

    const signedOutReturn = inner.indexOf("return (\n        <Orch1092SignedOutRecovery") >= 0
      ? inner.indexOf("<Orch1092SignedOutRecovery")
      : inner.indexOf("<Orch1092SignedOutRecovery");
    const mobileRouteReturn = inner.indexOf("<Orch1093MobileRouteRecovery");

    expect(signedOutReturn).toBeGreaterThan(-1);
    expect(mobileRouteReturn).toBeGreaterThan(-1);

    // The recovery JSX returns must come AFTER the last hook call.
    expect(signedOutReturn).toBeGreaterThan(lastHook);
    expect(mobileRouteReturn).toBeGreaterThan(lastHook);
  });

  test("the recovery decisions are computed as deferred booleans (returns gated on shouldShow*)", () => {
    expect(inner).toMatch(/const\s+shouldShowSignedOutRecovery\s*=/);
    expect(inner).toMatch(/const\s+shouldShowMobileRouteRecovery\s*=/);
    expect(inner).toMatch(/if\s*\(\s*shouldShowSignedOutRecovery\s*\)/);
    expect(inner).toMatch(/if\s*\(\s*shouldShowMobileRouteRecovery\s*\)/);
  });

  test("the key deferred hooks still run unconditionally (present in the body)", () => {
    // These are the hooks that USED to be skipped by the early returns.
    expect(inner).toMatch(/usePushPermissionMoment\s*\(/);
    // notification handlers + deferred-push replay + AppState + eviction/reap
    // are all useEffect — assert a healthy count of hook calls remains.
    const hookCount = (inner.match(HOOK_CALL) ?? []).length;
    expect(hookCount).toBeGreaterThanOrEqual(8);
  });
});
