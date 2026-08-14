import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const ROOT = process.cwd();
const require = createRequire(import.meta.url);
const {
  contentShareBusinessDestination,
  renderContentShareHtml,
} = require(path.join(ROOT, "mingla-business/server/socialPreview.js"));

const CODE = "Aa0Bb1Cc2Dd3Ee4F";
const SNIPPET = `https://usemingla.com/s/${CODE}`;
const IMAGE = `https://usemingla.com/og/s/${CODE}/v7-r2.jpg`;

const fixture = (kind, destination) => ({
  shortCode: CODE,
  version: 7,
  facts: {
    schemaVersion: 1,
    kind,
    title: `${kind} title`,
    description: `${kind} description`,
  },
  media: {
    kind: "photo",
    url: "https://images.pexels.com/photos/1/cover.jpg",
    posterUrl: "https://images.pexels.com/photos/1/cover.jpg",
  },
  destination,
  publicDetails: {
    kind,
    actionEligible: true,
    occurrences: [],
    offerings: [],
    stops: [],
  },
});

const publicCases = [
  ["event", { kind: "event", brandSlug: "art-roost", eventSlug: "new-forms", webPath: "/e/art-roost/new-forms" }, "https://host.usemingla.com/e/art-roost/new-forms"],
  ["rsvp_event", { kind: "rsvp_event", brandSlug: "art-roost", eventSlug: "opening-night", webPath: "/e/art-roost/opening-night" }, "https://host.usemingla.com/e/art-roost/opening-night"],
  ["trip", { kind: "trip", brandSlug: "lagos-art", eventSlug: "gallery-hop", webPath: "/t/lagos-art/gallery-hop" }, "https://host.usemingla.com/t/lagos-art/gallery-hop"],
  ["experience", { kind: "experience", brandSlug: "art-roost", eventSlug: "studio-tour", webPath: "/exp/art-roost/studio-tour" }, "https://host.usemingla.com/exp/art-roost/studio-tour"],
  ["venue", { kind: "venue", brandSlug: "art-roost", venueSlug: "lekki-gallery", webPath: "/b/art-roost/v/lekki-gallery" }, "https://host.usemingla.com/b/art-roost/v/lekki-gallery"],
  ["brand", { kind: "brand", brandSlug: "art-roost", webPath: "/b/art-roost" }, "https://host.usemingla.com/b/art-roost"],
];

test("all six Business public-page families retain rich snippet metadata and continue to their exact canonical page", () => {
  for (const [kind, destination, expected] of publicCases) {
    const contentShare = fixture(kind, destination);
    assert.equal(contentShareBusinessDestination(contentShare), expected, kind);
    const html = renderContentShareHtml(contentShare);
    const head = html.slice(0, html.indexOf("</head>"));
    assert.ok(head.includes(`<script>window.location.replace(${JSON.stringify(expected)})</script>`), kind);
    assert.ok(head.includes(`<link rel="canonical" href="${SNIPPET}" />`), kind);
    assert.ok(head.includes(`property="og:url" content="${SNIPPET}"`), kind);
    assert.ok(head.includes(`property="og:title" content="${kind} title on Mingla"`), kind);
    assert.ok(head.includes(`property="og:description" content="${kind} description"`), kind);
    assert.ok(head.includes(`property="og:image" content="${IMAGE}"`), kind);
    assert.ok(head.includes(`name="twitter:image" content="${IMAGE}"`), kind);
    assert.ok(html.includes(`href="${expected}"`), kind);
  }
});

test("Explorer-only kinds stay on the rich snippet receiver", () => {
  for (const kind of ["place", "curated"]) {
    const contentShare = fixture(kind, { kind });
    assert.equal(contentShareBusinessDestination(contentShare), null);
    const html = renderContentShareHtml(contentShare);
    assert.doesNotMatch(html, /window\.location\.replace/);
    assert.ok(html.includes(`property="og:url" content="${SNIPPET}"`));
  }
});

test("untrusted or internally inconsistent destinations fail closed", () => {
  const invalid = [
    fixture("event", { kind: "trip", brandSlug: "art-roost", eventSlug: "new-forms", webPath: "/e/art-roost/new-forms" }),
    fixture("event", { kind: "event", brandSlug: "art-roost", webPath: "/e/art-roost/new-forms" }),
    fixture("event", { kind: "event", brandSlug: "art-roost", eventSlug: "new-forms", webPath: "/e/other/new-forms" }),
    fixture("event", { kind: "event", brandSlug: "art-roost", eventSlug: "new-forms", webPath: "//evil.example/path" }),
    fixture("brand", { kind: "brand", brandSlug: "safe/../../escape", webPath: "/b/safe/../../escape" }),
  ];
  for (const contentShare of invalid) {
    assert.equal(contentShareBusinessDestination(contentShare), null);
    assert.doesNotMatch(renderContentShareHtml(contentShare), /window\.location\.replace/);
  }
});
