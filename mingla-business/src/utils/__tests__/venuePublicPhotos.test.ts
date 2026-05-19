import { describe, expect, test } from "@jest/globals";

import { buildVenueGalleryPhotoUrls } from "../venuePublicPhotos";

describe("buildVenueGalleryPhotoUrls", () => {
  test("prefers operator cover and profile over pool photos", () => {
    expect(
      buildVenueGalleryPhotoUrls({
        coverMediaUrl: "https://cdn/cover.jpg",
        profilePhotoUrl: "https://cdn/profile.jpg",
        poolPhotoUrls: ["https://pool/a.jpg"],
      }),
    ).toEqual(["https://cdn/cover.jpg", "https://cdn/profile.jpg"]);
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
