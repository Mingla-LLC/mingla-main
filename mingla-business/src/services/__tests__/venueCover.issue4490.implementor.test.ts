/**
 * #4490 07-L — "Use {Venue}'s cover": the client asks the edge to copy, then
 * applies the copy as an ordinary upload (no new provider, no credit).
 *
 * Fails-on-revert: dropping the action name from the body (the edge would run
 * the attestation path instead) fails the request case.
 */
const invoke = jest.fn();
jest.mock("../supabase", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }));

import { copyVenueCoverToEvent, venueCoverPatch } from "../eventCoverMediaService";

const EVENT = "11111111-1111-4111-8111-111111111111";
const VENUE = "22222222-2222-4222-8222-222222222222";

describe("#4490 07-L venue cover", () => {
  beforeEach(() => invoke.mockReset());

  it("asks the edge to copy the venue's cover for this event", async () => {
    invoke.mockResolvedValue({ data: { url: "https://x/e.jpg", type: "image", poster_url: "https://x/e.jpg", provider: "upload" }, error: null });
    const copied = await copyVenueCoverToEvent(EVENT, VENUE);
    expect(invoke).toHaveBeenCalledWith("event-cover-attest-selection", {
      body: { action: "copy_venue_cover", event_id: EVENT, venue_id: VENUE },
    });
    expect(copied).toEqual({ url: "https://x/e.jpg", type: "image", posterUrl: "https://x/e.jpg" });
  });

  it("a refusal or a bad answer throws (the step shows its error)", async () => {
    invoke.mockResolvedValue({ data: null, error: new Error("event_not_at_venue") });
    await expect(copyVenueCoverToEvent(EVENT, VENUE)).rejects.toThrow();
    invoke.mockResolvedValue({ data: { url: "https://x/e.jpg", type: "pdf", poster_url: "x" }, error: null });
    await expect(copyVenueCoverToEvent(EVENT, VENUE)).rejects.toThrow();
  });

  it("a local draft id is never sent", async () => {
    await expect(copyVenueCoverToEvent("d_abc", VENUE)).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("the patch is a plain upload with no credit", () => {
    expect(venueCoverPatch({ url: "u", type: "video", posterUrl: "p" }, "CLUB MERIDIAN")).toEqual({
      coverMediaUrl: "u",
      coverMediaPosterUrl: "p",
      coverMediaType: "video",
      coverMediaProvider: "upload",
      coverMediaSourceUrl: null,
      coverMediaCredit: null,
      coverMediaCreditUrl: null,
      coverMediaAlt: "CLUB MERIDIAN cover",
    });
  });
});
