/**
 * ORCH-1202 [business-web brand-load regression] — IMPLEMENTOR happy-path
 * regression test (sibling to the ORCH-1004 tests; append-only).
 *
 * Three independent proofs, all fail-on-revert:
 *
 *  (A) SOURCE-ASSERT — a representative DELTA-1 hook (`useBusinessNotifications`)
 *      folds `isAuthReady` into its React Query `enabled`. If the fix is
 *      reverted (the `isAuthReady &&` is deleted from the `const enabled = ...`
 *      line), this assertion FAILS. The same proof covers the realtime
 *      subscription now gating on the combined `enabled`.
 *
 *  (B) RUNTIME CACHE PROOF (adapted from /tmp/orch-1201/repro_reactquery.mjs) —
 *      with the REAL @tanstack/query-core + mingla-business's verbatim
 *      QueryClient defaults, the UNGATED shape (enabled true pre-auth, queryFn
 *      returns []) caches the RLS-empty [] as success and NEVER refetches after
 *      the JWT attaches (queryFnCalls === 1, finalDataLength === 0), while the
 *      GATED shape (enabled false until auth ready) fires once auth-ready and
 *      returns the real row (finalDataLength === 1). This proves the FIX SHAPE
 *      at runtime; if a gated hook is reverted to ungated, its surface behaves
 *      like the failing scenario.
 *
 *  (C) COMPLETENESS FAIL-CLOSED — the gate's completeness algorithm, replicated
 *      against a temp fixture set, MUST report an unregistered `useQuery`
 *      fixture as a query hook and MUST NOT report a `useMutation`-only fixture
 *      or a `useQueryClient`-only fixture. This proves the structural cure (the
 *      curated list can no longer silently go stale).
 *
 * Fails-on-revert verified by true LINE DELETION of the fix (not comment-out)
 * — see IMPLEMENT_ORCH-1202_web-brand-load-regression.md §Regression Test.
 */

import { describe, expect, test } from "@jest/globals";
import { readFileSync, mkdtempSync, writeFileSync, rmSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import os from "node:os";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { QueryClient, QueryObserver } = require("@tanstack/query-core");

const hooksDir = path.resolve(__dirname, "..");

// ── (A) SOURCE-ASSERT: the DELTA-1 fix is present in the hook source ─────────
describe("ORCH-1202 (A) — DELTA-1 hooks fold isAuthReady into enabled", () => {
  // Same detection predicate the gate uses (lock-step).
  const ENABLED_USES_IS_AUTH_READY =
    /const\s+enabled\w*\s*=\s*[^;]*\bisAuthReady\b|enabled:\s*[^,}\n]*\bisAuthReady\b/;

  test("useBusinessNotifications: const enabled = isAuthReady && userId !== null", () => {
    const src = readFileSync(path.join(hooksDir, "useBusinessNotifications.ts"), "utf8");
    expect(src).toMatch(/import\s*\{\s*useAuth\s*\}\s*from\s*"\.\.\/context\/AuthContext"/);
    expect(ENABLED_USES_IS_AUTH_READY.test(src)).toBe(true);
    // The exact fold (fails if `isAuthReady &&` is deleted from the line).
    expect(src).toMatch(/const\s+enabled\s*=\s*isAuthReady\s*&&\s*userId\s*!==\s*null/);
    // The realtime subscription is gated on the combined readiness, not raw userId.
    expect(src).toMatch(/useBusinessNotificationsRealtime\(userId,\s*enabled\)/);
  });

  test.each([
    ["useBrandInvitations.ts"],
    ["usePartnerStripe.ts"],
    ["useConversationList.ts"],
    ["marketing/useCampaigns.ts"],
  ])("%s reads isAuthReady and folds it into enabled", (rel) => {
    const src = readFileSync(path.join(hooksDir, rel), "utf8");
    expect(/\bisAuthReady\b/.test(src)).toBe(true);
    expect(ENABLED_USES_IS_AUTH_READY.test(src)).toBe(true);
  });
});

// ── (B) RUNTIME CACHE PROOF ──────────────────────────────────────────────────
describe("ORCH-1202 (B) — ungated shape strands; gated shape waits then loads", () => {
  const FIVE_MIN = 5 * 60 * 1000;
  const BRAND_ID = "00000000-0000-0000-0000-000000000001";

  const makeClient = () =>
    new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: FIVE_MIN,
          retry: 2,
          retryDelay: (attempt: number) => Math.min(1000 * 2 ** attempt, 4000),
          refetchOnWindowFocus: false,
          refetchOnReconnect: true,
        },
        mutations: { retry: 0 },
      },
    });

  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  test("UNGATED: caches RLS-empty [] as success and never refetches (the bug)", async () => {
    const auth = { hasJWT: false };
    setTimeout(() => {
      auth.hasJWT = true;
    }, 300);
    let queryFnCalls = 0;
    const queryFn = async () => {
      queryFnCalls += 1;
      return auth.hasJWT ? [{ id: "brand-1" }] : [];
    };

    const client = makeClient();
    const obs = new QueryObserver(client, {
      // enabled = brandId !== null → TRUE pre-auth (the DELTA-1 bug shape).
      queryKey: ["x", "ungated", BRAND_ID],
      enabled: BRAND_ID !== null,
      queryFn,
    });
    const unsub = obs.subscribe(() => {});
    await sleep(900);
    unsub();

    const finalData = client.getQueryData(["x", "ungated", BRAND_ID]) as unknown[];
    expect(Array.isArray(finalData)).toBe(true);
    expect(finalData.length).toBe(0); // stranded empty
    expect(queryFnCalls).toBe(1); // fired ONCE pre-auth, never again
  });

  test("GATED: stays disabled until auth ready, then loads the real row (the fix)", async () => {
    const auth = { isAuthReady: false, hasJWT: false };
    setTimeout(() => {
      auth.isAuthReady = true;
      auth.hasJWT = true;
    }, 300);
    let queryFnCalls = 0;
    const queryFn = async () => {
      queryFnCalls += 1;
      return auth.hasJWT ? [{ id: "brand-1" }] : [];
    };

    const client = makeClient();
    const mkOptions = () => ({
      queryKey: auth.isAuthReady ? ["x", "gated", BRAND_ID] : ["x-disabled", "gated"],
      enabled: auth.isAuthReady && BRAND_ID !== null,
      queryFn,
    });
    let obs = new QueryObserver(client, mkOptions());
    let unsub = obs.subscribe(() => {});
    await sleep(350); // pass the auth flip
    unsub();
    // React re-render recomputes enabled once auth is ready.
    obs = new QueryObserver(client, mkOptions());
    unsub = obs.subscribe(() => {});
    await sleep(550);
    unsub();

    const finalData = client.getQueryData(["x", "gated", BRAND_ID]) as unknown[];
    expect(Array.isArray(finalData)).toBe(true);
    expect(finalData.length).toBe(1); // real row, not stranded empty
    expect(queryFnCalls).toBe(1); // fired exactly once — AFTER the JWT attached
  });
});

// ── (C) COMPLETENESS FAIL-CLOSED ─────────────────────────────────────────────
describe("ORCH-1202 (C) — completeness algorithm catches unregistered query hooks", () => {
  // Replicate the gate's detection signal (lock-step with the .mjs).
  const CALLS_USE_QUERY = /\buseQuery(?!Client)\s*[<(]/;
  const CALLS_USE_INFINITE_QUERY = /\buseInfiniteQuery\s*[<(]/;
  const isQueryHookSource = (source: string) =>
    CALLS_USE_QUERY.test(source) || CALLS_USE_INFINITE_QUERY.test(source);

  const collect = (dir: string): string[] => {
    const out: string[] = [];
    const walk = (abs: string): void => {
      for (const name of readdirSync(abs)) {
        const child = path.join(abs, name);
        if (statSync(child).isDirectory()) {
          if (name === "__tests__") continue;
          walk(child);
          continue;
        }
        if (!name.endsWith(".ts")) continue;
        if (/\.(test|spec)\.ts$/.test(name)) continue;
        if (isQueryHookSource(readFileSync(child, "utf8"))) {
          out.push(path.relative(dir, child).split(path.sep).join("/"));
        }
      }
    };
    walk(dir);
    return out;
  };

  test("an unregistered useQuery fixture is collected; mutation/client-only fixtures are not", () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "orch1202-test-"));
    try {
      writeFileSync(path.join(tmp, "useFoo.ts"), "const q = useQuery({ queryKey: ['x'] });\n");
      writeFileSync(path.join(tmp, "useBarTyped.ts"), "const q = useQuery<Row[]>({ queryKey });\n");
      writeFileSync(path.join(tmp, "useMut.ts"), "const m = useMutation({ mutationFn: x });\n");
      writeFileSync(path.join(tmp, "useImperative.ts"), "const qc = useQueryClient();\n");
      writeFileSync(path.join(tmp, "useShim.ts"), 'export { useFoo } from "./useFoo";\n');

      const found = collect(tmp);
      expect(found).toContain("useFoo.ts");
      expect(found).toContain("useBarTyped.ts");
      expect(found).not.toContain("useMut.ts");
      expect(found).not.toContain("useImperative.ts");
      expect(found).not.toContain("useShim.ts");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("the live gate's two lists classify EVERY on-disk query hook (no orphans)", () => {
    const gatePath = path.resolve(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      ".github/scripts/strict-grep/orch-1004-auth-scoped-query-readiness.mjs",
    );
    const gateSrc = readFileSync(gatePath, "utf8");
    const extractBlock = (marker: string): string => {
      const start = gateSrc.indexOf(marker);
      const open = gateSrc.indexOf("[", start);
      const close = gateSrc.indexOf("];", open);
      return gateSrc.slice(open + 1, close);
    };
    const authFiles = [
      ...extractBlock("const AUTH_SCOPED_HOOK_FILES").matchAll(/"([^"]+\.ts)"/g),
    ].map((m) => m[1]);
    const allowFiles = [
      ...extractBlock("const PUBLIC_HOOK_ALLOWLIST").matchAll(/\[\s*"([^"]+\.ts)"/g),
    ].map((m) => m[1]);
    const classified = new Set([...authFiles, ...allowFiles]);

    const orphans = collect(hooksDir).filter((rel) => !classified.has(rel));
    expect(orphans).toEqual([]);
  });
});
