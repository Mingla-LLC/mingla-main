import { Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts";
import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { assert } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  buildThumbPathFromObjectPath,
  extractPlacePhotoObjectPath,
  handleProcessChunk,
  loadPendingPlaces,
  processPlaceThumbs,
} from "./index.ts";

function createDbMock() {
  const uploads: Array<{ path: string; options: Record<string, unknown> }> = [];
  const updates: Array<Record<string, unknown>> = [];

  return {
    uploads,
    updates,
    client: {
      storage: {
        from(bucket: string) {
          assertEquals(bucket, "place-photos");
          return {
            getPublicUrl(path: string) {
              return {
                data: {
                  publicUrl: `https://x.supabase.co/storage/v1/object/public/place-photos/${path}`,
                },
              };
            },
            upload(path: string, _body: unknown, options: Record<string, unknown>) {
              uploads.push({ path, options });
              return Promise.resolve({ error: null });
            },
          };
        },
      },
      from(table: string) {
        assertEquals(table, "place_pool");
        return {
          update(payload: Record<string, unknown>) {
            updates.push(payload);
            return {
              eq(column: string, value: string) {
                assertEquals(column, "id");
                assertEquals(value, "place-1");
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      },
    },
  };
}

async function makeJpegBytes(): Promise<Uint8Array> {
  const img = new Image(12, 12);
  img.fill(0xff_99_22_44);
  return await img.encodeJPEG(80);
}

function bodyFrom(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

Deno.test("backfill helpers derive thumb paths from place-photos object URLs", () => {
  const url = "https://x.supabase.co/storage/v1/object/public/place-photos/abc/2.webp?cache=1";
  assertEquals(extractPlacePhotoObjectPath(url), "abc/2.webp");
  assertEquals(buildThumbPathFromObjectPath("abc/2.webp"), "abc/2_thumb.jpg");
});

Deno.test("T-06 backfill fetches originals through object endpoint only", async () => {
  const priorFetch = globalThis.fetch;
  const fetchCalls: Array<{ url: string; method: string }> = [];
  const jpeg = await makeJpegBytes();

  globalThis.fetch = (input: URL | RequestInfo, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    fetchCalls.push({ url, method });
    if (method === "HEAD") return Promise.resolve(new Response(null, { status: 404 }));
    return Promise.resolve(new Response(bodyFrom(jpeg), {
      status: 200,
      headers: { "content-type": "image/jpeg" },
    }));
  };

  try {
    const mock = createDbMock();
    const result = await processPlaceThumbs(mock.client as any, {
      id: "place-1",
      stored_photo_urls: ["https://x.supabase.co/storage/v1/object/public/place-photos/abc/0.jpg"],
    }, { skipDelays: true });

    assertEquals(result.success, true);
    assertEquals(result.thumbsWritten, 1);
    assertEquals(mock.uploads.map((u) => u.path), ["abc/0_thumb.jpg"]);
    assertEquals(fetchCalls.every((call) => call.url.includes("/storage/v1/object/public/")), true);
    assertEquals(fetchCalls.some((call) => call.url.includes("/render/image/")), false);
  } finally {
    globalThis.fetch = priorFetch;
  }
});

Deno.test("T-07 backfill skips already-present thumbs without refetching originals", async () => {
  const priorFetch = globalThis.fetch;
  const fetchCalls: Array<{ url: string; method: string }> = [];

  globalThis.fetch = (input: URL | RequestInfo, init?: RequestInit) => {
    fetchCalls.push({ url: String(input), method: init?.method ?? "GET" });
    return Promise.resolve(new Response(null, { status: 200 }));
  };

  try {
    const mock = createDbMock();
    const result = await processPlaceThumbs(mock.client as any, {
      id: "place-1",
      stored_photo_urls: ["https://x.supabase.co/storage/v1/object/public/place-photos/abc/0.jpg"],
    }, { skipDelays: true });

    assertEquals(result.success, true);
    assertEquals(result.thumbsWritten, 0);
    assertEquals(result.thumbsAlreadyPresent, 1);
    assertEquals(mock.uploads.length, 0);
    assertEquals(fetchCalls, [{
      url: "https://x.supabase.co/storage/v1/object/public/place-photos/abc/0_thumb.jpg",
      method: "HEAD",
    }]);
  } finally {
    globalThis.fetch = priorFetch;
  }
});

// ─── ORCH-1033 ──────────────────────────────────────────────────────────────

// A terminal query-builder stub that records every .eq() applied. select/range/
// order/is/not/ilike/limit/maybeSingle/eq all return `this`; the builder is
// awaitable (then) and resolves to { data, error }.
function makeRecordingBuilder(resolveData: unknown) {
  const eqCalls: Array<{ column: string; value: unknown }> = [];
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const m of ["select", "range", "order", "is", "not", "ilike", "limit", "in", "update", "insert", "delete"]) {
    builder[m] = chain;
  }
  builder.eq = (column: string, value: unknown) => {
    eqCalls.push({ column, value });
    return builder;
  };
  builder.maybeSingle = () => Promise.resolve({ data: resolveData, error: null });
  builder.single = () => Promise.resolve({ data: resolveData, error: null });
  // Awaitable: a paged select resolves to a single short page so the loop stops.
  builder.then = (onFulfilled: (v: { data: unknown; error: null }) => unknown) =>
    Promise.resolve({ data: resolveData, error: null }).then(onFulfilled);
  return { builder, eqCalls };
}

Deno.test("T-02 loadPendingPlaces always filters is_servable=true and adds city_id when scoped", async () => {
  const recorders: Array<{ eqCalls: Array<{ column: string; value: unknown }> }> = [];
  const db = {
    from(_table: string) {
      const rec = makeRecordingBuilder([]); // 0-row page → loop exits
      recorders.push(rec);
      return rec.builder;
    },
  };

  await loadPendingPlaces(db as unknown as Record<string, never>, { cityId: "london-uuid" });

  const allEq = recorders.flatMap((r) => r.eqCalls);
  assert(allEq.some((c) => c.column === "is_servable" && c.value === true), "must filter is_servable=true");
  assert(allEq.some((c) => c.column === "city_id" && c.value === "london-uuid"), "must filter city_id when scoped");
});

Deno.test("T-02b loadPendingPlaces without city does NOT add a city_id filter", async () => {
  const recorders: Array<{ eqCalls: Array<{ column: string; value: unknown }> }> = [];
  const db = {
    from(_table: string) {
      const rec = makeRecordingBuilder([]);
      recorders.push(rec);
      return rec.builder;
    },
  };

  await loadPendingPlaces(db as unknown as Record<string, never>, {});

  const allEq = recorders.flatMap((r) => r.eqCalls);
  assert(allEq.some((c) => c.column === "is_servable" && c.value === true), "must always filter is_servable=true");
  assertEquals(allEq.some((c) => c.column === "city_id"), false);
});

// A mock db for handleProcessChunk: a runs table + a batches table with a
// configurable number of pending batches. Tracks the run's terminal status.
function makeChunkDb(opts: { pendingBatches: number }) {
  const run = {
    id: "run-1", status: "ready", started_at: null as string | null,
    completed_batches: 0, failed_batches: 0, skipped_batches: 0,
    total_succeeded: 0, total_failed: 0, total_skipped: 0, total_batches: opts.pendingBatches,
    last_heartbeat_at: null as string | null, completed_at: null as string | null,
  };
  let pending = opts.pendingBatches;

  const db = {
    storage: {
      from() {
        return {
          getPublicUrl(path: string) {
            return { data: { publicUrl: `https://x.supabase.co/storage/v1/object/public/place-photos/${path}` } };
          },
          upload() { return Promise.resolve({ error: null }); },
        };
      },
    },
    from(table: string) {
      if (table === "photo_backfill_runs") {
        const b: Record<string, unknown> = {};
        b.select = () => b;
        b.eq = () => b;
        b.update = (payload: Record<string, unknown>) => { Object.assign(run, payload); return b; };
        b.single = () => Promise.resolve({ data: { ...run }, error: null });
        b.maybeSingle = () => Promise.resolve({ data: { ...run }, error: null });
        return b;
      }
      if (table === "photo_backfill_batches") {
        const b: Record<string, unknown> = {};
        let didUpdate = false;
        let didSelectAfterUpdate = false;
        b.select = () => { if (didUpdate) didSelectAfterUpdate = true; return b; };
        b.order = () => b;
        b.limit = () => b;
        b.update = () => { didUpdate = true; return b; };
        b.eq = () => b;
        b.maybeSingle = () => {
          if (pending > 0) {
            return Promise.resolve({ data: { id: `batch-${pending}`, batch_index: 0, place_pool_ids: [], status: "pending" }, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        };
        // Only the conditional CLAIM (update + select('id')) decrements pending.
        // The batch-completion update (update, no select) does not.
        b.then = (onF: (v: { data: unknown; error: null }) => unknown) => {
          if (didUpdate && didSelectAfterUpdate && pending > 0) {
            const claimedId = `batch-${pending}`;
            pending--;
            return Promise.resolve({ data: [{ id: claimedId }], error: null }).then(onF);
          }
          return Promise.resolve({ data: [], error: null }).then(onF);
        };
        return b;
      }
      const fb: Record<string, unknown> = {};
      fb.select = () => fb; fb.eq = () => fb; fb.is = () => fb; fb.not = () => fb;
      fb.order = () => fb; fb.range = () => fb;
      fb.maybeSingle = () => Promise.resolve({ data: null, error: null });
      fb.then = (onF: (v: { data: unknown; error: null }) => unknown) => Promise.resolve({ data: [], error: null }).then(onF);
      return fb;
    },
  };
  return { db, getRun: () => run };
}

Deno.test("T-03 process_chunk completes the run when no pending batch remains", async () => {
  const { db, getRun } = makeChunkDb({ pendingBatches: 0 });
  const res = await handleProcessChunk(db as unknown as Record<string, never>, { runId: "run-1" });
  const out = await res.json();
  assertEquals(out.ok, true);
  assertEquals(out.done, true);
  assertEquals(getRun().status, "completed");
});

Deno.test("T-03b process_chunk self-invokes (EdgeRuntime.waitUntil) when pending batches remain", async () => {
  // [TEST-MOD-APPROVED ORCH-1044] ORCH-1044 replaced the ORCH-1043 multi-batch
  // BUDGET_MS=110s loop (exitReason='safety_max_iterations') with a SINGLE small
  // unit per invocation that self-invokes when work remains (exitReason='unit_done'
  // / 'guard_tripped_partial'). The self-invoke INVARIANT this test guards is
  // unchanged — only the exit-reason string changed because the loop is gone.
  // 25 pending → after processing one (empty) batch, 24 remain → self-invoke.
  const { db } = makeChunkDb({ pendingBatches: 25 });
  const priorFetch = globalThis.fetch;
  // deno-lint-ignore no-explicit-any
  const g = globalThis as any;
  const priorEdge = g.EdgeRuntime;
  const fetched: string[] = [];
  let waitUntilCalled = false;

  globalThis.fetch = (input: URL | RequestInfo) => {
    fetched.push(String(input));
    return Promise.resolve(new Response("{}", { status: 200 }));
  };
  g.EdgeRuntime = { waitUntil: (p: Promise<unknown>) => { waitUntilCalled = true; return p; } };

  try {
    Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "svc-test");
    const res = await handleProcessChunk(db as unknown as Record<string, never>, { runId: "run-1" });
    const out = await res.json();
    assertEquals(out.ok, true);
    assertEquals(out.done, false);
    // [TEST-MOD-APPROVED ORCH-1044] one batch processed this invocation → 'unit_done';
    // pending work remains → self-invoke.
    assertEquals(out.exitReason, "unit_done");
    assertEquals(out.batchesProcessed, 1);
    assertEquals(waitUntilCalled, true);
    assert(fetched.some((u) => u.includes("/functions/v1/backfill-place-photo-thumbs")), "self-invokes its own URL");
  } finally {
    globalThis.fetch = priorFetch;
    g.EdgeRuntime = priorEdge;
    Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
  }
});

// ─── ORCH-1044 [Thumb gen must fit the edge CPU budget + reliably drain] ──────

import { processBatch } from "./index.ts";

// A processBatch-focused db: place_pool lookups return a configured place row;
// storage upload + place_pool thumbs_backfilled_at update both succeed. Records
// how many HEAD checks + originals fetches happen so we can prove the guard
// stopped early AND that already-written thumbs are HEAD-skipped (not re-encoded).
function makeBatchDb(places: Record<string, string[]>) {
  const updatedPlaceIds: string[] = [];
  const db = {
    storage: {
      from() {
        return {
          getPublicUrl(path: string) {
            return { data: { publicUrl: `https://x.supabase.co/storage/v1/object/public/place-photos/${path}` } };
          },
          upload() { return Promise.resolve({ error: null }); },
        };
      },
    },
    from(table: string) {
      if (table !== "place_pool") throw new Error(`unexpected table ${table}`);
      const b: Record<string, unknown> = {};
      let selectedId: string | null = null;
      let isUpdate = false;
      let updateTargetId: string | null = null;
      b.select = () => b;
      b.is = () => b;
      b.update = (_payload: Record<string, unknown>) => { isUpdate = true; return b; };
      b.eq = (_col: string, val: string) => {
        if (isUpdate) { updateTargetId = val; return Promise.resolve({ error: null }).then((r) => { updatedPlaceIds.push(updateTargetId!); return r; }); }
        selectedId = val;
        return b;
      };
      b.maybeSingle = () => {
        const urls = selectedId ? places[selectedId] : undefined;
        if (!urls) return Promise.resolve({ data: null, error: null });
        return Promise.resolve({ data: { id: selectedId, stored_photo_urls: urls }, error: null });
      };
      return b;
    },
  };
  return { db, updatedPlaceIds };
}

Deno.test("T-01 CPU wall guard stops processing mid-batch, flags partial, and skips already-written thumbs", async () => {
  // 3 places × 1 photo each. A mock clock that advances 700ms per nowMs() call
  // crosses CPU_WALL_GUARD_MS (1200) after the guard check for the 2nd photo,
  // so only the 1st photo's place is fully drained; the rest are left undone.
  const priorFetch = globalThis.fetch;
  const headCalls: string[] = [];
  const getCalls: string[] = [];
  const jpeg = await makeJpegBytes();

  globalThis.fetch = (input: URL | RequestInfo, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (method === "HEAD") {
      headCalls.push(url);
      // place-1's thumb already exists (HEAD 200 → present, no re-encode);
      // place-2/place-3 thumbs do not exist yet (404).
      return Promise.resolve(new Response(null, { status: url.includes("p1/") ? 200 : 404 }));
    }
    getCalls.push(url);
    return Promise.resolve(new Response(bodyFrom(jpeg), { status: 200, headers: { "content-type": "image/jpeg" } }));
  };

  try {
    const { db, updatedPlaceIds } = makeBatchDb({
      "place-1": ["https://x.supabase.co/storage/v1/object/public/place-photos/p1/0.jpg"],
      "place-2": ["https://x.supabase.co/storage/v1/object/public/place-photos/p2/0.jpg"],
      "place-3": ["https://x.supabase.co/storage/v1/object/public/place-photos/p3/0.jpg"],
    });

    // Mock clock sequence (each nowMs() call returns the next value):
    //   call 1 = batchStartMs              → 0
    //   call 2 = guard check, place-1 job1 → 0    (< 1200 → place-1's photo runs)
    //   call 3 = guard check, place-2 job1 → 1300 (>= 1200 → TRIP, place-2/3 left undone)
    //   call 4 = the console.log elapsed read → 1300
    const clock = [0, 0, 1300, 1300];
    let i = 0;
    const nowMs = () => clock[Math.min(i++, clock.length - 1)];

    const result = await processBatch(db as unknown as Record<string, never>, ["place-1", "place-2", "place-3"], { nowMs });

    // Guard tripped → partial batch (must be returned to pending by the caller).
    assertEquals(result.partial, true);
    // place-1 fully drained: its single photo was already present (HEAD 200) → all
    // its jobs ran with no failure → succeeded + thumbs_backfilled_at set.
    assertEquals(updatedPlaceIds, ["place-1"]);
    assertEquals(result.succeeded, 1);
    assertEquals(result.thumbsAlreadyPresent, 1);
    // place-2 + place-3 were NOT processed (guard tripped) — no terminal tally,
    // no thumbs_backfilled_at, so they survive for the resumed batch.
    assertEquals(result.failed, 0);
    // Already-written thumb (place-1) was HEAD-skipped → NEVER re-encoded/refetched.
    assertEquals(getCalls.length, 0, "no original was fetched (place-1 HEAD-skipped, place-2/3 never reached)");
    // The guard stopped BEFORE place-2's HEAD even fired.
    assertEquals(headCalls.length, 1, "only place-1's HEAD ran before the guard tripped");
    assert(headCalls[0].includes("p1/"), "the one HEAD was place-1's thumb");
  } finally {
    globalThis.fetch = priorFetch;
  }
});

Deno.test("T-03 (ORCH-1044) no-guard small batch completes: place fully drained, NOT partial", async () => {
  // 1 place × 1 small photo, generous clock → guard never trips → batch fully
  // processed, place gets thumbs_backfilled_at, partial=false.
  const priorFetch = globalThis.fetch;
  const jpeg = await makeJpegBytes();
  globalThis.fetch = (input: URL | RequestInfo, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (method === "HEAD") return Promise.resolve(new Response(null, { status: 404 }));
    return Promise.resolve(new Response(bodyFrom(jpeg), { status: 200, headers: { "content-type": "image/jpeg" } }));
  };
  try {
    const { db, updatedPlaceIds } = makeBatchDb({
      "place-1": ["https://x.supabase.co/storage/v1/object/public/place-photos/p1/0.jpg"],
    });
    // Clock stays well under CPU_WALL_GUARD_MS for the whole batch.
    let t = 0;
    const nowMs = () => { const v = t; t += 10; return v; };
    const result = await processBatch(db as unknown as Record<string, never>, ["place-1"], { nowMs });
    assertEquals(result.partial, false);
    assertEquals(result.succeeded, 1);
    assertEquals(result.thumbsWritten, 1);
    assertEquals(updatedPlaceIds, ["place-1"]);
  } finally {
    globalThis.fetch = priorFetch;
  }
});

Deno.test({
  name: "T-03c process_chunk auth gate: wrong bearer → 403",
  // createClient (supabase-js@2) starts internal token-refresh intervals that
  // outlive the test — not a code leak, so disable the sanitizers for this case.
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
  const { handler } = await import("./index.ts");
  Deno.env.set("SUPABASE_URL", "https://x.supabase.co");
  Deno.env.set("SUPABASE_ANON_KEY", "anon-test");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "the-real-service-key");
  try {
    const req = new Request("https://x/functions/v1/backfill-place-photo-thumbs", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer wrong-token" },
      body: JSON.stringify({ action: "process_chunk", runId: "run-1" }),
    });
    const res = await handler(req);
    assertEquals(res.status, 403);
  } finally {
    Deno.env.delete("SUPABASE_URL");
    Deno.env.delete("SUPABASE_ANON_KEY");
    Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
  }
  },
});
