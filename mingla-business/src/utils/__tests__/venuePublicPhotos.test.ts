import { describe, expect, test } from "@jest/globals";

import { buildVenueGalleryPhotoUrls } from "../venuePublicPhotos";

describe("buildVenueGalleryPhotoUrls", () => {
  /**
   * [TEST-MOD-APPROVED #1561] — this test used to assert that a venue WITH a
   * cover published ONLY that cover, i.e. it pinned the early return
   * `if (urls.length > 0) return urls;` as the contract.
   *
   * That early return is the root cause #1550 Leg C measured on live
   * production: a `PHOTOS` heading — plural — over a single 240x180 tile that
   * was a shrunken duplicate of the hero, because the operator's whole uploaded
   * gallery was fetched by `venue_public_view` and then thrown away one line
   * before it was read. #1561 deletes it.
   *
   * The ORDER contract is unchanged and is what this test now pins: the
   * operator's cover first, then their profile photo, then the place-pool set.
   * The assertion is strictly STRONGER than the one it replaces — it names
   * every element and its position, where the old one named two.
   */
  test("ORDER: operator cover, then profile, then the pool photos", () => {
    expect(
      buildVenueGalleryPhotoUrls({
        coverMediaUrl: "https://cdn/cover.jpg",
        profilePhotoUrl: "https://cdn/profile.jpg",
        poolPhotoUrls: ["https://pool/a.jpg", "https://pool/b.jpg"],
      }),
    ).toEqual([
      "https://cdn/cover.jpg",
      "https://cdn/profile.jpg",
      "https://pool/a.jpg",
      "https://pool/b.jpg",
    ]);
  });

  test("falls back to pool when operator photos are absent", () => {
    expect(
      buildVenueGalleryPhotoUrls({
        coverMediaUrl: null,
        profilePhotoUrl: "",
        poolPhotoUrls: ["https://pool/a.jpg", "https://pool/b.jpg"],
      }),
    ).toEqual(["https://pool/a.jpg", "https://pool/b.jpg"]);
  });

  test("returns empty when no sources exist", () => {
    expect(
      buildVenueGalleryPhotoUrls({
        coverMediaUrl: null,
        profilePhotoUrl: null,
        poolPhotoUrls: [],
      }),
    ).toEqual([]);
  });
});
