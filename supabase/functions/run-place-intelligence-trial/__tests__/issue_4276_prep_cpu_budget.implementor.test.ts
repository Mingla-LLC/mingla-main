// Issue #4276: Intelligence prep stays under the edge CPU limit, doesn't buy the
// same reviews twice, and counts every Serper request.
//
// MINGLA-INVARIANT: I-4276-PREP-SERPER-COUNTED-BEFORE-COMPOSE | issue #4276 | Prep adds its Serper requests to place_intelligence_runs.serper_requests before it composes any collage
//
// Abuja, 2026-11-08: every process_chunk worker died with "CPU Time exceeded" ~16 s
// after boot, while composing 12 collages in parallel. serper_requests stayed 0
// because the count was written after the batch, which never finished.
//
// These drive the REAL runPrepIteration and handleProcessChunk, the REAL
// handleComposeCollage and composeCollage (photos served by a local server, real
// decode and WebP encode), against a fake database. Only Serper is stubbed.
//
// FAILS-ON-REVERT: restore origin/main's runPrepIteration (parallel-12 compose,
// end-of-batch Serper count) and fetchReviewsForPlace, and the cap, one-at-a-time,
// count-before-compose and no-refetch cases fail.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts";
import { resetStorageHeadroomCache } from "../../_shared/storageHeadroomGuard.ts";
import {
  fetchReviewsForPlace,
  handleProcessChunk,
  newComposeBudget,
  PREP_MAX_COMPOSES_PER_INVOCATION,
  runPrepIteration,
} from "../index.ts";

const RUN = "42763000-0000-4000-a000-000000000001";
const RUN_CREATED = "2026-11-08T16:00:00.000Z";

type Row = Record<string, unknown>;

interface World {
  run: Row;
  rows: Row[];
  places: Map<string, Row>;
  states: Map<string, Row>;
  rpc: Array<{ fn: string; args: Record<string, unknown> }>;
  uploads: string[];
  /** Order of events that matter: "serper_count", "upload:<place>". */
  order: string[];
}

function placeId(i: number) {
  return `42763000-0000-4000-b000-${String(i).padStart(12, "0")}`;
}

function makeWorld(n: number, photoBase: string, over: Partial<Row> = {}): World {
  const places = new Map<string, Row>();
  const rows: Row[] = [];
  for (let i = 1; i <= n; i++) {
    const id = placeId(i);
    places.set(id, {
      id,
      google_place_id: `gp-${i}`,
      name: `Place ${i}`,
      // Two photos, no collage yet: every compose is a real one.
      stored_photo_urls: [`${photoBase}/p${i}/a.png`, `${photoBase}/p${i}/b.png`],
      photo_collage_url: null,
      photo_collage_fingerprint: null,
    });
    rows.push({
      id: `42763000-0000-4000-c000-${String(i).padStart(12, "0")}`,
      place_pool_id: id,
      parent_run_id: RUN,
      status: "pending",
      started_at: null,
      prep_status: null,
      cost_usd: 0,
    });
  }
  return {
    run: {
      id: RUN,
      status: "running",
      force_refresh_reviews: false,
      created_at: RUN_CREATED,
      processed_count: 0,
      total_count: n,
      succeeded_count: 0,
      failed_count: 0,
      cost_so_far_usd: 0,
      ...over,
    },
    rows,
    places,
    states: new Map(),
    rpc: [],
    uploads: [],
    order: [],
  };
}

// deno-lint-ignore no-explicit-any
function fakeDb(w: World): any {
  // deno-lint-ignore no-explicit-any
  const from = (table: string): any => {
    let patch: Row | null = null;
    let upsertRows: Row[] | null = null;
    let headCount = false;
    let limit = Infinity;
    const eqs: Array<[string, unknown]> = [];
    const ins: Array<[string, unknown[]]> = [];
    const nulls: string[] = [];
    let pendingOrStuck = false;

    const matchRow = (r: Row) =>
      eqs.every(([c, v]) => r[c] === v) &&
      ins.every(([c, vs]) => vs.includes(r[c])) &&
      nulls.every((c) => r[c] === null || r[c] === undefined) &&
      // Pickup's .or(): pending, or running and stuck (the tests never have stuck rows).
      (!pendingOrStuck || r.status === "pending");

    // deno-lint-ignore no-explicit-any
    const result = (): any => {
      switch (table) {
        case "place_intelligence_runs": {
          if (patch) {
            const statusEq = eqs.find(([c]) => c === "status");
            if (!statusEq || w.run.status === statusEq[1]) Object.assign(w.run, patch);
            return { data: null, error: null };
          }
          return { data: w.run, error: null };
        }
        case "place_intelligence_trial_runs": {
          // The budget loop's score-eligible count. Kept at 0 so the loop only preps.
          if (headCount) return { data: null, count: 0, error: null };
          const hit = w.rows.filter(matchRow);
          if (patch) {
            for (const r of hit) Object.assign(r, patch);
            return { data: null, error: null };
          }
          return { data: hit.slice(0, limit).map((r) => ({ ...r })), error: null };
        }
        case "place_review_fetch_state": {
          if (upsertRows) {
            for (const s of upsertRows) w.states.set(String(s.place_id), { ...s });
            return { data: null, error: null };
          }
          const id = eqs.find(([c]) => c === "place_id")?.[1];
          return { data: w.states.get(String(id)) ?? null, error: null };
        }
        case "place_external_reviews":
          // Stores nothing; freshness for these tests lives in place_review_fetch_state.
          return { data: [], count: 0, error: null };
        case "place_pool": {
          const id = eqs.find(([c]) => c === "id")?.[1];
          const p = w.places.get(String(id));
          if (patch && p) {
            Object.assign(p, patch);
            return { data: null, error: null };
          }
          return { data: p ?? null, error: null };
        }
      }
      return { data: null, error: null };
    };
    // deno-lint-ignore no-explicit-any
    const chain: any = {
      select: (_cols?: string, o?: { head?: boolean }) => {
        if (o?.head) headCount = true;
        return chain;
      },
      update: (p: Row) => {
        patch = p;
        return chain;
      },
      upsert: (p: Row | Row[]) => {
        upsertRows = Array.isArray(p) ? p : [p];
        return chain;
      },
      eq: (c: string, v: unknown) => {
        eqs.push([c, v]);
        return chain;
      },
      in: (c: string, vs: unknown[]) => {
        ins.push([c, vs]);
        return chain;
      },
      is: (c: string) => {
        nulls.push(c);
        return chain;
      },
      or: () => {
        pendingOrStuck = true;
        return chain;
      },
      limit: (n: number) => {
        limit = n;
        return chain;
      },
      gte: () => chain,
      order: () => chain,
      range: () => chain,
      maybeSingle: () => Promise.resolve(result()),
      // deno-lint-ignore no-explicit-any
      then: (res: any, rej: any) => Promise.resolve(result()).then(res, rej),
    };
    return chain;
  };
  return {
    from,
    rpc: (fn: string, args: Record<string, unknown> = {}) => {
      w.rpc.push({ fn, args });
      if (fn === "increment_run_serper_requests") w.order.push("serper_count");
      if (fn === "place_intel_provider_healthy") return Promise.resolve({ data: true, error: null });
      if (fn === "lock_run_for_chunk") return Promise.resolve({ data: { ...w.run }, error: null });
      // Storage headroom: 1 GiB used, far under the ceiling.
      return Promise.resolve({ data: 1024 * 1024 * 1024, error: null });
    },
    storage: {
      from: () => ({
        upload: (path: string) => {
          w.uploads.push(path);
          w.order.push(`upload:${path.split("/")[0]}`);
          return Promise.resolve({ data: { path }, error: null });
        },
        remove: () => Promise.resolve({ data: [], error: null }),
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `https://x.supabase.co/storage/v1/object/public/place-collages/${path}` },
        }),
      }),
    },
  };
}

/** Serves real PNG tiles and records the most requests ever in flight at once. */
async function startPhotoServer() {
  const tile = new Image(64, 64);
  tile.fill(0x30_80_c0_ff);
  const png = await tile.encode();
  const body = new ArrayBuffer(png.byteLength);
  new Uint8Array(body).set(png);
  let inFlight = 0;
  const stats = { maxInFlight: 0, requests: 0 };
  const ac = new AbortController();
  const server = Deno.serve({ port: 0, signal: ac.signal, onListen: () => {} }, async () => {
    inFlight++;
    stats.requests++;
    stats.maxInFlight = Math.max(stats.maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    return new Response(body.slice(0), { headers: { "content-type": "image/png" } });
  });
  return {
    base: `http://127.0.0.1:${(server.addr as Deno.NetAddr).port}`,
    stats,
    stop: async () => {
      ac.abort();
      await server.finished;
    },
  };
}

/** Stubs only Serper; everything else (the photo server, the WebP wasm) is real. */
function stubSerper(pagesPerPlace: number) {
  const real = globalThis.fetch;
  const calls: Array<Record<string, unknown>> = [];
  const perPlace = new Map<string, number>();
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("serper.dev")) {
      const body = JSON.parse(String(init?.body));
      calls.push(body);
      const n = (perPlace.get(body.placeId) ?? 0) + 1;
      perPlace.set(body.placeId, n);
      const reviews = [{ id: `${body.placeId}-${n}`, snippet: "good", rating: 5 }];
      return Promise.resolve(
        Response.json(n < pagesPerPlace ? { reviews, nextPageToken: "more" } : { reviews }),
      );
    }
    return real(input, init);
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = real; } };
}

const opts = { sanitizeOps: false, sanitizeResources: false };

const prep = (w: World, composeBudget = newComposeBudget()) =>
  runPrepIteration({
    db: fakeDb(w),
    serperKey: "k",
    runId: RUN,
    stuckCutoff: new Date().toISOString(),
    workerStartedAtMs: Date.now(),
    iteration: 1,
    composeBudget,
  });

const serperCounted = (w: World) =>
  w.rpc
    .filter((c) => c.fn === "increment_run_serper_requests")
    .reduce((n, c) => n + Number(c.args.p_requests), 0);

Deno.test("the cap is small enough to fit the edge CPU limit", () => {
  // ~0.5 s of CPU per 16-tile collage measured locally; 2 s per invocation at the edge.
  assert(PREP_MAX_COMPOSES_PER_INVOCATION >= 1 && PREP_MAX_COMPOSES_PER_INVOCATION <= 3);
});

Deno.test({ name: "one prep batch composes no more than the cap, one at a time, and claims no more", ...opts, fn: async () => {
  resetStorageHeadroomCache();
  const srv = await startPhotoServer();
  const s = stubSerper(1);
  try {
    const w = makeWorld(12, srv.base);
    const r = await prep(w);
    assertEquals(w.uploads.length, PREP_MAX_COMPOSES_PER_INVOCATION, "new collages composed");
    assertEquals(r.composed, PREP_MAX_COMPOSES_PER_INVOCATION);
    assertEquals(r.prepped, PREP_MAX_COMPOSES_PER_INVOCATION);
    assertEquals(srv.stats.maxInFlight, 1, "collages are composed one at a time");
    const claimed = w.rows.filter((row) => row.status !== "pending" || row.prep_status !== null);
    assertEquals(
      w.rows.filter((row) => row.prep_status === "ready").length,
      PREP_MAX_COMPOSES_PER_INVOCATION,
    );
    assertEquals(claimed.length, PREP_MAX_COMPOSES_PER_INVOCATION, "no place is claimed and left waiting");
    assertEquals(w.rows.filter((row) => row.status === "running").length, 0);

    // The same budget, spent: a second iteration claims and composes nothing.
    const budget = newComposeBudget();
    budget.remaining = 0;
    const again = await prep(w, budget);
    assertEquals(again.composed + again.prepped + again.prep_failed, 0);
    assertEquals(w.uploads.length, PREP_MAX_COMPOSES_PER_INVOCATION);
  } finally {
    s.restore();
    await srv.stop();
  }
}});

Deno.test({ name: "a whole worker invocation stops prep at the cap and says why", ...opts, fn: async () => {
  resetStorageHeadroomCache();
  const srv = await startPhotoServer();
  const s = stubSerper(1);
  try {
    const w = makeWorld(20, srv.base);
    const res = await handleProcessChunk(fakeDb(w), { run_id: RUN }, "gemini-key", "k");
    const body = await res.json();
    assertEquals(w.uploads.length, PREP_MAX_COMPOSES_PER_INVOCATION, "composes across all iterations");
    assertEquals(body.exit_reason, "prep_compose_cap_reached");
    assertEquals(body.prepped, PREP_MAX_COMPOSES_PER_INVOCATION);
  } finally {
    s.restore();
    await srv.stop();
  }
}});

Deno.test({ name: "Serper requests are counted, failed ones too, before any collage is composed", ...opts, fn: async () => {
  resetStorageHeadroomCache();
  const srv = await startPhotoServer();
  const real = globalThis.fetch;
  let serperCalls = 0;
  // Place 1: three good pages. Place 2: a Serper 500, which still costs a request.
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("serper.dev")) {
      serperCalls++;
      const body = JSON.parse(String(init?.body));
      if (body.placeId === "gp-2") return Promise.resolve(new Response("Scraping failed", { status: 500 }));
      const page = body.nextPageToken ? Number(body.nextPageToken) : 1;
      const reviews = [{ id: `r${page}`, snippet: "good", rating: 5 }];
      return Promise.resolve(Response.json(page < 3 ? { reviews, nextPageToken: String(page + 1) } : { reviews }));
    }
    return real(input, init);
  }) as typeof fetch;
  try {
    const w = makeWorld(2, srv.base);
    const r = await prep(w);
    assertEquals(serperCalls, 4);
    assertEquals(serperCounted(w), 4, "serper_requests rises by every request made");
    assertEquals(r.prep_failed, 1, "the place whose fetch failed");
    assertEquals(w.uploads.length, 1);
    assertEquals(w.order[0], "serper_count", "counted before the first collage, so a CPU kill can't lose it");
  } finally {
    globalThis.fetch = real;
    await srv.stop();
  }
}});

Deno.test({ name: "a redo's place whose reviews this run already fetched is not fetched again", ...opts, fn: async () => {
  resetStorageHeadroomCache();
  const srv = await startPhotoServer();
  const s = stubSerper(1);
  try {
    const w = makeWorld(2, srv.base, { force_refresh_reviews: true });
    // Place 1 was fetched by this run before its worker was killed. Place 2 was
    // fetched before this run was created, so the redo must fetch it.
    w.states.set(placeId(1), {
      place_id: placeId(1),
      outcome: "fetched",
      review_count: 7,
      last_checked_at: "2026-11-08T16:05:00.000Z",
    });
    w.states.set(placeId(2), {
      place_id: placeId(2),
      outcome: "fetched",
      review_count: 7,
      last_checked_at: "2026-11-01T10:00:00.000Z",
    });
    const r = await prep(w);
    assertEquals(r.prepped, 2);
    assertEquals(s.calls.map((c) => c.placeId), ["gp-2"]);
    assertEquals(serperCounted(w), 1);
  } finally {
    s.restore();
    await srv.stop();
  }
}});

Deno.test({ name: "a redo still refetches a place whose fetch this run failed", ...opts, fn: async () => {
  const w = makeWorld(1, "http://127.0.0.1:9");
  w.states.set(placeId(1), {
    place_id: placeId(1),
    outcome: "failed",
    review_count: 0,
    last_checked_at: "2026-11-08T16:05:00.000Z",
  });
  const s = stubSerper(1);
  try {
    const outcome = await fetchReviewsForPlace(fakeDb(w), placeId(1), true, "k", undefined, {
      refreshedSince: RUN_CREATED,
    });
    assertEquals(outcome.kind, "fetched");
    assertEquals(s.calls.length, 1);
  } finally {
    s.restore();
  }
}});

Deno.test({ name: "a review seen again is stored as freshly fetched", ...opts, fn: async () => {
  const w = makeWorld(1, "http://127.0.0.1:9");
  const db = fakeDb(w);
  const upserts: Row[] = [];
  const realFrom = db.from;
  db.from = (table: string) => {
    const q = realFrom(table);
    if (table === "place_external_reviews") {
      const up = q.upsert;
      q.upsert = (rows: Row[]) => {
        upserts.push(...rows);
        return up(rows);
      };
    }
    return q;
  };
  const s = stubSerper(1);
  try {
    const before = Date.now();
    await fetchReviewsForPlace(db, placeId(1), false, "k");
    assertEquals(upserts.length, 1);
    assert(
      Date.parse(String(upserts[0].fetched_at)) >= before,
      "fetched_at must be refreshed on conflict, or stored reviews never look fresh and every retry pays Serper",
    );
  } finally {
    s.restore();
  }
}});
