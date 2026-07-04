// ORCH-1299 [trip cover-video doesn't display on review/checkout] — regression.
//
// TripPreview's LEGACY path (LegacyTripPreview — the wizard Step-5 review +
// checkout preview) rendered the trip cover with a raw
// <Image source={{ uri: trip.coverMediaUrl }}>. A VIDEO cover's coverMediaUrl is
// a Bunny …/play_720p.mp4 that an Image cannot render → the cover came up empty.
// The fix renders it through the shared, media-aware EventCoverMedia (image /
// gif / video / empty), narrowing the wide `coverMediaType: string | null` to the
// component union — and, because this is a review/CHECKOUT preview, as a calm
// still poster (autoplay/playbackActive false).
//
// Source-structural (TripPreview is a full RN screen — the RTL render proofs run
// under their own configs). Fails-on-revert: on origin/main LegacyTripPreview
// uses the raw Image + "No cover image" placeholder and no EventCoverMedia bound
// to trip.coverMediaUrl → the assertions below flip.

import { readFileSync } from "node:fs";
import { join } from "node:path";

const businessRoot = join(__dirname, "..", "..", "..", "..");
const read = (rel: string): string => readFileSync(join(businessRoot, rel), "utf8");

const stripComments = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

const SRC = stripComments(read("src/components/trip/TripPreview.tsx"));

describe("ORCH-1299 — trip review/checkout preview renders the cover via EventCoverMedia", () => {
  it("renders the trip cover through EventCoverMedia bound to trip.coverMediaUrl + narrowed coverType", () => {
    expect(SRC).toMatch(
      /<EventCoverMedia[\s\S]{0,400}?mediaUrl=\{trip\.coverMediaUrl\}/,
    );
    expect(SRC).toMatch(
      /mediaUrl=\{trip\.coverMediaUrl\}[\s\S]{0,200}?mediaType=\{coverType\}/,
    );
  });

  it("uses a calm still poster in the checkout preview (no autoplay)", () => {
    expect(SRC).toMatch(
      /mediaUrl=\{trip\.coverMediaUrl\}[\s\S]{0,400}?autoplay=\{false\}/,
    );
    expect(SRC).toMatch(
      /mediaUrl=\{trip\.coverMediaUrl\}[\s\S]{0,400}?playbackActive=\{false\}/,
    );
  });

  it("does NOT render the trip cover via a raw Image (which cannot display a video mp4)", () => {
    expect(SRC).not.toMatch(/source=\{\{\s*uri:\s*trip\.coverMediaUrl\s*\}\}/);
    // The legacy text placeholder is gone — EventCoverMedia renders the empty state.
    expect(SRC).not.toMatch(/No cover image/);
  });
});
