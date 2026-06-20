// ORCH-1157 [rsvp-public-redesign] Round-3 [consumer-hide-address] — regression
// (implementor-owned happy-path).
//
// PRIVACY LEAK (Seth device-confirmed): the consumer "Where you'll be" must hide
// the exact street when the host turned ON "hide address until purchase" and the
// viewer is not going/maybe (RSVP) / not purchased (ticketed). The consumer
// detail screen GATES correctly on `card.hideAddressUntilTicket`, but two
// experience card mappers HARDCODED that flag to `false` — fabricating a
// reveal-by-default. Round-3 carries the REAL anon-safe flag (fail-CLOSED to
// `true`) on every consumer card path.
//
// This suite is HYBRID:
//   (A) BEHAVIORAL — `venueExperienceMapping.ts` is pure (no RN imports), so we
//       import the real `extractHideAddressUntilTicket` + `experienceToBusinessEventCard`
//       and assert the flag tracks the theme and fails CLOSED.
//   (B) SOURCE-CONTRACT — assert the two mappers no longer carry the literal
//       `hideAddressUntilTicket: false`, and the consumer gate reads the card flag.
//
// FAILS-ON-REVERT (proven by true line-deletion in the implementation report):
//   - revert `venueExperienceMapping.ts` to `hideAddressUntilTicket: false`
//     → the behavioral "tracks theme = true" assert AND the source-contract
//       "no hardcoded false" assert both fail.
//   - revert the extractor default to `false` → the fail-closed assert fails.

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  extractHideAddressUntilTicket,
  experienceToBusinessEventCard,
} from "../venueExperienceMapping.ts";

// ─── (A) BEHAVIORAL — the real extractor ──────────────────────────────────────

Deno.test("extractHideAddressUntilTicket — reads the real theme flag = true", () => {
  const theme = { business_event: { hideAddressUntilTicket: true } };
  assertEquals(extractHideAddressUntilTicket(theme), true);
});

Deno.test("extractHideAddressUntilTicket — reads the real theme flag = false", () => {
  const theme = { business_event: { hideAddressUntilTicket: false } };
  assertEquals(extractHideAddressUntilTicket(theme), false);
});

Deno.test("extractHideAddressUntilTicket — fails CLOSED (true) when absent", () => {
  // No theme / no business_event / no flag → must HIDE (never fabricate reveal).
  assertEquals(extractHideAddressUntilTicket(null), true);
  assertEquals(extractHideAddressUntilTicket({}), true);
  assertEquals(extractHideAddressUntilTicket({ business_event: {} }), true);
  assertEquals(
    extractHideAddressUntilTicket({ business_event: { hideAddressUntilTicket: "true" } }),
    true,
  );
});

Deno.test("experienceToBusinessEventCard — carries the REAL flag (hide=ON), not hardcoded false", () => {
  const row = {
    experience_id: "exp-1",
    brand_id: "b-1",
    brand_slug: "b",
    brand_name: "Brand",
    experience_slug: "exp",
    title: "Tour",
    description: null,
    cover_media_url: null,
    cover_media_type: null,
    theme: { business_event: { hideAddressUntilTicket: true } },
    venue_text: "Raleigh",
    next_occurrence_at: null,
    price_from_cents: null,
    currency: "USD",
    is_free: true,
    experience_intents: null,
    stops: null,
  };
  // deno-lint-ignore no-explicit-any
  const card = experienceToBusinessEventCard(row as any);
  assertEquals(
    card.hideAddressUntilTicket,
    true,
    "the experience card must carry the host's real hide=ON flag, not a fabricated false",
  );
  // The experience top-level street stays null (street surfaces via the gated
  // itinerary, never the 'Where you'll be' field).
  assertEquals(card.address, null);
});

Deno.test("experienceToBusinessEventCard — fails CLOSED to true when the theme omits the flag", () => {
  const row = {
    experience_id: "exp-2",
    brand_id: "b-2",
    brand_slug: "b",
    brand_name: "Brand",
    experience_slug: "exp2",
    title: "Tour",
    description: null,
    cover_media_url: null,
    cover_media_type: null,
    theme: null,
    venue_text: null,
    next_occurrence_at: null,
    price_from_cents: null,
    currency: "USD",
    is_free: true,
    experience_intents: null,
    stops: null,
  };
  // deno-lint-ignore no-explicit-any
  const card = experienceToBusinessEventCard(row as any);
  assertEquals(card.hideAddressUntilTicket, true);
});

// ─── (B) SOURCE-CONTRACT — no fabricated false; the gate reads the card flag ───

// Strip line + block comments so a doc comment that *names* the old literal
// doesn't false-positive the "no fabricated false" assertion.
const stripComments = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");

const venueMapperSrc = stripComments(
  await Deno.readTextFile(new URL("../venueExperienceMapping.ts", import.meta.url)),
);
const swipeableSrc = stripComments(
  await Deno.readTextFile(new URL("../../components/SwipeableCards.tsx", import.meta.url)),
);
const consumerScreenSrc = await Deno.readTextFile(
  new URL("../../screens/Event/ConsumerEventDetailScreen.tsx", import.meta.url),
);

Deno.test("source — venueExperienceMapping no longer hardcodes hideAddressUntilTicket: false", () => {
  assert(
    !/hideAddressUntilTicket:\s*false/.test(venueMapperSrc),
    "venueExperienceMapping must NOT fabricate a reveal-by-default false",
  );
  assertStringIncludes(
    venueMapperSrc,
    "hideAddressUntilTicket: extractHideAddressUntilTicket(row.theme)",
  );
});

Deno.test("source — SwipeableCards experience mapper no longer hardcodes false", () => {
  assert(
    !/hideAddressUntilTicket:\s*false/.test(swipeableSrc),
    "the deck experience mapper must NOT fabricate a reveal-by-default false",
  );
  assertStringIncludes(swipeableSrc, "extractHideAddressUntilTicket(rec?.theme)");
});

// ORCH-1163 [TEST-MOD-APPROVED ORCH-1163]: retargeted RsvpPublicBody → RsvpOfferingBody/FoundationRsvpPreview (body promoted to offering-rendering).
// The bespoke consumer address gate (fnd.hideAddressUntilTicket / rsvpAddressRevealed
// / `const addressHidden = isRsvp …`) was DELETED and PROMOTED into the shared
// RsvpOfferingBody (which reveals the street only on the viewer's own going/maybe).
// The INVARIANT — the gate is driven by the REAL host card flag (never a fabricated
// literal) and reveals only on going/maybe — is preserved: the consumer threads the
// REAL flag into the shared body, and the shared body owns the reveal logic.
const rsvpBodySrc = await Deno.readTextFile(
  new URL("../../../../packages/offering-rendering/RsvpOfferingBody.tsx", import.meta.url),
);
Deno.test("source — consumer threads the REAL card flag into the shared body, which reveals only on going/maybe (RSVP)", () => {
  // the consumer carries the REAL host flag into the shared body props (never a
  // hardcoded literal) — this is what the Round-3 mapper fix feeds correctly.
  assertStringIncludes(consumerScreenSrc, "hideAddressUntilTicket: card.hideAddressUntilTicket");
  // the shared body owns the reveal: revealed iff hide is OFF, or own going/maybe.
  assertStringIncludes(rsvpBodySrc, "const addressRevealed");
  assertStringIncludes(rsvpBodySrc, "!event.hideAddressUntilTicket");
  assertStringIncludes(rsvpBodySrc, 'state.guestStatus === "going"');
  assertStringIncludes(rsvpBodySrc, 'state.guestStatus === "maybe"');
});
