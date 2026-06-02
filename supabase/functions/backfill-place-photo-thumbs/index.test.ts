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
  // SAFETY_MAX_ITERATIONS=20; 25 pending → loop exits on iteration cap with work
  // still pending, forcing the end-of-budget self-invoke.
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
    assertEquals(out.exitReason, "safety_max_iterations");
    assertEquals(waitUntilCalled, true);
    assert(fetched.some((u) => u.includes("/functions/v1/backfill-place-photo-thumbs")), "self-invokes its own URL");
  } finally {
    globalThis.fetch = priorFetch;
    g.EdgeRuntime = priorEdge;
    Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
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
