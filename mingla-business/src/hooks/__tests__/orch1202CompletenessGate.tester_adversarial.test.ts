/**
 * ORCH-1202 [business-web brand-load regression] — TESTER ADVERSARIAL suite.
 *
 * Different angle than the implementor's happy-path test
 * (orch1202AuthScopedHookCompleteness.test.ts):
 *
 *   - The implementor asserts hook SOURCE shape + a single-consumer cache proof
 *     (queryFn returns [] then a row at t=300ms, in-process).
 *   - THIS suite attacks the GATE SCRIPT as a black-box SUBPROCESS (exactly how
 *     CI invokes it) against PLANTED FIXTURES copied into a sandbox hooks tree,
 *     and attacks the cache mechanism at a DIFFERENT BOUNDARY: a SECOND consumer
 *     of the same query key mounting AFTER the JWT attaches but while the cached
 *     [] is still inside staleTime (the multi-consumer / staleTime-fresh path the
 *     implementor's single-consumer test does not exercise).
 *
 * Every gate assertion runs the real .mjs via `node`, pointed at a sandbox copy
 * of mingla-business so we exercise the real completeness walk + per-hook checks,
 * not a re-implementation. Fixtures are created and torn down per-test; the
 * working tree is never mutated.
 *
 * NOTE (append-only): this is a NEW file (status A) — no existing test touched.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { QueryClient, QueryObserver } from "@tanstack/query-core";

// ── Repo roots ───────────────────────────────────────────────────────────────
// __dirname = mingla-business/src/hooks/__tests__
const REPO_ROOT = path.resolve(__dirname, "../../../..");
const GATE_SRC = path.join(
  REPO_ROOT,
  ".github/scripts/strict-grep/orch-1004-auth-scoped-query-readiness.mjs",
);
const REAL_HOOKS_DIR = path.resolve(__dirname, "..");

/**
 * Build a sandbox that mirrors the gate's expectations:
 *   <sandbox>/mingla-business/src/hooks/**            (copied from the real tree)
 *   <sandbox>/mingla-business/package.json            (so checkNpmWiring passes)
 *   <sandbox>/.github/scripts/strict-grep/<gate>.mjs  (the real gate, verbatim)
 * The gate resolves `root` from cwd; we run it with cwd = <sandbox>.
 */
function makeSandbox(): { dir: string; hooksDir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orch1202-adv-"));
  const mbDir = path.join(dir, "mingla-business");
  const hooksDir = path.join(mbDir, "src/hooks");
  fs.mkdirSync(hooksDir, { recursive: true });
  fs.cpSync(REAL_HOOKS_DIR, hooksDir, { recursive: true });
  // package.json with the wiring the gate's checkNpmWiring asserts.
  fs.writeFileSync(
    path.join(mbDir, "package.json"),
    JSON.stringify(
      {
        name: "mingla-business",
        scripts: {
          "test:orch-1004":
            "node ../.github/scripts/strict-grep/orch-1004-auth-scoped-query-readiness.mjs",
        },
      },
      null,
      2,
    ),
    "utf8",
  );
  const gateDest = path.join(dir, ".github/scripts/strict-grep");
  fs.mkdirSync(gateDest, { recursive: true });
  fs.copyFileSync(
    GATE_SRC,
    path.join(gateDest, "orch-1004-auth-scoped-query-readiness.mjs"),
  );
  return { dir, hooksDir };
}

/** Run the gate as CI does (subprocess). Returns {code, out}. */
function runGate(sandboxDir: string): { code: number; out: string } {
  try {
    const out = execFileSync(
      "node",
      [".github/scripts/strict-grep/orch-1004-auth-scoped-query-readiness.mjs"],
      { cwd: sandboxDir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return { code: 0, out };
  } catch (err: any) {
    return {
      code: err.status ?? 1,
      out: `${err.stdout ?? ""}${err.stderr ?? ""}`,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
describe("ORCH-1202 ADVERSARIAL — fail-closed completeness gate (subprocess)", () => {
  // Sanity: the unmodified sandbox passes (proves the sandbox is faithful).
  test("baseline: unmodified sandbox passes the gate (exit 0)", () => {
    const { dir } = makeSandbox();
    try {
      const { code, out } = runGate(dir);
      expect(code).toBe(0);
      expect(out).toMatch(/ORCH-1004 gate PASS/);
      expect(out).toMatch(/completeness: every src\/hooks query hook is classified/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // (1) Planted auth-scoped useQuery hook with NO list entry → MUST fail with
  //     the exact §4.C completeness message naming the file.
  test("(1) planted unregistered auth-scoped useQuery hook FAILS completeness", () => {
    const { dir, hooksDir } = makeSandbox();
    try {
      fs.writeFileSync(
        path.join(hooksDir, "useTesterPlantedSecret.ts"),
        [
          'import { useQuery } from "@tanstack/react-query";',
          'import { useAuth } from "../context/AuthContext";',
          "export function useTesterPlantedSecret(brandId: string | null) {",
          "  const { isAuthReady } = useAuth();",
          "  const enabled = isAuthReady && brandId !== null;",
          "  return useQuery({ queryKey: enabled ? [brandId] : ['off'], enabled });",
          "}",
        ].join("\n"),
        "utf8",
      );
      const { code, out } = runGate(dir);
      expect(code).toBe(1);
      expect(out).toMatch(
        /ORCH-1202 completeness: unregistered query hook "useTesterPlantedSecret\.ts"/,
      );
      expect(out).toMatch(/in neither AUTH_SCOPED_HOOK_FILES nor PUBLIC_HOOK_ALLOWLIST/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // (1b) Even a CORRECTLY-GATED but unregistered hook must fail — registration,
  //      not gating, is what coverage requires. (Catches a gate that only checks
  //      "is it gated" and forgets the membership requirement.)
  test("(1b) a gated-but-unregistered hook STILL fails (registration is mandatory)", () => {
    const { dir, hooksDir } = makeSandbox();
    try {
      // Subdir to also prove the POSIX relpath is reported, not the basename.
      fs.mkdirSync(path.join(hooksDir, "marketing"), { recursive: true });
      fs.writeFileSync(
        path.join(hooksDir, "marketing/useTesterNestedUnregistered.ts"),
        'const q = useQuery({ queryKey: ["x"], enabled: isAuthReady && true });',
        "utf8",
      );
      const { code, out } = runGate(dir);
      expect(code).toBe(1);
      expect(out).toMatch(
        /unregistered query hook "marketing\/useTesterNestedUnregistered\.ts"/,
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // (2) Drop isAuthReady from a registered hook → per-hook check MUST fail.
  test("(2) registered hook losing its isAuthReady gate FAILS the per-hook check", () => {
    const { dir, hooksDir } = makeSandbox();
    try {
      const target = path.join(hooksDir, "useBusinessNotifications.ts");
      const src = fs.readFileSync(target, "utf8");
      // True removal of the fold (not a comment-out): strip "isAuthReady && ".
      const reverted = src.replace(/isAuthReady\s*&&\s*/g, "");
      expect(reverted).not.toBe(src); // ensure we actually changed something
      fs.writeFileSync(target, reverted, "utf8");
      const { code, out } = runGate(dir);
      expect(code).toBe(1);
      expect(out).toMatch(
        /useBusinessNotifications\.ts:.*(does not read isAuthReady|not wired into an "enabled")/,
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // (3) A useQueryClient-only file must NOT be flagged (no false positive).
  test("(3) useQueryClient-only file is NOT classified as a query hook", () => {
    const { dir, hooksDir } = makeSandbox();
    try {
      fs.writeFileSync(
        path.join(hooksDir, "useTesterImperativeOnly.ts"),
        [
          'import { useQueryClient } from "@tanstack/react-query";',
          "export function useTesterImperativeOnly() {",
          "  const qc = useQueryClient();",
          "  return () => qc.invalidateQueries({ queryKey: ['x'] });",
          "}",
        ].join("\n"),
        "utf8",
      );
      const { code, out } = runGate(dir);
      // It is NOT a query hook, so completeness ignores it → gate stays green.
      expect(code).toBe(0);
      expect(out).not.toMatch(/useTesterImperativeOnly/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // (3b) A mutation-only file must NOT be flagged either.
  test("(3b) useMutation-only file is NOT classified as a query hook", () => {
    const { dir, hooksDir } = makeSandbox();
    try {
      fs.writeFileSync(
        path.join(hooksDir, "useTesterMutationOnly.ts"),
        [
          'import { useMutation } from "@tanstack/react-query";',
          "export const useTesterMutationOnly = () =>",
          "  useMutation({ mutationFn: async () => undefined });",
        ].join("\n"),
        "utf8",
      );
      const { code } = runGate(dir);
      expect(code).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // (4) Gating a PUBLIC_HOOK_ALLOWLIST hook must fail checkPublicNotGated.
  test("(4) folding isAuthReady into a PUBLIC allowlist hook FAILS checkPublicNotGated", () => {
    const { dir, hooksDir } = makeSandbox();
    try {
      const target = path.join(hooksDir, "usePublicEvents.ts");
      expect(fs.existsSync(target)).toBe(true);
      const src = fs.readFileSync(target, "utf8");
      // Inject an isAuthReady-folded enabled to simulate someone gating it.
      const poisoned =
        'import { useAuth } from "../context/AuthContext";\n' +
        "const __tester = (isAuthReady: boolean) => {\n" +
        "  const enabled = isAuthReady && true;\n" +
        "  return enabled;\n" +
        "};\n" +
        src;
      fs.writeFileSync(target, poisoned, "utf8");
      const { code, out } = runGate(dir);
      expect(code).toBe(1);
      expect(out).toMatch(
        /usePublicEvents\.ts: PUBLIC\/DUAL-USE hook must NOT gate enabled on isAuthReady/,
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // (5) The carve-out files (one gated + one intentionally-ungated hook) PASS
  //     unmodified. Asserted positively: the baseline passes AND these two files
  //     are present and registered (so file-level granularity is exercised).
  test("(5) carve-out files (useCancelTripBooking, useBrandPaystack) pass unmodified", () => {
    const { dir, hooksDir } = makeSandbox();
    try {
      expect(fs.existsSync(path.join(hooksDir, "useCancelTripBooking.ts"))).toBe(true);
      expect(fs.existsSync(path.join(hooksDir, "useBrandPaystack.ts"))).toBe(true);
      // The carve-out hooks must remain ungated in source.
      const cancel = fs.readFileSync(
        path.join(hooksDir, "useCancelTripBooking.ts"),
        "utf8",
      );
      const paystack = fs.readFileSync(
        path.join(hooksDir, "useBrandPaystack.ts"),
        "utf8",
      );
      // useBuyerRefundPreview / useBrandBanks carve-outs: still anon (no token
      // route gated on isAuthReady). Spot-check the buyer-token predicate remains.
      expect(cancel).toMatch(/useBuyerRefundPreview/);
      expect(paystack).toMatch(/useBrandBanks/);
      const { code } = runGate(dir);
      expect(code).toBe(0); // both files pass via their auth-scoped co-resident
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // (extra) Removing a hook from BOTH lists while it stays on disk must fail —
  //     proves the membership test is what enforces coverage, not mere presence.
  test("(extra) deleting a hook's list entry while it remains on disk FAILS", () => {
    const { dir } = makeSandbox();
    try {
      const gatePath = path.join(
        dir,
        ".github/scripts/strict-grep/orch-1004-auth-scoped-query-readiness.mjs",
      );
      const gateSrc = fs.readFileSync(gatePath, "utf8");
      // De-register useConversationList.ts (a real on-disk DELTA-1 file).
      const stripped = gateSrc.replace(/^\s*"useConversationList\.ts",\s*$/m, "");
      expect(stripped).not.toBe(gateSrc);
      fs.writeFileSync(gatePath, stripped, "utf8");
      const { code, out } = runGate(dir);
      expect(code).toBe(1);
      expect(out).toMatch(/unregistered query hook "useConversationList\.ts"/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (6) Cache-mechanism regression at a DIFFERENT BOUNDARY than the implementor.
//
//     Implementor angle: single observer, queryFn returns [] then a row @300ms.
//     THIS angle: TWO consumers of the SAME query key. The FIRST mounts pre-auth
//     and caches RLS-empty []. The SECOND mounts AFTER the JWT has attached but
//     while the cached [] is still INSIDE staleTime — the production defaults
//     (staleTime 5min, refetchOnWindowFocus:false, retry error-only). We prove:
//       - UNGATED: the second consumer is served the stale-fresh [] and the
//         queryFn is NEVER called again → the bug persists for late mounters.
//       - GATED: the first (pre-auth) observer is DISABLED, so nothing caches []
//         pre-auth; once auth is ready both observers load the real row.
// ─────────────────────────────────────────────────────────────────────────────
describe("ORCH-1202 ADVERSARIAL — cache mechanism, multi-consumer / staleTime-fresh", () => {
  const FIVE_MIN = 5 * 60 * 1000;

  // Mirror src/config/queryClient.ts production defaults.
  const makeClient = () =>
    new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: FIVE_MIN,
          retry: 2,
          retryDelay: (a: number) => Math.min(1000 * 2 ** a, 4000),
          refetchOnWindowFocus: false,
          refetchOnReconnect: true,
        },
      },
    });

  const KEY: readonly unknown[] = ["business-notifications", "u1"];

  /** Simulated server: returns [] while jwtAttached=false, the row once true. */
  function makeServer() {
    const state = { jwtAttached: false, calls: 0 };
    const queryFn = async () => {
      state.calls += 1;
      // RLS returns 200 + [] when no JWT (a SUCCESS, not a 401).
      return state.jwtAttached ? [{ id: "n1", unread: true }] : [];
    };
    return { state, queryFn };
  }

  const settle = () => new Promise((r) => setTimeout(r, 0));

  test("UNGATED: first (pre-auth) consumer caches []; a later post-auth consumer is served the stale-fresh [] and queryFn never re-runs", async () => {
    const client = makeClient();
    const { state, queryFn } = makeServer();

    // Consumer A mounts PRE-AUTH (enabled true regardless of auth — the bug).
    const obsA = new QueryObserver(client, {
      queryKey: KEY,
      queryFn,
      enabled: true,
    });
    const unsubA = obsA.subscribe(() => {});
    await settle();
    await settle();

    // The empty result is cached as success.
    expect(client.getQueryData(KEY)).toEqual([]);
    expect(state.calls).toBe(1);

    // JWT attaches AFTER the cache is populated.
    state.jwtAttached = true;

    // Consumer B mounts LATER (post-auth) for the SAME key, within staleTime.
    const obsB = new QueryObserver(client, {
      queryKey: KEY,
      queryFn,
      enabled: true,
    });
    const unsubB = obsB.subscribe(() => {});
    await settle();
    await settle();

    // The bug: B is served the stale-fresh [] and the queryFn is NOT re-invoked.
    expect(obsB.getCurrentResult().data).toEqual([]);
    expect(state.calls).toBe(1); // never refetched despite the JWT being present
    expect(client.getQueryData(KEY)).toEqual([]); // still empty

    unsubA();
    unsubB();
  });

  test("GATED: pre-auth consumer is DISABLED (nothing caches []); once auth ready both consumers load the real row", async () => {
    const client = makeClient();
    const { state, queryFn } = makeServer();

    // Consumer A mounts PRE-AUTH but GATED: enabled=false → never fetches.
    const DISABLED_KEY: readonly unknown[] = ["business-notifications-disabled"];
    const obsA = new QueryObserver<
      { id: string; unread: boolean }[],
      Error,
      { id: string; unread: boolean }[],
      { id: string; unread: boolean }[],
      readonly unknown[]
    >(client, {
      queryKey: DISABLED_KEY, // DISABLED_KEY sentinel
      queryFn,
      enabled: false,
    });
    const unsubA = obsA.subscribe(() => {});
    await settle();
    await settle();

    // Nothing cached under the real key, queryFn never called pre-auth.
    expect(client.getQueryData(KEY)).toBeUndefined();
    expect(state.calls).toBe(0);

    // Auth becomes ready: JWT attaches, the observer flips to the real key+enabled.
    state.jwtAttached = true;
    obsA.setOptions({ queryKey: KEY, queryFn, enabled: true });
    await settle();
    await settle();

    expect(state.calls).toBe(1);
    expect(obsA.getCurrentResult().data).toEqual([{ id: "n1", unread: true }]);

    // A second consumer mounting now is correctly served the cached ROW.
    const obsB = new QueryObserver(client, { queryKey: KEY, queryFn, enabled: true });
    const unsubB = obsB.subscribe(() => {});
    await settle();
    expect(obsB.getCurrentResult().data).toEqual([{ id: "n1", unread: true }]);

    unsubA();
    unsubB();
  });
});
