// Issue #4276 S1: a drift_reeval child and an admin_reeval child go all the way
// through the REAL handleProcessChunk: prep, Gemini, parent complete, and
// ai_signal_scores written. Neither mode has ever completed in production, because
// the database refused both until this issue. Providers are mocked; no paid call.
//
// MINGLA-INVARIANT: I-4276-REEVAL-MODES-COMPLETE | issue #4276 | A drift_reeval or admin_reeval run completes through the worker and writes ai_signal_scores
//
// By default this uses an in-memory table store. To run the same body on the real
// schema, set ISSUE_4276_POSTGREST_URL and ISSUE_4276_POSTGREST_JWT to a local
// PostgREST over a fully migrated database; that also fires the real drift trigger.
//
// FAILS-ON-REVERT: on the real schema, take either mode back out of
// place_intelligence_runs_mode_check and both the trigger and the insert are refused.
// In memory, make prep ignore the mode's child (remove parent_run_id from the row) and
// the parent never completes.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fingerprintPhotos } from "../../_shared/imageCollage.ts";
import { handleProcessChunk } from "../index.ts";

type Row = Record<string, unknown>;

// deno-lint-ignore no-explicit-any
function memoryDb(): { db: any; tables: Record<string, Row[]> } {
  const tables: Record<string, Row[]> = {
    seeding_cities: [],
    place_pool: [],
    place_intelligence_runs: [],
    place_intelligence_trial_runs: [],
    place_external_reviews: [],
    place_review_fetch_state: [],
  };
  // Understands the one `or` shape the worker sends:
  //   status.eq.pending,and(status.eq.running,started_at.lt.<iso>)
  const orMatches = (expr: string, r: Row) => {
    const m = expr.match(/^status\.eq\.pending,and\(status\.eq\.running,started_at\.lt\.(.+)\)$/);
    if (!m) throw new Error(`memoryDb: unsupported or(): ${expr}`);
    return r.status === "pending" || (r.status === "running" && String(r.started_at) < m[1]);
  };
  // deno-lint-ignore no-explicit-any
  const from = (table: string): any => {
    if (!tables[table]) tables[table] = [];
    const filters: Array<(r: Row) => boolean> = [];
    let op: "select" | "update" | "insert" | "upsert" = "select";
    let payload: Row | Row[] | null = null;
    let onConflict = "";
    let limit = Infinity;
    let range: [number, number] | null = null;
    let head = false;
    let wantCount = false;
    const run = () => {
      if (op === "insert" || op === "upsert") {
        const rows = (Array.isArray(payload) ? payload : [payload]) as Row[];
        for (const row of rows) {
          const key = onConflict.split(",").filter(Boolean);
          const hit = key.length
            ? tables[table].find((e) => key.every((k) => e[k] === row[k]))
            : undefined;
          if (hit) Object.assign(hit, row);
          else tables[table].push({ id: crypto.randomUUID(), ...row });
        }
        return { data: rows, error: null, count: rows.length };
      }
      const hits = tables[table].filter((r) => filters.every((f) => f(r)));
      if (op === "update") {
        for (const r of hits) Object.assign(r, payload);
        return { data: hits, error: null, count: hits.length };
      }
      let out = hits;
      if (range) out = out.slice(range[0], range[1] + 1);
      out = out.slice(0, limit === Infinity ? undefined : limit);
      return { data: head ? null : out, error: null, count: wantCount ? hits.length : null };
    };
    // deno-lint-ignore no-explicit-any
    const chain: any = {
      select: (_c?: string, o?: { count?: string; head?: boolean }) => {
        head = o?.head === true;
        wantCount = !!o?.count;
        return chain;
      },
      insert: (p: Row | Row[]) => { op = "insert"; payload = p; return chain; },
      upsert: (p: Row | Row[], o?: { onConflict?: string }) => {
        op = "upsert"; payload = p; onConflict = o?.onConflict ?? ""; return chain;
      },
      update: (p: Row) => { op = "update"; payload = p; return chain; },
      eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return chain; },
      in: (c: string, v: unknown[]) => { filters.push((r) => v.includes(r[c])); return chain; },
      is: (c: string, _v: null) => { filters.push((r) => r[c] === null || r[c] === undefined); return chain; },
      gte: (c: string, v: string) => { filters.push((r) => String(r[c]) >= v); return chain; },
      or: (e: string) => { filters.push((r) => orMatches(e, r)); return chain; },
      order: () => chain,
      limit: (n: number) => { limit = n; return chain; },
      range: (a: number, b: number) => { range = [a, b]; return chain; },
      maybeSingle: () => {
        const r = run();
        return Promise.resolve({ ...r, data: (r.data as Row[] | null)?.[0] ?? null });
      },
      single: () => {
        const r = run();
        const row = (r.data as Row[] | null)?.[0] ?? null;
        return Promise.resolve({ ...r, data: row, error: row ? null : { message: "not found" } });
      },
      // deno-lint-ignore no-explicit-any
      then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
    };
    return chain;
  };
  const rpc = (fn: string, args: Row) => {
    const run = tables.place_intelligence_runs.find((r) => r.id === args.p_run_id);
    if (fn === "lock_run_for_chunk") return Promise.resolve({ data: run ?? null, error: null });
    if (fn === "increment_run_counters" && run) {
      run.processed_count = Number(run.processed_count ?? 0) + Number(args.p_processed);
      run.succeeded_count = Number(run.succeeded_count ?? 0) + Number(args.p_succeeded);
      run.failed_count = Number(run.failed_count ?? 0) + Number(args.p_failed);
      run.cost_so_far_usd = Number(run.cost_so_far_usd ?? 0) + Number(args.p_cost);
    }
    return Promise.resolve({ data: null, error: null });
  };
  return { db: { from, rpc }, tables };
}

const REAL_URL = Deno.env.get("ISSUE_4276_POSTGREST_URL");
const REAL_JWT = Deno.env.get("ISSUE_4276_POSTGREST_JWT");

function stubProviders() {
  const real = globalThis.fetch;
  const called = { serper: 0, gemini: 0 };
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("serper.dev")) {
      called.serper++;
      return Promise.resolve(Response.json({
        reviews: [{ id: `r-${crypto.randomUUID()}`, snippet: "Lovely spot", rating: 5, isoDate: "2026-10-01T00:00:00Z" }],
      }));
    }
    if (url.includes("generativelanguage")) {
      called.gemini++;
      return Promise.resolve(Response.json({
        candidates: [{
          finishReason: "STOP",
          content: {
            parts: [{
              functionCall: {
                name: JSON.parse(String(init?.body)).tools[0].function_declarations[0].name,
                args: {
                  evaluations: [{ signal_id: "drinks", score_0_to_100: 77, inappropriate_for: false, reasoning: "Good bar" }],
                },
              },
            }],
          },
        }],
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50, thoughtsTokenCount: 0 },
      }));
    }
    if (url.includes("x.test")) {
      return Promise.resolve(new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/webp" } }));
    }
    if (REAL_URL && url.startsWith(REAL_URL)) return real(input, init);
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as typeof fetch;
  return { called, restore: () => { globalThis.fetch = real; } };
}

async function seedPlace(
  // deno-lint-ignore no-explicit-any
  db: any,
  cityId: string,
  placeId: string,
): Promise<void> {
  const photos = ["https://photos.test/1.jpg"];
  const { error: cityErr } = await db.from("seeding_cities").insert({
    id: cityId, google_place_id: `gp-${cityId}`, name: `City ${cityId.slice(-4)}`, country: "Testland",
    country_code: "TL", center_lat: 1, center_lng: 1, bbox_sw_lat: 0, bbox_sw_lng: 0, bbox_ne_lat: 2,
    bbox_ne_lng: 2, status: "draft",
  });
  assertEquals(cityErr, null);
  const { error: placeErr } = await db.from("place_pool").insert({
    id: placeId, google_place_id: `gp-${placeId}`, name: "A place", lat: 1, lng: 1, types: ["bar"],
    primary_type: "bar", is_active: true, is_servable: true, city_id: cityId, business_status: "OPERATIONAL",
    ai_signal_scores: { drinks: { score_0_to_100: 1, inappropriate_for: false, reasoning: "old", evaluated_at: "2026-01-01T00:00:00Z", prompt_version: "v4", model: "m" } },
    fetched_via: "nearby_search", stored_photo_urls: photos, photo_collage_url: "https://x.test/c.webp",
    photo_collage_fingerprint: await fingerprintPhotos(photos),
  });
  assertEquals(placeErr, null);
}

const opts = { sanitizeOps: false, sanitizeResources: false };

for (const mode of ["drift_reeval", "admin_reeval"] as const) {
  Deno.test({ name: `a ${mode} child reaches a complete parent and writes ai_signal_scores`, ...opts, fn: async () => {
    const mem = memoryDb();
    // deno-lint-ignore no-explicit-any
    const db: any = REAL_URL
      ? createClient(REAL_URL, REAL_JWT!, {
        auth: { persistSession: false },
        // A bare PostgREST has no gateway adding /rest/v1.
        global: {
          fetch: (input: string | URL | Request, init?: RequestInit) =>
            globalThis.fetch(String(input).replace("/rest/v1", ""), init),
        },
      })
      : mem.db;
    const cityId = crypto.randomUUID();
    const placeId = crypto.randomUUID();
    await seedPlace(db, cityId, placeId);

    let runId: string;
    const realDrift = REAL_URL && mode === "drift_reeval";
    if (realDrift) {
      // The real trigger writes the rows, and the kicker's promotion is mimicked.
      const { error } = await db.from("place_pool").update({ business_status: "CLOSED_TEMPORARILY" }).eq("id", placeId);
      assertEquals(error, null);
      const { data: parent, error: readErr } = await db.from("place_intelligence_runs")
        .select("id, status, started_at").eq("city_id", cityId).single();
      assertEquals(readErr, null);
      assertEquals(parent.status, "queued");
      assertEquals(parent.started_at, null);
      runId = parent.id;
    } else {
      runId = crypto.randomUUID();
      const { error: pErr } = await db.from("place_intelligence_runs").insert({
        id: runId, city_id: cityId, city_name: "t", mode, sample_size: 1, total_count: 1,
        processed_count: 0, succeeded_count: 0, failed_count: 0, cost_so_far_usd: 0,
        estimated_cost_usd: 0.0089, estimated_minutes: 1, prompt_version: "v4", model: "gemini-3.6-flash",
        started_by: null, status: mode === "drift_reeval" ? "queued" : "running", force_refresh_reviews: false,
      });
      assertEquals(pErr, null);
      const { error: cErr } = await db.from("place_intelligence_trial_runs").insert({
        run_id: runId, parent_run_id: runId, place_pool_id: placeId, city_id: cityId, signal_id: null,
        anchor_index: null, input_payload: {}, status: "pending", prompt_version: "v4", model: "gemini-3.6-flash",
        retry_count: 0, prep_status: null, started_at: null,
        source: mode === "drift_reeval" ? "auto-refresh-drift" : "admin-reeval-button",
      });
      assertEquals(cErr, null);
    }

    // A queued parent is refused by the worker until the cron promotes it.
    if (mode === "drift_reeval") {
      const early = await (await handleProcessChunk(db, { run_id: runId }, "gk", "sk")).json();
      assertEquals(early.skipped, true);
      assertEquals(early.reason, "status=queued");
      const { error } = await db.from("place_intelligence_runs")
        .update({ status: "running", started_at: new Date().toISOString() }).eq("id", runId);
      assertEquals(error, null);
    }

    const stub = stubProviders();
    try {
      let last: Record<string, unknown> = {};
      for (let i = 0; i < 4; i++) {
        last = await (await handleProcessChunk(db, { run_id: runId }, "gk", "sk")).json();
        if (last.run_complete === true || last.action === "complete" || last.action === "complete_reconciled") break;
      }
      assertEquals(stub.called.serper, 1, "one review fetch");
      assertEquals(stub.called.gemini, 1, "one Gemini call");

      const { data: run } = await db.from("place_intelligence_runs")
        .select("status, processed_count, succeeded_count, failed_count").eq("id", runId).single();
      assertEquals(run.status, "complete", `worker said ${JSON.stringify(last)}`);
      assertEquals(run.processed_count, 1);
      assertEquals(run.succeeded_count, 1);
      assertEquals(run.failed_count, 0);

      const { data: child } = await db.from("place_intelligence_trial_runs")
        .select("status, prep_status, error_message").eq("parent_run_id", runId).single();
      assertEquals(child.status, "completed");
      assertEquals(child.prep_status, "ready");
      assert(!child.error_message);

      const { data: place } = await db.from("place_pool").select("ai_signal_scores").eq("id", placeId).single();
      assertEquals(place.ai_signal_scores.drinks.score_0_to_100, 77);
      assertEquals(place.ai_signal_scores.drinks.reasoning, "Good bar");
      assert(place.ai_signal_scores.drinks.evaluated_at > "2026-01-01");
    } finally {
      stub.restore();
    }
  }});
}
