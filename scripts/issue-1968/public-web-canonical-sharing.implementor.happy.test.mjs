import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

const coverSources = [
  "packages/offering-rendering/ParallaxCoverShell.tsx",
  "packages/brand-rendering/PublicBrandPage.tsx",
  "mingla-business/src/components/event/FoundationEventPreview.tsx",
  "mingla-business/src/components/event/FoundationRsvpPreview.tsx",
  "mingla-business/src/components/trip/TripPreview.tsx",
  "mingla-business/src/components/experience/ExperiencePreview.tsx",
];

const publicShareSources = [
  "mingla-business/src/components/event/PublicEventPage.tsx",
  "mingla-business/src/components/brand/PublicBrandPage.tsx",
  "mingla-business/app/b/[brandSlug]/v/[venueSlug].tsx",
  "mingla-business/app/t/[brandSlug]/[tripSlug].tsx",
  "mingla-business/app/exp/[brandSlug]/[experienceSlug].tsx",
];

test("desktop public covers have no second date/title caption owner", () => {
  const shell = read(coverSources[0]);
  assert.doesNotMatch(shell, /desktopHeroCaption|heroEyebrow\??:|heroTitle\??:/);
  for (const file of coverSources.slice(1)) {
    assert.doesNotMatch(read(file), /heroEyebrow=|heroTitle=/, file);
  }
});

test("all anonymous public web route families share their canonical URL directly", () => {
  for (const file of publicShareSources) {
    const source = read(file);
    assert.match(source, /Platform\.OS === "web"/, file);
    assert.match(source, /shareCanonicalPublicPageOnWeb\(/, file);
    assert.match(source, /<ShareModal/, `${file} must retain native ShareModal`);
  }

  const event = read(publicShareSources[0]);
  assert.match(event, /url: canonicalUrl\(event\)/);
  const brand = read(publicShareSources[1]);
  assert.match(brand, /url: canonicalUrl\(brand\)/);
  const venue = read(publicShareSources[2]);
  assert.match(venue, /url: venuePublicUrl\(\{ brandSlug, venueSlug \}\)/);
  const trip = read(publicShareSources[3]);
  assert.match(trip, /url: tripPublicUrl\(\{ brandSlug, tripSlug \}\)/);
  const experience = read(publicShareSources[4]);
  assert.match(
    experience,
    /url: experiencePublicUrl\(\{ brandSlug, experienceSlug \}\)/,
  );

  const helper = read(
    "mingla-business/src/utils/shareCanonicalPublicPageOnWeb.ts",
  );
  assert.match(helper, /await sharePublicUrl\(input\)/);
  assert.match(helper, /await copyPublicUrl\(input\.url\)/);
  assert.match(helper, /name === "AbortError"/);
  assert.doesNotMatch(helper, /prepareBusinessContentShare|buildShortShareUrl/);
});

test("canonical experience URLs use the UA-independent shared public-search handler", () => {
  const vercel = JSON.parse(read("mingla-business/vercel.json"));
  const rewrite = vercel.rewrites.find(
    (entry) => entry.source === "/exp/:brandSlug/:experienceSlug",
  );
  assert.equal(
    rewrite?.destination,
    "/api/public-experience?brandSlug=:brandSlug&experienceSlug=:experienceSlug",
  );
  assert.equal(Object.hasOwn(rewrite ?? {}, "has"), false);

  const handler = read("mingla-business/api/public-experience.js");
  assert.match(
    handler,
    /handlePublicSearchDocument\(\{ req, res, kind: "experience", slugs: \[brandSlug, experienceSlug\] \}\)/,
  );
  assert.doesNotMatch(handler, /user-agent|socialPreview|renderExperienceHtml|renderNotFoundHtml/);

  const shared = read("mingla-business/server/publicSearchDocument.js");
  assert.match(shared, /const handlePublicSearchDocument = async/);
  assert.match(shared, /resolution\.kind !== kind/);
  assert.match(shared, /facts\.kind !== kind/);
});

test("Explorer custom sharing and both snippet systems remain protected", () => {
  const vercel = JSON.parse(read("mingla-business/vercel.json"));
  assert.ok(
    vercel.rewrites.some(
      (entry) =>
        entry.source === "/s/:code" &&
        entry.destination === "/api/content-share?code=:code",
    ),
  );
  const social = read("mingla-business/server/socialPreview.js");
  assert.match(social, /renderContentShareHtml/);
  assert.match(social, /const canonicalUrl = `\$\{EXPLORER_PUBLIC_ORIGIN\}\/s\//);
  assert.match(social, /property="og:title"/);
  assert.match(social, /property="og:description"/);
  assert.match(social, /property="og:image"/);

  const producer = read(
    "mingla-business/src/services/contentShareAdapter.ts",
  );
  assert.match(producer, /buildShortShareUrl/);
  assert.match(producer, /createContentShare/);
  assert.match(read("app-mobile/app/s/[code].tsx"), /readContentShare/);
});
