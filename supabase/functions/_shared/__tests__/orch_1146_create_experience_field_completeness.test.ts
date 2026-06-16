// ORCH-1146 [experience-parser field completeness]
// Implementor happy-path + guard regression (mingla-implementor side).
// The tester writes the adversarial counterpart separately.
//
// PRIMARY (fails-on-revert) — T1: confirming a snapped Ve6 tool_args set must
// produce a FULLY-POPULATED draft: experience_intents canonicalized + currency
// column + ONE ticket_types row carrying is_free/capacity/price — and dates /
// cover / stops / published_at left null. This test FAILS if §4.1 of the spec
// is reverted (the executor collapses back to a 14-column title/narrative shell
// with no currency column, no experience_intents, and NO ticket row).
//
// Also covers:
//   T2  (Ve5, no price, romantic tag)  → {romantic}, free unlimited ticket
//   T3  (unmappable tags only)         → experience_intents OMITTED (NULL, no CHECK fail)
//   T5  (Ari minimal call)             → draft + free/unlimited ticket; intents NULL; no throw
//   T6  (invariant)                    → 0 dates/stops, null cover, draft visibility
//   T7  (currency from brand)          → currency='NGN' on event + ticket
//   T9  (atomicity)                    → ticket insert fails ⇒ throws WRITE_FAILED + orphan soft-deleted
//
// ⚠️ ORCH-1146 — snapped experiences must arrive with every inferable field in
// its real column; do not collapse the confirm executor back to a
// title/narrative shell.

import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { findTool, ToolError } from "../agentTools.ts";

// ── mock Supabase client (chainable query-builder) ──────────────────────────
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

interface TableScript {
  // row returned by single()/maybeSingle()
  single?: Row | null;
  // error to surface on the terminal (insert/select)
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
      // `await chain` after an insert with no .select()/.single() (the ticket
      // insert + the orphan-delete update both terminate this way).
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

// Build the standard scripts for a successful snap-confirm under a brand with
// `venue_category` + `default_currency`. `assertBrandOwned` reads brands(id);
// the executor then re-reads brands(venue_category, default_currency); the
// events insert returns the new row id; the ticket insert succeeds.
function scriptsFor(
  venueCategory: string | null,
  defaultCurrency: string | null,
  opts: { ticketError?: { message: string } } = {},
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
    ticket_types: { error: opts.ticketError ?? null },
  };
}

function getInsert(rec: Recorder, table: string): Row | undefined {
  return rec.inserts.find((i) => i.table === table)?.payload;
}

// ── T1 (happy, Ve6) — full-field draft ──────────────────────────────────────
Deno.test("ORCH-1146 T1: Ve6 snap → canonical intents + currency column + ONE ticket (cap/free/price)", async () => {
  const rec: Recorder = { inserts: [], updates: [] };
  const client = makeClient(scriptsFor("play", "GBP"), rec);
  const tool = findTool("create_experience");
  assert(tool, "create_experience registered");

  await tool!.executor(
    {
      brand_id: OWNED_BRAND_ID,
      title: "Lane + pitcher for 8",
      narrative: "Bowling lane and a pitcher, great for a crew.",
      intent_tags: ["group_activity", "date_night_active"],
      currency: "NGN",
      capacity_max: 8,
      suggested_price_min_cents: 2000,
      suggested_price_max_cents: 4000,
    },
    client,
    USER_ID,
  );

  // events row — canonical intents + currency column + draft invariants.
  const ev = getInsert(rec, "events");
  assert(ev, "events insert happened");
  assertEquals(ev!.experience_intents, ["romantic", "group-fun"]); // canonical order
  assertEquals(ev!.currency, "NGN");
  assertEquals(ev!.whole_price_cents, 3000); // midpoint
  assertEquals(ev!.status, "draft");
  assertEquals(ev!.visibility, "draft");
  assertEquals(ev!.published_at, null);

  // exactly ONE ticket_types row (I-1) with capacity + paid price.
  const tickets = rec.inserts.filter((i) => i.table === "ticket_types");
  assertEquals(tickets.length, 1, "exactly one ticket row");
  const tk = tickets[0].payload;
  assertEquals(tk.quantity_total, 8);
  assertEquals(tk.is_unlimited, false);
  assertEquals(tk.is_free, false);
  assertEquals(tk.price_cents, 3000);
  assertEquals(tk.currency, "NGN");
  assertEquals(tk.name, "Standard");
  assertEquals(tk.event_id, NEW_EVENT_ID);
});

// ── T2 (happy, Ve5) — no price, romantic free-text tag → {romantic}, free ──
Deno.test("ORCH-1146 T2: Ve5 snap, no price, romantic tag → {romantic}, free unlimited ticket", async () => {
  const rec: Recorder = { inserts: [], updates: [] };
  const client = makeClient(scriptsFor("restaurant", "USD"), rec);
  const tool = findTool("create_experience");

  await tool!.executor(
    {
      brand_id: OWNED_BRAND_ID,
      title: "Date-night tasting menu",
      narrative: "A candlelit five-course tasting.",
      intent_tags: ["date-night tasting menu"],
      // no price → free
    },
    client,
    USER_ID,
  );

  const ev = getInsert(rec, "events");
  assertEquals(ev!.experience_intents, ["romantic"]);
  assertEquals(ev!.whole_price_cents, null);

  const tk = getInsert(rec, "ticket_types");
  assert(tk, "ticket inserted");
  assertEquals(tk!.is_free, true);
  assertEquals(tk!.price_cents, 0);
  assertEquals(tk!.quantity_total, null);
  assertEquals(tk!.is_unlimited, true);
});

// ── T3 (edge) — unmappable tags → experience_intents OMITTED (NULL) ──────────
Deno.test("ORCH-1146 T3: unmappable tags → experience_intents key OMITTED (column stays NULL, no CHECK fail)", async () => {
  const rec: Recorder = { inserts: [], updates: [] };
  const client = makeClient(scriptsFor("restaurant", "USD"), rec);
  const tool = findTool("create_experience");

  await tool!.executor(
    {
      brand_id: OWNED_BRAND_ID,
      title: "Gluten-free brunch",
      narrative: "Coeliac-friendly brunch dishes.",
      intent_tags: ["gluten_free", "vegan"],
    },
    client,
    USER_ID,
  );

  const ev = getInsert(rec, "events");
  // Key must be ABSENT (never an empty array — the CHECK rejects []).
  assertEquals(
    "experience_intents" in ev!,
    false,
    "experience_intents must be omitted, not written as []",
  );
});

// ── T5 (Ari no-regression) — minimal call still works, additive only ─────────
Deno.test("ORCH-1146 T5: Ari minimal {brand_id,title,narrative} → draft + free/unlimited ticket; intents NULL; no throw", async () => {
  const rec: Recorder = { inserts: [], updates: [] };
  // Ari under a brand with NO venue_category + NO default_currency.
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

  assert(result.event, "returns the event (additive output)");

  const ev = getInsert(rec, "events");
  assertEquals(ev!.status, "draft");
  assertEquals(ev!.visibility, "draft");
  // No intents passed → key omitted (NULL).
  assertEquals("experience_intents" in ev!, false);
  // No brand currency + no arg → currency key omitted (DB default applies).
  assertEquals("currency" in ev!, false);

  // Still gains a free, unlimited Standard ticket.
  const tk = getInsert(rec, "ticket_types");
  assert(tk, "Ari draft still gets a ticket");
  assertEquals(tk!.is_free, true);
  assertEquals(tk!.is_unlimited, true);
  assertEquals(tk!.quantity_total, null);
  assertEquals("currency" in tk!, false);
});

// ── T6 (invariant) — no dates/stops/cover/published_at written ──────────────
Deno.test("ORCH-1146 T6: snap writes NO event_dates/experience_stops/cover/published_at", async () => {
  const rec: Recorder = { inserts: [], updates: [] };
  const client = makeClient(scriptsFor("play", "GBP"), rec);
  const tool = findTool("create_experience");

  await tool!.executor(
    {
      brand_id: OWNED_BRAND_ID,
      title: "Escape room",
      narrative: "60-minute room, up to 6.",
      intent_tags: ["group_activity"],
      capacity_max: 6,
    },
    client,
    USER_ID,
  );

  // No inserts into the forbidden tables.
  assertEquals(rec.inserts.some((i) => i.table === "event_dates"), false);
  assertEquals(rec.inserts.some((i) => i.table === "experience_stops"), false);

  const ev = getInsert(rec, "events");
  assertEquals(ev!.published_at, null);
  assertEquals("cover_media_url" in ev!, false);
  assertEquals(ev!.timezone, "UTC");
});

// ── T7 (currency) — currency arg absent → resolved from brand.default_currency ─
Deno.test("ORCH-1146 T7: no currency arg + brand NGN → events.currency='NGN' + ticket currency='NGN'", async () => {
  const rec: Recorder = { inserts: [], updates: [] };
  const client = makeClient(scriptsFor("play", "ngn"), rec); // lowercase brand value
  const tool = findTool("create_experience");

  await tool!.executor(
    {
      brand_id: OWNED_BRAND_ID,
      title: "Arcade tournament",
      narrative: "Friday night arcade tournament.",
      intent_tags: ["group_activity"],
      suggested_price_min_cents: 5000,
      suggested_price_max_cents: 5000,
    },
    client,
    USER_ID,
  );

  const ev = getInsert(rec, "events");
  assertEquals(ev!.currency, "NGN"); // uppercased from brand default
  const tk = getInsert(rec, "ticket_types");
  assertEquals(tk!.currency, "NGN");
});

// ── T9 (atomicity) — ticket insert fails ⇒ throws + orphan events soft-deleted ─
Deno.test("ORCH-1146 T9: ticket insert failure throws WRITE_FAILED and soft-deletes the orphan events row", async () => {
  const rec: Recorder = { inserts: [], updates: [] };
  const client = makeClient(
    scriptsFor("play", "GBP", { ticketError: { message: "boom" } }),
    rec,
  );
  const tool = findTool("create_experience");

  const err = await assertRejects(
    () =>
      tool!.executor(
        {
          brand_id: OWNED_BRAND_ID,
          title: "Mini golf 18",
          narrative: "Round of mini golf.",
          intent_tags: ["group_activity"],
          suggested_price_min_cents: 1500,
          suggested_price_max_cents: 1500,
        },
        client,
        USER_ID,
      ),
    ToolError,
  );
  assertEquals((err as ToolError).code, "WRITE_FAILED");

  // Compensating soft-delete of the orphan events row happened.
  const evUpdates = rec.updates.filter((u) => u.table === "events");
  assertEquals(evUpdates.length, 1, "exactly one events update (the orphan soft-delete)");
  assert("deleted_at" in evUpdates[0].payload, "deleted_at stamped on the orphan");
});
