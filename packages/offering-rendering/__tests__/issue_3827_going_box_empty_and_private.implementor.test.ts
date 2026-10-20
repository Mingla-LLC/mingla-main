// MINGLA-INVARIANT: I-3827-NO-EMPTY-GOING-BOX | issue #3827 | No buyer surface or host preview renders a going box for a private list, a withheld count, or a display count of 0; faces and "See who's going" need somebody real; the meter is never an empty track beside a shown capacity.
// issue #3827 going-box — implementor happy-path proof of the two derivations
// (amendment §3.1, §3.2, §5.2, §5.3) and the component gates that use them.
// Deno-runnable: socialProofMomentum.ts and rsvpMomentum.ts are pure.
//
// A-D1  family A (ticketed / trip / experience): every row of the truth table
// A-D2  family B (RSVP): every row through deriveMomentum + rsvpMomentumSubLabel +
//       rsvpCapacityChipLabel, exact strings
// A-D3  back-compat: the 2-argument calls are byte-identical to before
// A-D4  the capacity chip never depends on how many are going
// T-D*  base spec §7 cases (private, null, extras-only, real+extras, sold out,
//       hidden capacity, never "Be the first" with extras, bad input)
// G-*   the component gates that turn the model into "no box"
//
// FAILS-ON-REVERT: delete the private/null guard in deriveSocialProofMomentum ->
// T-D1/T-D2 fail; fold extras into the meter math -> T-D4 fails; drop showMeter ->
// A-D1 extras-only rows fail; fold extras into hasGoing -> A-D2 "no cluster" fails;
// remove `unitVisible` from RsvpMomentumDecision -> G-2 fails.

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { deriveSocialProofMomentum } from "../socialProofMomentum.ts";
import {
  deriveMomentum,
  rsvpCapacityChipLabel,
  rsvpMomentumSubLabel,
} from "../rsvpMomentum.ts";

const read = (rel: string): string =>
  Deno.readTextFileSync(new URL(rel, import.meta.url));

type EntityType = "event" | "trip" | "experience";

const proof = (
  goingCount: number | null,
  extraGuestCount: number,
  capacity: number | null,
  opts: { privateGuestList?: boolean; hideRemainingCount?: boolean; entityType?: EntityType } = {},
) =>
  deriveSocialProofMomentum({
    entityType: opts.entityType ?? "event",
    goingCount,
    capacity,
    hideRemainingCount: opts.hideRemainingCount ?? false,
    privateGuestList: opts.privateGuestList ?? false,
    extraGuestCount,
  });

// ── base spec T-D1..T-D8 ─────────────────────────────────────────────────────

Deno.test("T-D1 private → invisible (no box), whatever the counts", () => {
  for (const r of [0, 4, 50]) {
    for (const x of [0, 40]) {
      assertEquals(proof(r, x, 50, { privateGuestList: true }).visible, false);
    }
  }
});

Deno.test("T-D2 goingCount null (withheld) → invisible, never a 0", () => {
  assertEquals(proof(null, 0, 50).visible, false);
  assertEquals(proof(null, 40, 50).visible, false);
});

Deno.test("T-D3 real 0, extras 40, capacity 50 → 40 going, '50 spots left', no meter, no faces", () => {
  const m = proof(0, 40, 50);
  assertEquals(m.visible, true);
  assertEquals(m.displayCount, 40);
  assertEquals(m.subLabel, "50 spots left");
  assertEquals(m.meterPercent, 0);
  assertEquals(m.showMeter, false);
  assertEquals(m.showCluster, false);
  assertEquals(m.shownGlyphs, 0);
  assertEquals(m.overflowCount, 0);
});

Deno.test("T-D4 real 10, extras 42, capacity 50 → 52 going, '40 spots left · filling up', meter 20 (REAL only)", () => {
  const m = proof(10, 42, 50);
  assertEquals(m.displayCount, 52);
  assertEquals(m.subLabel, "40 spots left · filling up");
  assertEquals(m.meterPercent, 20);
  assertEquals(m.showCluster, true);
  assertEquals(m.shownGlyphs, 3);
  assertEquals(m.overflowCount, 49);
});

Deno.test("T-D5 real 50 of 50, extras 10 → 'Sold out', meter 100, 60 going", () => {
  const m = proof(50, 10, 50);
  assertEquals(m.subLabel, "Sold out");
  assertEquals(m.meterPercent, 100);
  assertEquals(m.displayCount, 60);
});

Deno.test("T-D6 hideRemainingCount → no sub-line, fixed 18% meter, count real + extras", () => {
  const m = proof(3, 12, 50, { hideRemainingCount: true });
  assertEquals(m.subLabel, null);
  assertEquals(m.meterPercent, 18);
  assertEquals(m.showMeter, true);
  assertEquals(m.displayCount, 15);
});

Deno.test("T-D7 RSVP: real 0 + extras 0 keeps the old 'Be the first' model; extras never say it", () => {
  assertEquals(deriveMomentum(0, 80).subLabel, "Be the first to RSVP");
  for (const cap of [80, null]) {
    const m = deriveMomentum(0, cap, 5);
    assert(!m.subLabel.includes("Be the first"), `extras-only said "${m.subLabel}"`);
    assert(!rsvpMomentumSubLabel(0, cap, { extraGuestCount: 5 }).includes("Be the first"));
  }
});

Deno.test("T-D8 negative, NaN, fractional and infinite extras read as whole numbers ≥ 0", () => {
  assertEquals(proof(0, -3, 50).visible, false);
  assertEquals(proof(0, Number.NaN, 50).visible, false);
  assertEquals(proof(0, Number.POSITIVE_INFINITY, 50).visible, false);
  assertEquals(proof(2, 3.9, 50).displayCount, 5);
  assertEquals(deriveMomentum(0, 80, -4).displayCount, 0);
  assertEquals(deriveMomentum(0, 80, Number.NaN).hasGoing, false);
});

// ── A-D1: family A truth table (amendment §3.1) ─────────────────────────────

Deno.test("A-D1 family A: every row of §3.1", () => {
  type Row = {
    p: boolean; r: number | null; x: number; shown: boolean;
    visible: boolean; count?: number; sub?: string | null; showMeter?: boolean;
    meter?: number; cluster?: boolean; glyphs?: number; overflow?: number;
  };
  const rows: Row[] = [];
  for (const r of [null, 0, 4, 50]) {
    for (const x of [0, 40]) {
      for (const shown of [true, false]) {
        rows.push({ p: true, r, x, shown, visible: false });
      }
    }
  }
  rows.push(
    { p: false, r: null, x: 0, shown: true, visible: false },
    { p: false, r: null, x: 40, shown: true, visible: false },
    { p: false, r: 0, x: 0, shown: true, visible: false },
    { p: false, r: 0, x: 0, shown: false, visible: false },
    { p: false, r: 0, x: 40, shown: true, visible: true, count: 40, sub: "50 spots left",
      showMeter: false, meter: 0, cluster: false, glyphs: 0, overflow: 0 },
    { p: false, r: 0, x: 40, shown: false, visible: true, count: 40, sub: null,
      showMeter: true, meter: 18, cluster: false, glyphs: 0, overflow: 0 },
    { p: false, r: 4, x: 0, shown: true, visible: true, count: 4, sub: "46 spots left · filling up",
      showMeter: true, meter: 8, cluster: true, glyphs: 3, overflow: 1 },
    { p: false, r: 4, x: 0, shown: false, visible: true, count: 4, sub: null,
      showMeter: true, meter: 18, cluster: true, glyphs: 3, overflow: 1 },
    { p: false, r: 50, x: 0, shown: true, visible: true, count: 50, sub: "Sold out",
      showMeter: true, meter: 100, cluster: true, glyphs: 3, overflow: 47 },
    { p: false, r: 4, x: 40, shown: true, visible: true, count: 44, sub: "46 spots left · filling up",
      showMeter: true, meter: 8, cluster: true, glyphs: 3, overflow: 41 },
    { p: false, r: 4, x: 40, shown: false, visible: true, count: 44, sub: null,
      showMeter: true, meter: 18, cluster: true, glyphs: 3, overflow: 41 },
    { p: false, r: 50, x: 40, shown: true, visible: true, count: 90, sub: "Sold out",
      showMeter: true, meter: 100, cluster: true, glyphs: 3, overflow: 87 },
  );
  for (const row of rows) {
    const label = JSON.stringify(row);
    const m = proof(row.r, row.x, 50, {
      privateGuestList: row.p,
      hideRemainingCount: !row.shown,
    });
    assertEquals(m.visible, row.visible, `visible ${label}`);
    if (!row.visible) continue;
    assertEquals(m.displayCount, row.count, `count ${label}`);
    assertEquals(m.subLabel, row.sub, `sub ${label}`);
    assertEquals(m.showMeter, row.showMeter, `showMeter ${label}`);
    assertEquals(m.meterPercent, row.meter, `meter ${label}`);
    assertEquals(m.showCluster, row.cluster, `cluster ${label}`);
    assertEquals(m.shownGlyphs, row.glyphs, `glyphs ${label}`);
    assertEquals(m.overflowCount, row.overflow, `overflow ${label}`);
  }
});

Deno.test("A-D1b per-entity nouns and full labels survive with extras", () => {
  assertEquals(proof(10, 5, 10, { entityType: "trip" }).subLabel, "Trip full");
  const exp = proof(10, 5, 10, { entityType: "experience" });
  assertEquals(exp.subLabel, "Fully booked");
  assertEquals(exp.countLabel, "booked");
  assertEquals(exp.displayCount, 15);
  assertEquals(proof(0, 1, 1).subLabel, "1 spot left");
});

// ── A-D2: family B truth table (amendment §3.2) ─────────────────────────────

Deno.test("A-D2 family B: every visible row of §3.2 (count, sub-line, meter, faces)", () => {
  type Row = { r: number; x: number; cap: number | null; waitlist: boolean;
    count: number; sub: string; showMeter: boolean; meter: number; hasGoing: boolean;
    avatars: number; overflow: number };
  const rows: Row[] = [
    { r: 0, x: 12, cap: 80, waitlist: true, count: 12, sub: "80 spots left", showMeter: false,
      meter: 0, hasGoing: false, avatars: 0, overflow: 0 },
    { r: 0, x: 12, cap: null, waitlist: true, count: 12, sub: "Open invite", showMeter: true,
      meter: 18, hasGoing: false, avatars: 0, overflow: 0 },
    { r: 3, x: 0, cap: 80, waitlist: true, count: 3, sub: "77 spots left · filling up",
      showMeter: true, meter: 4, hasGoing: true, avatars: 3, overflow: 0 },
    { r: 80, x: 0, cap: 80, waitlist: true, count: 80, sub: "Full · waitlist open",
      showMeter: true, meter: 100, hasGoing: true, avatars: 3, overflow: 77 },
    { r: 80, x: 0, cap: 80, waitlist: false, count: 80, sub: "Full", showMeter: true,
      meter: 100, hasGoing: true, avatars: 3, overflow: 77 },
    { r: 3, x: 0, cap: null, waitlist: true, count: 3, sub: "Open invite", showMeter: true,
      meter: 18, hasGoing: true, avatars: 3, overflow: 0 },
    { r: 3, x: 12, cap: 80, waitlist: true, count: 15, sub: "77 spots left · filling up",
      showMeter: true, meter: 4, hasGoing: true, avatars: 3, overflow: 12 },
    { r: 80, x: 12, cap: 80, waitlist: false, count: 92, sub: "Full", showMeter: true,
      meter: 100, hasGoing: true, avatars: 3, overflow: 89 },
    { r: 3, x: 12, cap: null, waitlist: true, count: 15, sub: "Open invite", showMeter: true,
      meter: 18, hasGoing: true, avatars: 3, overflow: 12 },
  ];
  for (const row of rows) {
    const label = JSON.stringify(row);
    const m = deriveMomentum(row.r, row.cap, row.x);
    assertEquals(m.displayCount, row.count, `count ${label}`);
    assertEquals(m.showMeter, row.showMeter, `showMeter ${label}`);
    assertEquals(m.meterPercent, row.meter, `meter ${label}`);
    assertEquals(m.hasGoing, row.hasGoing, `hasGoing (real > 0) ${label}`);
    assertEquals(m.shownAvatars, row.avatars, `avatars ${label}`);
    assertEquals(m.overflowCount, row.overflow, `overflow ${label}`);
    assertEquals(
      rsvpMomentumSubLabel(row.r, row.cap, { waitlistEnabled: row.waitlist, extraGuestCount: row.x }),
      row.sub,
      `sub ${label}`,
    );
  }
});

Deno.test("A-D2b the capacity chip: full + waitlist, full, N spots, 1 spot, none", () => {
  assertEquals(rsvpCapacityChipLabel({ displayCapacity: 80, capacityFull: true, waitlistEnabled: true }), "Full · waitlist open");
  assertEquals(rsvpCapacityChipLabel({ displayCapacity: 80, capacityFull: true, waitlistEnabled: false }), "Full");
  assertEquals(rsvpCapacityChipLabel({ displayCapacity: null, capacityFull: true, waitlistEnabled: false }), "Full");
  assertEquals(rsvpCapacityChipLabel({ displayCapacity: 80, capacityFull: false, waitlistEnabled: true }), "80 spots");
  assertEquals(rsvpCapacityChipLabel({ displayCapacity: 1, capacityFull: false, waitlistEnabled: false }), "1 spot");
  assertEquals(rsvpCapacityChipLabel({ displayCapacity: null, capacityFull: false, waitlistEnabled: true }), null);
  assertEquals(rsvpCapacityChipLabel({ displayCapacity: 0, capacityFull: false, waitlistEnabled: true }), null);
});

// ── A-D3 / A-D4 ──────────────────────────────────────────────────────────────

Deno.test("A-D3 back-compat: the 2-argument calls are unchanged", () => {
  assertEquals(deriveMomentum(0, 80).subLabel, "Be the first to RSVP");
  assertEquals(rsvpMomentumSubLabel(0, 80), "Be the first to RSVP · 80 spots");
  assertEquals(rsvpMomentumSubLabel(0, null), "Be the first to RSVP");
  assertEquals(deriveMomentum(12, 20).subLabel, "8 spots left · filling up");
  assertEquals(deriveMomentum(12, 20).displayCount, 12);
  assertEquals(rsvpMomentumSubLabel(20, 20, { waitlistEnabled: false }), "Full");
});

Deno.test("A-D4 the chip carries no going count: same inputs, any real count, same chip", () => {
  for (const full of [true, false]) {
    for (const waitlist of [true, false]) {
      for (const cap of [80, 1, null]) {
        const input = { displayCapacity: cap, capacityFull: full, waitlistEnabled: waitlist };
        const label = rsvpCapacityChipLabel(input);
        assert(label === null || !/going/.test(label), `chip mentions going: ${label}`);
        // The helper takes no count at all — the type itself is the proof; pin it.
        assertEquals(Object.keys(input).sort(), ["capacityFull", "displayCapacity", "waitlistEnabled"]);
      }
    }
  }
});

// ── G-*: component gates ─────────────────────────────────────────────────────

const OFFERING = read("../OfferingMomentum.tsx");
const RSVP_UNIT = read("../RsvpMomentumDecision.tsx");
const RSVP_BODY = read("../RsvpOfferingBody.tsx");

Deno.test("G-1 OfferingMomentum returns nothing for private or a withheld count, and renders the display count", () => {
  assertStringIncludes(OFFERING, "socialProof.privateGuestList === true ||");
  assertStringIncludes(OFFERING, "socialProof.goingCount === null");
  assertStringIncludes(OFFERING, "{momentum.displayCount}");
  assertStringIncludes(OFFERING, "{momentum.showMeter ? (");
  assertStringIncludes(OFFERING, "momentum.showCluster ? (");
  // The old render of the raw server count is gone.
  assert(!OFFERING.includes("{socialProof.goingCount}"), "raw goingCount still rendered");
});

Deno.test("G-2 RsvpMomentumDecision mounts the unit only when visible, else the capacity chip", () => {
  assertStringIncludes(
    RSVP_UNIT,
    "!privateGuestList && goingCount !== null && momentum.displayCount > 0",
  );
  assertStringIncludes(RSVP_UNIT, "{showMomentum && unitVisible ? momentumUnit : null}");
  assertStringIncludes(RSVP_UNIT, 'testID="issue-3827-rsvp-capacity-chip"');
  assertStringIncludes(RSVP_UNIT, "const capacityChipLabel = unitVisible");
  // The cluster gate keeps meaning "somebody real" (pinned elsewhere too).
  assertStringIncludes(RSVP_UNIT, "momentum.hasGoing && !privateGuestList ?");
  assert(!RSVP_UNIT.includes("{momentum.hasGoing ? goingCount : 0}"), "the '0 going' render is back");
});

Deno.test("G-3 RsvpOfferingBody: server full flag first; a null count is never full by itself", () => {
  assertStringIncludes(RSVP_BODY, "config.capacityFull ??");
  assertStringIncludes(RSVP_BODY, "config.goingCount !== null &&");
  assertStringIncludes(RSVP_BODY, "extraGuestCount={config.extraGuestCount ?? 0}");
  assertStringIncludes(RSVP_BODY, "capacityFull={state.capacityFull}");
});

Deno.test("G-4 extras never reach the CTA state machine or checkout contracts", () => {
  for (const file of ["../offeringCta.ts", "../ticketCheckoutContract.ts", "../ticketCheckoutServerContract.ts"]) {
    assert(!read(file).includes("extraGuestCount"), `${file} reads extraGuestCount`);
  }
});
