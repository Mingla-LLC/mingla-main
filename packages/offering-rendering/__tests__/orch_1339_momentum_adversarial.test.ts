// ORCH-1339 [momentum-card-cross-entity] — implementor-owned ADVERSARIAL suite
// (SPEC §7 T-2 component source contract, T-3 derivation separation, plus the
// no-digit leak sweep mirroring orch_1157_rsvp_momentum_adversarial.test.ts).
//
// FAILS-ON-REVERT:
//   - add an <Image>/uri/Pressable/onPress or a hex literal to
//     OfferingMomentum → the T-2 source assertions FAIL.
//   - route an "rsvp" branch into socialProofMomentum.ts, or leak the new
//     entity strings into rsvpMomentum.ts → T-3 FAILS (COMMS-0057 owners).
//   - fabricate a digit-bearing sub-line outside the spots-left scarcity →
//     the no-leak sweep FAILS.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { deriveSocialProofMomentum } from "../socialProofMomentum.ts";

const read = (rel: string): Promise<string> =>
  Deno.readTextFile(new URL(rel, import.meta.url));

const COMPONENT_RAW = await read("../OfferingMomentum.tsx");
// Strip block + line comments so prose never false-positives the token bans.
const COMPONENT = COMPONENT_RAW.replace(/\/\*[\s\S]*?\*\//g, "").replace(
  /(^|[^:])\/\/[^\n]*/g,
  "$1",
);
const DERIVATION = await read("../socialProofMomentum.ts");
const DERIVATION_CODE = DERIVATION.replace(/\/\*[\s\S]*?\*\//g, "").replace(
  /(^|[^:])\/\/[^\n]*/g,
  "$1",
);
const RSVP_DERIVATION = await read("../rsvpMomentum.ts");

// ───────────── T-2 — OfferingMomentum source contract (glyph-only leg) ──────

Deno.test("T-2: NO <Image>, NO uri, NO identity props — glyph-only until ORCH-1340", () => {
  assert(!/<Image\b/.test(COMPONENT), "no <Image> in the momentum unit");
  assert(!/\buri\b/.test(COMPONENT), "no uri in the momentum unit");
  assert(
    !/guestName|guestPhoto|attendeeName|guestAvatar/.test(COMPONENT),
    "no guest identity fields",
  );
  assert(!/maybeCount|waitlistCount/.test(COMPONENT), "no maybe/waitlist counts");
  // The sample field (real avatars) is deliberately UNREAD in this leg.
  assert(
    !/socialProof\.sample|\.sample\b/.test(COMPONENT),
    "the avatar sample is NOT consumed in this leg (ORCH-1340's)",
  );
});

Deno.test("T-2: NO tap affordance — no Pressable/onPress anywhere (inert until ORCH-1341)", () => {
  assert(!/\bPressable\b/.test(COMPONENT), "no Pressable in the momentum unit");
  assert(!/\bonPress\b/.test(COMPONENT), "no onPress in the momentum unit");
  assert(!/\bTouchable/.test(COMPONENT), "no Touchable* in the momentum unit");
});

Deno.test("T-2: NO checkout affordance tokens (I-PROPOSED-1157-NO-CHECKOUT-AFFORDANCE sibling)", () => {
  assert(!/\/checkout/.test(COMPONENT));
  assert(!/ticket-checkout-create/.test(COMPONENT));
  assert(!/priceAllIn/.test(COMPONENT));
  assert(!/\bReserve\b/.test(COMPONENT));
  assert(!/Get tickets/.test(COMPONENT));
  assert(!/\bcart\b/i.test(COMPONENT));
});

Deno.test("T-2: theme dial — palette-only colors, NO 3/6-digit hex literal", () => {
  assert(!/#[0-9a-fA-F]{6}\b/.test(COMPONENT), "no 6-digit hex literal");
  assert(!/#[0-9a-fA-F]{3}\b/.test(COMPONENT), "no 3-digit hex literal");
  assert(/backgroundColor: palette\.accent/.test(COMPONENT), "meter/cluster read palette.accent");
});

Deno.test("T-2: Android-opaque card fill + overflow hidden (ANDROID_GLASS_USES_OPAQUE_FALLBACK)", () => {
  assert(/Platform\.OS === "android"/.test(COMPONENT));
  assert(/opaqueSurfaceColor/.test(COMPONENT));
  assert(/overflow: "hidden"/.test(COMPONENT));
});

Deno.test("T-2: ORCH-1303 — isInteraction:false REQUIRED wherever Animated is used (or no Animated at all)", () => {
  if (/\bAnimated\./.test(COMPONENT)) {
    assert(
      /isInteraction: false/.test(COMPONENT),
      "any Animated timing in the unit must carry isInteraction:false",
    );
  } else {
    // The shipped unit uses a STATIC meter — nothing can hold an
    // InteractionManager handle. This branch documents that choice.
    assert(true);
  }
});

Deno.test("T-2: D2 — the cluster render is gated on !privateGuestList (count/sub/meter are not)", () => {
  assert(
    /\{!socialProof\.privateGuestList \? \(/.test(COMPONENT),
    "cluster suppressed entirely under privateGuestList",
  );
});

// ───────────── T-3 — single-owner separation (COMMS-0057) ──────────────────

Deno.test("T-3: socialProofMomentum handles NO 'rsvp' branch (lookup-miss → invisible)", () => {
  assert(
    !/"rsvp"/.test(DERIVATION_CODE),
    "no quoted rsvp entity literal in the ticketed derivation",
  );
  // Runtime proof: an rsvp payload yields the invisible model, never copy.
  const m = deriveSocialProofMomentum({
    entityType: "rsvp",
    goingCount: 25,
    capacity: 50,
    hideRemainingCount: false,
  });
  assertEquals(m.visible, false);
  assertEquals(m.subLabel, null);
});

Deno.test("T-3: rsvpMomentum.ts stays the sole RSVP owner — none of the new entity strings leak into it", () => {
  for (const token of [
    "Trip full",
    "Fully booked",
    "Sold out",
    "are pulling up",
    "are on this trip",
    "have booked this",
    "booked",
  ]) {
    assert(
      !RSVP_DERIVATION.includes(token),
      `rsvpMomentum.ts must not carry the ticketed-entity string "${token}"`,
    );
  }
});

// ───────────── no-digit leak sweep (mirror of 1157 adversarial) ────────────

Deno.test("adversarial: only the spots-left sub-line ever carries a digit — per entity, 0..cap×2 sweep", () => {
  const cap = 25;
  for (const entityType of ["event", "trip", "experience"] as const) {
    for (let going = 0; going <= cap * 2; going += 1) {
      for (const hide of [false, true]) {
        const m = deriveSocialProofMomentum({
          entityType,
          goingCount: going,
          capacity: cap,
          hideRemainingCount: hide,
        });
        if (m.subLabel === null) continue;
        const hasDigit = /\d/.test(m.subLabel);
        const isSpotsLeftLine = /\bspots? left\b/.test(m.subLabel);
        if (hasDigit) {
          assert(
            isSpotsLeftLine,
            `subLabel "${m.subLabel}" (${entityType} going=${going} hide=${hide}) leaked a non-spots-left number`,
          );
        }
        if (hide) {
          assertEquals(
            m.subLabel,
            null,
            `hideRemainingCount must OMIT the sub-line (got "${m.subLabel}")`,
          );
        }
      }
    }
  }
});

Deno.test("adversarial: meter clamps 0..100; degenerate inputs never NaN/negative", () => {
  assertEquals(
    deriveSocialProofMomentum({
      entityType: "event",
      goingCount: 999,
      capacity: 10,
      hideRemainingCount: false,
    }).meterPercent,
    100,
  );
  assertEquals(
    deriveSocialProofMomentum({
      entityType: "trip",
      goingCount: -5,
      capacity: 10,
      hideRemainingCount: false,
    }).visible,
    false,
  );
  const zeroCap = deriveSocialProofMomentum({
    entityType: "experience",
    goingCount: 5,
    capacity: 0,
    hideRemainingCount: false,
  });
  assert(Number.isFinite(zeroCap.meterPercent));
  assertEquals(zeroCap.meterPercent, 18, "capacity<=0 behaves as null (open fill)");
});

Deno.test("adversarial: full sub-lines carry NO digit (state copy, never a count)", () => {
  for (const [entityType, label] of [
    ["event", "Sold out"],
    ["trip", "Trip full"],
    ["experience", "Fully booked"],
  ] as const) {
    const m = deriveSocialProofMomentum({
      entityType,
      goingCount: 30,
      capacity: 30,
      hideRemainingCount: false,
    });
    assertEquals(m.subLabel, label);
    assert(!/\d/.test(m.subLabel ?? ""), `${entityType} full sub-line must carry no digit`);
    assertEquals(m.meterPercent, 100);
  }
});
