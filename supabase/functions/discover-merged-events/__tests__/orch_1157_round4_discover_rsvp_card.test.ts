// ORCH-1157 [rsvp-public-redesign] Round-4 [discover-events-path] — regression
// (implementor-owned happy-path).
//
// THE PATH UNDER TEST — the Discover screen's "Events" tab. A consumer opening an
// RSVP event from Discover → Events goes:
//
//   pg_discover_business_events (RPC, returns event_type + theme)
//     → discover-merged-events edge fn  → mapRpcRowToCard  (THIS FILE, Part A)
//     → searchMerged service            → DiscoverScreen `it.item`
//     → setExpansionTarget({ kind: "businessEvent", data })   (DiscoverScreen)
//     → ExpandedCardModal: non-experience businessEvent → ConsumerEventDetailScreen
//       seed={businessEvent}                                  (Part B)
//     → ConsumerEventDetailScreen: isRsvp = seed.eventType === "rsvp"
//
// This is the SAME single-source-of-truth detail screen the round-1/2/3 work
// fixed; the Discover path reaches it identically. This suite locks BOTH halves:
//
//   (A) BEHAVIORAL — the real `mapRpcRowToCard` (the Discover supply) turns an
//       RSVP RPC row into a card carrying `eventType: "rsvp"` and the REAL
//       `hideAddressUntilTicket` (fail-CLOSED to true). If the card lost either
//       flag, the detail would render the ticketed branch + ungated street.
//   (B) SOURCE-CONTRACT — the Discover→detail wiring is intact AND the detail
//       gates the ticket block on `!isRsvp` and reveals the street only on
//       going/maybe (RSVP). Re-pointing Discover at an old/duplicate sheet, or
//       un-gating the ticket block, makes the relevant assertion FAIL.
//
// FAILS-ON-REVERT (proven by true line-deletion in the implementation report):
//   - Part A: delete the `eventType: row.event_type === "rsvp" ? "rsvp" : "event"`
//     line in `_business-query.ts` → T-R4-A1 FAILS (eventType becomes undefined).
//   - Part B: delete the `{!isRsvp ? (` ticket-block gate in
//     ConsumerEventDetailScreen → T-R4-B3 FAILS.

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { mapRpcRowToCard } from "../_business-query.ts";

// ── Part A — BEHAVIORAL: the real Discover-supply mapper ──────────────────────

// An RSVP RPC row mirroring the live "The Second Test" shape (event_type='rsvp',
// theme.business_event.hideAddressUntilTicket=true, a top-level street in
// location_text). This is exactly what pg_discover_business_events emits and the
// edge fn maps before it reaches the Discover screen.
function rsvpRpcRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "d3aa8011-664f-4cb8-a85e-5e696bb34638",
    brand_id: "22a18413-bfbf-4087-9ba7-45f70deba0f3",
    brand_slug: "leggothis",
    brand_name: "Leggo This",
    slug: "the-second-test",
    title: "The Second Test",
    description: "This is another test",
    event_type: "rsvp",
    theme: {
      coverHue: 25,
      business_event: {
        venueName: "The Party Venue",
        format: "in_person",
        hideAddressUntilTicket: true,
      },
    },
    location_text:
      "The Party Venue · 700 Corporate Center Drive, Raleigh, North Carolina 27607, United States",
    location_geo: "(-78.738607,35.790926)",
    city: "Raleigh",
    timezone: "America/New_York",
    currency: "USD",
    is_online: false,
    master_start_at: "2026-06-17T17:00:00+00:00",
    master_end_at: "2026-06-18T08:00:00+00:00",
    cover_media_url: "https://example.com/x.gif",
    cover_media_type: "gif",
    party_types: ["networking-event"],
    vibe_tags: ["energetic"],
    music_genres: ["hiphop-rap"],
    ...overrides,
  };
}

Deno.test("ORCH-1157 T-R4-A1: Discover-events RSVP card carries eventType='rsvp'", () => {
  const card = mapRpcRowToCard(rsvpRpcRow());
  // The discriminator the detail reads (`isRsvp = seed.eventType === 'rsvp'`).
  // If this is undefined/'event', the detail renders the TICKETED branch.
  assertEquals(card.eventType, "rsvp");
});

Deno.test("ORCH-1157 T-R4-A2: a ticketed Discover card stays eventType='event'", () => {
  const card = mapRpcRowToCard(rsvpRpcRow({ event_type: "event" }));
  assertEquals(card.eventType, "event");
});

Deno.test("ORCH-1157 T-R4-A3: Discover-events RSVP card carries the REAL hideAddressUntilTicket (true)", () => {
  const card = mapRpcRowToCard(rsvpRpcRow());
  // The UI gate reads card.hideAddressUntilTicket → masks the street. Never a
  // fabricated reveal-by-default.
  assertEquals(card.hideAddressUntilTicket, true);
  // The street IS carried on the card (the gate hides it at render — it is NOT
  // stripped from the payload), so a privacy regression is a UI-gate failure,
  // never a missing field.
  assert(
    (card.address ?? "").includes("700 Corporate Center Drive"),
    "the card carries the street; the UI gate decides visibility",
  );
});

Deno.test("ORCH-1157 T-R4-A4: hideAddressUntilTicket fails CLOSED (true) when the theme omits it", () => {
  const card = mapRpcRowToCard(
    rsvpRpcRow({ theme: { coverHue: 25, business_event: {} } }),
  );
  assertEquals(card.hideAddressUntilTicket, true);
});

// ── Part B — SOURCE-CONTRACT: the Discover→detail wiring + the gated detail ───

const discoverScreen = await Deno.readTextFile(
  new URL(
    "../../../../app-mobile/src/components/DiscoverScreen.tsx",
    import.meta.url,
  ),
);
const expandedModal = await Deno.readTextFile(
  new URL(
    "../../../../app-mobile/src/components/ExpandedCardModal.tsx",
    import.meta.url,
  ),
);
const detail = await Deno.readTextFile(
  new URL(
    "../../../../app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx",
    import.meta.url,
  ),
);

Deno.test("ORCH-1157 T-R4-B1: Discover Events tab opens the businessEvent target with the merged item verbatim", () => {
  // The Events-tab card press routes the merged `BusinessEventCard` (it.item,
  // which carries eventType + hideAddressUntilTicket) straight into the shared
  // expansion modal — it does NOT rebuild a lossy card.
  assertStringIncludes(discoverScreen, "handleBusinessEventCardPress");
  assertStringIncludes(
    discoverScreen,
    'setExpansionTarget({ kind: "businessEvent", data });',
  );
});

Deno.test("ORCH-1157 T-R4-B2: ExpandedCardModal routes a non-experience businessEvent to the SAME ConsumerEventDetailScreen", () => {
  // Single source of truth: the Discover path and the experience-card path share
  // one detail component. A non-experience businessEvent (an event/RSVP) opens
  // ConsumerEventDetailScreen with the card as seed — NOT a legacy/duplicate sheet.
  assertStringIncludes(expandedModal, "isExperienceCard(businessEvent)");
  assertStringIncludes(expandedModal, "<ConsumerEventDetailScreen");
  assertStringIncludes(expandedModal, "seed={businessEvent}");
  // EBES (the old sheet) must NOT be the event/RSVP detail.
  assert(
    !expandedModal.includes("<ExpandedBusinessEventSheet"),
    "RSVP/event detail must not route to the decommissioned EBES sheet",
  );
});

Deno.test("ORCH-1157 T-R4-B3: the shared detail GATES the ticket block on !isRsvp (no ticket block on an RSVP)", () => {
  // The exact symptom on the Discover path: an RSVP rendered "Choose your ticket
  // → No tickets available yet". The block must be gated `!isRsvp`.
  assertStringIncludes(detail, "{!isRsvp ? (");
  // The RENDERED ticket heading (a JSX text child, not the comment mention) must
  // sit AFTER the gate opens. We anchor on the gate token, then require the
  // ticket heading to appear within the gated branch.
  const gateIdx = detail.indexOf("{!isRsvp ? (");
  const renderedHeadingIdx = detail.indexOf("\n                  Choose your ticket");
  assert(
    gateIdx !== -1 && renderedHeadingIdx !== -1 && gateIdx < renderedHeadingIdx,
    "the !isRsvp gate must open before the rendered ticket heading",
  );
  // And the gated branch closes with `: null}` (RSVP renders nothing here).
  const branch = detail.slice(gateIdx, renderedHeadingIdx + 4000);
  assertStringIncludes(branch, ") : null}");
});

Deno.test("ORCH-1157 T-R4-B4: the shared detail derives isRsvp from the seed eventType (the Discover card's flag)", () => {
  assertStringIncludes(detail, 'const isRsvp = seed?.eventType === "rsvp";');
});

Deno.test("ORCH-1157 T-R4-B5: the RSVP address gate hides the street until going/maybe with RSVP wording (not 'after ticket purchase')", () => {
  // For an RSVP there is no purchase — the street reveals on going/maybe and the
  // hidden caption is the RSVP wording, never the ticketed copy.
  assertStringIncludes(
    detail,
    'rsvpStatus === "going" || rsvpStatus === "maybe"',
  );
  assertStringIncludes(detail, "fnd.hideAddressUntilTicket && !rsvpAddressRevealed");
  assertStringIncludes(detail, '"Address shared after you RSVP"');
  // The ticketed copy must NOT be the caption for an RSVP (it stays for ticketed).
  assertStringIncludes(
    detail,
    'isRsvp\n    ? (cityCountry ?? "Address shared after you RSVP")',
  );
});
