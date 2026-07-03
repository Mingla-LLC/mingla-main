// META-ORCH-1270 (Phase 1) — implementor happy-path test for the provider-aware
// poster derivation. A Bunny delivery URL (.../{guid}/play_{H}p.mp4) yields the
// auto-generated .../{guid}/thumbnail.jpg poster; a Cloudinary URL STILL yields
// the so_0 first-frame still (Cloudinary path kept until Phase 4).
//
// FAILS ON REVERT: delete the Bunny `/play_\d+p.mp4` branch in
// coverMediaPresentation.ts and the first assertion returns null → the test throws.

import { deriveCoverPosterUrl } from "../coverMediaPresentation";

describe("META-ORCH-1270 — deriveCoverPosterUrl is provider-aware (Bunny + Cloudinary)", () => {
  it("Bunny: play_{H}p.mp4 → thumbnail.jpg", () => {
    expect(
      deriveCoverPosterUrl("https://vz-abc123-x1.b-cdn.net/GUID-1/play_720p.mp4"),
    ).toBe("https://vz-abc123-x1.b-cdn.net/GUID-1/thumbnail.jpg");

    // Any rendition height maps to the same thumbnail.
    expect(
      deriveCoverPosterUrl("https://vz-abc123-x1.b-cdn.net/GUID-1/play_480p.mp4"),
    ).toBe("https://vz-abc123-x1.b-cdn.net/GUID-1/thumbnail.jpg");

    // Query string is dropped from the derived still.
    expect(
      deriveCoverPosterUrl("https://vz-abc123-x1.b-cdn.net/GUID-1/play_720p.mp4?token=xyz"),
    ).toBe("https://vz-abc123-x1.b-cdn.net/GUID-1/thumbnail.jpg");
  });

  it("Cloudinary: still yields the so_0 first-frame still (unchanged)", () => {
    expect(
      deriveCoverPosterUrl("https://res.cloudinary.com/x/video/upload/v1/abc.mp4"),
    ).toBe("https://res.cloudinary.com/x/video/upload/so_0/v1/abc.jpg");
  });

  it("Non-Bunny / non-Cloudinary / empty → null (placeholder shows, zero video bytes)", () => {
    expect(deriveCoverPosterUrl("https://storage.supabase.co/cover.png")).toBeNull();
    expect(deriveCoverPosterUrl(null)).toBeNull();
    expect(deriveCoverPosterUrl(undefined)).toBeNull();
    expect(deriveCoverPosterUrl("")).toBeNull();
  });
});
