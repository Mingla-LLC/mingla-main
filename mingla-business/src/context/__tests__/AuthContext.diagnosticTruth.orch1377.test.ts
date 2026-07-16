/**
 * ORCH-1377 [business-web-auth-7s-log-lies] — T-11 / T-12 / SC-14 / SC-15:
 * THE DIAGNOSTIC-TRUTH GUARD.
 *
 * ─── WHAT WENT WRONG ───────────────────────────────────────────────────────
 * The loading-gate release backstop was guarded ONLY by `if (!mounted) return;`.
 * It never read whether auth had resolved, so it fired on EVERY load where the
 * tab stayed open ~7.5s — including loads where auth resolved in 604ms. Measured
 * 4/4 at ~7505-7666ms with ZERO observable state change. It emitted:
 *
 *   "[auth] resolution-hard-ceiling: auth did not resolve within 7000ms"
 *
 * …which was FALSE on 100% of loads. That lie cost a full investigation cycle and
 * produced a "7-second stall" report for a stall that never existed.
 *
 * And it was not only noise: the same unconditional body armed
 * `bootstrapTimedOutRef` — a flag whose NAME MEANS "bootstrap FAILED" — on every
 * healthy boot (F-3). The listener at :540 uses that flag to discard stale echoes
 * of a FAILED bootstrap, so a wrongly-armed flag silently drops a later passive
 * event carrying an unusable session instead of clearing session/user.
 *
 * ─── THE TRAP THESE TESTS PIN ──────────────────────────────────────────────
 * The bootstrap effect is `useEffect(…, [])` — it runs ONCE. A naive
 * `if (!loading) return;` inside the timer closes over `loading` FROM MOUNT
 * (true), so it would NEVER guard and the "fix" would silently do nothing while
 * looking correct. Only a REF is read at fire time.
 *
 * ─── TEST STYLE ────────────────────────────────────────────────────────────
 * AuthContext.tsx contains JSX that the node/ts-jest harness does not transform
 * from a `.test.ts`, and there is no RTL installed under the default config, so
 * <AuthProvider> cannot be MOUNTED here. That constrains HOW we reach the
 * backstop — it does NOT license testing a copy of it.
 *   (A) STRUCTURAL — slice the REAL shipped source and assert the guard exists
 *       AND is ordered before everything it guards. Fails-on-revert by
 *       construction: line-delete the guard → these fail.
 *   (B) BEHAVIORAL — slice the REAL shipped timer body out of AuthContext.tsx
 *       and EXECUTE it against injected spies.
 *
 * ─── ORCH-1373 P2-2 — WHY (B) WAS REWRITTEN (read before you touch it) ──────
 * (B) used to hand-roll a local `armBackstop()` that RE-TYPED the production
 * timer shape. The ORCH-1373 tester proved it was DECORATIVE: because it imported
 * only `fs`/`path` and never executed AuthContext.tsx, DELETING THE REAL GUARD
 * FROM THE REAL FILE LEFT T-11/T-12 GREEN. It tested a copy of the fix, not the
 * fix. SC-14 survived that review only because it was independently proven at
 * RUNTIME (real Chrome, 9s hold, zero backstop logs) — the unit test contributed
 * nothing to the verdict it appeared to support.
 *
 * The replica had also silently DRIFTED from production: it guarded on
 * `mountedRef.current` while the shipped code closes over a bare `mounted`
 * variable. A replica that diverges from the thing it mirrors is worse than no
 * test — it reports on code that does not exist.
 *
 * (B) now slices the REAL `setTimeout` callback body out of the shipped source
 * and runs it via `new Function` with the real collaborators injected. The test
 * no longer DESCRIBES the backstop; it RUNS it. Line-delete the guard from
 * AuthContext.tsx and T-11 FAILS, which is the whole point of a guard.
 */

import fs from "node:fs";
import path from "node:path";

const AUTH_CONTEXT_SOURCE = fs.readFileSync(
  path.join(__dirname, "..", "AuthContext.tsx"),
  "utf8",
);

/** The REAL backstop callback body, sliced from the shipped source. */
const ceilingBody = (): string => {
  const m = AUTH_CONTEXT_SOURCE.match(
    /hardCeilingTimer = setTimeout\(\(\) => \{[\s\S]*?\}, AUTH_LOADING_GATE_RELEASE_BACKSTOP_MS\);/,
  );
  expect(m).not.toBeNull();
  return m![0];
};

// ─────────────────────────────────────────────────────────────────────────────
// (A) STRUCTURAL — against the REAL shipped module
// ─────────────────────────────────────────────────────────────────────────────

describe("ORCH-1377 (A) structural — the backstop reads the state it describes", () => {
  it("T-11a — the backstop body carries the bootstrapResolvedRef early-return guard", () => {
    // Line-delete this guard from AuthContext.tsx and this test FAILS. That is
    // the fails-on-revert property.
    expect(ceilingBody()).toMatch(/if \(bootstrapResolvedRef\.current\) return;/);
  });

  it("T-11b — the guard is ordered BEFORE the log (a log it does not gate is a log that lies)", () => {
    const body = ceilingBody();
    const guardIdx = body.indexOf("if (bootstrapResolvedRef.current) return;");
    const logIdx = body.indexOf("console.warn");
    expect(guardIdx).toBeGreaterThan(-1);
    expect(logIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(logIdx);
  });

  it("T-11c — the guard is ordered BEFORE the bootstrapTimedOutRef write (this is the F-3 half)", () => {
    const body = ceilingBody();
    const guardIdx = body.indexOf("if (bootstrapResolvedRef.current) return;");
    const refWriteIdx = body.indexOf("bootstrapTimedOutRef.current = true");
    expect(guardIdx).toBeGreaterThan(-1);
    expect(refWriteIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(refWriteIdx);
  });

  it("T-11d — the guard sits AFTER the mounted check (unmount must still short-circuit first)", () => {
    const body = ceilingBody();
    expect(body.indexOf("if (!mounted) return;")).toBeLessThan(
      body.indexOf("if (bootstrapResolvedRef.current) return;"),
    );
  });

  it("ORCH-1204 PRESERVED — the backstop still releases ONLY loading, never clears user/session", () => {
    const body = ceilingBody();
    expect(body).toMatch(/setLoading\(false\)/);
    expect(body).toMatch(/bootstrapTimedOutRef\.current = true/);
    expect(body).not.toMatch(/setUser\(\s*null\s*\)/);
    expect(body).not.toMatch(/setSession\(\s*null\s*\)/);
  });

  it("C-1377-N4 — the log text no longer asserts a falsehood, and the old lying text is GONE", () => {
    // The old text claimed "auth did not resolve" unconditionally. The new text
    // can only be emitted when that is TRUE (guarded above) — true by
    // construction, not by intent.
    expect(AUTH_CONTEXT_SOURCE).toMatch(/\[auth\] loading-gate-backstop:/);
    expect(AUTH_CONTEXT_SOURCE).not.toMatch(/resolution-hard-ceiling/);
  });

  it("SC-15 — ALL THREE bootstrap resolution points set bootstrapResolvedRef (miss one = the log lies on that path)", () => {
    const writes = (
      AUTH_CONTEXT_SOURCE.match(/bootstrapResolvedRef\.current = true;/g) ?? []
    ).length;
    // 1: ORCH-0887-A race-timeout branch. 2: getSession() error branch.
    // 3: the ORCH-1294 main success release (the normal path).
    expect(writes).toBeGreaterThanOrEqual(3);
  });

  it("SC-15 — each resolution point is labelled so the next reader cannot delete one by accident", () => {
    const labels = (
      AUTH_CONTEXT_SOURCE.match(/ORCH-1377 resolution point \d\/3/g) ?? []
    ).length;
    expect(labels).toBe(3);
  });

  it("the ref is declared with useRef(false) — not derived from the stale-closure `loading`", () => {
    expect(AUTH_CONTEXT_SOURCE).toMatch(
      /const bootstrapResolvedRef = useRef\(false\);/,
    );
  });

  it("ANTI-STALE-CLOSURE — the backstop does NOT guard on the captured `loading` value", () => {
    // `useEffect(…, [])` captures `loading === true` at mount forever. A
    // `if (!loading) return;` here would never fire and the fix would be a no-op
    // that looks correct. This pins the ref-based mechanism.
    expect(ceilingBody()).not.toMatch(/if \(!loading\) return;/);
  });

  it("C-1377-N4 — the ORCH-1292 native arming is NOT regressed (no Platform gate around the timer)", () => {
    const noComments = AUTH_CONTEXT_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(
      /(^|[^:])\/\/.*$/gm,
      "$1",
    );
    expect(noComments).not.toMatch(
      /if \(Platform\.OS === "web"\)\s*\{[\s\S]{0,200}?hardCeilingTimer = setTimeout\(/,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (B) BEHAVIORAL — the production timer shape, driven in both directions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ORCH-1373 P2-2 — arm the REAL backstop.
 *
 * Slices the shipped `setTimeout` CALLBACK BODY out of AuthContext.tsx and
 * compiles it with the real collaborators injected. Nothing here re-types
 * production logic: if the shipped body changes, THIS RUNS THE CHANGED BODY.
 *
 * `mounted` is injected as a bare value (not a ref) because the shipped code
 * closes over a bare `let mounted` — matching production exactly is the point.
 * It is read through a getter so a test can flip it after arming, which is what
 * the real closure does.
 */
const realBackstopBody = (): string => {
  const m = AUTH_CONTEXT_SOURCE.match(
    /hardCeilingTimer = setTimeout\(\(\) => \{([\s\S]*?)\}, AUTH_LOADING_GATE_RELEASE_BACKSTOP_MS\);/,
  );
  expect(m).not.toBeNull();
  return m![1];
};

function armBackstop({
  isMounted,
  bootstrapResolvedRef,
  bootstrapTimedOutRef,
  setLoading,
  warn,
  backstopMs,
}: {
  isMounted: () => boolean;
  bootstrapResolvedRef: { current: boolean };
  bootstrapTimedOutRef: { current: boolean };
  setLoading: (v: boolean) => void;
  warn: (msg: string) => void;
  backstopMs: number;
}): ReturnType<typeof setTimeout> {
  // Compile the REAL body. `mounted` is a getter-backed local so the injected
  // closure variable behaves like the production `let mounted`.
  // eslint-disable-next-line no-new-func
  const compiled = new Function(
    "__isMounted",
    "bootstrapResolvedRef",
    "bootstrapTimedOutRef",
    "setLoading",
    "console",
    "AUTH_LOADING_GATE_RELEASE_BACKSTOP_MS",
    `"use strict";
     return function () {
       const mounted = __isMounted();
       ${realBackstopBody()}
     };`,
  ) as (
    isMountedFn: () => boolean,
    resolvedRef: { current: boolean },
    timedOutRef: { current: boolean },
    setLoadingFn: (v: boolean) => void,
    consoleLike: { warn: (msg: string) => void },
    backstopMsValue: number,
  ) => () => void;

  const callback = compiled(
    isMounted,
    bootstrapResolvedRef,
    bootstrapTimedOutRef,
    setLoading,
    { warn },
    backstopMs,
  );

  return setTimeout(callback, backstopMs);
}

describe("ORCH-1377 (B) behavioral — T-11 / T-12 against the REAL shipped body", () => {
  const BACKSTOP_MS = 7000;
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const harness = () => {
    let mounted = true;
    return {
      isMounted: () => mounted,
      setMounted: (v: boolean) => {
        mounted = v;
      },
      bootstrapResolvedRef: { current: false },
      bootstrapTimedOutRef: { current: false },
      setLoading: jest.fn(),
      warn: jest.fn(),
      backstopMs: BACKSTOP_MS,
    };
  };

  it("T-11 — RESOLVED boot (getSession → {session:null} fast): NO log, ref NOT armed, past 7s", () => {
    const h = harness();
    armBackstop(h);
    // Bootstrap resolves quickly — the normal path (resolution point 3/3).
    h.bootstrapResolvedRef.current = true;
    h.setLoading(false);
    h.setLoading.mockClear();

    jest.advanceTimersByTime(BACKSTOP_MS + 1000);

    // SC-14 — the log that fired 4/4 must now be silent.
    expect(h.warn).not.toHaveBeenCalled();
    // SC-15 — the F-3 half: the "bootstrap FAILED" flag must NOT be armed.
    expect(h.bootstrapTimedOutRef.current).toBe(false);
    expect(h.setLoading).not.toHaveBeenCalled();
  });

  it("T-12 — REAL stall (getSession never resolves): the log IS emitted and loading IS released", () => {
    // The anti-over-correction guard: this FAILS if someone "fixes" the lying
    // log by deleting the backstop. The backstop's purpose (GoTrue lock
    // deadlock) is legitimate and must survive.
    const h = harness();
    armBackstop(h);

    jest.advanceTimersByTime(BACKSTOP_MS + 1);

    expect(h.warn).toHaveBeenCalledTimes(1);
    expect(h.warn.mock.calls[0][0]).toMatch(/loading-gate-backstop/);
    expect(h.bootstrapTimedOutRef.current).toBe(true);
    expect(h.setLoading).toHaveBeenCalledWith(false);
  });

  it("T-12b — the backstop still fires when bootstrap resolves LATE (after the backstop)", () => {
    const h = harness();
    armBackstop(h);
    jest.advanceTimersByTime(BACKSTOP_MS + 1);
    expect(h.warn).toHaveBeenCalledTimes(1);
    // A late resolution afterwards must not retroactively silence anything.
    h.bootstrapResolvedRef.current = true;
    jest.advanceTimersByTime(BACKSTOP_MS);
    expect(h.warn).toHaveBeenCalledTimes(1);
  });

  it("unmount still short-circuits BEFORE the resolved check (ordering preserved)", () => {
    const h = harness();
    armBackstop(h);
    h.setMounted(false);
    jest.advanceTimersByTime(BACKSTOP_MS + 1);
    expect(h.warn).not.toHaveBeenCalled();
    expect(h.bootstrapTimedOutRef.current).toBe(false);
  });

  it("STALE-CLOSURE PROOF — a `loading`-captured guard would NEVER fire (why the ref is mandatory)", () => {
    // This test exists to make the trap legible: `useEffect(…, [])` captures
    // loading=true at mount. Even though bootstrap later resolves, the captured
    // value stays true forever — so `if (!loading) return;` never guards.
    const capturedLoadingAtMount = true;
    let liveLoading = true;
    const warn = jest.fn();

    setTimeout(() => {
      // The NAIVE fix, verbatim. It reads the CAPTURED value, not the live one.
      if (!capturedLoadingAtMount) return;
      warn("would still lie");
    }, BACKSTOP_MS);

    liveLoading = false; // bootstrap resolved — the live state says "fine"
    jest.advanceTimersByTime(BACKSTOP_MS + 1);

    expect(liveLoading).toBe(false); // reality: resolved
    expect(warn).toHaveBeenCalled(); // the naive guard STILL lied — hence the ref
  });
});
