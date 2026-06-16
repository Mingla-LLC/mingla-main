// ORCH-1151 [curated experiences with menu items as STOPS] — TESTER ADVERSARIAL.
// Different angle than the implementor's clean-integer happy path:
//   ADV-1 — summed-price ARITHMETIC robustness across a single stops[] array that
//           mixes negative, null, undefined-key, float, string-numeric, and
//           non-numeric garbage prices. The executor's coercion is
//           `Math.max(0, Math.round(Number(s?.price_cents) || 0))` per stop and
//           the ticket = Σ of those clamped values. A revert to naive `+=` or a
//           dropped clamp must NOT silently let a negative/NaN poison the sum.
//   ADV-2 — name/description BOUNDARY: a >120-char stop name truncates to exactly
//           120 chars; a >280-char description truncates to exactly 280; an
//           all-whitespace name falls back to "Stop {i+1}". (`.slice` boundaries.)
//   ADV-3 — exactly-zero-but-one-priced mix: one stop priced, the rest 0/null →
//           ticket = the single price, is_free=false (a "≥1 stop with NO price"
//           case — the experience price EXCLUDES the unpriced stops by treating
//           them as 0, never NaN, never free).
//
// Append-only; new file; attacks executor `createExperience` only. Source-only
// reasoning capped — these are runtime Deno assertions on the real executor.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { findTool } from "../agentTools.ts";

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
    const terminal = (data: unknown) =>
      Promise.resolve({ data, error: script.error ?? null });
    const passthrough = () => chain;
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

const BRAND = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const EVENT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function scripts(): Record<string, TableScript> {
  return {
    brands: { single: { id: BRAND, venue_category: "restaurant", default_currency: "USD" } },
    events: { single: { id: EVENT, brand_id: BRAND, status: "draft" } },
    experience_stops: { error: null },
    ticket_types: { error: null },
  };
}
function stopsInsert(rec: Recorder): Row[] {
  const e = rec.inserts.find((i) => i.table === "experience_stops");
  return (e?.payload as Row[]) ?? [];
}
function ticketInsert(rec: Recorder): Row | undefined {
  return rec.inserts.find((i) => i.table === "ticket_types")?.payload;
}

// ── ADV-1 — arithmetic robustness across a poisoned price array ──────────────
Deno.test("ORCH-1151 ADV-1: mixed negative/null/float/string/garbage prices clamp + sum cleanly", async () => {
  const rec: Recorder = { inserts: [], updates: [] };
  const tool = findTool("create_experience")!;
  await tool.executor(
    {
      brand_id: BRAND,
      title: "Poisoned Prices",
      narrative: "Arithmetic adversary.",
      currency: "USD",
      stops: [
        { name: "Clean", price_cents: 1500 },          // 1500
        { name: "Negative", price_cents: -900 },        // clamp → 0
        { name: "Null", price_cents: null },            // → 0
        { name: "Missing key" },                        // undefined → 0
        { name: "Float", price_cents: 1099.7 },         // round → 1100
        { name: "String-numeric", price_cents: "2200" as unknown as number }, // Number("2200")=2200
        { name: "Garbage", price_cents: "abc" as unknown as number }, // NaN → 0
      ],
      // expected sum = 1500 + 0 + 0 + 0 + 1100 + 2200 + 0 = 4800
    },
    makeClient(scripts(), rec),
    USER,
  );

  const rows = stopsInsert(rec);
  assertEquals(rows.length, 7, "all 7 stops still written (none dropped)");
  // per-row clamped values
  assertEquals(rows[0].price_cents, 1500);
  assertEquals(rows[1].price_cents, 0, "negative clamps to 0, never negative");
  assertEquals(rows[2].price_cents, 0, "null → 0");
  assertEquals(rows[3].price_cents, 0, "missing key → 0");
  assertEquals(rows[4].price_cents, 1100, "float rounds (1099.7→1100)");
  assertEquals(rows[5].price_cents, 2200, "string-numeric coerces");
  assertEquals(rows[6].price_cents, 0, "non-numeric garbage → 0, NOT NaN");
  // no NaN ever reaches a row
  for (const r of rows) {
    assert(Number.isFinite(r.price_cents), `price_cents finite for ${r.place_name}`);
    assert(r.price_cents >= 0, `price_cents non-negative for ${r.place_name}`);
  }
  // summed ticket = 4800, finite, not free
  const tk = ticketInsert(rec)!;
  assertEquals(tk.price_cents, 4800, "Σ of clamped prices");
  assert(Number.isFinite(tk.price_cents), "ticket price is finite (no NaN poison)");
  assertEquals(tk.is_free, false, "sum > 0 ⇒ not free");
});

// ── ADV-2 — name/description truncation + whitespace fallback boundaries ─────
Deno.test("ORCH-1151 ADV-2: >120-char name truncates to 120; >280 desc to 280; blank name → fallback", async () => {
  const rec: Recorder = { inserts: [], updates: [] };
  const tool = findTool("create_experience")!;
  const longName = "N".repeat(200);
  const longDesc = "D".repeat(400);
  await tool.executor(
    {
      brand_id: BRAND,
      title: "Boundary",
      narrative: "Truncation adversary.",
      stops: [
        { name: longName, description: longDesc, price_cents: 500 },
        { name: "    ", description: "   ", price_cents: 700 }, // whitespace-only
      ],
    },
    makeClient(scripts(), rec),
    USER,
  );
  const rows = stopsInsert(rec);
  assertEquals(rows[0].place_name.length, 120, "name truncated to exactly 120");
  assertEquals(rows[0].ai_description.length, 280, "description truncated to exactly 280");
  // whitespace-only name → trimmed empty → "Stop 2" fallback (index 1)
  assertEquals(rows[1].place_name, "Stop 2", "blank name falls back to Stop {i+1}");
  assertEquals(rows[1].ai_description, "", "blank description → '' (NOT-NULL)");
  // both stops still present, summed price 1200
  assertEquals(ticketInsert(rec)!.price_cents, 1200);
});

// ── ADV-3 — one priced + rest unpriced ⇒ price excludes the unpriced, not free ─
Deno.test("ORCH-1151 ADV-3: one priced stop among unpriced → ticket = that price, not free", async () => {
  const rec: Recorder = { inserts: [], updates: [] };
  const tool = findTool("create_experience")!;
  await tool.executor(
    {
      brand_id: BRAND,
      title: "One Priced",
      narrative: "Partial pricing.",
      stops: [
        { name: "Free starter", price_cents: null },
        { name: "The main", price_cents: 3300 },
        { name: "Free water" }, // no key
      ],
    },
    makeClient(scripts(), rec),
    USER,
  );
  const rows = stopsInsert(rec);
  assertEquals(rows.length, 3, "all 3 stops written (unpriced kept at 0)");
  assertEquals(rows[0].price_cents, 0);
  assertEquals(rows[1].price_cents, 3300);
  assertEquals(rows[2].price_cents, 0);
  const tk = ticketInsert(rec)!;
  assertEquals(tk.price_cents, 3300, "ticket excludes unpriced stops (treated as 0)");
  assertEquals(tk.is_free, false, "≥1 priced stop ⇒ NOT free");
});
