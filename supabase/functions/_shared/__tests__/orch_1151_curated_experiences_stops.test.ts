// ORCH-1151 [curated experiences with menu items as STOPS + summed price + no free ticket]
// Implementor happy-path + guard regression (mingla-implementor side).
// The tester writes the adversarial counterpart separately.
//
// PRIMARY (fails-on-revert) — T1: a snap confirm carrying N item-stops must
// write exactly N experience_stops rows (stop_order 0..N-1, place_name = item
// name, address='', ai_description = item desc, price_cents = item price) AND a
// single ticket priced at the SUM of the stops, NOT free, pricing_mode
// 'per_stop'. This FAILS if §4.4 of the SPEC is reverted (no stops written /
// free per-dish ticket restored / whole pricing).
//
// Also covers:
//   T2  (Ve6 activities snap)     → 2 stops, summed ticket
//   T3  (draft invariant)         → NO event_dates / published_at null / no cover
//   T4  (Ari no-regression)       → no `stops` arg ⇒ ZERO experience_stops rows,
//                                    one free unlimited ticket, no throw (byte-identical to ORCH-1146)
//   T5  (zero-price stops)        → ticket price_cents=0, is_free=true; stops STILL written
//   T6  (atomicity)               → stops insert fails ⇒ throws WRITE_FAILED + orphan soft-deleted, NO ticket
//   T7  (address null)            → each stop place_id/lat/lng absent (NULL), address='', place_name set
//   T8  (NOT-NULL satisfied)      → minimal stop (name+price only) ⇒ ai_description='', no image_urls key
//   T10 (parser schemas)          → both Gemini cores declare nested stops + MAX_EXPERIENCES=6
//
// ⚠️ ORCH-1151 — the snap path (stops present) and the Ari/manual path (stops
// absent) must never cross-contaminate; the `hasStops` gate is the single fork.

import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { findTool, ToolError } from "../agentTools.ts";

// ── mock Supabase client (chainable query-builder) ──────────────────────────
// Independent re-implementation; mirrors the ORCH-1146 field-completeness mock
// so the experience_stops batch insert + the orphan soft-delete both record.
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

interface TableScript {
  single?: Row | null;
  error?: { message: string; code?: string } | null;
}
interface Recorder {
  inserts: { table: string; payload: Row }[];
  updates: { table: string; payload: Row }[];
}

function makeClient(scripts: Record<string, TableScript>, rec: Recorder) {
  function builder(table: string) {
    let pendingInsert: Row | null = null;
    let pendingUpdate: Row | null = null;
    const script = scripts[table] ?? {};
    const chain: Record<string, unknown> = {};
    const passthrough = () => chain;
    const terminal = (data: unknown) =>
      Promise.resolve({ data, error: script.error ?? null });

    Object.assign(chain, {
      select: () => Object.assign(terminal(null), chain),
      insert: (payload: Row) => {
        pendingInsert = payload;
        rec.inserts.push({ table, payload });
        return chain;
      },
      update: (payload: Row) => {
        pendingUpdate = payload;
        rec.updates.push({ table, payload });
        return chain;
      },
      eq: passthrough,
      in: passthrough,
      is: passthrough,
      maybeSingle: () => terminal(script.single ?? null),
      single: () => terminal(script.single ?? null),
      then: (resolve: (v: unknown) => void) =>
        terminal(pendingInsert ?? pendingUpdate ?? null).then(resolve),
    });
    return chain;
  }
  return { from: (t: string) => builder(t) } as unknown as Parameters<
    NonNullable<ReturnType<typeof findTool>>["executor"]
  >[1];
}

const OWNED_BRAND_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NEW_EVENT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function scriptsFor(
  venueCategory: string | null,
  defaultCurrency: string | null,
  opts: { ticketError?: { message: string }; stopsError?: { message: string } } = {},
): Record<string, TableScript> {
  return {
    brands: {
      single: {
        id: OWNED_BRAND_ID,
        venue_category: venueCategory,
        default_currency: defaultCurrency,
      },
    },
    events: {
      single: { id: NEW_EVENT_ID, brand_id: OWNED_BRAND_ID, status: "draft" },
    },
    experience_stops: { error: opts.stopsError ?? null },
    ticket_types: { error: opts.ticketError ?? null },
  };
}

function getInsert(rec: Recorder, table: string): Row | undefined {
  return rec.inserts.find((i) => i.table === table)?.payload;
}
function getInserts(rec: Recorder, table: string): Row[] {
  return rec.inserts.filter((i) => i.table === table).map((i) => i.payload);
}

// ── T1 (happy, Ve5) — N priced stops → N rows + summed ticket ────────────────
Deno.test("ORCH-1151 T1: menu snap with 3 priced stops → 3 experience_stops + ticket price = sum", async () => {
  const rec: Recorder = { inserts: [], updates: [] };
  const client = makeClient(scriptsFor("restaurant", "USD"), rec);
  const tool = findTool("create_experience");
  assert(tool, "create_experience registered");

  await tool!.executor(
    {
      brand_id: OWNED_BRAND_ID,
      title: "Date-Night Tasting Trio",
      narrative: "A curated three-course tasting for two.",
      currency: "USD",
      stops: [
        { name: "Burrata", description: "Creamy burrata, basil, tomato", price_cents: 1400 },
        { name: "Cacio e Pepe", description: "Pepper + pecorino pasta", price_cents: 2200 },
        { name: "Tiramisu", description: "Espresso-soaked layers", price_cents: 1100 },
      ],
    },
    client,
    USER_ID,
  );

  // events: per_stop mode, whole_price_cents NULL, draft.
  const ev = getInsert(rec, "events");
  assert(ev, "events insert happened");
  assertEquals(ev!.pricing_mode, "per_stop");
  assertEquals(ev!.whole_price_cents, null);
  assertEquals(ev!.status, "draft");
  assertEquals(ev!.visibility, "draft");

  // exactly 3 experience_stops rows, ordered, item-as-stop.
  const stops = getInserts(rec, "experience_stops");
  // The batch insert records ONE inserts entry whose payload is the array.
  assertEquals(stops.length, 1, "one batched experience_stops insert call");
  const rows = stops[0] as Row[];
  assertEquals(rows.length, 3, "3 stop rows");
  assertEquals(rows[0].stop_order, 0);
  assertEquals(rows[1].stop_order, 1);
  assertEquals(rows[2].stop_order, 2);
  assertEquals(rows[0].place_name, "Burrata");
  assertEquals(rows[1].place_name, "Cacio e Pepe");
  assertEquals(rows[2].place_name, "Tiramisu");
  assertEquals(rows[0].ai_description, "Creamy burrata, basil, tomato");
  assertEquals(rows[0].price_cents, 1400);
  assertEquals(rows[1].price_cents, 2200);
  assertEquals(rows[2].price_cents, 1100);
  assertEquals(rows[0].address, "", "address is empty string (NOT-NULL satisfied)");
  assertEquals(rows[0].event_id, NEW_EVENT_ID);

  // exactly ONE ticket priced at the SUM (4700), not free.
  const tickets = getInserts(rec, "ticket_types");
  assertEquals(tickets.length, 1, "exactly one ticket row (I-1)");
  assertEquals(tickets[0].price_cents, 4700, "ticket = sum of stop prices");
  assertEquals(tickets[0].is_free, false, "not free when sum > 0");
  assertEquals(tickets[0].currency, "USD");
});

// ── T2 (happy, Ve6) — activities snap with 2 stops ──────────────────────────
Deno.test("ORCH-1151 T2: play activities snap with 2 stops → 2 rows + summed ticket 8800", async () => {
  const rec: Recorder = { inserts: [], updates: [] };
  const client = makeClient(scriptsFor("play", "USD"), rec);
  const tool = findTool("create_experience");

  await tool!.executor(
    {
      brand_id: OWNED_BRAND_ID,
      title: "Friday Night Out for the Crew",
      narrative: "Lanes and a pitcher.",
      currency: "USD",
      stops: [
        { name: "2 Lanes 1hr", description: "Two lanes, one hour", price_cents: 6000 },
        { name: "Pitcher", description: "Domestic pitcher", price_cents: 2800 },
      ],
    },
    client,
    USER_ID,
  );

  const rows = (getInserts(rec, "experience_stops")[0]) as Row[];
  assertEquals(rows.length, 2);
  const tk = getInsert(rec, "ticket_types");
  assertEquals(tk!.price_cents, 8800);
  assertEquals(tk!.is_free, false);
  const ev = getInsert(rec, "events");
  assertEquals(ev!.pricing_mode, "per_stop");
  assertEquals(ev!.status, "draft");
});

// ── T3 (draft invariant) — no dates/cover/publish even with stops ───────────
Deno.test("ORCH-1151 T3: snap with stops still writes NO event_dates / published_at null / no cover", async () => {
  const rec: Recorder = { inserts: [], updates: [] };
  const client = makeClient(scriptsFor("restaurant", "USD"), rec);
  const tool = findTool("create_experience");

  await tool!.executor(
    {
      brand_id: OWNED_BRAND_ID,
      title: "Brunch Crawl",
      narrative: "Three brunch plates.",
      stops: [{ name: "Pancakes", price_cents: 1200 }],
    },
    client,
    USER_ID,
  );

  assertEquals(rec.inserts.some((i) => i.table === "event_dates"), false);
  const ev = getInsert(rec, "events");
  assertEquals(ev!.published_at, null);
  assertEquals("cover_media_url" in ev!, false);
});

// ── T4 (Ari no-regression) — no stops arg ⇒ byte-identical ORCH-1146 ─────────
Deno.test("ORCH-1151 T4: Ari minimal call (no stops) ⇒ ZERO experience_stops + one free unlimited ticket", async () => {
  const rec: Recorder = { inserts: [], updates: [] };
  const client = makeClient(scriptsFor(null, null), rec);
  const tool = findTool("create_experience");

  const result = await tool!.executor(
    {
      brand_id: OWNED_BRAND_ID,
      title: "Pop-up supper club",
      narrative: "An intimate one-off supper.",
    },
    client,
    USER_ID,
  ) as { event: unknown };
  assert(result.event, "returns the event");

  // NO experience_stops insert on the Ari path.
  assertEquals(
    rec.inserts.some((i) => i.table === "experience_stops"),
    false,
    "Ari path writes no stops",
  );
  // events stays in whole pricing mode (unchanged).
  const ev = getInsert(rec, "events");
  assertEquals(ev!.pricing_mode, "whole");
  // one free unlimited ticket (unchanged ORCH-1146).
  const tk = getInsert(rec, "ticket_types");
  assert(tk, "Ari draft still gets a ticket");
  assertEquals(tk!.is_free, true);
  assertEquals(tk!.is_unlimited, true);
  assertEquals(tk!.quantity_total, null);
});

// ── T5 (zero-price stops) — truly free menu → free ticket, stops still written ─
Deno.test("ORCH-1151 T5: all stops price 0 → ticket price 0 + is_free true; stops still written", async () => {
  const rec: Recorder = { inserts: [], updates: [] };
  const client = makeClient(scriptsFor("restaurant", "USD"), rec);
  const tool = findTool("create_experience");

  await tool!.executor(
    {
      brand_id: OWNED_BRAND_ID,
      title: "Free Tasting Walk",
      narrative: "Complimentary samples.",
      // Explicit is_free=false must be IGNORED on the snap path — the SUM is
      // authoritative; sum 0 ⇒ free.
      is_free: false,
      stops: [
        { name: "Sample A", price_cents: 0 },
        { name: "Sample B", price_cents: 0 },
      ],
    },
    client,
    USER_ID,
  );

  const rows = (getInserts(rec, "experience_stops")[0]) as Row[];
  assertEquals(rows.length, 2, "stops still written even when free");
  const tk = getInsert(rec, "ticket_types");
  assertEquals(tk!.price_cents, 0);
  assertEquals(tk!.is_free, true, "sum 0 ⇒ free, ignoring explicit is_free=false");
});

// ── T6 (atomicity) — stops insert fails ⇒ throws + orphan soft-deleted ──────
Deno.test("ORCH-1151 T6: stops insert failure throws WRITE_FAILED, soft-deletes orphan, writes NO ticket", async () => {
  const rec: Recorder = { inserts: [], updates: [] };
  const client = makeClient(
    scriptsFor("restaurant", "USD", { stopsError: { message: "stops boom" } }),
    rec,
  );
  const tool = findTool("create_experience");

  const err = await assertRejects(
    () =>
      tool!.executor(
        {
          brand_id: OWNED_BRAND_ID,
          title: "Doomed Tasting",
          narrative: "Will fail at stops.",
          stops: [{ name: "Plate", price_cents: 1000 }],
        },
        client,
        USER_ID,
      ),
    ToolError,
  );
  assertEquals((err as ToolError).code, "WRITE_FAILED");

  // orphan events soft-deleted.
  const evUpdates = rec.updates.filter((u) => u.table === "events");
  assertEquals(evUpdates.length, 1, "one events update (orphan soft-delete)");
  assert("deleted_at" in evUpdates[0].payload, "deleted_at stamped");
  // NO ticket written (we threw before the ticket insert).
  assertEquals(
    rec.inserts.some((i) => i.table === "ticket_types"),
    false,
    "no ticket written when stops fail",
  );
});

// ── T7 (address null) — stops carry no address/coords ───────────────────────
Deno.test("ORCH-1151 T7: each stop row leaves place_id/lat/lng absent, address='', place_name set", async () => {
  const rec: Recorder = { inserts: [], updates: [] };
  const client = makeClient(scriptsFor("restaurant", "USD"), rec);
  const tool = findTool("create_experience");

  await tool!.executor(
    {
      brand_id: OWNED_BRAND_ID,
      title: "No-Address Tasting",
      narrative: "Items have no location.",
      stops: [{ name: "Olives", description: "Marinated", price_cents: 800 }],
    },
    client,
    USER_ID,
  );

  const rows = (getInserts(rec, "experience_stops")[0]) as Row[];
  const r = rows[0];
  assertEquals("place_id" in r, false, "place_id omitted (NULL)");
  assertEquals("lat" in r, false, "lat omitted (NULL)");
  assertEquals("lng" in r, false, "lng omitted (NULL)");
  assertEquals(r.address, "");
  assertEquals(r.place_name, "Olives");
});

// ── T8 (NOT-NULL satisfied) — minimal stop name+price only ──────────────────
Deno.test("ORCH-1151 T8: minimal stop (name+price, no description) ⇒ ai_description='', no image_urls key", async () => {
  const rec: Recorder = { inserts: [], updates: [] };
  const client = makeClient(scriptsFor("restaurant", "USD"), rec);
  const tool = findTool("create_experience");

  await tool!.executor(
    {
      brand_id: OWNED_BRAND_ID,
      title: "Minimal",
      narrative: "One stop, no description.",
      stops: [{ name: "X", price_cents: 500 }],
    },
    client,
    USER_ID,
  );

  const rows = (getInserts(rec, "experience_stops")[0]) as Row[];
  const r = rows[0];
  assertEquals(r.ai_description, "", "ai_description defaults to '' (NOT-NULL)");
  assertEquals("image_urls" in r, false, "image_urls omitted (DB default '{}')");
  // Every NOT-NULL column the executor must supply is present:
  assert("event_id" in r);
  assert("stop_order" in r);
  assert("place_name" in r);
  assert("address" in r);
  assert("price_cents" in r);
  assert("ai_description" in r);
});

// ── T10 (parser schemas) — both cores declare nested stops + MAX=6 ──────────
Deno.test("ORCH-1151 T10: both Gemini cores emit nested stops and cap experiences at 6", async () => {
  const menuSrc = await Deno.readTextFile(
    new URL("../geminiMenuParser.ts", import.meta.url),
  );
  const playSrc = await Deno.readTextFile(
    new URL("../geminiActivitiesParser.ts", import.meta.url),
  );

  for (const [label, src] of [["menu", menuSrc], ["play", playSrc]] as const) {
    assert(
      /MAX_EXPERIENCES\s*=\s*6\b/.test(src),
      `${label} core caps MAX_EXPERIENCES at 6`,
    );
    assert(
      /stops\s*:\s*\{[\s\S]*?type:\s*"array"/.test(src),
      `${label} RESPONSE_SCHEMA declares a stops array`,
    );
    assert(
      /price_cents:\s*\{\s*type:\s*"integer"/.test(src),
      `${label} stop schema declares price_cents integer`,
    );
    assert(
      /required:\s*\[\s*"title",\s*"narrative",\s*"stops"\s*\]/.test(src),
      `${label} item requires stops`,
    );
  }
});
