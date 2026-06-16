// ORCH-1146 [experience-parser field completeness] — TESTER ADVERSARIAL.
//
// Different angle than the implementor's happy-path file
// (orch_1146_create_experience_field_completeness.test.ts). This file attacks:
//   ADV-1  is_free PRECEDENCE — explicit args.is_free=false on a zero/absent
//          price must NOT be forced free (explicit wins over price-derivation).
//   ADV-2  CAPACITY LEAK — capacity_max present on a RESTAURANT (Ve5) snap must
//          NOT cap the ticket (capacity is a Play-only signal).
//   ADV-3  TITLE BOUNDARY — a >120-char title still errors (INVALID_ARGS), no
//          partial event/ticket write.
//   ADV-4  CHECK-SAFETY (the highest-risk DB failure) — experience_intents is
//          NEVER written as [] and NEVER as an invalid id. Adversarial inputs:
//          all-unmappable, mixed mappable+garbage, case/whitespace variants,
//          duplicate tags. The events.experience_intents CHECK requires a NULL
//          column OR an array of length 1-4 of the 4 canonical ids.
//   ADV-5  ORPHAN-CLEANUP ON EVENTS-INSERT FAILURE — if the events insert
//          itself fails, NO ticket is written and the tool throws (no orphan).
//
// Append-only: brand-new file; modifies no existing test. The mock client below
// is an independent re-implementation (not imported from the implementor file).

import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { findTool, ToolError } from "../agentTools.ts";
import {
  CANONICAL_EXPERIENCE_INTENTS,
  mapToCanonicalExperienceIntents,
} from "../canonicalExperienceIntents.ts";

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

const BRAND = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const EVENT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function scriptsFor(
  venueCategory: string | null,
  defaultCurrency: string | null,
  opts: { eventError?: { message: string; code?: string } } = {},
): Record<string, TableScript> {
  return {
    brands: {
      single: {
        id: BRAND,
        venue_category: venueCategory,
        default_currency: defaultCurrency,
      },
    },
    events: opts.eventError
      ? { error: opts.eventError }
      : { single: { id: EVENT, brand_id: BRAND, status: "draft" } },
    ticket_types: {},
  };
}
function ins(rec: Recorder, table: string): Row | undefined {
  return rec.inserts.find((i) => i.table === table)?.payload;
}

// ── ADV-1: explicit is_free=false on absent price must NOT be forced free ────
Deno.test("ORCH-1146 ADV-1: explicit is_free=false wins over price-derivation (no zero-price 'free')", async () => {
  const rec: Recorder = { inserts: [], updates: [] };
  const client = makeClient(scriptsFor("play", "USD"), rec);
  const tool = findTool("create_experience")!;
  await tool.executor(
    {
      brand_id: BRAND,
      title: "Paid-but-priceless workshop",
      narrative: "A paid workshop where the AI didn't read a price.",
      intent_tags: ["group_activity"],
      is_free: false, // explicit — must override the price-absent derivation
      // NO price supplied
    },
    client,
    USER,
  );
  const tk = ins(rec, "ticket_types");
  assert(tk, "ticket inserted");
  // explicit is_free=false MUST be honored (not flipped to free by price absence)
  assertEquals(tk!.is_free, false, "explicit is_free=false must win");
  assertEquals(tk!.price_cents, 0, "no price → 0 cents, but ticket is NOT marked free");
});

// ── ADV-2: capacity_max on a RESTAURANT must NOT cap the ticket ──────────────
Deno.test("ORCH-1146 ADV-2: capacity_max on a Ve5 RESTAURANT snap does NOT cap (Play-only signal)", async () => {
  const rec: Recorder = { inserts: [], updates: [] };
  const client = makeClient(scriptsFor("restaurant", "USD"), rec);
  const tool = findTool("create_experience")!;
  await tool.executor(
    {
      brand_id: BRAND,
      title: "Tasting menu",
      narrative: "A restaurant tasting menu.",
      intent_tags: ["tasting_menu"],
      capacity_max: 4, // bogus for a restaurant — must be ignored
    },
    client,
    USER,
  );
  const tk = ins(rec, "ticket_types");
  assert(tk, "ticket inserted");
  assertEquals(tk!.quantity_total, null, "restaurant ticket must stay uncapped");
  assertEquals(tk!.is_unlimited, true, "restaurant ticket must be unlimited");
});

// ── ADV-3: >120-char title still errors, no partial write ───────────────────
Deno.test("ORCH-1146 ADV-3: >120-char title → INVALID_ARGS, no event/ticket written", async () => {
  const rec: Recorder = { inserts: [], updates: [] };
  const client = makeClient(scriptsFor("play", "USD"), rec);
  const tool = findTool("create_experience")!;
  const err = await assertRejects(
    () =>
      tool.executor(
        {
          brand_id: BRAND,
          title: "x".repeat(121),
          narrative: "valid narrative",
          intent_tags: ["group_activity"],
        },
        client,
        USER,
      ),
    ToolError,
  );
  assertEquals((err as ToolError).code, "INVALID_ARGS");
  assertEquals(rec.inserts.length, 0, "no inserts on validation failure");
});

// ── ADV-4: CHECK-SAFETY — experience_intents never [] and never an invalid id ─
Deno.test("ORCH-1146 ADV-4a: all-unmappable + case/whitespace/dup → column OMITTED (never [])", async () => {
  const rec: Recorder = { inserts: [], updates: [] };
  const client = makeClient(scriptsFor("restaurant", "USD"), rec);
  const tool = findTool("create_experience")!;
  await tool.executor(
    {
      brand_id: BRAND,
      title: "Allergen menu",
      narrative: "Nothing maps to a vibe.",
      intent_tags: ["  GLUTEN_FREE  ", "Vegan", "keto", "halal", "GLUTEN_FREE"],
    },
    client,
    USER,
  );
  const ev = ins(rec, "events");
  assert(ev, "events insert happened");
  assertEquals(
    "experience_intents" in ev!,
    false,
    "all-unmappable (incl. case/whitespace/dup variants) → key OMITTED, never []",
  );
});

Deno.test("ORCH-1146 ADV-4b: mixed mappable+garbage → ONLY valid canonical ids, deduped, ≤4, in canonical order", () => {
  // Direct helper assault (the CHECK contract is: NULL or 1-4 of the 4 ids).
  const out = mapToCanonicalExperienceIntents(
    [
      "  Romantic Candlelit  ", // → romantic (case + whitespace)
      "gluten_free", // garbage → drop
      "GROUP party", // → group-fun
      "solo_exploration", // → adventurous
      "first-date", // → first-date
      "romantic", // dup of romantic
      42, // non-string → ignored
      null, // non-string → ignored
    ],
    "restaurant",
  );
  // Every emitted id MUST be a member of the canonical set.
  for (const id of out) {
    assert(
      (CANONICAL_EXPERIENCE_INTENTS as readonly string[]).includes(id),
      `emitted id '${id}' must be canonical`,
    );
  }
  // No duplicates.
  assertEquals(new Set(out).size, out.length, "no duplicate ids");
  // Length within 1-4 (CHECK bound).
  assert(out.length >= 1 && out.length <= 4, "length must be 1-4");
  // Canonical order preserved: adventurous, first-date, romantic, group-fun.
  assertEquals(out, ["adventurous", "first-date", "romantic", "group-fun"]);
});

Deno.test("ORCH-1146 ADV-4c: empty array / non-array inputs → [] (executor then omits → NULL)", () => {
  assertEquals(mapToCanonicalExperienceIntents([], "play"), []);
  assertEquals(mapToCanonicalExperienceIntents(null, "play"), []);
  assertEquals(mapToCanonicalExperienceIntents("group_activity", "play"), []); // not an array
  assertEquals(mapToCanonicalExperienceIntents([""], "play"), []); // empty string drops
});

// ── ADV-5: events-insert failure → no ticket, tool throws, no orphan cleanup needed ─
Deno.test("ORCH-1146 ADV-5: events insert fails → throws, NO ticket written, NO stray update", async () => {
  const rec: Recorder = { inserts: [], updates: [] };
  const client = makeClient(
    scriptsFor("play", "USD", { eventError: { message: "rls denied" } }),
    rec,
  );
  const tool = findTool("create_experience")!;
  await assertRejects(
    () =>
      tool.executor(
        {
          brand_id: BRAND,
          title: "Will fail at events insert",
          narrative: "events insert rejected.",
          intent_tags: ["group_activity"],
        },
        client,
        USER,
      ),
    ToolError,
  );
  // No ticket should be attempted when the parent insert failed.
  assertEquals(
    rec.inserts.some((i) => i.table === "ticket_types"),
    false,
    "no ticket insert after a failed events insert",
  );
  // No compensating soft-delete (there is no orphan to clean).
  assertEquals(
    rec.updates.some((u) => u.table === "events"),
    false,
    "no orphan soft-delete when the events insert itself failed",
  );
});
