import fs from "node:fs";

const paths = {
  eventFoundation: "mingla-business/src/components/event/FoundationEventPreview.tsx",
  eventRoute: "mingla-business/src/components/event/PublicEventPage.tsx",
  tripRoute: "mingla-business/app/t/[brandSlug]/[tripSlug].tsx",
  brandRoute: "mingla-business/app/b/[brandSlug]/index.tsx",
  venueRoute: "mingla-business/app/b/[brandSlug]/v/[venueSlug].tsx",
  experience: "mingla-business/src/components/experience/ExperiencePreview.tsx",
  rsvp: "mingla-business/src/components/event/FoundationRsvpPreview.tsx",
  shell: "packages/offering-rendering/ParallaxCoverShell.tsx",
  brandRenderer: "packages/brand-rendering/PublicBrandPage.tsx",
  venueRenderer: "packages/brand-rendering/PublicVenueScreen.tsx",
  tripRenderer: "mingla-business/src/components/trip/TripPreview.tsx",
  explorer: "app-mobile/app/s/[code].tsx",
  social: "mingla-business/server/socialPreview.js",
  cardRenderer: "mingla-business/server/cardIdentityRenderer.js",
  ogEvent: "mingla-business/api/og-event.js",
  ogTrip: "mingla-business/api/og-trip.js",
  ogBrand: "mingla-business/api/og-brand.js",
  ogVenue: "mingla-business/api/og-venue.js",
};

const baseline = Object.fromEntries(
  Object.entries(paths).map(([key, file]) => [key, fs.readFileSync(file, "utf8")]),
);
const activation = /(?:useDirectionCIdentity\b|directionCIdentity=)/;
const need = (source, needle, label) => {
  if (!source.includes(needle)) throw new Error(`issue #1960 missing ${label}`);
};

export function enforce(s) {
  for (const key of ["eventFoundation", "eventRoute", "tripRoute", "brandRoute", "venueRoute"]) {
    if (activation.test(s[key])) throw new Error(`issue #1960 destination share-art activation in ${key}`);
  }
  for (const key of ["experience", "rsvp"]) {
    if (activation.test(s[key])) throw new Error(`issue #1960 widened into ${key}`);
  }
  need(s.shell, "directionCIdentity?:", "dormant shell capability");
  need(s.shell, "directionCIdentity ? (", "default-off shell branch");
  need(s.brandRenderer, "useDirectionCIdentity = false", "brand default-off seam");
  need(s.venueRenderer, "useDirectionCIdentity = false", "venue default-off seam");
  need(s.tripRenderer, "useDirectionCIdentity = false", "trip default-off seam");
  for (const needle of ["readContentShare", "buildSharePortraitUrl", "destinationPath"]) {
    need(s.explorer, needle, `Explorer ${needle}`);
  }
  need(s.social, "renderContentShareHtml", "web share page renderer");
  need(s.cardRenderer, "renderCardIdentityPng", "S4/S5 renderer");
  need(s.cardRenderer, "renderContentSharePortraitJpeg", "portrait renderer");
  for (const key of ["ogEvent", "ogTrip", "ogBrand", "ogVenue"]) {
    need(s[key], "renderCardIdentityPng", `${key} identity renderer`);
  }
}

if (process.argv.includes("--self-test")) {
  const mutations = [
    ["eventFoundation", (s) => `${s}\ndirectionCIdentity={{ title: "bad" }}`],
    ["eventRoute", (s) => `${s}\nuseDirectionCIdentity`],
    ["tripRoute", (s) => `${s}\nuseDirectionCIdentity`],
    ["brandRoute", (s) => `${s}\nuseDirectionCIdentity`],
    ["venueRoute", (s) => `${s}\nuseDirectionCIdentity`],
    ["experience", (s) => `${s}\ndirectionCIdentity={{ title: "bad" }}`],
    ["rsvp", (s) => `${s}\nuseDirectionCIdentity`],
    ["shell", (s) => s.replace("directionCIdentity?:", "removed?:")],
    ["brandRenderer", (s) => s.replace("useDirectionCIdentity = false", "useDirectionCIdentity = true")],
    ["venueRenderer", (s) => s.replace("useDirectionCIdentity = false", "useDirectionCIdentity = true")],
    ["tripRenderer", (s) => s.replace("useDirectionCIdentity = false", "useDirectionCIdentity = true")],
    ["explorer", (s) => s.replaceAll("readContentShare", "removedRead")],
    ["social", (s) => s.replaceAll("renderContentShareHtml", "removedHtml")],
    ["cardRenderer", (s) => s.replaceAll("renderCardIdentityPng", "removedPng")],
    ["cardRenderer", (s) => s.replaceAll("renderContentSharePortraitJpeg", "removedPortrait")],
    ["ogEvent", (s) => s.replaceAll("renderCardIdentityPng", "removedPng")],
    ["ogTrip", (s) => s.replaceAll("renderCardIdentityPng", "removedPng")],
    ["ogBrand", (s) => s.replaceAll("renderCardIdentityPng", "removedPng")],
    ["ogVenue", (s) => s.replaceAll("renderCardIdentityPng", "removedPng")],
  ];
  for (const [key, mutate] of mutations) {
    const candidate = { ...baseline, [key]: mutate(baseline[key]) };
    let failed = false;
    try { enforce(candidate); } catch { failed = true; }
    if (!failed) throw new Error(`issue #1960 self-test mutation escaped: ${key}`);
  }
  console.log(`issue #1960 self-test passed (${mutations.length} mutations)`);
} else {
  enforce(baseline);
  console.log("issue #1960 share-art isolation passed");
}
