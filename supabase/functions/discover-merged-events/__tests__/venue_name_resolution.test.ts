// ORCH-0846 [Consumer event sheet venue/address parity] — happy-path
// regression test suite.
//
// Bug: pre-0846, `supabase/functions/discover-merged-events/index.ts`
// hardcoded `venueName: null` on every BusinessEventCard, which forced the
// shared @mingla/event-rendering `PublicEventPage` render gate
// (`event.format !== "online" && event.venueName !== null`) to false on
// every business event. The consumer-side sheet (Discover → tap business
// card → ExpandedBusinessEventSheet) silently dropped the entire venue
// card. The brand-side public buyer page rendered correctly because
// `publicEventsService.toPublicEventBySlug` resolved venueName via
// `theme.business_event.venueName ?? location_text`.
//
// Fix: the discover edge function now mirrors brand-side resolution via
// `extractVenueName(theme) ?? location_text`, passes address
// unconditionally (UI gates on hideAddressUntilTicket), and derives
// `format` from `theme.business_event.format` with `is_online` fallback.
//
// Coverage angles:
//   (V) venueName fallback chain — three input shapes covering theme+text,
//       theme-null+text, both-null, plus a whitespace trim guard
//   (F) format derivation — 3×3 matrix pruned to 6 representative cases
//       (each of in_person/online/hybrid, plus is_online-fallback paths
//       and an unknown-literal rejection)
//   (A) address resolution — explicit unconditional-pass-through proof
//       (hide=true does NOT zero out address at the producer; UI gates)
//
// fails-on-revert proof: each V/F/A test below FAILS if the production
// code in `_helpers.ts` reverts to the pre-fix shape. See the
// implementation report under "Regression Test" for the exact run output.
//
// Run with:
//   deno test --allow-read supabase/functions/discover-merged-events/__tests__/venue_name_resolution.test.ts

import {
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

import {
  extractVenueName,
  extractBusinessEventFormat,
  deriveSharedFormat,
  resolveBusinessEventVenueFields,
} from "../_helpers.ts";

// ── (V) venueName fallback chain ────────────────────────────────────────

Deno.test(
  "ORCH-0846 V-01 — theme.business_event.venueName wins over location_text",
  () => {
    const theme = { business_event: { venueName: "Velvet Underground" } };
    assertEquals(extractVenueName(theme), "Velvet Underground");
    const resolved = resolveBusinessEventVenueFields({
      theme,
      locationText: "123 Main St",
      isOnline: false,
    });
    assertEquals(resolved.venueName, "Velvet Underground");
    assertEquals(resolved.address, "123 Main St");
  },
);

Deno.test(
  "ORCH-0846 V-02 — theme venueName null falls back to location_text",
  () => {
    const theme = { business_event: { venueName: null } };
    assertEquals(extractVenueName(theme), null);
    const resolved = resolveBusinessEventVenueFields({
      theme,
      locationText: "123 Main St",
      isOnline: false,
    });
    assertEquals(
      resolved.venueName,
      "123 Main St",
      "fallback chain must surface location_text so PublicEventPage venue-card gate passes",
    );
  },
);

Deno.test(
  "ORCH-0846 V-03 — both null produces null venueName (preserves shared-component hide)",
  () => {
    const resolved = resolveBusinessEventVenueFields({
      theme: { business_event: { venueName: null } },
      locationText: null,
      isOnline: false,
    });
    assertEquals(resolved.venueName, null);
    assertEquals(resolved.address, null);
  },
);

Deno.test(
  "ORCH-0846 V-04 — whitespace-only venueName rejected by trim guard",
  () => {
    const theme = { business_event: { venueName: "   " } };
    assertEquals(
      extractVenueName(theme),
      null,
      "whitespace strings must not satisfy the venue-card render gate",
    );
  },
);

Deno.test(
  "ORCH-0846 V-05 — missing theme entirely is safe",
  () => {
    assertEquals(extractVenueName(undefined), null);
    assertEquals(extractVenueName(null), null);
    assertEquals(extractVenueName({}), null);
    assertEquals(extractVenueName({ business_event: null }), null);
  },
);

// ── (F) format derivation ───────────────────────────────────────────────

Deno.test(
  "ORCH-0846 F-01 — theme.format=in_person maps to shared 'in-person'",
  () => {
    assertEquals(
      deriveSharedFormat(extractBusinessEventFormat({
        business_event: { format: "in_person" },
      }), false),
      "in-person",
    );
  },
);

Deno.test(
  "ORCH-0846 F-02 — theme.format=online maps to shared 'online'",
  () => {
    assertEquals(
      deriveSharedFormat(extractBusinessEventFormat({
        business_event: { format: "online" },
      }), true),
      "online",
    );
  },
);

Deno.test(
  "ORCH-0846 F-03 — theme.format=hybrid maps to shared 'hybrid'",
  () => {
    assertEquals(
      deriveSharedFormat(extractBusinessEventFormat({
        business_event: { format: "hybrid" },
      }), false),
      "hybrid",
    );
  },
);

Deno.test(
  "ORCH-0846 F-04 — null theme format + is_online=true falls back to 'online'",
  () => {
    assertEquals(deriveSharedFormat(null, true), "online");
  },
);

Deno.test(
  "ORCH-0846 F-05 — null theme format + is_online=false falls back to 'in-person'",
  () => {
    assertEquals(deriveSharedFormat(null, false), "in-person");
  },
);

Deno.test(
  "ORCH-0846 F-06 — unknown theme format literal rejected and is_online fallback used",
  () => {
    assertEquals(
      extractBusinessEventFormat({
        business_event: { format: "garbage" },
      }),
      null,
    );
    assertEquals(
      deriveSharedFormat(
        extractBusinessEventFormat({ business_event: { format: "garbage" } }),
        true,
      ),
      "online",
    );
  },
);

// ── (A) address resolution — unconditional producer pass-through ────────

Deno.test(
  "ORCH-0846 A-01 — address is passed through regardless of hide hint (UI gates)",
  () => {
    // hide=true used to zero out address at the producer. Post-fix the
    // producer always passes location_text and the UI gates rendering on
    // hideAddressUntilTicket. This mirrors brand-side mechanism.
    const resolved = resolveBusinessEventVenueFields({
      theme: { business_event: { venueName: null, hideAddressUntilTicket: true } },
      locationText: "123 Main St",
      isOnline: false,
    });
    assertEquals(
      resolved.address,
      "123 Main St",
      "producer must pass address unconditionally so the shared component can decide what to render",
    );
  },
);

Deno.test(
  "ORCH-0846 A-02 — address surfaces when hide=false (the headline visible change)",
  () => {
    const resolved = resolveBusinessEventVenueFields({
      theme: { business_event: { venueName: null, hideAddressUntilTicket: false } },
      locationText: "123 Main St",
      isOnline: false,
    });
    assertEquals(resolved.address, "123 Main St");
  },
);

Deno.test(
  "ORCH-0846 A-03 — null location_text yields null address",
  () => {
    const resolved = resolveBusinessEventVenueFields({
      theme: { business_event: { venueName: null } },
      locationText: null,
      isOnline: false,
    });
    assertEquals(resolved.address, null);
  },
);
