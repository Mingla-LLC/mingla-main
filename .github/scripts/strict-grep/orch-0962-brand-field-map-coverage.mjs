#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..", "..");

const read = (relativePath) =>
  fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

const files = {
  editView: read("mingla-business/src/components/brand/BrandEditView.tsx"),
  publicPage: read("mingla-business/src/components/brand/PublicBrandPage.tsx"),
  service: read("mingla-business/src/services/publicEventsService.ts"),
  migration: read(
    "supabase/migrations/20260727000003_orch_0962_brand_field_render_truthful.sql",
  ),
};

const failures = [];

function requireIncludes(label, source, needle) {
  if (!source.includes(needle)) failures.push(`${label}: missing ${needle}`);
}

function requireMatch(label, source, pattern) {
  if (!pattern.test(source)) failures.push(`${label}: missing ${pattern}`);
}

// G-01: contact fields remain selected by both public brand views and consumed
// by the public mappers, matching the editable contact fields in BrandEditView.
requireMatch("BrandEditView contact email editor", files.editView, /contact[?:.]+email|contact:\s*\{[^}]*email/s);
requireMatch("BrandEditView contact phone editor", files.editView, /contact[?:.]+phone|contact:\s*\{[^}]*phone/s);
requireMatch("business_public_brands_view contact email", files.migration, /\bcontact_email\b/);
requireMatch("business_public_brands_view contact phone", files.migration, /\bcontact_phone\b/);
requireIncludes("public mapper contact helper", files.service, "extractBrandContact");
requireIncludes("public mapper contact email", files.service, "row.contact_email");
requireIncludes("public mapper contact phone", files.service, "row.contact_phone");

// G-02: description written as tagline+bio must be split on public read, and
// the page must render both text slots instead of a fallback-only branch.
requireIncludes("public service splitBrandDescription import", files.service, "splitBrandDescription");
requireIncludes("public page tagline style", files.publicPage, "styles.taglineCentered");
requireIncludes("public page bio style", files.publicPage, "styles.bioLeadCentered");

// G-03: every social key already editable in BrandEditView must be present in
// the public SocialLinksRow renderer.
for (const key of ["facebook", "linkedin"]) {
  requireMatch(`BrandEditView ${key} editor`, files.editView, new RegExp(`links[?:.]+${key}|links:\\s*\\{[^}]*${key}`, "s"));
  requireIncludes(`PublicBrandPage ${key} branch`, files.publicPage, `links.${key}`);
  requireIncludes(`PublicBrandPage ${key} icon`, files.publicPage, `icon: "${key}"`);
}

// G-08/G-09: event-detail and claimed-venue mappers must read DB-backed truth
// rather than fabricating brand kind/address/cover or attendee-count settings.
for (const column of ["brand_kind", "brand_address", "brand_cover_media_url"]) {
  requireMatch(`business_public_events_view ${column}`, files.migration, new RegExp(`\\b${column}\\b`));
  requireIncludes(`viewRowToBrand ${column}`, files.service, `row.${column}`);
}
requireMatch("claimed_venues_public_view display_attendee_count", files.migration, /\bdisplay_attendee_count\b/);
requireIncludes("claimedVenueRowToBrand displayAttendeeCount", files.service, "row.display_attendee_count");

if (failures.length > 0) {
  console.error("FAIL [ORCH-0962 brand field map coverage]");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("PASS [ORCH-0962 brand field map coverage]");
