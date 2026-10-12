/**
 * toward #3697 Wave 4 — Admin Marketing tab + shared allowlist parity.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "../../..");
const ADMIN = path.join(ROOT, "mingla-admin/src");

/** Exact (slug, path) pairs — must match SQL, shared TS, and marketing click map. */
const MARKETING_PAIRS = [
  ["explorer", "/"],
  ["host", "/host"],
  ["download", "/download"],
  ["host-download", "/host/download"],
  ["tools", "/tools"],
  ["tools-events", "/tools/events"],
  ["tools-venues", "/tools/venues"],
  ["tools-trips", "/tools/trips"],
  ["tools-pricing", "/tools/pricing"],
];

test("Wave 4: Marketing tab after Sites; Event→Stay→Brand order preserved (#1431)", () => {
  const step = fs.readFileSync(
    path.join(ADMIN, "components/campaign-builder/StepDestination.jsx"),
    "utf8",
  );
  assert.ok(step.indexOf('id: "event"') < step.indexOf('id: "venue"'));
  assert.ok(step.indexOf('id: "venue"') < step.indexOf('id: "brand"'));
  assert.ok(step.indexOf('id: "site"') < step.indexOf('id: "marketing"'));
  assert.match(step, /id: "marketing"/);
  assert.match(step, /label: "Marketing"/);
  assert.doesNotMatch(step, /usemingla\.com/);
});

test("Wave 4: AdPreview sends entity_slug for marketing (and other non-brand types)", () => {
  const src = fs.readFileSync(
    path.join(ADMIN, "components/campaign-builder/AdPreview.jsx"),
    "utf8",
  );
  assert.match(
    src,
    /destination\.page_type === "brand" \|\| destination\.page_type === "site"/,
  );
  assert.doesNotMatch(
    src,
    /destination\.page_type === "event" \? \{ entity_slug/,
  );
});

test("Wave 4: (slug, path) pairs match across SQL, shared, and marketing click map", () => {
  const mig = fs.readFileSync(
    path.join(
      ROOT,
      "supabase/migrations/20270818003697_issue_3697_wave4_marketing_destinations.sql",
    ),
    "utf8",
  );
  const shared = fs.readFileSync(
    path.join(ROOT, "supabase/functions/_shared/adDestination.ts"),
    "utf8",
  );
  const marketing = fs.readFileSync(
    path.join(ROOT, "mingla-marketing/lib/ad-marketing-routes.ts"),
    "utf8",
  );
  const capture = fs.readFileSync(
    path.join(ROOT, "mingla-marketing/lib/ad-click-capture.ts"),
    "utf8",
  );
  assert.match(mig, /ad_destination_resolve_wave1/);
  assert.match(shared, /MARKETING_WEB_ORIGIN = "https:\/\/usemingla\.com"/);
  assert.match(capture, /page_type: 'marketing'/);
  assert.doesNotMatch(capture, /page_type: 'brand'/);
  for (const [slug, routePath] of MARKETING_PAIRS) {
    const sharedPair = new RegExp(
      `slug:\\s*"${slug}"[\\s\\S]{0,120}?path:\\s*"${routePath.replace(/\//g, "\\/")}"`,
    );
    const marketingPair = new RegExp(
      `slug:\\s*'${slug}'[\\s\\S]{0,80}?path:\\s*'${routePath.replace(/\//g, "\\/")}'`,
    );
    // SQL VALUES: ('uuid', 'slug', 'path', ...)
    const sqlPair = new RegExp(
      `'${slug}',\\s*'${routePath.replace(/\//g, "\\/")}'`,
    );
    assert.match(shared, sharedPair, `shared missing pair ${slug}→${routePath}`);
    assert.match(
      marketing,
      marketingPair,
      `marketing missing pair ${slug}→${routePath}`,
    );
    assert.match(mig, sqlPair, `SQL missing pair ${slug}→${routePath}`);
  }
});

test("Wave 4: attribution-capture CaptureBody.dest.page_type union includes marketing", () => {
  const src = fs.readFileSync(
    path.join(ROOT, "supabase/functions/attribution-capture/index.ts"),
    "utf8",
  );
  assert.match(
    src,
    /page_type\?:\s*\n(?:\s*\|\s*"[a-z]+"\s*\n)*\s*\|\s*"marketing"/,
  );
  assert.match(src, /DEST_PAGE_TYPES = \[[\s\S]*?"marketing"/);
});
