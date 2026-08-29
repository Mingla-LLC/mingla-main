// META-ORCH-1270 (Phase 2) — implementor test: destroy-on-terminal (reaper).
//
// Proves the reaper DESTROYS a terminal Bunny asset and STAMPS reaped_at (and,
// terminal assets only. Durable ready/unapplied work routes to reconciliation. On a destroy
// FAILURE it must NOT stamp reaped_at (fail-safe retry next run).
//
// FAILS ON REVERT: remove the destroy+reaped_at loop in handleReaper → the
// destroy spy is never called / no reaped_at patch is captured → assertions
// throw.
//
// Run: deno test --allow-env --no-check
//   supabase/functions/event-cover-video-reaper/__tests__/meta_orch_1270_destroy_on_terminal.test.ts

import { handleReaper, type ReapCandidate } from "../index.ts";

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message);
};

const SERVICE_KEY = "test-service-role-key";
const NOW = Date.now();
const HOURS = (n: number) => new Date(NOW - n * 60 * 60 * 1000).toISOString();

type Patch = { id: unknown; patch: Record<string, unknown> };

const makeSupabaseStub = (
  candidates: ReapCandidate[],
  patches: Patch[],
  rpcCalls: string[] = [],
) => {
  const selectChain = {
    // deno-lint-ignore no-explicit-any
    select() {
      return this as any;
    },
    // deno-lint-ignore no-explicit-any
    is() {
      return this as any;
    },
    // deno-lint-ignore no-explicit-any
    not() {
      return this as any;
    },
    // deno-lint-ignore no-explicit-any
    limit() {
      return this as any;
    },
    then(resolve: (v: { data: ReapCandidate[]; error: null }) => unknown) {
      return Promise.resolve({ data: candidates, error: null }).then(resolve);
    },
  };
  return {
    // [TEST-MOD-APPROVED #2715 A10] Exercise the production lease-claim owner;
    // ready work is returned for reconciliation but never for destruction.
    rpc: (name: string) => {
      rpcCalls.push(name);
      if (name !== "cover_video_claim_reconcile_jobs") {
        throw new Error(`unexpected rpc ${name}`);
      }
      return Promise.resolve({
        data: candidates.filter((candidate) =>
          ["source_uploaded", "processing_queued", "processing", "ready"]
            .includes(candidate.status ?? "")
        ),
        error: null,
      });
    },
    from: () => ({
      select: () => selectChain,
      update: (patch: Record<string, unknown>) => ({
        eq: (_col: string, val: unknown) => {
          patches.push({ id: val, patch });
          return Promise.resolve({ error: null });
        },
      }),
    }),
  };
};

const withServiceKey = async (fn: () => Promise<void>): Promise<void> => {
  const prior = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY);
  try {
    await fn();
  } finally {
    if (prior === undefined) Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
    else Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", prior);
  }
};

const authedRequest = (): Request =>
  new Request("https://example.test/functions/v1/event-cover-video-reaper", {
    method: "POST",
    headers: { Authorization: `Bearer ${SERVICE_KEY}` },
  });

Deno.test("reaper: destroys a cancelled Bunny asset + stamps reaped_at", async () => {
  await withServiceKey(async () => {
    const patches: Patch[] = [];
    const destroyed: unknown[] = [];
    const candidates: ReapCandidate[] = [
      {
        id: "job-a",
        status: "cancelled",
        source_asset_id: "guid-a",
        reaped_at: null,
        provider: "bunny",
        created_at: HOURS(1),
      },
    ];
    const deps = {
      destroyCoverVideoAsset: (job: unknown) => {
        destroyed.push(job);
        return Promise.resolve({ ok: true as const });
      },
      serviceRoleClient: () => makeSupabaseStub(candidates, patches) as never,
    };
    const response = await handleReaper(authedRequest(), deps as never);
    const body = await response.json();
    assert(body.ok === true, `expected ok, got ${JSON.stringify(body)}`);
    assert(body.reaped === 1, `expected reaped=1, got ${body.reaped}`);
    assert(
      destroyed.length === 1,
      "destroyCoverVideoAsset must be called for the terminal asset",
    );
    assert(
      (destroyed[0] as { source_asset_id?: unknown }).source_asset_id ===
        "guid-a",
      "destroy targets guid-a",
    );
    const stamp = patches.find((p) => p.id === "job-a");
    assert(
      !!stamp && typeof stamp.patch.reaped_at === "string",
      "reaped_at stamped after a successful destroy",
    );
  });
});

Deno.test("reaper: old ready/unapplied work is reconciled and never destroyed or failed", async () => {
  // [TEST-MOD-APPROVED #2715] Elapsed time cannot turn ready truth into failure.
  await withServiceKey(async () => {
    const patches: Patch[] = [];
    const destroyed: unknown[] = [];
    const rpcCalls: string[] = [];
    const candidates: ReapCandidate[] = [
      {
        id: "job-old",
        status: "ready",
        source_asset_id: "guid-old",
        reaped_at: null,
        applied_at: null,
        created_at: HOURS(30),
        provider: "bunny",
      },
    ];
    const deps = {
      bunnyGetVideo: () =>
        Promise.resolve({ ok: true as const, video: { status: 4 } }),
      destroyCoverVideoAsset: (job: unknown) => {
        destroyed.push(job);
        return Promise.resolve({ ok: true as const });
      },
      serviceRoleClient: () =>
        makeSupabaseStub(candidates, patches, rpcCalls) as never,
    };
    const response = await handleReaper(authedRequest(), deps as never);
    const body = await response.json();
    assert(body.reaped === 0, `expected reaped=0, got ${body.reaped}`);
    assert(
      body.reconciled === 1,
      `expected reconciled=1, got ${body.reconciled}`,
    );
    assert(destroyed.length === 0, "ready asset must not be destroyed");
    assert(
      rpcCalls.includes("cover_video_claim_reconcile_jobs"),
      "ready reconciliation must claim a lease through the named RPC",
    );
    assert(
      !patches.some((p) => p.id === "job-old" && p.patch.status === "failed"),
      "ready job must not fail",
    );
  });
});

Deno.test("reaper: destroy FAILURE → no reaped_at (fail-safe retry)", async () => {
  await withServiceKey(async () => {
    const patches: Patch[] = [];
    const candidates: ReapCandidate[] = [
      {
        id: "job-x",
        status: "failed",
        source_asset_id: "guid-x",
        reaped_at: null,
        provider: "bunny",
        created_at: HOURS(1),
      },
    ];
    const deps = {
      destroyCoverVideoAsset: () =>
        Promise.resolve({
          ok: false as const,
          reason: "bunny_delete_http_500",
        }),
      serviceRoleClient: () => makeSupabaseStub(candidates, patches) as never,
    };
    const response = await handleReaper(authedRequest(), deps as never);
    const body = await response.json();
    assert(
      body.reaped === 0 && body.failed === 1,
      `expected reaped=0 failed=1, got ${JSON.stringify(body)}`,
    );
    assert(
      patches.length === 0,
      "a failed destroy must NOT stamp reaped_at (retry next run)",
    );
  });
});

Deno.test("reaper: rejects a non-service-role caller", async () => {
  await withServiceKey(async () => {
    const req = new Request(
      "https://example.test/functions/v1/event-cover-video-reaper",
      {
        method: "POST",
        headers: { Authorization: "Bearer not-the-service-key" },
      },
    );
    const response = await handleReaper(req, {
      destroyCoverVideoAsset: () => Promise.resolve({ ok: true as const }),
      serviceRoleClient: () => ({}) as never,
    } as never);
    assert(
      response.status === 401,
      `expected 401 for a bad bearer, got ${response.status}`,
    );
  });
});
