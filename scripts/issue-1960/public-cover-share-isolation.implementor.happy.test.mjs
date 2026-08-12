import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (file) => fs.readFileSync(file, "utf8");

const ordinaryPublicPages = [
  "mingla-business/src/components/event/FoundationEventPreview.tsx",
  "mingla-business/src/components/event/PublicEventPage.tsx",
  "mingla-business/app/t/[brandSlug]/[tripSlug].tsx",
  "mingla-business/app/b/[brandSlug]/index.tsx",
  "mingla-business/app/b/[brandSlug]/v/[venueSlug].tsx",
];

test("ordinary Business destination pages do not opt into share-art overlays", () => {
  for (const file of ordinaryPublicPages) {
    assert.doesNotMatch(read(file), /(?:useDirectionCIdentity\b|directionCIdentity=)/, file);
  }
});

test("dormant rendering capability remains default-off", () => {
  const shell = read("packages/offering-rendering/ParallaxCoverShell.tsx");
  const brand = read("packages/brand-rendering/PublicBrandPage.tsx");
  const venue = read("packages/brand-rendering/PublicVenueScreen.tsx");
  const trip = read("mingla-business/src/components/trip/TripPreview.tsx");
  assert.match(shell, /directionCIdentity\?:/);
  assert.match(shell, /directionCIdentity \? \(/);
  assert.match(brand, /useDirectionCIdentity = false/);
  assert.match(venue, /useDirectionCIdentity = false/);
  assert.match(trip, /useDirectionCIdentity = false/);
});

test("Explorer and web share ownership remains intact", () => {
  const explorer = read("app-mobile/app/s/[code].tsx");
  for (const needle of ["readContentShare", "buildSharePortraitUrl", "destinationPath"]) {
    assert.ok(explorer.includes(needle), needle);
  }
  const social = read("mingla-business/server/socialPreview.js");
  assert.match(social, /renderContentShareHtml/);
  const renderer = read("mingla-business/server/cardIdentityRenderer.js");
  assert.match(renderer, /renderCardIdentityPng/);
  assert.match(renderer, /renderContentSharePortraitJpeg/);
  for (const file of ["event", "trip", "brand", "venue"]) {
    assert.match(read(`mingla-business/api/og-${file}.js`), /renderCardIdentityPng/);
  }
});

test("Experience and RSVP remain outside this regression fix", () => {
  assert.doesNotMatch(
    read("mingla-business/src/components/experience/ExperiencePreview.tsx"),
    /(?:useDirectionCIdentity\b|directionCIdentity=)/,
  );
  assert.doesNotMatch(
    read("mingla-business/src/components/event/FoundationRsvpPreview.tsx"),
    /(?:useDirectionCIdentity\b|directionCIdentity=)/,
  );
});
