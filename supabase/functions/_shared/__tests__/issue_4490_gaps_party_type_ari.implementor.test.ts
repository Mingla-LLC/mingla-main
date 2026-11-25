// #4490 07-A: Ari's publish checklist asks for a party type only when the
// event is not at a venue (the server publish gate reads events.venue_id).
// [TEST-MOD-APPROVED #4490] merge with #4572: the gap now reads "an event type" (was "a party type").
import { assertEquals } from "jsr:@std/assert@1";

import { hostPublishGaps } from "../ariFlows/offerings/event.ts";
import type { FlowEventRow } from "../ariFlows/types.ts";

function row(venueId: string | null, partyTypes: string[]): FlowEventRow {
  return {
    id: "00000000-0000-4000-8000-000000004490",
    title: "Venue night",
    status: "draft",
    timezone: "Africa/Lagos",
    description: "A night at the venue.",
    party_types: partyTypes,
    city: "Lagos",
    cover_media_url: null,
    online_url: null,
    created_at: "2026-11-19T10:00:00.000Z",
    venue_id: venueId,
    draft: {},
  };
}

Deno.test("07-A: no venue and no party type -> asks for a party type", () => {
  assertEquals(hostPublishGaps(row(null, [])).includes("an event type"), true);
});

Deno.test("07-A: at a venue with no party type -> no party-type gap", () => {
  assertEquals(
    hostPublishGaps(row("00000000-0000-4000-9000-0000000000a1", [])).includes("an event type"),
    false,
  );
});

Deno.test("07-A: a chosen party type never adds the gap", () => {
  assertEquals(hostPublishGaps(row(null, ["club-night"])).includes("an event type"), false);
});
