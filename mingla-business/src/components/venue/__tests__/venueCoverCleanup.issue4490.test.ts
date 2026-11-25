import { unreferencedPreviousCoverUrls } from "../venueCoverCleanup";

describe("#4490 venue cover cleanup", () => {
  // MINGLA-INVARIANT: I-4490-VENUE-GALLERY-OWNS-SHARED-COVER | issue #4490 | replacing a venue hero cannot delete an object still referenced by its gallery.
  test("retains a previous photo cover while the saved gallery still uses it", () => {
    const sharedPhoto = "https://storage.example/gallery/photo-1.jpg";

    expect(
      unreferencedPreviousCoverUrls(
        {
          coverMediaUrl: sharedPhoto,
          coverMediaPosterUrl: sharedPhoto,
        },
        {
          coverMediaUrl: "https://video.example/processed.mp4",
          coverMediaPosterUrl: "https://video.example/poster.jpg",
        },
        [sharedPhoto, "https://storage.example/gallery/photo-2.jpg"],
      ),
    ).toEqual([]);
  });

  test("removes only superseded objects with no remaining reference", () => {
    expect(
      unreferencedPreviousCoverUrls(
        {
          coverMediaUrl: "https://storage.example/old-cover.jpg",
          coverMediaPosterUrl: "https://storage.example/old-poster.jpg",
        },
        {
          coverMediaUrl: "https://storage.example/new-cover.jpg",
          coverMediaPosterUrl: "https://storage.example/old-poster.jpg",
        },
        [],
      ),
    ).toEqual(["https://storage.example/old-cover.jpg"]);
  });
});
