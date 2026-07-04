// ORCH-1301 [close-hardening for ORCH-1298/1299 video cover display] — TESTER
// ADVERSARIAL regression protection.
//
// The two implementor tests pin ONE surface each and ONE literal cover binding:
//   - brandCoverVideoPreview.orch1298.test.ts → BrandEditView, draft.coverMediaUrl
//   - tripPreviewCoverVideo.orch1299.test.ts  → TripPreview (Legacy), trip.coverMediaUrl
//
// This file attacks a DIFFERENT, GENERALIZED angle across BOTH surfaces at once:
// on NEITHER file may ANY cover URL (draft/trip/brand.coverMediaUrl) reach a raw
// Image/ExpoImage/RNImage `source={{ uri: … }}`, and BOTH must bind the cover to
// the video-capable EventCoverMedia. It also proves the FoundationTripPreview
// hands the cover to the media-aware ParallaxCoverShell (not a raw Image) and that
// a VIDEO mediaType is actually wired to reach EventCoverMedia (never an Image).
//
// Source-structural (both are full RN screens — never mounted here). Fails-on-revert:
// reverting either fix restores `<Image source={{ uri: <cover>MediaUrl }}>` → the
// raw-image scans below trip; deleting the EventCoverMedia binding flips the
// binding scans.

import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const BUSINESS_ROOT = join(__dirname, "..");
const read = (rel: string): string =>
  readFileSync(join(BUSINESS_ROOT, rel), "utf8");

const stripComments = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

const BRAND_EDIT = stripComments(read("src/components/brand/BrandEditView.tsx"));
const TRIP_PREVIEW = stripComments(read("src/components/trip/TripPreview.tsx"));

// A raw Image/ExpoImage/RNImage whose source is a cover URL — the exact regression.
const RAW_COVER_IMAGE = /source=\{\{\s*uri:\s*[\w.]*coverMediaUrl\b/;
// A cover bound to EventCoverMedia (its `mediaUrl` prop; raw Image uses `source`).
const COVER_BOUND_TO_MEDIA = /mediaUrl=\{[\w.]*coverMediaUrl\b/;
const IMPORTS_EVENT_COVER_MEDIA =
  /import\s*\{[^}]*\bEventCoverMedia\b[^}]*\}\s*from\s*["'][^"']*EventCoverMedia["']/;

describe.each([
  ["BrandEditView.tsx", () => BRAND_EDIT],
  ["TripPreview.tsx", () => TRIP_PREVIEW],
])("ORCH-1301 — %s renders the cover through the video-capable EventCoverMedia", (_label, getSrc) => {
  it("imports EventCoverMedia", () => {
    expect(getSrc()).toMatch(IMPORTS_EVENT_COVER_MEDIA);
  });

  it("binds a cover to EventCoverMedia via mediaUrl={…coverMediaUrl}", () => {
    expect(getSrc()).toMatch(COVER_BOUND_TO_MEDIA);
  });

  it("does NOT render any cover URL through a raw Image source={{ uri: …coverMediaUrl }} (a video mp4 must not reach an Image)", () => {
    expect(getSrc()).not.toMatch(RAW_COVER_IMAGE);
  });
});

describe("ORCH-1301 — TripPreview: both the immersive shell AND the legacy review preview are video-capable", () => {
  it("FoundationTripPreview hands the cover to the media-aware ParallaxCoverShell (coverMediaUrl prop), not a raw Image", () => {
    // The parallax shell resolves image/gif/video itself; the cover flows in as a
    // prop, never a raw <Image source>.
    expect(TRIP_PREVIEW).toMatch(/coverMediaUrl=\{trip\.coverMediaUrl\}/);
  });

  it("a VIDEO cover mediaType is actually wired to reach EventCoverMedia (the coverType narrowing keeps 'video')", () => {
    // The narrowing maps a "video" cover to the component union so the mp4 renders
    // as video (never falls through to an image-only path).
    expect(TRIP_PREVIEW).toMatch(/coverMediaType\s*===\s*["']video["']\s*\?\s*["']video["']/);
    // …and that narrowed coverType is what EventCoverMedia / the shell receive.
    expect(TRIP_PREVIEW).toMatch(/mediaType=\{coverType\}/);
  });

  it("the LegacyTripPreview cover (review/checkout) binds trip.coverMediaUrl to EventCoverMedia", () => {
    expect(TRIP_PREVIEW).toMatch(
      /<EventCoverMedia[\s\S]{0,400}?mediaUrl=\{trip\.coverMediaUrl\}/,
    );
  });
});

describe("ORCH-1301 — BrandEditView: the brand cover preview is video-capable", () => {
  it("binds draft.coverMediaUrl + draft.coverMediaType to EventCoverMedia", () => {
    expect(BRAND_EDIT).toMatch(
      /<EventCoverMedia[\s\S]{0,600}?mediaUrl=\{draft\.coverMediaUrl/,
    );
    expect(BRAND_EDIT).toMatch(
      /<EventCoverMedia[\s\S]{0,600}?mediaType=\{draft\.coverMediaType/,
    );
  });

  it("does NOT import expo-image for the cover preview (the outlier raw-image path is gone)", () => {
    expect(BRAND_EDIT).not.toMatch(/from\s*["']expo-image["']/);
  });
});
