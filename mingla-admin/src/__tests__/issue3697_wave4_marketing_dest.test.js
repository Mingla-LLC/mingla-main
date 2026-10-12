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
});

test("Wave 4: migration + shared allowlist pin usemingla.com routes", () => {
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
  assert.match(mig, /page_type.*marketing|'marketing'/);
  assert.match(mig, /ad_destination_resolve_wave1/);
  assert.match(shared, /MARKETING_WEB_ORIGIN = "https:\/\/usemingla\.com"/);
  assert.match(shared, /slug: "host"/);
  assert.match(marketing, /slug: 'host'/);
  assert.match(capture, /page_type: 'marketing'/);
  assert.doesNotMatch(capture, /page_type: 'brand'/);
  for (const slug of [
    "explorer",
    "host",
    "download",
    "host-download",
    "tools",
    "tools-events",
    "tools-venues",
    "tools-trips",
    "tools-pricing",
  ]) {
    assert.match(shared, new RegExp(`slug: "${slug}"`));
    assert.match(marketing, new RegExp(`slug: '${slug}'`));
    assert.match(mig, new RegExp(`'${slug}'`));
  }
});

test("Wave 4: attribution-capture accepts marketing dest_page_type", () => {
  const src = fs.readFileSync(
    path.join(ROOT, "supabase/functions/attribution-capture/index.ts"),
    "utf8",
  );
  assert.match(src, /"marketing"/);
});
