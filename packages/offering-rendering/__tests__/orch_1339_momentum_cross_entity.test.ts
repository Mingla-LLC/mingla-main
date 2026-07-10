// ORCH-1339 [momentum-card-cross-entity] — implementor-owned happy-path
// regression suite (SPEC §7 T-1 derivation table, T-4 body mounts, T-5 RSVP
// gate wiring; SPEC §9 structural safeguard). Deno-runnable:
// socialProofMomentum.ts is pure + dep-free, and the component/mount
// invariants are enforced as SOURCE-STRUCTURE assertions (the package has no
// react-native-testing-library).
//
// FAILS-ON-REVERT (proven by true line-deletion in the implementation report):
//   - delete a body mount (the <OfferingMomentum …/> block in any of the three
//     bodies) → the T-4 mount/order assertions FAIL.
//   - delete the `hideRemainingCount ? null : capacity` gate or the
//     `!privateGuestList` cluster condition in RsvpMomentumDecision → T-5 FAILS.
//   - delete the goingCount=0 invisibility guard or an entity copy row in
//     deriveSocialProofMomentum → T-1 expectations flip.

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { deriveSocialProofMomentum } from "../socialProofMomentum.ts";
import { deriveMomentum, RSVP_CLUSTER_SHOWN } from "../rsvpMomentum.ts";

const read = (rel: string): Promise<string> =>
  Deno.readTextFile(new URL(rel, import.meta.url));

const EVENT_BODY = await read("../EventOfferingBody.tsx");
const TRIP_BODY = await read("../TripOfferingBody.tsx");
const EXP_BODY = await read("../ExperienceOfferingBody.tsx");
const RSVP_UNIT = await read("../RsvpMomentumDecision.tsx");
const RSVP_BODY = await read("../RsvpOfferingBody.tsx");
const BARREL = await read("../index.ts");

// ───────────────────────── T-1 — derivation copy table ─────────────────────

Deno.test("T-1: zero going → invisible for ALL three entities (rule 9 — no 'be the first' fabrication)", () => {
  for (const entityType of ["event", "trip", "experience"] as const) {
    const m = deriveSocialProofMomentum({
      entityType,
      goingCount: 0,
      capacity: 50,
      hideRemainingCount: false,
    });
    assertEquals(m.visible, false, `${entityType} at 0 must be invisible`);
  }
});

Deno.test("T-1: event copy — going / spots-left / Sold out / are pulling up", () => {
  const open = deriveSocialProofMomentum({
    entityType: "event",
    goingCount: 12,
    capacity: 50,
    hideRemainingCount: false,
  });
  assertEquals(open.visible, true);
  assertEquals(open.countLabel, "going");
  assertEquals(open.subLabel, "38 spots left · filling up");
  assertEquals(open.meterPercent, 24);
  assertEquals(open.clusterNote, "are pulling up");

  const full = deriveSocialProofMomentum({
    entityType: "event",
    goingCount: 50,
    capacity: 50,
    hideRemainingCount: false,
  });
  assertEquals(full.subLabel, "Sold out");
  assertEquals(full.meterPercent, 100);
});

Deno.test("T-1: trip copy — going / Trip full / are on this trip", () => {
  const m = deriveSocialProofMomentum({
    entityType: "trip",
    goingCount: 4,
    capacity: 10,
    hideRemainingCount: false,
  });
  assertEquals(m.countLabel, "going");
  assertEquals(m.clusterNote, "are on this trip");
  const full = deriveSocialProofMomentum({
    entityType: "trip",
    goingCount: 10,
    capacity: 10,
    hideRemainingCount: false,
  });
  assertEquals(full.subLabel, "Trip full");
});

Deno.test("T-1: experience copy — booked / Fully booked / have booked this", () => {
  const m = deriveSocialProofMomentum({
    entityType: "experience",
    goingCount: 6,
    capacity: 20,
    hideRemainingCount: false,
  });
  assertEquals(m.countLabel, "booked");
  assertEquals(m.clusterNote, "have booked this");
  const full = deriveSocialProofMomentum({
    entityType: "experience",
    goingCount: 20,
    capacity: 20,
    hideRemainingCount: false,
  });
  assertEquals(full.subLabel, "Fully booked");
});

Deno.test("T-1: capacity null OR hideRemainingCount → sub-line OMITTED (null) + fixed 18 fill; count kept", () => {
  const unlimited = deriveSocialProofMomentum({
    entityType: "event",
    goingCount: 9,
    capacity: null,
    hideRemainingCount: false,
  });
  assertEquals(unlimited.visible, true);
  assertEquals(unlimited.subLabel, null);
  assertEquals(unlimited.meterPercent, 18);

  // D2 — hidden scarcity behaves EXACTLY like null capacity for display.
  const hidden = deriveSocialProofMomentum({
    entityType: "trip",
    goingCount: 9,
    capacity: 10,
    hideRemainingCount: true,
  });
  assertEquals(hidden.visible, true);
  assertEquals(hidden.subLabel, null);
  assertEquals(hidden.meterPercent, 18);
});

Deno.test("T-1: singular '1 spot left' + 'filling fast' at ≥80% (byte-parity with rsvpMomentum)", () => {
  const one = deriveSocialProofMomentum({
    entityType: "event",
    goingCount: 49,
    capacity: 50,
    hideRemainingCount: false,
  });
  assertEquals(one.subLabel, "1 spot left · filling fast");
  const fast = deriveSocialProofMomentum({
    entityType: "experience",
    goingCount: 8,
    capacity: 10,
    hideRemainingCount: false,
  });
  assertEquals(fast.subLabel, "2 spots left · filling fast");
  assertEquals(fast.meterPercent, 80);
});

Deno.test("T-1: cluster constant BYTE-PARITY with RSVP_CLUSTER_SHOWN (the local CLUSTER_SHOWN mirrors it)", () => {
  // socialProofMomentum keeps its own dep-free constant; pin it to the RSVP
  // owner's value so the two clusters can never silently diverge.
  const m = deriveSocialProofMomentum({
    entityType: "event",
    goingCount: RSVP_CLUSTER_SHOWN + 10,
    capacity: null,
    hideRemainingCount: false,
  });
  assertEquals(m.shownGlyphs, RSVP_CLUSTER_SHOWN);
  assertEquals(m.overflowCount, 10);
  // And the RSVP derivation agrees on the same sizing for the same count.
  const r = deriveMomentum(RSVP_CLUSTER_SHOWN + 10, null);
  assertEquals(r.shownAvatars, RSVP_CLUSTER_SHOWN);
  assertEquals(r.overflowCount, 10);
});

Deno.test("T-1: cluster sizing — shown = min(3, going), overflow = going − 3", () => {
  const two = deriveSocialProofMomentum({
    entityType: "event",
    goingCount: 2,
    capacity: null,
    hideRemainingCount: false,
  });
  assertEquals(two.shownGlyphs, 2);
  assertEquals(two.overflowCount, 0);
  const many = deriveSocialProofMomentum({
    entityType: "event",
    goingCount: 47,
    capacity: null,
    hideRemainingCount: false,
  });
  assertEquals(many.shownGlyphs, 3);
  assertEquals(many.overflowCount, 44);
});

// ───────────────────────── T-4 — body mounts + order ───────────────────────

Deno.test("T-4: EventOfferingBody mounts orch-1339-momentum-event BETWEEN §4 pills and the §5 ticket box", () => {
  assertStringIncludes(EVENT_BODY, 'testID="orch-1339-momentum-event"');
  assertStringIncludes(EVENT_BODY, "socialProof?: SocialProofSummary | null");
  const pills = EVENT_BODY.indexOf('testID="orch-1167-pills-row"');
  const momentum = EVENT_BODY.indexOf('testID="orch-1339-momentum-event"');
  // The §5 render gate (NOT the header prose that also mentions EventTicketBox).
  const box = EVENT_BODY.indexOf("{hideTicketBox ? null : (");
  assert(pills > -1 && momentum > -1 && box > -1, "all three anchors exist");
  assert(pills < momentum, "momentum sits AFTER the pills row");
  assert(momentum < box, "momentum sits BEFORE the ticket box (decision stays the hero)");
});

Deno.test("T-4: TripOfferingBody mounts orch-1339-momentum-trip BETWEEN §4 meta pills and §5 Presented-By", () => {
  assertStringIncludes(TRIP_BODY, 'testID="orch-1339-momentum-trip"');
  assertStringIncludes(TRIP_BODY, "socialProof?: SocialProofSummary | null");
  const pills = TRIP_BODY.indexOf('testID="trip-body-meta-pills"');
  const momentum = TRIP_BODY.indexOf('testID="orch-1339-momentum-trip"');
  const presented = TRIP_BODY.indexOf('testID="trip-body-presented-by"');
  assert(pills > -1 && momentum > -1 && presented > -1, "all three anchors exist");
  assert(pills < momentum, "momentum sits AFTER the meta pills");
  assert(momentum < presented, "momentum sits BEFORE Presented-By");
});

Deno.test("T-4: ExperienceOfferingBody mounts orch-1339-momentum-experience AFTER the state banner, BEFORE §5 Presented-By", () => {
  assertStringIncludes(EXP_BODY, 'testID="orch-1339-momentum-experience"');
  assertStringIncludes(EXP_BODY, "socialProof?: SocialProofSummary | null");
  const vibes = EXP_BODY.indexOf('testID="experience-body-vibes"');
  const banner = EXP_BODY.indexOf('testID="experience-body-state-banner"');
  const momentum = EXP_BODY.indexOf('testID="orch-1339-momentum-experience"');
  const presented = EXP_BODY.indexOf('testID="experience-body-presented-by"');
  assert(vibes > -1 && banner > -1 && momentum > -1 && presented > -1);
  assert(vibes < momentum, "momentum sits AFTER the vibe chips");
  assert(banner < momentum, "the state banner stays ABOVE momentum");
  assert(momentum < presented, "momentum sits BEFORE Presented-By");
});

Deno.test("T-4: each mount is null-gated (honest absence — no unit without a payload)", () => {
  for (const [name, src] of [
    ["event", EVENT_BODY],
    ["trip", TRIP_BODY],
    ["experience", EXP_BODY],
  ] as const) {
    assert(
      /\{socialProof \? \(/.test(src),
      `${name} body renders the momentum ONLY behind the socialProof null-gate`,
    );
    assertStringIncludes(src, "socialProof = null", `${name} body defaults the prop to null`);
  }
});

// ───────────────────────── T-5 — RSVP gate wiring (D2) ─────────────────────

Deno.test("T-5: RsvpMomentumDecision derives with a null DISPLAY capacity under hideRemainingCount", () => {
  assertStringIncludes(
    RSVP_UNIT,
    "deriveMomentum(goingCount, hideRemainingCount ? null : capacity)",
  );
});

Deno.test("T-5: RsvpMomentumDecision suppresses the cluster under privateGuestList", () => {
  assertStringIncludes(RSVP_UNIT, "momentum.hasGoing && !privateGuestList ?");
  // Both gates are optional props defaulting to false (back-compat surfaces).
  assertStringIncludes(RSVP_UNIT, "privateGuestList = false");
  assertStringIncludes(RSVP_UNIT, "hideRemainingCount = false");
});

Deno.test("T-5: RsvpOfferingConfig carries the two gates and DecisionUnit forwards them", () => {
  assertStringIncludes(RSVP_BODY, "privateGuestList?: boolean");
  assertStringIncludes(RSVP_BODY, "hideRemainingCount?: boolean");
  assertStringIncludes(RSVP_BODY, "privateGuestList={config.privateGuestList ?? false}");
  assertStringIncludes(RSVP_BODY, "hideRemainingCount={config.hideRemainingCount ?? false}");
});

// ───────────────────────── barrel exports ──────────────────────────────────

Deno.test("barrel exports the momentum unit + derivation + model type", () => {
  assertStringIncludes(BARREL, 'export { OfferingMomentum } from "./OfferingMomentum"');
  assertStringIncludes(
    BARREL,
    'export { deriveSocialProofMomentum } from "./socialProofMomentum"',
  );
  assertStringIncludes(
    BARREL,
    'export type { SocialProofMomentumModel } from "./socialProofMomentum"',
  );
});
