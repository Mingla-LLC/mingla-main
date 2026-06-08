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
    // [TEST-MOD-APPROVED ORCH-1102] styles renamed orch1092Styles→authRoutingStyles
    src.indexOf("const authRoutingStyles", innerStart),
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

  // [TEST-MOD-APPROVED ORCH-1102] The two recovery CARDS
  // (<Orch1092SignedOutRecovery> / <Orch1093MobileRouteRecovery>) were REMOVED by
  // ORCH-1102. The hooks-order invariant they motivated still matters: the new
  // auth-routing early returns (the AuthResolvingScreen spinner + the
  // <Redirect href="/" /> to sign-in) must STILL be DEFERRED to after every
  // React-hook call so all renders call the same hooks in the same order
  // (React #300 fix preserved). These tests now assert that against the new
  // returns instead of the deleted cards.
  test("both auth-routing returns are DEFERRED to after the last hook call (no hooks after an early return)", () => {
    const lastHook = lastHookCallIndex(inner);
    expect(lastHook).toBeGreaterThan(-1);

    const resolvingReturn = inner.indexOf("<AuthResolvingScreen");
    const redirectReturn = inner.indexOf('<Redirect href="/" />');

    expect(resolvingReturn).toBeGreaterThan(-1);
    expect(redirectReturn).toBeGreaterThan(-1);

    // The auth-routing returns must come AFTER the last hook call.
    expect(resolvingReturn).toBeGreaterThan(lastHook);
    expect(redirectReturn).toBeGreaterThan(lastHook);
  });

  test("the auth-routing decisions are computed as deferred booleans (returns gated on the predicates)", () => {
    expect(inner).toMatch(/const\s+authResolving\s*=/);
    expect(inner).toMatch(/const\s+redirectToSignIn\s*=/);
    expect(inner).toMatch(/if\s*\(\s*authResolving\s*\)/);
    expect(inner).toMatch(/if\s*\(\s*redirectToSignIn\s*\)/);
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
