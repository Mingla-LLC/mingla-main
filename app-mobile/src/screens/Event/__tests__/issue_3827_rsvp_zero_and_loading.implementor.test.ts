// issue #3827 going-box — Explorer: no fabricated 0, no empty box, honest header.
// Runs under the META-ORCH-1337 Deno lane (same lane as orch_1342_cold_seed_landing).
//
// A-M1 rsvpConfig.goingCount is null while the momentum read is loading and when it
//      resolves null (missing row / private) — never `?? 0`
// A-M2 the social-proof impression fires for real 0 + extras > 0 (box visible), but
//      the guest-list auto-open needs somebody REAL (trip, experience and event)
// A-M3 rsvpDeckService maps rsvp_going_count NULL to null and reads the two new
//      columns, with a fallback for a server that predates them
// A-M4 the sheet header adds and discloses the host's own-list guests; the tail
//      stays on the real count
//
// FAILS-ON-REVERT: restore `rsvpMomentum?.goingCount ?? 0` -> A-M1 fails; restore
// `row.rsvp_going_count ?? 0` -> A-M3a fails; drop the extras from the impression
// gate -> A-M2a fails; revert the header helper -> A-M4 fails.

import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";

import { guestSheetHeaderSubtitle } from "../../../components/guestSheetHeaderCopy.ts";

const read = (rel: string): string => Deno.readTextFileSync(new URL(rel, import.meta.url));

const EVENT = read("../ConsumerEventDetailScreen.tsx");
const TRIP = read("../../Trip/ConsumerTripDetailScreen.tsx");
const EXP = read("../../Experience/ConsumerExperienceDetailScreen.tsx");
const DECK = read("../../../services/rsvpDeckService.ts");
const SHEET = read("../../../components/EventGuestListSheet.tsx");

Deno.test("A-M1 the RSVP count is null while loading / missing / private — never a fabricated 0", () => {
  assertStringIncludes(EVENT, "goingCount: rsvpMomentum ? rsvpMomentum.goingCount : null,");
  assert(!EVENT.includes("goingCount: rsvpMomentum?.goingCount ?? 0,"), "the `?? 0` fallback is back");
  assertStringIncludes(EVENT, "rsvpMomentum?.extraGuestCount ?? socialProofQuery.data?.extraGuestCount ?? 0");
  assertStringIncludes(EVENT, "capacityFull: rsvpMomentum?.capacityFull ?? socialProofQuery.data?.capacityFull,");
});

Deno.test("A-M2 impression = box visible (extras count); auto-open = somebody real", () => {
  for (const [name, src] of [["event", EVENT], ["trip", TRIP], ["experience", EXP]] as const) {
    assertStringIncludes(src, "proof.goingCount === null ||", `${name}: impression null-safe`);
    assertStringIncludes(
      src,
      "proof.goingCount + (proof.extraGuestCount ?? 0) <= 0) return;",
      `${name}: impression counts the host's own-list guests`,
    );
    assertStringIncludes(src, "sp.goingCount !== null &&\n      sp.goingCount > 0", `${name}: auto-open needs real > 0`);
  }
});

Deno.test("A-M3 rsvpDeckService: NULL stays null; new columns read; old servers fall back", () => {
  assertStringIncludes(
    DECK,
    'goingCount: typeof row.rsvp_going_count === "number" ? row.rsvp_going_count : null,',
  );
  assert(!DECK.includes("goingCount: row.rsvp_going_count ?? 0"), "the `?? 0` fallback is back");
  assertStringIncludes(DECK, 'const RSVP_MOMENTUM_3827_COLUMNS = "rsvp_capacity_full,extra_guest_count";');
  assertStringIncludes(DECK, 'error.code === "42703"');
  assertStringIncludes(DECK, "({ data, error } = await select(RSVP_MOMENTUM_COLUMNS));");
});

Deno.test("A-M4 sheet header: R+X going · X on the host's list; tail stays on R", () => {
  assertEquals(guestSheetHeaderSubtitle(5, 0, 0), "5 going");
  assertEquals(guestSheetHeaderSubtitle(5, 0, 2), "5 going · 2 keep it private");
  assertEquals(guestSheetHeaderSubtitle(10, 42, 0), "52 going · 42 on the host's list");
  assertEquals(guestSheetHeaderSubtitle(10, 42, 3), "52 going · 42 on the host's list · 3 keep it private");
  assertEquals(guestSheetHeaderSubtitle(3, -4, 0), "3 going");
  assertEquals(guestSheetHeaderSubtitle(3, Number.NaN, 0), "3 going");
  assertStringIncludes(SHEET, "guestSheetHeaderSubtitle(\n    goingCount,\n    extraGuestCount,");
  // The "and N more" tail still reads the REAL count prop, never the sum.
  assert(!/goingCount \+ extraGuestCount/.test(SHEET), "the sheet adds extras itself");
  for (const [name, src] of [["event", EVENT], ["trip", TRIP], ["experience", EXP]] as const) {
    assertStringIncludes(src, "extraGuestCount={", `${name} passes extras to the sheet`);
  }
});
