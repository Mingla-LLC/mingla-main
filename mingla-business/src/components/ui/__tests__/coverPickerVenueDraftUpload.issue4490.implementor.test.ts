/**
 * #4490 D6 — add-venue wizard: Cover › Upload new › Add a photo failed with
 * "This needs a server record before media upload." for every host who had
 * not added gallery photos (the cover is mandatory, so they were stuck).
 *
 * Root cause: the photo-cover branch in CoverPicker sent only `venue` and
 * `ad_creative` targets to brand-keyed storage. The wizard's `venue_draft`
 * target (no venue row yet, no events row ever) fell through to the
 * events-row upload with an empty row id, which throws
 * `missing_server_event_id`. The shared rule below now decides the branch.
 */
import { describe, expect, test } from "@jest/globals";

import {
  coverTargetHasUploadIdentity,
  coverTargetIsVenue,
  coverTargetUploadsToBrandStorage,
  type CoverTarget,
} from "../coverTarget";

const BRAND = "11111111-1111-4111-8111-111111111111";
const draft: CoverTarget = { kind: "venue_draft", brandId: BRAND, draftOwnerKey: "dv_abc" };
const venue: CoverTarget = { kind: "venue", brandId: BRAND, venueId: "v1" };
const event: CoverTarget = {
  kind: "event",
  brandId: BRAND,
  eventRowId: "",
  coverMediaApplyMode: "draft_auto",
};

describe("#4490 D6 — a venue draft cover uploads before any server row exists", () => {
  test("a venue draft has upload identity and goes to brand-keyed storage", () => {
    expect(coverTargetHasUploadIdentity(draft)).toBe(true);
    expect(coverTargetUploadsToBrandStorage(draft)).toBe(true);
  });

  test("saved venues and ad creatives keep their brand-storage path; events never take it", () => {
    expect(coverTargetUploadsToBrandStorage(venue)).toBe(true);
    expect(coverTargetUploadsToBrandStorage({ kind: "ad_creative", brandId: BRAND, ownerKey: "host-ad:x" })).toBe(true);
    expect(coverTargetUploadsToBrandStorage(event)).toBe(false);
    expect(coverTargetUploadsToBrandStorage({ kind: "brand", brandId: BRAND, accountId: "a", existingDescription: null })).toBe(false);
  });

  test("GIPHY / Pexels picks for a draft get the venue URL check, never a brand write", () => {
    expect(coverTargetIsVenue(draft)).toBe(true);
    expect(coverTargetIsVenue(venue)).toBe(true);
    expect(coverTargetIsVenue(event)).toBe(false);
  });

});
