// @ts-nocheck — Deno-runtime suite (Deno globals + deno.land import); the
// app-mobile tsc sweep has no Deno types (house convention — see
// orch_1342_cold_seed_landing.test.ts).
//
// #2242 [cold-link-cart] — implementor-owned happy-path guard suite for the cart's
// ticket source on ConsumerEventDetailScreen (SPEC §8 T-1..T-6, §5 SC-8/9/10/12).
// Deno source-structure suite in the 1342 house style (read source → strip comments
// → assert).
//
// WHY THE LOCAL IS NAMED, AND WHY THAT NAME IS PART OF THE CONTRACT (SPEC §4.2).
// Every guard in this area is a `String.includes()` source assertion. The inline
// expression `canonical?.event.tickets ?? ticketsQuery.data` is a PREFIX SUBSTRING of
// the page body's line 586, `canonical?.event.tickets ?? ticketsQuery.data ?? []`.
// A guard written against the inline form is therefore satisfied by line 586 alone —
// it passes on a fully reverted cart. That is not hypothetical: it is exactly what
// happened. `96cbd78ba` (#1936, Fixes #1929) migrated five ticket read sites onto the
// canonical checkout bundle and moved four, leaving `<TicketCartSheet tickets=…>`
// pointed at a query the same commit had just disabled — and the CI gate whose
// failure message read "cold tickets not bundle-owned" inspected only line 586 and
// stayed green for six days while every buyer arriving from a shared link hit a
// spinner that could never resolve. `cartTickets` is not a substring of anything else
// in the file, so `const cartTickets = …` and `tickets={cartTickets}` are both
// unambiguously assertable. A one-token rename silently re-opens the hole.
//
// FAILS-ON-REVERT (proven by true line deletion in the implementation report):
//   - revert the mount to `tickets={ticketsQuery.data}` → T-02 FAILS (both halves).
//   - delete the `cartTickets` local → T-01 FAILS.
//   - add `?? []` to the initializer → T-03 FAILS.
//   - re-point the initializer at `canonicalQuery.data` → T-04 FAILS.
//   - touch any of the three pinned lines → T-05 FAILS.
//   - edit either sibling screen's cart mount → T-06 FAILS.
//
// The negative half of T-02 and the whole of T-03/T-04 are the assertions that could
// not have existed before this change: no test anywhere in the repo had ever asserted
// on what the event screen feeds its TicketCartSheet.

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const read = async (rel: string): Promise<string> =>
  await Deno.readTextFile(new URL(rel, import.meta.url));

const strip = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const eventScreen = strip(await read("../ConsumerEventDetailScreen.tsx"));
const tripScreen = strip(
  await read("../../Trip/ConsumerTripDetailScreen.tsx"),
);
const expScreen = strip(
  await read("../../Experience/ConsumerExperienceDetailScreen.tsx"),
);

// The `cartTickets` initializer, isolated from the rest of the file so T-03/T-04 can
// assert on the expression itself rather than on the module. Comments are already
// stripped, so this is real code.
const cartTicketsInitializer = ((): string => {
  const match = eventScreen.match(/const cartTickets\s*=([^;]*);/);
  assert(
    match !== null,
    "no `const cartTickets = …;` declaration found in ConsumerEventDetailScreen.tsx",
  );
  return match[1].trim();
})();

// ── T-1: the cart's ticket source exists, verbatim ───────────────────────────

Deno.test("#2242 T-01: the cart reads a named canonical-first local, verbatim", () => {
  assertStringIncludes(
    eventScreen,
    "const cartTickets = canonical?.event.tickets ?? ticketsQuery.data;",
  );
  // exactly ONE declaration — never a second, divergent source.
  assertEquals(eventScreen.split("const cartTickets =").length - 1, 1);
});

// ── T-2: the mount, and the absence of the pre-fix mount ─────────────────────

Deno.test("#2242 T-02: the TicketCartSheet mount reads cartTickets and never the gated legacy query", () => {
  assertStringIncludes(eventScreen, "tickets={cartTickets}");
  // The negative is the load-bearing half: nothing but the fix satisfies it. Before
  // this change the event screen carried `tickets={ticketsQuery.data}` at :1475 while
  // :439-441 disabled that very query on the cold /e/ route, so the sheet subscribed
  // to ["publicEventTickets", null] — a cache key no code path can populate.
  assert(
    !eventScreen.includes("tickets={ticketsQuery.data}"),
    "ConsumerEventDetailScreen still mounts the cart on the gated legacy query",
  );
  // the mount is on the ONE TicketCartSheet in this file.
  assertEquals(eventScreen.split("<TicketCartSheet").length - 1, 1);
  assertEquals(eventScreen.split("tickets={cartTickets}").length - 1, 1);
});

// ── T-3: no fabricated empty list ────────────────────────────────────────────

Deno.test("#2242 T-03: the initializer has NO `?? []` — undefined must survive", () => {
  // `?? []` here would turn the deck path's honest in-flight `Loading tickets…` into a
  // false `No tickets available for this event.` — trading a P0 on the link route for
  // a data-fabrication bug on the busier one (Constitution #9).
  assert(
    !/\?\?\s*\[\s*\]/.test(cartTicketsInitializer),
    `cartTickets initializer fabricates an empty list: ${cartTicketsInitializer}`,
  );
  assertEquals(
    cartTicketsInitializer,
    "canonical?.event.tickets ?? ticketsQuery.data",
  );
});

// ── T-4: the binding is to `canonical`, never `canonicalQuery.data` ──────────

Deno.test("#2242 T-04: the source is coldReadPlan.canonical, not canonicalQuery.data", () => {
  assertStringIncludes(cartTicketsInitializer, "canonical?.event.tickets");
  // A seed suppresses the bundle outright (usePublicEventBySlug.ts:64), so once #2230
  // enables usePublicEventBySlug on the deck path too, `canonicalQuery.data` is
  // non-null on the deck while `coldReadPlan.canonical` stays null. Binding here to
  // `canonicalQuery.data` would silently switch the DECK cart from legacy
  // quantity_total capacity to bundle remaining capacity, unreviewed and untested, on
  // the app's highest-traffic path.
  assert(
    !cartTicketsInitializer.includes("canonicalQuery"),
    `cartTickets is bound to canonicalQuery, not canonical: ${cartTicketsInitializer}`,
  );
  // the local `canonical` is still the coldReadPlan projection it has always been.
  assertStringIncludes(eventScreen, "const canonical = coldReadPlan.canonical;");
});

// ── T-5: the three pinned lines survive byte-identical ───────────────────────

Deno.test("#2242 T-05: the gate + body + screen-spinner lines are untouched", () => {
  // :439-441 — the legacy read stays gated on allowLegacyTicketRead.
  assertStringIncludes(
    eventScreen,
    "coldReadPlan.allowLegacyTicketRead ? eventId : null",
  );
  // :586 — the page body's canonical-first read, pinned by
  // orch_1342_cold_seed_landing.test.ts:129 and by the #1929 strict-grep gate.
  assertStringIncludes(
    eventScreen,
    "const tickets = canonical?.event.tickets ?? ticketsQuery.data ?? [];",
  );
  // :1117 — the screen-level loading sheet keeps its `canonical === null` conjunct,
  // which is what stops the screen itself from hanging on the cold route.
  assertStringIncludes(
    eventScreen,
    "if (canonical === null && ticketsQuery.isLoading) {",
  );
});

// ── T-6: the two sibling cart mounts are untouched (SPEC DO-NOT-TOUCH) ───────

const siblings: Array<[string, string, string]> = [
  ["ConsumerTripDetailScreen", tripScreen, "usePublicEventTickets(tripId)"],
  ["ConsumerExperienceDetailScreen", expScreen, "usePublicEventTickets(eventId)"],
];
let t = 6;
for (const [name, src, declaration] of siblings) {
  Deno.test(`#2242 T-0${t}: ${name} is unmodified — no gate, ungated query, original mount`, () => {
    // Neither sibling has the allowLegacyTicketRead construct; it exists nowhere but
    // the event screen. Their cold routes resolve a real id, so their query runs and
    // `tickets={ticketsQuery.data}` is correct there — which is also why the #1929
    // gate's new negative assertion must stay scoped to the event screen.
    assert(
      !src.includes("allowLegacyTicketRead"),
      `${name} acquired the allowLegacyTicketRead gate — out of scope for #2242`,
    );
    assertStringIncludes(src, declaration);
    assertStringIncludes(src, "tickets={ticketsQuery.data}");
    assert(
      !src.includes("cartTickets"),
      `${name} was edited by #2242 — it is DO-NOT-TOUCH (SPEC §10)`,
    );
  });
  t += 1;
}
