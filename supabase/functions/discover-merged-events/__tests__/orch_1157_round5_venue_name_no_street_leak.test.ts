// ORCH-1157 [rsvp-public-redesign] Round-5 [rsvp-address-privacy] — implementor
// happy-path regression. THE RUNTIME LEAK round-4 missed.
//
// ROOT CAUSE (runtime-proven, not source-only):
//   The deployed edge fn (v179) correctly returns hideAddressUntilTicket=true
//   for "The Second Test", AND the consumer detail correctly gates the `address`
//   field. BUT the live invoke returned:
//     venueName = "The Party Venue · 700 Corporate Center Drive, Raleigh, …"
//   i.e. the FULL STREET folded into the venue NAME. The detail's venue-name
//   line renders `fnd.venueName` verbatim, so the street leaked through the NAME
//   line even with the address gate ON.
//
//   Why: every live business event stores the venue name at
//   theme.business_event.location.venueName (16/16 rows; ZERO use the top-level
//   theme.business_event.venueName the ORCH-0846 extractVenueName read). So
//   extractVenueName returned null and mapRpcRowToCard fell back to
//   row.location_text (the "name · street" string) AS the venueName.
//
// FIX: extractVenueName now reads top-level FIRST, then the canonical nested
//   location.venueName, before mapRpcRowToCard's location_text last resort.
//
// FAILS-ON-REVERT (proven by true line-deletion in the implementation report):
//   delete the nested `location.venueName` lookup in
//   supabase/functions/discover-merged-events/_helpers.ts → T-R5-1 / T-R5-2 FAIL
//   (venueName falls back to location_text and carries the street).

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { extractVenueName } from "../_helpers.ts";
import { mapRpcRowToCard } from "../_business-query.ts";

// The EXACT live shape of "The Second Test" (verified via execute_sql on the
// pg_discover_business_events RPC output 2026-06-17): venueName nested under
// `location`, top-level venueName ABSENT, location_text = "name · street".
function liveRsvpRow(
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
        // NOTE: top-level venueName is ABSENT on every live row (the bug).
        format: "in_person",
        hideAddressUntilTicket: true,
        location: {
          venueName: "The Party Venue",
          address:
            "700 Corporate Center Drive, Raleigh, North Carolina 27607, United States",
        },
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

Deno.test("ORCH-1157 T-R5-1: extractVenueName resolves the nested location.venueName (the live shape)", () => {
  assertEquals(
    extractVenueName(liveRsvpRow().theme),
    "The Party Venue",
  );
});

Deno.test("ORCH-1157 T-R5-2: the Discover card venueName is JUST the name — it does NOT contain the street", () => {
  const card = mapRpcRowToCard(liveRsvpRow());
  // The exact device-observed leak: the street rendered in the venue-NAME line.
  assertEquals(card.venueName, "The Party Venue");
  assert(
    !(card.venueName ?? "").includes("700 Corporate Center Drive"),
    "the venue NAME must never carry the street — that is the runtime leak round-4 missed",
  );
  // The street still rides on `address` (the gate masks THAT field at render).
  assert(
    (card.address ?? "").includes("700 Corporate Center Drive"),
    "the street stays on the address field; the UI gate decides its visibility",
  );
  // Privacy flag intact + fail-closed.
  assertEquals(card.hideAddressUntilTicket, true);
});

Deno.test("ORCH-1157 T-R5-3: top-level venueName still wins (forward-compat) when present", () => {
  const card = mapRpcRowToCard(
    liveRsvpRow({
      theme: {
        coverHue: 25,
        business_event: {
          venueName: "Explicit Top Name",
          format: "in_person",
          hideAddressUntilTicket: true,
          location: { venueName: "Nested Name" },
        },
      },
    }),
  );
  assertEquals(card.venueName, "Explicit Top Name");
});

Deno.test("ORCH-1157 T-R5-4: with NO venueName anywhere, venueName falls back to location_text (last resort) — the client guard then sanitizes it", () => {
  const card = mapRpcRowToCard(
    liveRsvpRow({
      theme: { coverHue: 25, business_event: { hideAddressUntilTicket: true } },
    }),
  );
  // No name in the theme at all → the producer's documented last resort.
  assertEquals(card.venueName, card.address);
  // (The consumer detail's Round-5 venueNameDisplay guard strips the street from
  // THIS string when addressHidden — see the .test.ts source-contract below.)
});

// ── SOURCE-CONTRACT: the consumer detail venue-name defense-in-depth guard ────

const detail = await Deno.readTextFile(
  new URL(
    "../../../../app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx",
    import.meta.url,
  ),
);

Deno.test("ORCH-1157 T-R5-5: the detail derives a sanitized venueNameDisplay and renders IT (not raw fnd.venueName) so a street-folded name can never paint when hidden", () => {
  // The guard exists.
  assert(
    detail.includes("const venueNameDisplay"),
    "expected the Round-5 venueNameDisplay guard in the consumer detail",
  );
  // When hidden, it suppresses a name that still contains the address.
  assert(
    detail.includes("namePart.includes(fnd.address)"),
    "the guard must drop the name when it still contains the full address",
  );
  // The rendered NAME line reads venueNameDisplay, NOT raw fnd.venueName.
  assert(
    detail.includes("{venueNameDisplay ?? addressHiddenLabel}"),
    "the venue-name line must render the sanitized venueNameDisplay",
  );
});
