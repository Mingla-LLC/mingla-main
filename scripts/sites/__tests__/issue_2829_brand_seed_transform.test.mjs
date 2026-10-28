// #2829 W7b — the local brand seed: the Payload seed recorder runs a brand's
// own seed against an in-memory stand-in (no Payload, no network), and the
// transform maps what it recorded to Mingla records. Everything here is an
// invented, neutral fixture; no brand's content is in this repository.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { corePlan, groupSize, lexicalToText, mediaNeeded, sitePlan } from "../local/lib/brand-seed-transform.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const recorder = resolve(here, "../local/lib/payload-seed-recorder");
const sha = (value) => createHash("sha256").update(value).digest("hex");
const lexical = (...lines) => ({ root: { type: "root", children: lines.map((text) => ({ type: "paragraph", children: [{ type: "text", text }] })) } });

function recorded() {
  return {
    documents: [
      { collection: "media", id: 1, data: { alt: "A field" }, file: "/src/images/101_field.jpg" },
      { collection: "media", id: 2, data: { alt: "" }, file: "/src/images/102_travel_explore.svg" },
      { collection: "media", id: 3, data: { alt: "Logo" }, file: "/src/images/logo.webp" },
      { collection: "videos", id: 4, data: {}, file: "/src/video/film.mp4" },
      { collection: "forms", id: 5, data: { fields: [
        { blockType: "text", name: "name", placeholder: "Fixture name" },
        { blockType: "email", name: "email", placeholder: "Fixture email" },
        { blockType: "textarea", name: "message", label: "Fixture message", placeholder: "Fixture hint" },
      ], submitButtonLabel: "Go" } },
      { collection: "trips", id: 6, data: { title: "Fixture Trip", slug: "fixture-trip", location: "Fixture Bay", groupSize: "4-12", priceFrom: 1234.5, featuredImage: 1, startDate: "2026-05-01T00:00:00.000Z", endDate: "2026-05-08T00:00:00.000Z", overview: lexical("First line.", "Second line."), itinerary: [{ label: "Day 1", title: "Arrive", body: "Fixture body." }, { label: "Day 2", title: "  " }], faqs: [{ question: "Fixture Q?", answer: "Fixture A." }], gallery: [{ image: 1 }], whatToPrepare: lexical("Bring boots.") } },
      { collection: "trips", id: 7, data: { title: "Older Trip", slug: "older-trip", startDate: "2025-01-01T00:00:00.000Z", endDate: "2025-01-03T00:00:00.000Z", overview: lexical("Old.") } },
      { collection: "destinations", id: 8, data: { title: "Fixture Land", slug: "fixture-land", relatedTrips: [6, 99] } },
      { collection: "categories", id: 9, data: { title: "Notes", slug: "notes" } },
      { collection: "posts", id: 10, data: { title: "Fixture Post", slug: "fixture-post", publishedAt: "2025-12-03T14:52:30", category: 9, featuredImage: 1, content: lexical("Body.") } },
      { collection: "pages", id: 11, data: { title: "Home", slug: "home", layout: [
        { blockType: "hero", headingLines: [{ text: "Line one." }, { text: "Line two." }], backgroundImage: 1, showSearch: true },
        { blockType: "valueCards", cards: [{ title: "Card", body: "Body", icon: 2 }] },
        { blockType: "tripsGrid", heading: "Soon", show: "upcoming" },
        { blockType: "storiesGrid", heading: "Notes", limit: 3, link: { label: "All notes", href: "/notes" } },
      ] } },
      { collection: "pages", id: 12, data: { title: "Trips", slug: "journeys", layout: [{ blockType: "tripsGrid", heading: "All", show: "all", showFilters: true }] } },
      { collection: "pages", id: 13, data: { title: "Notes", slug: "notes", layout: [{ blockType: "storiesGrid", heading: "Every note" }] } },
      { collection: "pages", id: 14, data: { title: "About", slug: "about", layout: [
        { blockType: "videoFeature", coverImage: 1, video: 4 },
        { blockType: "tripHistory", heading: "Trips so far", intro: "Fixture intro." },
        { blockType: "contactForm", form: 5 },
        { blockType: "faqs", items: [{ question: "Q", answer: "A" }] },
      ] } },
    ],
    globals: {
      "site-settings": { siteName: "Fixture Co", tagline: "Fixture tagline", email: "hello@fixture.invalid" },
      header: { logo: 3, navItems: [{ label: "Trips", href: "/journeys" }, { label: "More", children: [{ label: "About", href: "/about" }] }] },
      footer: { taglineLines: [{ text: "One." }], columns: [{ heading: "Info", links: [{ label: "About", href: "/about" }] }], socials: [{ network: "instagram", href: "https://example.invalid/x" }], copyright: "© Fixture Co" },
    },
    modules: {},
  };
}

const ARCHIVE = {
  PAST_TRIPS: [
    { title: "Run A", location: "Fixture Hill", date: "2025-01-10T00:00:00.000Z", series: "Hill runs" },
    { title: "Run B", location: "Fixture Hill", date: "2025-01-17T00:00:00.000Z", series: "Hill runs" },
    { title: "Fixture Trip", location: "Fixture Bay", date: "2026-05-01T00:00:00.000Z", trip: "fixture-trip" },
  ],
  REVIEWS: [{ quote: "Fixture quote.", reviewer: "Fixture R", reviewDate: "2026-02-01T00:00:00.000Z", tripName: "Run A" }],
};
const TEXT = {
  emptyBody: "Fixture empty sentence.",
  emptyAction: { label: "Write to us", href: "/about" },
  headerCta: { label: "See trips", href: "/journeys" },
  newsletterPlaceholder: "Fixture email box",
  timezone: "America/New_York",
  redirects: [{ source: "/old", destination: "/journeys", permanent: true }],
};

test("helpers: group size and rich text to plain text", () => {
  assert.deepEqual(groupSize("15-30"), { minimum: 15, maximum: 30 });
  assert.deepEqual(groupSize("30-15"), { minimum: null, maximum: null });
  assert.deepEqual(groupSize("about ten"), { minimum: null, maximum: null });
  assert.equal(lexicalToText(lexical("a", "b")), "a\n\nb");
});

test("core plan: trip documents become Mingla trips, the archive becomes history + reviews", () => {
  const plan = corePlan(recorded(), { brandId: "b", archive: ARCHIVE, hash: sha, sourceNote: "fixture" });
  const trip = plan.trips.find((row) => row.slug === "fixture-trip");
  assert.equal(trip.start_date, "2026-05-01");
  assert.equal(trip.price_minor, 123450);
  assert.deepEqual([trip.group_minimum, trip.capacity], [4, 12]);
  assert.equal(trip.description, "First line.\n\nSecond line.");
  assert.deepEqual(trip.days.map((day) => day.ordinal), [1, 2]);
  assert.deepEqual(trip.guide.faqs, [{ question: "Fixture Q?", answer: "Fixture A." }]);
  assert.equal(plan.historyFile.trips.length, 3);
  assert.ok(plan.historyFile.trips.every((row) => /^history:[0-9a-f]{16}$/.test(row.import_key) && row.timezone === "America/New_York"));
  assert.equal(plan.historyFile.trips[0].series, "Hill runs");
  assert.equal(plan.linkedHistoryKeys.length, 1);
  assert.deepEqual(plan.historyFile.reviews[0], { quote: "Fixture quote.", reviewer: "Fixture R", review_date: "2026-02-01", trip_name: "Run A", trip_import_key: plan.historyFile.trips[0].import_key, source_note: "fixture", confirmed_real: true });
});

// #2829 W7c (A13.4) — reviews are attached to their trip in the data.
test("core plan: a review naming an archive trip is attached to it; an unknown name stays text", () => {
  const archive = {
    PAST_TRIPS: [
      { title: "Ski Week", location: "Fixture Alps", date: "2025-03-01T00:00:00.000Z" },
      { title: "SKI  week", location: "Fixture Alps", date: "2026-03-01T00:00:00.000Z" },
      { title: "Ski Week", location: "Fixture Alps", date: "2027-03-01T00:00:00.000Z" },
    ],
    REVIEWS: [
      { quote: "Q1.", reviewer: "R1", reviewDate: "2026-03-20T00:00:00.000Z", tripName: "Ski Week" },
      { quote: "Q2.", reviewer: "R2", reviewDate: "2026-03-20T00:00:00.000Z", tripName: "group ski trip" },
      { quote: "Q3.", reviewer: "R3", reviewDate: "2026-03-20T00:00:00.000Z" },
    ],
  };
  const plan = corePlan(recorded(), { brandId: "b", archive, hash: sha, sourceNote: "fixture" });
  const [, second] = plan.historyFile.trips;
  assert.equal(plan.historyFile.reviews[0].trip_import_key, second.import_key);
  assert.equal(plan.historyFile.reviews[0].trip_name, "Ski Week");
  assert.equal("trip_import_key" in plan.historyFile.reviews[1], false);
  assert.equal(plan.historyFile.reviews[1].trip_name, "group ski trip");
  assert.equal("trip_import_key" in plan.historyFile.reviews[2], false);
});

test("site plan: blocks, index pages, navigation, redirects, collections", () => {
  const refs = {
    media: (id) => `m${id}`,
    video: (id) => `v${id}`,
    trip: (id) => (id === 6 ? { id: "t6", public_url: "https://host.example.invalid/t/fixture/fixture-trip" } : id === 7 ? { id: "t7", public_url: "https://host.example.invalid/t/fixture/older-trip" } : null),
    tripsNewestFirst: ["t6", "t7"],
    history: ["h1", "h2", "h3"],
    series: [{ label: "Hill runs", offering_ids: ["h1", "h2"] }],
    linkedHistory: ["h3"],
  };
  const plan = sitePlan(recorded(), refs, TEXT);
  const home = plan.pages.find((page) => page.slug === "");
  assert.deepEqual(home.blocks.map((block) => block.blockType), ["hero", "feature_cards", "offering_grid", "story_grid"]);
  assert.equal(home.blocks[0].heading, "Line one. Line two.");
  assert.equal(home.blocks[1].cards[0].icon, "travel_explore");
  assert.deepEqual(home.blocks[2].offering_ids, [], "an upcoming grid lists whatever Mingla has");
  assert.equal(home.blocks[2].empty_text, "Fixture empty sentence.");
  const trips = plan.pages.find((page) => page.slug === "journeys");
  assert.equal(trips.kind, "collection_index");
  assert.deepEqual(trips.blocks[0].offering_ids, [{ offering_id: "t6" }, { offering_id: "t7" }], "a full listing picks the brand's trip documents, newest first");
  assert.deepEqual(plan.pages.find((page) => page.slug === "notes").collection_kind, "stories");
  const about = plan.pages.find((page) => page.slug === "about");
  const history = about.blocks.find((block) => block.blockType === "offering_history");
  assert.deepEqual(history.offering_ids.map((row) => row.offering_id), ["h1", "h2", "h3"]);
  assert.deepEqual(history.linked_offering_ids, [{ offering_id: "h3" }]);
  const form = about.blocks.find((block) => block.blockType === "contact_form");
  assert.deepEqual([form.name_placeholder, form.email_placeholder, form.message_label, form.submit_label], ["Fixture name", "Fixture email", "Fixture message", "Go"]);
  assert.equal(form.fallback_email, undefined, "no standing fallback line under a working form");
  assert.deepEqual(plan.settings.routes, { stories: "", trips: "journeys" });
  assert.deepEqual(plan.settings.redirects, [
    { from: "/old", to: "/journeys", status: 308 },
    { from: "/journeys/fixture-trip", to: "https://host.example.invalid/t/fixture/fixture-trip", status: 308 },
    { from: "/journeys/older-trip", to: "https://host.example.invalid/t/fixture/older-trip", status: 308 },
  ]);
  assert.equal(plan.settings.design, "voyage");
  assert.deepEqual(plan.navigation.items[1], { label: "More", page_slug: "about", children: [{ label: "About", page_slug: "about" }] });
  assert.deepEqual(plan.navigation.header_cta, { label: "See trips", page_slug: "journeys" });
  assert.deepEqual(plan.destinations[0].related_offerings, [{ offering_id: "t6" }], "an unknown related trip is dropped");
  assert.equal(plan.stories[0].published_at, "2025-12-03T12:00:00.000Z", "a story keeps its calendar day");
  assert.deepEqual(mediaNeeded(recorded()).map((row) => row.id).sort(), [1, 3]);
});

test("site plan refuses a block it cannot map (never drops content silently)", () => {
  const data = recorded();
  data.documents.find((doc) => doc.slug === undefined && doc.collection === "pages").data.layout.push({ blockType: "mystery" });
  assert.throws(() => sitePlan(data, { media: () => null, video: () => null, trip: () => null, tripsNewestFirst: [], history: [], series: [], linkedHistory: [] }, TEXT), /UNMAPPED_BLOCK:mystery/);
});

test("the recorder runs a seed against the stand-in: no Payload, nothing written but --out", () => {
  const dir = mkdtempSync(join(tmpdir(), "seed-recorder-"));
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src/extra.ts"), "export const ITEMS: { name: string }[] = [{ name: 'fixture' }]\n");
  writeFileSync(join(dir, "src/run.ts"), [
    "import 'dotenv/config'",
    "import { getPayload } from 'payload'",
    "import type { Payload } from 'payload'",
    "import config from './payload.config'",
    "import { ITEMS } from './extra'",
    "export async function seed(): Promise<void> {",
    "  const payload: Payload = await getPayload({ config })",
    "  const found = await payload.find({ collection: 'pages', where: {} })",
    "  if (found.docs.length) throw new Error('stand-in should be empty')",
    "  const media = await payload.create({ collection: 'media', data: { alt: 'x' }, filePath: '/f/a.jpg' })",
    "  await payload.create({ collection: 'pages', data: { title: ITEMS[0].name, image: media.id } })",
    "  await payload.updateGlobal({ slug: 'footer', data: { copyright: 'c' } })",
    "}",
  ].join("\n"));
  const out = join(dir, "out.json");
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "--import", resolve(recorder, "register.mjs"), resolve(recorder, "extract.mjs"),
    "--source", dir, "--seed", "src/run.ts", "--export", "seed", "--module", "src/extra.ts", "--out", out], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PAYLOAD_SEED_RECORDED documents=2 globals=1/);
  const value = JSON.parse(readFileSync(out, "utf8"));
  assert.deepEqual(value.documents.map((doc) => [doc.collection, doc.id]), [["media", 1], ["pages", 2]]);
  assert.equal(value.documents[0].file, "/f/a.jpg");
  assert.deepEqual(value.documents[1].data, { title: "fixture", image: 1 });
  assert.deepEqual(value.globals.footer, { copyright: "c" });
  assert.deepEqual(value.modules["src/extra.ts"], { ITEMS: [{ name: "fixture" }] });
});
