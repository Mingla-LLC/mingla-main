import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (file) => fs.readFileSync(file, "utf8");

test("custom sharing remains confined to native public pages and management surfaces", () => {
  const helper = read(
    "mingla-business/src/utils/shareCanonicalPublicPageOnWeb.ts",
  );
  assert.match(helper, /Platform\.OS !== "web"/);
  assert.match(helper, /throw new Error\("canonical_public_web_share_requires_web"\)/);
  assert.match(helper, /if \(isShareCancellation\(error\)\) return "cancelled"/);
  assert.match(helper, /return "failed"/);

  const managementSurfaces = [
    "mingla-business/app/event/[id]/index.tsx",
    "mingla-business/app/rsvp/[id]/index.tsx",
    "mingla-business/app/trip/[id]/index.tsx",
    "mingla-business/app/experience/[id]/index.tsx",
  ];
  for (const file of managementSurfaces) {
    const source = read(file);
    assert.match(source, /<ShareModal/, file);
    assert.doesNotMatch(source, /shareCanonicalPublicPageOnWeb/, file);
  }
});

test("experience crawler lookup cannot return a non-experience sharing collision", () => {
  const social = read("mingla-business/server/socialPreview.js");
  const start = social.indexOf("const fetchPublicExperienceBySlug");
  const end = social.indexOf("const eventDescription", start);
  assert.ok(start >= 0 && end > start, "experience crawler reader must exist");
  const reader = social.slice(start, end);
  assert.match(reader, /event_type: "eq\.experience"/);
  assert.match(reader, /brand_slug: `eq\.\$\{brandSlug\}`/);
  assert.match(reader, /slug: `eq\.\$\{experienceSlug\}`/);
  assert.match(reader, /limit: "1"/);

  const handler = read("mingla-business/api/public-experience.js");
  assert.match(handler, /renderNotFoundHtml\("Experience not found"\), 404/);
  assert.match(handler, /renderExperienceHtml\(experience\)/);
  assert.match(handler, /public experience preview could not load/);
});

test("canonical and Explorer snippet URLs cannot be accidentally conflated", () => {
  const social = read("mingla-business/server/socialPreview.js");
  assert.match(
    social,
    /const experiencePublicPath = \(row\) =>\s*`\/exp\/\$\{encodeURIComponent\(row\.brand_slug\)\}\/\$\{encodeURIComponent\(row\.slug\)\}`/,
  );
  assert.match(
    social,
    /const canonicalUrl = `\$\{EXPLORER_PUBLIC_ORIGIN\}\/s\/\$\{encodeURIComponent\(code\)\}`/,
  );
  assert.doesNotMatch(
    read("mingla-business/src/utils/shareCanonicalPublicPageOnWeb.ts"),
    /EXPLORER_PUBLIC_ORIGIN|\/s\/|contentShare/,
  );
});
