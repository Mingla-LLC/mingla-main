// @ts-nocheck — Deno-discovered suite; app-mobile's tsc sweep has no Deno globals.
/* eslint-disable import/no-unresolved -- Deno-discovered suite; Expo ESLint does not resolve URL imports. */
// #4572 item 6 (D6, SC-6.3) — Discover's "Event type" filter shows the Host
// wizard's two groups, in the canonical order, six chips each until "Show all".
//
// FAILS-ON-REVERT (true line deletion): drop the `group.id === "partyType"`
// branch in FilterDropdown.tsx → EG-4 fails; drop the sort in
// groupEventTypeOptions → EG-1 fails; drop `|| selected.includes(option.id)`
// → EG-3 fails.
import { assert, assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { PARTY_TYPES } from "../../../constants/eventTaxonomy.ts";
import { groupEventTypeOptions, visibleEventTypeOptions } from "../eventTypeGroups.ts";

// The server sends options in its own array order (the 15 old slugs first).
const serverOrder = ["birthday-party", "rooftop-party", "club-night", "corporate-event", "networking-event",
  "rave", "festival", "exhibition", "opening", "talk", "workshop", "screening", "class", "kids-family",
  "market", "tour", "performance", "tasting", "pool-party", "brand-new-type"];
const options = serverOrder.map((id, i) => ({ id, count: i }));

Deno.test("EG-1 two groups in the Host wizard's order", () => {
  const groups = groupEventTypeOptions(options, PARTY_TYPES);
  assertEquals(groups.map((g) => g.id), ["party", "culture"]);
  assertEquals(groups[0].options.map((o) => o.id), ["birthday-party", "club-night", "rooftop-party", "festival", "pool-party", "rave"]);
  assertEquals(groups[1].options.slice(0, 4).map((o) => o.id), ["exhibition", "opening", "talk", "workshop"]);
  assert(groups[1].options.some((o) => o.id === "networking-event"));
  assert(groups[1].options.some((o) => o.id === "corporate-event"));
});

Deno.test("EG-2 an unknown slug from a newer server is kept (last group), not dropped", () => {
  const groups = groupEventTypeOptions(options, PARTY_TYPES);
  assertEquals(groups[1].options.at(-1)?.id, "brand-new-type");
});

Deno.test("EG-3 six chips until expanded, and a picked chip never hides", () => {
  const culture = groupEventTypeOptions(options, PARTY_TYPES)[1];
  assertEquals(visibleEventTypeOptions(culture, false, []).length, 6);
  const withPick = visibleEventTypeOptions(culture, false, ["tasting"]);
  assertEquals(withPick.length, 7);
  assert(withPick.some((o) => o.id === "tasting"));
  assertEquals(visibleEventTypeOptions(culture, true, []).length, culture.options.length);
});

Deno.test("EG-4 the filter sheet renders Event type through the groups", () => {
  const sheet = Deno.readTextFileSync(new URL("../FilterDropdown.tsx", import.meta.url));
  assert(sheet.includes('group.id === "partyType" ?'));
  assert(sheet.includes("groupEventTypeOptions(group.options, PARTY_TYPES)"));
  assert(sheet.includes('"group.event_type_parties"') && sheet.includes('"group.event_type_culture"'));
});

Deno.test("EG-5 the canonical list has 26 types in two groups of 13", () => {
  assertEquals(PARTY_TYPES.length, 26);
  assertEquals(PARTY_TYPES.filter((p) => p.group === "party").length, 13);
  assertEquals(new Set(PARTY_TYPES.map((p) => p.slug)).size, 26);
});
