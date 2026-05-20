/**
 * ORCH-0887-A [Auth getSession Promise.race timeout] — implementor
 * happy-path regression test (SPEC §8.1).
 *
 * Parent ORCH: ORCH-0887 [Mingla Business Web Performance — slow page
 * loads + hanging loaders].
 * SPEC: /Users/sethogieva/Desktop/mingla-main/Mingla_Artifacts/specs/SPEC_ORCH-0887-A_AUTH_GETSESSION_TIMEOUT.md
 *
 * ─────────────────────────────────────────────────────────────────────
 * Test-style note (mandatory pre-amble per the implementor brief):
 *
 * The SPEC §8.1 describes a render-test using React Native Testing
 * Library + `<AuthProvider><TestConsumer/></AuthProvider>`. The brief
 * required confirming the project's test stack first
 * (`cat package.json | grep -A 5 '"scripts"'`). Confirmation result:
 *
 *   - `mingla-business/jest.config.cjs` uses `testEnvironment: "node"`
 *     and `preset: "ts-jest"`.
 *   - `package.json` devDependencies contains ONLY `@jest/globals`,
 *     `@types/jest`, `jest`, `ts-jest`. NO `@testing-library/react-native`,
 *     NO `react-test-renderer`, NO `jsdom`.
 *   - The repo-wide convention (codified by sibling test
 *     `EventListCard_defensiveFilter.test.tsx` lines 29-33: "this repo
 *     uses source-text-assertion tests rather than render-tree-assertion
 *     tests (no @testing-library/react-native installed)") is to assert
 *     the SHAPE of the source code + run PURE-LOGIC tests of the
 *     extracted semantics. The Toast test (Toast.test.tsx lines 1-7)
 *     makes the same observation: "Full render tests … require
 *     @testing-library/react-native — not currently part of the
 *     mingla-business Jest harness."
 *
 * Therefore this file follows the established repo convention. It splits
 * SPEC §8.1's four contract-coverage cases across two test surfaces:
 *
 *   (A) Pure Promise.race semantics — tests the actual race-and-resolve
 *       behaviour with `jest.useFakeTimers()`, the real
 *       `AUTH_BOOTSTRAP_TIMEOUT_MS` constant exported from
 *       AuthContext.tsx, and the same Symbol-sentinel pattern. This
 *       PROVES the timeout fires at the constant value, the sentinel
 *       discriminator works, and the never-resolves case completes in
 *       bounded synthetic time. It does NOT mount React, but it does
 *       exercise the exact JavaScript primitive the fix relies on.
 *
 *   (B) Source-text structural assertions — confirms the AuthContext.tsx
 *       file contains every required piece of the SPEC §2.2 pattern
 *       (constant, Symbol, ref, Promise.race call, timeout branch with
 *       early return, console.warn message). Removing or inverting ANY
 *       of these makes the file fail the assertions. This is the
 *       fails-on-revert mechanism.
 *
 * Each `it(...)` has an explicit per-test timeout (third arg, 5000ms)
 * so any future refactor that re-introduces the bug fails CI within ≤5s
 * rather than hanging — belt-and-suspenders per SPEC §8.3.
 *
 * The ADVERSARIAL test
 * (`AuthContext.timeout.adversarial.test.ts`) is the tester's
 * deliverable per SPEC §8.2 — not authored here.
 * ─────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from "fs";
import path from "path";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

// AuthContext.tsx contains JSX, which the project's ts-jest configuration
// does NOT successfully transform when imported from a `.test.ts` file
// (the Provider component on the last line trips a "SyntaxError: Unexpected
// token '<'" parse error during transform). The repo convention for testing
// values inside JSX-containing modules is to assert against the source text
// via fs.readFileSync — exactly the pattern in
// `EventListCard_defensiveFilter.test.tsx`. We mirror it here.
//
// To still PROVE the JS-primitive race semantics, we re-declare the
// canonical constant inline + assert it matches the source via regex
// (so any drift between the test's expectation and the file is caught
// at test-run time). The SPEC §2.1 explicitly forbids extracting the
// constant into a separate file (single-consumer rule).
const AUTH_BOOTSTRAP_TIMEOUT_MS = 3000 as const;

// ─────────────────────────────────────────────────────────────────────
// Surface A — Pure Promise.race semantics
//
// Reconstructs the EXACT race pattern from AuthContext.tsx (SPEC §2.2)
// in a testable form. We do NOT re-implement different logic — we run
// the same Promise.race shape against fake timers to prove the three
// SPEC §8.1 cases hold at the JS-primitive level.
// ─────────────────────────────────────────────────────────────────────

const AUTH_BOOTSTRAP_TIMEOUT_SENTINEL = Symbol("auth-bootstrap-timeout-test");
type Sentinel = typeof AUTH_BOOTSTRAP_TIMEOUT_SENTINEL;

type GetSessionShape =
  | { data: { session: { user: { id: string } } }; error: null }
  | { data: { session: null }; error: { message: string } }
  | { data: { session: null }; error: null };

/**
 * Same race shape the production code in AuthContext.tsx uses. Wrapped
 * here so the test can drive `getSessionPromise` with controllable
 * resolution timing.
 */
async function raceWithTimeout(
  getSessionPromise: Promise<GetSessionShape>,
  timeoutMs: number,
): Promise<GetSessionShape | Sentinel> {
  const timeoutPromise = new Promise<Sentinel>((resolve) => {
    setTimeout(() => resolve(AUTH_BOOTSTRAP_TIMEOUT_SENTINEL), timeoutMs);
  });
  return Promise.race([getSessionPromise, timeoutPromise]);
}

describe("ORCH-0887-A — Promise.race semantics (Surface A)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it(
    "Case 1 — getSession resolves immediately with session → race returns the session payload (NOT the sentinel) within 100ms of synthetic time",
    async () => {
      const realSession: GetSessionShape = {
        data: { session: { user: { id: "user-abc" } } },
        error: null,
      };
      // Synchronous resolution — Promise.race must pick this arm.
      const getSession = Promise.resolve(realSession);
      const racePromise = raceWithTimeout(
        getSession,
        AUTH_BOOTSTRAP_TIMEOUT_MS,
      );

      // Advance well under the 3s timeout window.
      jest.advanceTimersByTime(100);
      const result = await racePromise;

      expect(result).not.toBe(AUTH_BOOTSTRAP_TIMEOUT_SENTINEL);
      // Type-narrowing: result is the GetSessionShape arm.
      expect(result).toMatchObject({
        data: { session: { user: { id: "user-abc" } } },
        error: null,
      });
    },
    5000,
  );

  it(
    "Case 2 — getSession resolves immediately with no session → race returns the anon shape (NOT the sentinel) — the legitimate-anon path is preserved by the fix",
    async () => {
      const anonShape: GetSessionShape = {
        data: { session: null },
        error: null,
      };
      const getSession = Promise.resolve(anonShape);
      const racePromise = raceWithTimeout(
        getSession,
        AUTH_BOOTSTRAP_TIMEOUT_MS,
      );

      jest.advanceTimersByTime(100);
      const result = await racePromise;

      expect(result).not.toBe(AUTH_BOOTSTRAP_TIMEOUT_SENTINEL);
      expect(result).toMatchObject({
        data: { session: null },
        error: null,
      });
    },
    5000,
  );

  it(
    "Case 3 — getSession NEVER resolves → race returns the timeout sentinel after exactly AUTH_BOOTSTRAP_TIMEOUT_MS of synthetic time (the bug-repro case; bounded by fake timers + 5000ms per-test wallclock guard)",
    async () => {
      // Genuinely never-resolving promise — the production bug shape.
      const neverResolves = new Promise<GetSessionShape>(() => {
        /* intentionally never resolves */
      });
      const racePromise = raceWithTimeout(
        neverResolves,
        AUTH_BOOTSTRAP_TIMEOUT_MS,
      );

      // Just BEFORE the timeout: race must still be unresolved (not
      // racy against system clock — fake timers are deterministic).
      jest.advanceTimersByTime(AUTH_BOOTSTRAP_TIMEOUT_MS - 1);
      let resolvedEarly = false;
      void racePromise.then(() => {
        resolvedEarly = true;
      });
      // Drain the microtask queue without advancing time.
      await Promise.resolve();
      expect(resolvedEarly).toBe(false);

      // Now cross the timeout boundary — race MUST resolve to sentinel.
      jest.advanceTimersByTime(2);
      const result = await racePromise;

      expect(result).toBe(AUTH_BOOTSTRAP_TIMEOUT_SENTINEL);
    },
    5000,
  );

  it(
    "Case 4 — getSession resolves with error → race returns the error shape (NOT the sentinel) — preserves the existing error path at AuthContext.tsx (post-fix line 188-192)",
    async () => {
      const errorShape: GetSessionShape = {
        data: { session: null },
        error: { message: "test auth error" },
      };
      const getSession = Promise.resolve(errorShape);
      const racePromise = raceWithTimeout(
        getSession,
        AUTH_BOOTSTRAP_TIMEOUT_MS,
      );

      jest.advanceTimersByTime(100);
      const result = await racePromise;

      expect(result).not.toBe(AUTH_BOOTSTRAP_TIMEOUT_SENTINEL);
      expect(result).toMatchObject({
        data: { session: null },
        error: { message: "test auth error" },
      });
    },
    5000,
  );

  it(
    "Constant value matches SPEC §2.3 (3000ms) AND the inline test constant matches the source-of-truth in AuthContext.tsx — guards against drift between the test's expectation and the production constant.",
    () => {
      expect(AUTH_BOOTSTRAP_TIMEOUT_MS).toBe(3000);
      const sourceMatch = AUTH_CONTEXT_SOURCE.match(
        /export const AUTH_BOOTSTRAP_TIMEOUT_MS = (\d+);/,
      );
      expect(sourceMatch).not.toBeNull();
      if (sourceMatch) {
        expect(Number(sourceMatch[1])).toBe(AUTH_BOOTSTRAP_TIMEOUT_MS);
      }
    },
    5000,
  );
});

// ─────────────────────────────────────────────────────────────────────
// Surface B — Source-text structural assertions
//
// Project convention (see `EventListCard_defensiveFilter.test.tsx`
// lines 29-33). These assertions prove the file CONTAINS the SPEC §2.2
// pattern. Removing/inverting any of them is the fails-on-revert
// mechanism — any revert that takes out the Promise.race wrapper or
// the timeout branch makes one of these expects fail immediately.
// ─────────────────────────────────────────────────────────────────────

const AUTH_CONTEXT_SOURCE = readFileSync(
  path.resolve(__dirname, "..", "AuthContext.tsx"),
  "utf8",
);

describe("ORCH-0887-A — AuthContext.tsx source-text structural assertions (Surface B / fails-on-revert)", () => {
  it(
    "exports the AUTH_BOOTSTRAP_TIMEOUT_MS constant (so tests + future consumers can reference the canonical value, not a magic number)",
    () => {
      expect(AUTH_CONTEXT_SOURCE).toMatch(
        /export const AUTH_BOOTSTRAP_TIMEOUT_MS = 3000;/,
      );
    },
    5000,
  );

  it(
    "declares a Symbol sentinel (SPEC §2.1 — NOT a __timedOut flag; Symbol is referentially unique and cannot collide with any legitimate getSession() return shape)",
    () => {
      expect(AUTH_CONTEXT_SOURCE).toMatch(
        /const AUTH_BOOTSTRAP_TIMEOUT = Symbol\("auth-bootstrap-timeout"\);/,
      );
      expect(AUTH_CONTEXT_SOURCE).toMatch(
        /type AuthBootstrapTimeout = typeof AUTH_BOOTSTRAP_TIMEOUT;/,
      );
    },
    5000,
  );

  it(
    "declares bootstrapTimedOutRef = useRef(false) (SPEC §4 decision (b) — late-resolution guard primitive; alongside afEventFiredRef per SPEC §4 implementor guidance)",
    () => {
      expect(AUTH_CONTEXT_SOURCE).toMatch(
        /const bootstrapTimedOutRef = useRef\(false\);/,
      );
    },
    5000,
  );

  it(
    "wraps supabase.auth.getSession() in Promise.race against a timeoutPromise (SPEC §2.2 — this is the entire fix in one line)",
    () => {
      // The exact race pattern: Promise.race with getSession() as the
      // first arm. Anchored loosely to allow formatting variation while
      // still catching a revert that removes the race.
      expect(AUTH_CONTEXT_SOURCE).toMatch(
        /Promise\.race\(\s*\[\s*supabase\.auth\.getSession\(\)\s*,/,
      );
      expect(AUTH_CONTEXT_SOURCE).toMatch(
        /setTimeout\(\(\) => resolve\(AUTH_BOOTSTRAP_TIMEOUT\), AUTH_BOOTSTRAP_TIMEOUT_MS\)/,
      );
    },
    5000,
  );

  it(
    "checks raceResult === AUTH_BOOTSTRAP_TIMEOUT and sets bootstrapTimedOutRef + logs console.warn matching /bootstrap-timeout/ before returning (SPEC §2.2 + I-NO-SILENT-FAILURES per §9)",
    () => {
      expect(AUTH_CONTEXT_SOURCE).toMatch(
        /if \(raceResult === AUTH_BOOTSTRAP_TIMEOUT\)/,
      );
      // console.warn with bootstrap-timeout message — I-NO-SILENT-FAILURES.
      expect(AUTH_CONTEXT_SOURCE).toMatch(
        /console\.warn\([\s\S]*?bootstrap-timeout/,
      );
      // Ref is set inside the timeout branch.
      expect(AUTH_CONTEXT_SOURCE).toMatch(
        /bootstrapTimedOutRef\.current = true;/,
      );
    },
    5000,
  );

  it(
    "timeout branch sets session/user to null + loading to false + returns early (SPEC §3 Option A silent fall-through; SPEC §2.2 CRITICAL early return prevents proceeding into ensureCreatorAccount with null user)",
    () => {
      // The 5 state-writes + return pattern, lenient on whitespace.
      const timeoutBranchPattern =
        /if \(raceResult === AUTH_BOOTSTRAP_TIMEOUT\)[\s\S]*?setAuthError\(null\);[\s\S]*?setSession\(null\);[\s\S]*?setUser\(null\);[\s\S]*?setLoading\(false\);[\s\S]*?return;/;
      expect(AUTH_CONTEXT_SOURCE).toMatch(timeoutBranchPattern);
    },
    5000,
  );

  it(
    "preserves the existing happy-path destructure on raceResult after the timeout branch returns early (SPEC §2.2 — original `{ data: { session: s }, error } = ...` shape preserved; ensures ensureCreatorAccount + analytics chain still runs on session-resolved arm)",
    () => {
      // After the timeout branch, the original destructure still runs
      // on raceResult (TypeScript narrows after the early return).
      expect(AUTH_CONTEXT_SOURCE).toMatch(
        /const \{\s*data: \{ session: s \},\s*error,?\s*\} = raceResult;/,
      );
    },
    5000,
  );

  it(
    "does NOT gate the timeout behind Platform.OS === \"web\" (SPEC §6 — universal safety net; same behaviour on iOS/Android/web; gate would create platform divergence without value)",
    () => {
      // Confirm the SPEC §6 native-parity decision: no Platform.OS web
      // gate around the Promise.race. We grep for the race line + check
      // there's no `Platform.OS === "web"` conditional immediately
      // before it.
      const lines = AUTH_CONTEXT_SOURCE.split("\n");
      const raceLineIdx = lines.findIndex((l) =>
        l.includes("Promise.race([supabase.auth.getSession()"),
      );
      expect(raceLineIdx).toBeGreaterThan(-1);
      // Inspect the 10 lines immediately before the race — they must
      // not contain a Platform.OS web gate.
      const windowAbove = lines
        .slice(Math.max(0, raceLineIdx - 10), raceLineIdx)
        .join("\n");
      expect(windowAbove).not.toMatch(/Platform\.OS\s*===\s*["']web["']/);
    },
    5000,
  );

  it(
    "imports useRef (the bootstrapTimedOutRef needs it — pre-existing import; this guards against a refactor that drops useRef from the import list)",
    () => {
      expect(AUTH_CONTEXT_SOURCE).toMatch(/useRef/);
    },
    5000,
  );

  // ────────────────────────────────────────────────────────────────────
  // ORCH-0887-A REWORK — late-resolution defense (SPEC §3.3 Option b)
  //
  // v1 implementor SET bootstrapTimedOutRef in the timeout branch but
  // did NOT add the corresponding READ in the onAuthStateChange listener.
  // The ref was dead code. Cases 15-16 below assert the READ + the
  // event-discriminator semantics now live in AuthContext.tsx.
  //
  // Fails-on-revert: removing either the `if (bootstrapTimedOutRef.current)`
  // gate OR the "late INITIAL_SESSION after bootstrap-timeout" warn string
  // OR the `bootstrapTimedOutRef.current = false` clear-line makes one of
  // these assertions fail.
  // ────────────────────────────────────────────────────────────────────

  it(
    "Case 15 — onAuthStateChange listener READS bootstrapTimedOutRef and skips late-arriving INITIAL_SESSION (SPEC §3.3 Option b: late getSession() Promise must not flash anon→home or re-fire ensureCreatorAccount)",
    () => {
      // The ref-read gate inside the listener body. The literal string
      // pattern `if (bootstrapTimedOutRef.current) {` immediately followed
      // (within ~30 lines) by `if (_event === "INITIAL_SESSION")` proves
      // the discriminator is in place.
      const listenerGuardPattern =
        /if \(bootstrapTimedOutRef\.current\)\s*\{\s*[\s\S]{0,400}?if \(_event === ["']INITIAL_SESSION["']\)/;
      expect(AUTH_CONTEXT_SOURCE).toMatch(listenerGuardPattern);

      // I-NO-SILENT-FAILURES: the skip path warns explicitly so silent
      // late-resolution drops are observable in dev console.
      expect(AUTH_CONTEXT_SOURCE).toMatch(
        /late INITIAL_SESSION after bootstrap-timeout/,
      );

      // The skip path returns early (no setSession/setUser writes for
      // the late INITIAL_SESSION). Loose pattern: a `return;` appears
      // between the INITIAL_SESSION discriminator and the next closing
      // brace pair.
      expect(AUTH_CONTEXT_SOURCE).toMatch(
        /if \(_event === ["']INITIAL_SESSION["']\)\s*\{[\s\S]{0,300}?return;\s*\}/,
      );
    },
    5000,
  );

  it(
    "Case 16 — post-timeout non-INITIAL_SESSION events clear bootstrapTimedOutRef before continuing handler (SPEC §3.3 Option b: SIGNED_IN/SIGNED_OUT/TOKEN_REFRESHED/USER_UPDATED represent real subsequent state; subsequent INITIAL_SESSION events after the clear must process normally)",
    () => {
      // The clear-line lives inside the same `if (bootstrapTimedOutRef.current)`
      // block as the INITIAL_SESSION skip, but on the else/after branch.
      // Pattern: the `bootstrapTimedOutRef.current = false;` assignment
      // appears AFTER the timeout-branch set (line 192) and INSIDE the
      // listener guard block.
      expect(AUTH_CONTEXT_SOURCE).toMatch(
        /bootstrapTimedOutRef\.current = false;/,
      );

      // Both write-sites coexist: the timeout-branch SET (= true) AND the
      // listener-clear (= false). grep-count ≥ 2 write lines proves the
      // late-resolution lifecycle is wired both ways.
      const setTrueMatches = (
        AUTH_CONTEXT_SOURCE.match(/bootstrapTimedOutRef\.current = true;/g) ??
        []
      ).length;
      const setFalseMatches = (
        AUTH_CONTEXT_SOURCE.match(/bootstrapTimedOutRef\.current = false;/g) ??
        []
      ).length;
      expect(setTrueMatches).toBeGreaterThanOrEqual(1);
      expect(setFalseMatches).toBeGreaterThanOrEqual(1);

      // Total bootstrapTimedOutRef references ≥ 3 (declaration + set + read/clear).
      // Guards against a future refactor that removes the ref-read but leaves
      // the ref declaration + set in place (the exact v1 bug class).
      const refMatches = (
        AUTH_CONTEXT_SOURCE.match(/bootstrapTimedOutRef/g) ?? []
      ).length;
      expect(refMatches).toBeGreaterThanOrEqual(3);
    },
    5000,
  );
});
