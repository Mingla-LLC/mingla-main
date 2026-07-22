/**
 * ORCH-1062 §B4 defect #1 — RSVP offering type is typed truthfully.
 *
 * `LiveEvent.event_type` (store/liveEventStore.ts) legitimately carries "rsvp",
 * so `eventsToIndexEntries` really emits `type: "rsvp"` into a SearchIndexEntry.
 * Before the fix, `SearchResultType` (lib/search/types.ts) excluded "rsvp", so
 * adapters.ts failed to compile (TS2322 at the `type: eventType` assignment +
 * TS2345 at `iconForOffering(eventType)`) — which took down every src/lib/search
 * suite.
 *
 * This happy-path test proves the adapter maps an RSVP event to a correctly
 * typed, correctly routed offering entry.
 *
 * Fails-on-revert: deleting "rsvp" from the SearchResultType union makes
 * adapters.ts fail to type-check (TS2322/TS2345), so this suite (which imports
 * adapters) fails to run — RED. The fix is what keeps it green. Runtime output
 * is unchanged by the fix (the icon was already "calendar" via the switch
 * default); the fix only makes the real output type-truthful.
 */

import { eventsToIndexEntries } from "../adapters";

type EventRow =
  Parameters<typeof eventsToIndexEntries>[0] extends readonly (infer T)[]
    ? T
    : never;

const rsvpEvent = {
  id: "ev-rsvp-1",
  name: "Rooftop RSVP Mixer",
  event_type: "rsvp",
  status: "scheduled",
  venueName: "Skyline Lounge",
  address: null,
  partyTypes: ["mixer"],
  vibeTags: ["chill"],
  musicGenres: ["house"],
  description: "An intimate rooftop gathering.",
  publishedAt: "2026-07-01T12:00:00.000Z",
} as unknown as EventRow;

describe("ORCH-1062 §B4 — RSVP offering adapter type", () => {
  it("maps an rsvp LiveEvent to a type:'rsvp' offering entry routed to /rsvp/{id}", () => {
    const out = eventsToIndexEntries([rsvpEvent]);
    expect(out).toHaveLength(1);
    const entry = out[0];
    expect(entry?.type).toBe("rsvp");
    expect(entry?.group).toBe("offerings");
    // RSVP shares the event/calendar icon (cosmetic parity with the switch
    // default — see iconForOffering).
    expect(entry?.iconName).toBe("calendar");
    // Non-draft rsvp routes to the RSVP dashboard (routeForEventRow).
    expect(entry?.route).toBe("/rsvp/ev-rsvp-1");
    expect(entry?.title).toBe("Rooftop RSVP Mixer");
  });
});
