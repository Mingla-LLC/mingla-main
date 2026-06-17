// ORCH-1157 [rsvp-public-redesign] — shared RsvpMomentumDecision regression
// (implementor-owned happy-path). Deno-runnable: rsvpMomentum.ts is pure +
// dep-free (no RN imports), and the component invariants are enforced as
// SOURCE-STRUCTURE assertions (the package has no react-native-testing-library).
//
// Covers the SPEC §7 cases for the shared unit + the 4 DRAFT invariants:
//   T-1 open count>0 capacity set · T-2 unlimited · T-3 goingCount=0 zero-state ·
//   T-4 full+waitlist (no number) · I-PROPOSED-1157-RSVP-NO-CHECKOUT-AFFORDANCE ·
//   I-PROPOSED-1157-RSVP-DECISION-IS-HERO · -SOCIAL-PROOF-ANON-ONLY · -USES-BRAND-
//   THEME-DIAL.
//
// FAILS-ON-REVERT (proven by true line-deletion in the implementation report):
//   - delete the goingCount=0 guard in deriveMomentum → T-3 expectations flip.
//   - delete the capacity-null branch → T-2 "Open invite" flips.
//   - re-introduce an <Image>/uri or a maybeCount/waitlistCount prop in the
//     component → the anon-only source assertions FAIL.
//   - hardcode a hex on the meter/going-button → the theme-dial assertion FAILS.

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  deriveMomentum,
  partyTypeLabel,
  RSVP_CLUSTER_SHOWN,
} from "../rsvpMomentum.ts";

const COMPONENT_RAW = await Deno.readTextFile(
  new URL("../RsvpMomentumDecision.tsx", import.meta.url),
);
// Strip comments before the no-checkout / anon-only assertions: the invariants
// are about RENDERED code, not the doc comments (which legitimately NAME the
// forbidden affordances to explain WHY they are absent). Removes /* */ block
// comments, // line comments, and {/* JSX */} comment nodes.
const COMPONENT = COMPONENT_RAW.replace(/\/\*[\s\S]*?\*\//g, "").replace(
  /(^|[^:])\/\/[^\n]*/g,
  "$1",
);

// ───────────────────────── pure momentum derivation ─────────────────────────

Deno.test("T-1: open, count>0, capacity set → spots-left sub + proportional meter + cluster", () => {
  const m = deriveMomentum(38, 50);
  assert(m.hasGoing);
  assertEquals(m.subLabel, "12 spots left · filling up");
  assertEquals(m.meterPercent, 76);
  assertEquals(m.shownAvatars, RSVP_CLUSTER_SHOWN);
  assertEquals(m.overflowCount, 35); // 38 − 3 shown
});

Deno.test("T-1b: filling FAST when ≥80% full", () => {
  const m = deriveMomentum(45, 50);
  assertStringIncludes(m.subLabel, "filling fast");
  assertEquals(m.meterPercent, 90);
});

Deno.test("T-2: unlimited capacity → 'Open invite', no scarcity, low fixed meter", () => {
  const m = deriveMomentum(38, null);
  assert(m.hasGoing);
  assertEquals(m.subLabel, "Open invite");
  assert(m.meterPercent > 0 && m.meterPercent < 50);
});

Deno.test("T-3: goingCount=0 → 'Be the first to RSVP', empty meter, NO cluster", () => {
  const m = deriveMomentum(0, 50);
  assert(!m.hasGoing);
  assertEquals(m.subLabel, "Be the first to RSVP");
  assertEquals(m.meterPercent, 0);
  assertEquals(m.shownAvatars, 0);
  assertEquals(m.overflowCount, 0);
});

Deno.test("T-4: full → 'Full · waitlist open', meter 100, NO waitlist number", () => {
  const m = deriveMomentum(50, 50);
  assertEquals(m.subLabel, "Full · waitlist open");
  assertEquals(m.meterPercent, 100);
  // honesty: the sub-line carries STATE, never a count of waitlisted guests.
  assert(!/\d/.test(m.subLabel));
});

Deno.test("singular spot copy at exactly 1 left", () => {
  assertStringIncludes(deriveMomentum(49, 50).subLabel, "1 spot left");
});

Deno.test("cluster never exceeds RSVP_CLUSTER_SHOWN; small counts have no overflow", () => {
  const m = deriveMomentum(2, 50);
  assertEquals(m.shownAvatars, 2);
  assertEquals(m.overflowCount, 0);
});

Deno.test("partyTypeLabel humanizes canonical kebab slugs to the taxonomy label", () => {
  assertEquals(partyTypeLabel("rooftop-party"), "Rooftop party");
  assertEquals(partyTypeLabel("club-night"), "Club night");
  assertEquals(partyTypeLabel("networking-event"), "Networking event");
  assertEquals(partyTypeLabel("rave"), "Rave");
});

// ───────────────────── DRAFT-invariant source assertions ─────────────────────

Deno.test("I-PROPOSED-1157-RSVP-NO-CHECKOUT-AFFORDANCE: the shared unit has no checkout/price/cart", () => {
  assert(!/\/checkout/.test(COMPONENT));
  assert(!/ticket-checkout-create/.test(COMPONENT));
  assert(!/priceAllIn/.test(COMPONENT));
  assert(!/\bReserve\b/.test(COMPONENT));
  assert(!/Get tickets/.test(COMPONENT));
  assert(!/\bcart\b/i.test(COMPONENT));
});

Deno.test("I-PROPOSED-1157-RSVP-DECISION-IS-HERO: the unit supports floating-dock + sticky-panel variants", () => {
  assertStringIncludes(COMPONENT, '"floating-dock"');
  assertStringIncludes(COMPONENT, '"sticky-panel"');
  // the host (RsvpPublicBody / consumer screen) picks the dock/sticky variant —
  // the unit exposes `variant` so the decision is rendered docked, not buried.
  assertStringIncludes(COMPONENT, "variant:");
});

Deno.test("I-PROPOSED-1157-RSVP-SOCIAL-PROOF-ANON-ONLY: faceless cluster, no images, no maybe/waitlist count props", () => {
  // The cluster avatars are GLYPH-only — never a photo.
  assert(!/<Image\b/.test(COMPONENT));
  assert(!/\buri\b/.test(COMPONENT));
  assertStringIncludes(COMPONENT, "PersonGlyph"); // faceless person outline
  // No public maybe / waitlist COUNT anywhere in the props or render.
  assert(!/maybeCount/.test(COMPONENT));
  assert(!/waitlistCount/.test(COMPONENT));
  // No guest identity fields.
  assert(!/guestName|guestPhoto|attendeeName|guestAvatar/.test(COMPONENT));
});

Deno.test("I-PROPOSED-1157-RSVP-USES-BRAND-THEME-DIAL: meter + cluster + going + kicker dot read palette.accent (no hardcoded hue)", () => {
  // The accent-driven nodes derive color from the palette, never a literal hex.
  assertStringIncludes(COMPONENT, "backgroundColor: palette.accent"); // meter fill + going + dot + cluster
  // No hardcoded 6/3-digit hex literals anywhere in the component (the error red
  // lives in the host's contact form, not here).
  assert(
    !/#[0-9a-fA-F]{6}\b/.test(COMPONENT),
    "no 6-digit hex literal allowed in the theme-driven RSVP unit",
  );
  assert(
    !/#[0-9a-fA-F]{3}\b/.test(COMPONENT),
    "no 3-digit hex literal allowed in the theme-driven RSVP unit",
  );
});

Deno.test("Android opaque-fill policy: the unit derives an opaque Android card fill", () => {
  // ANDROID_GLASS_USES_OPAQUE_FALLBACK — Platform.OS==='android' → opaque page
  // fill, plus overflow:'hidden' clipping on the rounded cards.
  assertStringIncludes(COMPONENT, 'Platform.OS === "android"');
  assertStringIncludes(COMPONENT, 'overflow: "hidden"');
});

Deno.test("the decision exposes Going / Maybe / Can't (the three-way RSVP reply)", () => {
  assertStringIncludes(COMPONENT, "onGoing");
  assertStringIncludes(COMPONENT, "onMaybe");
  assertStringIncludes(COMPONENT, "onNotGoing");
});

// ORCH-1157 rework (tester FAIL P1-A): the decision block must be GATED behind a
// `showDecision` prop so the phone INLINE body mount renders momentum-only — the
// Going/Maybe/Can't decision lives EXACTLY ONCE (floating dock on phone, sticky
// panel on desktop). Without the gate the inline body re-emits a SECOND, dead
// decision row (no-op handlers) — Constitution rule 1 (no dead taps), and a
// divergence from the binding mockup (`.decision-host.inbody { display:none }`).
// FAILS-ON-REVERT: revert `{showDecision ? decisionBlock : null}` back to the
// unconditional `{decisionBlock}` (drop the prop) → these assertions FAIL.
Deno.test("P1-A: the decision block is gated behind a showDecision prop (no dead duplicate row)", () => {
  // the prop is part of the contract …
  assertStringIncludes(COMPONENT, "showDecision");
  // … defaults to true so the dock + desktop sticky-panel keep the decision …
  assertStringIncludes(COMPONENT, "showDecision = true");
  // … and the render gates the decision block on it (not unconditional).
  assertStringIncludes(COMPONENT, "showDecision ? decisionBlock : null");
  assert(
    !/\n\s*\{decisionBlock\}\s*\n/.test(COMPONENT),
    "decisionBlock must be rendered ONLY through the showDecision gate, never unconditionally",
  );
});
