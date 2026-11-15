// MINGLA-INVARIANT: I-4420-EXPERIENCE-ONE-RESERVE-MODEL | issue #4420 | The experience Reserve sheet and the inline "Book a time" picker share ONE reservation model (experienceReserveModel.ts via useExperienceReserveState): the same defaults, party caps, totals and the byte-identical checkout hand-off (slots → quantity 1; person → quantity = party; group / block → one unit + partySize). Neither picker re-implements the rules.
// issue #4420 — implementor regression for the shared experience model.
//
// FAILS-ON-REVERT:
//   - change any hand-off shape in buildExperienceReserveSelection → S-1..S-4;
//   - drop the group cap or the remaining clamp in experiencePartyMax → P-1/P-2;
//   - stop grouping occurrences by the experience-zone day → D-1/D-2;
//   - put the slot RPC back inside the business sheet (a second copy of the
//     rules) or drop the shared hook from either picker → W-1/W-2.

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  EXPERIENCE_MAX_PARTY,
  buildExperienceReserveSelection,
  experienceActiveUnitCents,
  experiencePartyMax,
  experienceReserveDays,
  experienceReserveTotal,
  parseSlotAvailability,
  slotRemainingByWallMinute,
  wallMinuteInZone,
} from "../experienceReserveModel.ts";

const read = (rel: string): string =>
  Deno.readTextFileSync(new URL(rel, import.meta.url));

const person = {
  ticketTypeId: "tt-person",
  name: "Paddle",
  priceCents: 1500000,
  priceAllInCents: 1550000,
  currency: "NGN",
  isFree: false,
  isUnlimited: false,
  ticketsRemaining: 20,
  quantityTotal: 40,
};

// 10:00–18:00 Lagos (UTC+1) on 2030-06-01.
const day = {
  id: "d-1",
  startAt: "2030-06-01T09:00:00.000Z",
  endAt: "2030-06-01T17:00:00.000Z",
  ticketsRemaining: 8,
};

Deno.test("S-1 slots: one unit on the chosen occurrence, option id kept", () => {
  const sel = buildExperienceReserveSelection({
    mode: "slots",
    date: day,
    timezone: "Africa/Lagos",
    spacingMinutes: 30,
    minute: null,
    blocks: null,
    party: 4,
    option: person,
  });
  assertEquals(sel, { eventDateId: "d-1", quantity: 1, ticketTypeId: "tt-person" });
});

Deno.test("S-2 slots: a sold-out occurrence cannot be handed off", () => {
  const sel = buildExperienceReserveSelection({
    mode: "slots",
    date: { ...day, ticketsRemaining: 0 },
    timezone: "Africa/Lagos",
    spacingMinutes: 30,
    minute: null,
    blocks: null,
    party: 1,
    option: null,
  });
  assertEquals(sel, null);
});

Deno.test("S-3 open daily person: quantity = party, start in the experience zone", () => {
  const sel = buildExperienceReserveSelection({
    mode: "open-daily",
    date: day,
    timezone: "Africa/Lagos",
    spacingMinutes: 30,
    minute: 11 * 60,
    blocks: null,
    party: 3,
    option: person,
  });
  assertEquals(sel, {
    eventDateId: "d-1",
    quantity: 3,
    startAt: "2030-06-01T10:00:00.000Z",
    partySize: 3,
    ticketTypeId: "tt-person",
  });
  // No time chosen → nothing to hand off.
  assertEquals(
    buildExperienceReserveSelection({
      mode: "open-daily",
      date: day,
      timezone: "Africa/Lagos",
      spacingMinutes: 30,
      minute: null,
      blocks: null,
      party: 3,
      option: person,
    }),
    null,
  );
});

Deno.test("S-4 open daily block: one unit, end = start + blocks × length", () => {
  const block = { ...person, ticketTypeId: "tt-block", priceBasis: "block" as const, blockMinutes: 60, minBlocks: 1, maxBlocks: 3 };
  const sel = buildExperienceReserveSelection({
    mode: "open-daily",
    date: day,
    timezone: "Africa/Lagos",
    spacingMinutes: 30,
    minute: 12 * 60,
    blocks: 2,
    party: 5,
    option: block,
  });
  assertEquals(sel, {
    eventDateId: "d-1",
    quantity: 1,
    startAt: "2030-06-01T11:00:00.000Z",
    partySize: 5,
    ticketTypeId: "tt-block",
    bookedEndAt: "2030-06-01T13:00:00.000Z",
  });
  // A block option with no length chosen is incomplete.
  assertEquals(
    buildExperienceReserveSelection({
      mode: "open-daily",
      date: day,
      timezone: "Africa/Lagos",
      spacingMinutes: 30,
      minute: 12 * 60,
      blocks: null,
      party: 5,
      option: block,
    }),
    null,
  );
});

Deno.test("P-1 party cap: group max, else 12", () => {
  assertEquals(experiencePartyMax({ option: null, eventRemaining: null, slotRemaining: null }), EXPERIENCE_MAX_PARTY);
  const group = { ...person, priceBasis: "group" as const, groupMax: 6, ticketsRemaining: null };
  assertEquals(experiencePartyMax({ option: group, eventRemaining: null, slotRemaining: null }), 6);
});

Deno.test("P-2 party cap: live spots clamp it, never below 1", () => {
  assertEquals(experiencePartyMax({ option: person, eventRemaining: null, slotRemaining: 3 }), 3);
  assertEquals(experiencePartyMax({ option: { ...person, ticketsRemaining: 5 }, eventRemaining: null, slotRemaining: null }), 5);
  assertEquals(experiencePartyMax({ option: person, eventRemaining: null, slotRemaining: 0 }), 1);
});

Deno.test("T-1 total: all-in unit × people (person), × blocks (block), unknown → null", () => {
  const unit = experienceActiveUnitCents(person, null);
  assertEquals(unit, 1550000);
  const t = experienceReserveTotal({ unitCents: unit, currency: "NGN", isBlock: false, isGroup: false, blocks: null, party: 2 });
  assert(t !== null && t.includes("₦"), `naira glyph: ${t}`);
  assertStringIncludes(t ?? "", "31,000");
  assertEquals(experienceReserveTotal({ unitCents: null, currency: "NGN", isBlock: false, isGroup: false, blocks: null, party: 2 }), null);
  assertEquals(experienceReserveTotal({ unitCents: 1000, currency: "", isBlock: false, isGroup: false, blocks: null, party: 2 }), null);
});

Deno.test("D-1 days group by the experience-zone calendar day", () => {
  const days = experienceReserveDays(
    [
      { id: "a", startAt: "2030-06-01T08:00:00.000Z", endAt: "2030-06-01T09:00:00.000Z", ticketsRemaining: 2 },
      { id: "b", startAt: "2030-06-01T16:00:00.000Z", endAt: "2030-06-01T17:00:00.000Z", ticketsRemaining: 0 },
      // 23:30 UTC on 1 June is 00:30 on 2 June in Lagos.
      { id: "c", startAt: "2030-06-01T23:30:00.000Z", endAt: "2030-06-02T00:30:00.000Z", ticketsRemaining: null },
    ],
    "Africa/Lagos",
    "en-GB",
  );
  assertEquals(days.map((d) => d.key), ["2030-06-01", "2030-06-02"]);
  assertEquals(days[0].dates.map((d) => d.id), ["a", "b"]);
  assertEquals(days[0].full, false);
  assertEquals(days[1].dayNumber, "2");
});

Deno.test("D-2 a day is full only when every occurrence on it is sold out", () => {
  const days = experienceReserveDays(
    [
      { id: "a", startAt: "2030-06-03T08:00:00.000Z", endAt: "2030-06-03T09:00:00.000Z", ticketsRemaining: 0 },
      { id: "b", startAt: "2030-06-03T10:00:00.000Z", endAt: "2030-06-03T11:00:00.000Z", ticketsRemaining: 0 },
    ],
    "UTC",
  );
  assertEquals(days.length, 1);
  assertEquals(days[0].full, true);
});

Deno.test("R-1 slot payload: malformed → null, rows keyed by wall minute", () => {
  assertEquals(parseSlotAvailability(null), null);
  assertEquals(parseSlotAvailability({ slots: "x" }), null);
  const rows = parseSlotAvailability({
    slots: [
      { startAt: "2030-06-01T10:00:00.000Z", remaining: 4 },
      { startAt: "2030-06-01T10:30:00.000Z", remaining: "n/a" },
      { remaining: 2 },
    ],
  });
  assertEquals(rows?.length, 2);
  const map = slotRemainingByWallMinute(rows ?? [], "Africa/Lagos");
  assertEquals(map.get(11 * 60), 4);
  assertEquals(map.get(11 * 60 + 30), null);
  assertEquals(wallMinuteInZone("not a date", "UTC"), null);
});

Deno.test("W-1 the business sheet reads the shared hook, not its own copy", () => {
  const sheet = read("../../../mingla-business/src/components/experience/ExperienceReservePicker.tsx");
  assertStringIncludes(sheet, "useExperienceReserveState(");
  assert(!sheet.includes("experienceTimeChoices("), "no private time grid in the sheet");
  assert(!sheet.includes("function wallMinuteInZone"), "no private zone helper in the sheet");
  assert(!sheet.includes("useState<number>(2)"), "no private party state in the sheet");
});

Deno.test("W-2 the public route drives the inline picker and the bar from one state", () => {
  const route = read("../../../mingla-business/app/exp/[brandSlug]/[experienceSlug].tsx");
  assertStringIncludes(route, "useExperienceReserveState(");
  assertStringIncludes(route, "<ExperienceInlinePicker");
  assertStringIncludes(route, "state={inlineReserve}");
  assertStringIncludes(route, "goToCart(inlineSelection)");
  const picker = read("../ExperienceInlinePicker.tsx");
  assert(!picker.includes("supabase"), "the package picker never reaches a data client");
  assert(!picker.includes("useState<number | null>(null)"), "no private minute state in the inline picker");
});
