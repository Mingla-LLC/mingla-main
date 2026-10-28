#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

const ALLOWLIST_PATH = "supabase/security/anon_executable_definer_allowlist.txt";
const RETIRED_WORKFLOW_PATH = ".github/workflows/issue-2117-offering-visibility-gate-tests.yml";
const OLD_HEADER = "# Signature count: 193 (intended-public 24, internally-gated 108, predicate/read-helper 58, PostGIS 3).";
const NEW_HEADER = "# Signature count: 196 (intended-public 27, internally-gated 108, predicate/read-helper 58, PostGIS 3).";
const ANCHOR = "pg_published_trips_public(p_destination_query text, p_departure_query text, p_date_from timestamp with time zone, p_date_to timestamp with time zone, p_min_price_cents integer, p_max_price_cents integer, p_group_size_min integer, p_group_size_max integer, p_sort text, p_limit integer, p_offset integer)";
const EXACT_BLOCK = [
  "# #2986: exact Host-relative path only; returns the closed lifecycle plus address-safe visible facts, never authoring, buyer, token, contact, or exact hidden-address data.",
  "resolve_public_search_document(p_path text)",
  "# #2986: enumerable only by design; emits current, non-test, individually validated search_ready Host paths and real source timestamps, never page facts or noindex states.",
  "list_public_search_sitemap()",
].join("\n");
const SIGNATURES = ["resolve_public_search_document(p_path text)", "list_public_search_sitemap()"];

// #3426 — the second binding amendment, and the only other one. Exactly ONE
// intended-public reader (the brand page's date-decided sections) plus its one
// justification comment, inserted directly after the Upcoming reader it
// partners. Nothing else in the file may move, and the #2986 count header is
// deliberately NOT edited (the #2986 security suite pins it).
const I3426_ANCHOR = "pg_public_brand_upcoming(p_brand_slug text, p_cursor_at timestamp with time zone, p_limit integer)";
const I3426_SIGNATURE = "pg_public_brand_offering_section(p_brand_slug text, p_section text, p_cursor_at timestamp with time zone, p_cursor_id uuid, p_limit integer)";
const I3426_BLOCK = [
  "# #3426: one date-decided section (happening_now/upcoming/past) of a public brand page; the same visibility, private-access and paid-supply guards as pg_public_brand_upcoming, no theme column, bounded page size.",
  I3426_SIGNATURE,
].join("\n");
const I3426_NAME = "pg_public_brand_offering_section(";

// #3281 R3 — third binding amendment. Exactly ONE intended-public reader (buyer
// time-step remaining for public live experiences) plus its justification
// comment, inserted directly after pg_public_experiences_by_brand. The #2986
// count header is deliberately NOT edited (the #2986 security suite pins it).
const I3281_ANCHOR = "pg_public_experiences_by_brand(p_brand_slug text)";
const I3281_SIGNATURE =
  "pg_experience_slot_availability(p_event_id uuid, p_event_date_id uuid, p_ticket_type_id uuid)";
const I3281_BLOCK = [
  "# #3281 R3: buyer time-step remaining for public live experiences only. Returns",
  "# empty slots (not an error) for private/draft/non-experience ids; exposes only",
  "# startAt/remaining/full — no buyer identity, holds, or authoring fields.",
  I3281_SIGNATURE,
].join("\n");
const I3281_NAME = "pg_experience_slot_availability(";

// #3872 R1 — fourth binding amendment. Exactly THREE intended-public display
// readers and their three justification comments, inserted directly after the
// legacy tier all-in reader. The pinned #2986 count header remains untouched.
const I3872_ANCHOR = "pg_public_event_tier_allin(p_event_id uuid)";
const I3872_SIGNATURES = [
  "pg_public_event_tier_pricing(p_event_id uuid)",
  "pg_public_event_display_prices(p_event_ids uuid[])",
  "pg_public_menu_item_sales(p_venue_id uuid)",
];
const I3872_BLOCK = [
  "# #3872 R1: public event tiers with server-owned list, all-in and current sale prices; only already-public tier facts, bounded to one event.",
  I3872_SIGNATURES[0],
  "# #3872 R1: bounded batch of public event display prices for cards and links; rejects more than 100 ids and returns no authoring or buyer data.",
  I3872_SIGNATURES[1],
  "# #3872 R1: current sale overlays for one public venue menu; returns item ids and price facts only, with no order or buyer data.",
  I3872_SIGNATURES[2],
].join("\n");
const I3872_NAME = "pg_public_event_tier_pricing(";

// #3697 — fourth binding amendment. Exactly ONE intended-public reader returns
// the non-sensitive pixel consent mode for one country and defaults to
// on_arrival. It exposes neither the region inventory nor any credential.
const I3697_OLD_HEADER = "# Signature count: 196 (intended-public 27, internally-gated 108, predicate/read-helper 58, PostGIS 3).";
const I3697_NEW_HEADER = "# Signature count: 197 (intended-public 28, internally-gated 108, predicate/read-helper 58, PostGIS 3).";
const I3697_ANCHOR = "# === INTENDED-PUBLIC READS (power anonymous public pages / checkout / signup) — INVESTIGATION F-8 / SPEC §4.4 ===";
const I3697_SIGNATURE = "ad_pixel_public_config(p_country_code text)";
const I3697_BLOCK = [
  "# #3697: one non-sensitive country-mode scalar; exposes no country inventory and defaults on_arrival.",
  I3697_SIGNATURE,
].join("\n");
const I3697_NAME = "ad_pixel_public_config(";

// #3682 — fifth binding amendment. The two aggregate-only count readers sit
// directly after the #3281 public slot reader. The frozen #2986 count header is
// deliberately unchanged.
const I3682_ANCHOR = I3281_SIGNATURE;
const I3682_SIGNATURES = [
  "get_brand_follower_count(p_brand_id uuid)",
  "get_brand_follower_counts(p_brand_ids uuid[])",
];
const I3682_BLOCK = [
  "# #3682: aggregate-only brand follower counts for public brand and offering pages; one bigint or (brand_id, follower_count) rows for live brands, never a user id; batch capped at 100 ids.",
  ...I3682_SIGNATURES,
].join("\n");
const I3682_NAMES = ["get_brand_follower_count(", "get_brand_follower_counts("];

// #4111 — sixth binding amendment. Two intended-public brand-page reads (does
// this brand take enquiries; its aggregate reply time) sit directly after the
// #3682 follower-count readers. The frozen #2986 count header is deliberately
// unchanged.
const I4111_ANCHOR = I3682_SIGNATURES[1];
const I4111_SIGNATURES = [
  "brand_enquiry_public_profile(p_brand_id uuid)",
  "issue_4111_brand_takes_enquiries(p_brand_id uuid)",
];
const I4111_BLOCK = [
  "# #4111: signed-out brand pages need whether a brand takes enquiries and its measured reply time; both return only a boolean or an aggregate, never guest data.",
  ...I4111_SIGNATURES,
].join("\n");
const I4111_NAMES = ["brand_enquiry_public_profile(", "issue_4111_brand_takes_enquiries("];

// #3872 R3/R4 — seventh binding amendment. The Creator Program, Mingla Local,
// buyer referral landing and attribution-redirect readers that signed-out
// viewers reach by design, appended as one commented block after the PostGIS
// tail. Each returns only already-public display facts or a listing target.
// The frozen #2986 count header is deliberately unchanged.
const I3872P_ANCHOR = "st_estimatedextent(text, text, text, boolean)";
const I3872P_SIGNATURES = [
  "gig_ratings_public(p_creator_account_id uuid)",
  "public_creator_profile(p_creator_account_id uuid)",
  "public_local_profile(p_user_id uuid)",
  "public_place_local_reviews(p_place_id uuid)",
  "public_content_share_friend_discount(p_short_code text)",
  "public_content_share_sharer(p_short_code text)",
  "public_referral_landing(p_slug text, p_listing_kind text, p_listing_id uuid)",
  "referral_link_resolve(p_slug text)",
  "tracking_link_resolve(p_slug text)",
];
const I3872P_BLOCK = [
  "",
  "# === #3872 Creator Program public surfaces (signed-out viewers by design) ===",
  "# Public creator card and ratings on profiles and the buyer web: display name,",
  "# niches, processed showcase ids, completed-gig count, live promotions, and",
  "# submitted star ratings. No handles, contact details, money or account data.",
  I3872P_SIGNATURES[0],
  I3872P_SIGNATURES[1],
  "# Mingla Local public profile and a place's published Local reviews: the Local's",
  "# display name, avatar and city, and reviews Mingla has already published.",
  I3872P_SIGNATURES[2],
  I3872P_SIGNATURES[3],
  "# Buyer referral landing on the buyer web before sign-in: whether a share link or",
  "# referral offer is active, the sharer's display name and avatar, and the friend",
  "# discount shown on the landing. No buyer, order or payout data.",
  I3872P_SIGNATURES[4],
  I3872P_SIGNATURES[5],
  I3872P_SIGNATURES[6],
  "# Attribution redirects: a referral or tracking slug resolves to its listing so a",
  "# signed-out click can be attributed. Returns the listing target only.",
  I3872P_SIGNATURES[7],
  I3872P_SIGNATURES[8],
].join("\n");
const I3872P_NAMES = I3872P_SIGNATURES.map((signature) => signature.slice(0, signature.indexOf("(") + 1));

// #2829 W4 — ninth binding amendment. The public trip-guide reader sits
// directly after the public venue-menu sale reader. It returns guide copy only
// for a public, non-private trip and NULL for every hidden/non-trip shape. This
// amendment also advances the audited intended-public count by exactly one.
const I2829_OLD_HEADER = I3697_NEW_HEADER;
const I2829_NEW_HEADER =
  "# Signature count: 198 (intended-public 29, internally-gated 108, predicate/read-helper 58, PostGIS 3).";
const I2829_ANCHOR = I3872_SIGNATURES[2];
const I2829_SIGNATURE = "pg_public_trip_guide(p_trip_id uuid)";
const I2829_BLOCK = [
  "# #2829 W4: one public trip's guide, gated by the same public/non-private trip predicate as the public offering read model; returns guide copy only and NULL for draft, private, deleted, or non-trip ids.",
  I2829_SIGNATURE,
].join("\n");
const I2829_NAME = "pg_public_trip_guide(";

const countExactLine = (source, expected) => source.split(/\r?\n/).filter((line) => line.trim() === expected).length;

const expectedAfter2986 = (base) => {
  const baseHasPair = SIGNATURES.every((signature) => countExactLine(base, signature) === 1);
  if (baseHasPair) return base;
  if (SIGNATURES.some((signature) => base.includes(signature))) {
    throw new Error("base contains a partial or lookalike #2986 signature set");
  }
  if (countExactLine(base, OLD_HEADER) !== 1) throw new Error("base #2986 count-header anchor is absent or duplicated");
  if (countExactLine(base, ANCHOR) !== 1) throw new Error("base #2986 insertion anchor is absent or duplicated");
  return base.replace(OLD_HEADER, NEW_HEADER).replace(ANCHOR, `${ANCHOR}\n${EXACT_BLOCK}`);
};

// #3426 — applied on top of #2986. A base that already carries the exact block
// is returned unchanged, so every later change must leave the file byte-equal.
const expectedAfter3426 = (base) => {
  if (countExactLine(base, I3426_SIGNATURE) === 1 && base.includes(`${I3426_ANCHOR}\n${I3426_BLOCK}\n`)) return base;
  if (base.includes(I3426_NAME) || base.includes("#3426")) {
    throw new Error("base contains a partial or lookalike #3426 reader");
  }
  if (countExactLine(base, I3426_ANCHOR) !== 1) throw new Error("base #3426 insertion anchor is absent or duplicated");
  return base.replace(`${I3426_ANCHOR}\n`, `${I3426_ANCHOR}\n${I3426_BLOCK}\n`);
};

// #3281 — applied on top of #3426. A base that already carries the exact block
// is returned unchanged, so every later change must leave the file byte-equal.
const expectedAfter3281 = (base) => {
  if (
    countExactLine(base, I3281_SIGNATURE) === 1 &&
    base.includes(`${I3281_ANCHOR}\n${I3281_BLOCK}\n`)
  ) {
    return base;
  }
  if (base.includes(I3281_NAME) || base.includes("#3281 R3:")) {
    throw new Error("base contains a partial or lookalike #3281 R3 reader");
  }
  if (countExactLine(base, I3281_ANCHOR) !== 1) {
    throw new Error("base #3281 R3 insertion anchor is absent or duplicated");
  }
  return base.replace(`${I3281_ANCHOR}\n`, `${I3281_ANCHOR}\n${I3281_BLOCK}\n`);
};

// #3872 — applied on top of #3281. A settled base must retain the exact block
// byte-for-byte; partial, moved, or lookalike additions fail closed.
const expectedAfter3872 = (base) => {
  if (
    I3872_SIGNATURES.every((signature) => countExactLine(base, signature) === 1) &&
    base.includes(`${I3872_ANCHOR}\n${I3872_BLOCK}\n`)
  ) {
    return base;
  }
  if (base.includes(I3872_NAME) || base.includes("# #3872 R1:")) {
    throw new Error("base contains a partial or lookalike #3872 R1 reader set");
  }
  if (countExactLine(base, I3872_ANCHOR) !== 1) {
    throw new Error("base #3872 R1 insertion anchor is absent or duplicated");
  }
  return base.replace(`${I3872_ANCHOR}\n`, `${I3872_ANCHOR}\n${I3872_BLOCK}\n`);
};

const expectedAfter3697 = (base) => {
  if (
    countExactLine(base, I3697_SIGNATURE) === 1 &&
    base.includes(`${I3697_ANCHOR}\n${I3697_BLOCK}\n`)
  ) {
    return base;
  }
  if (base.includes(I3697_NAME) || base.includes("# #3697:")) {
    throw new Error("base contains a partial or lookalike #3697 reader");
  }
  if (countExactLine(base, I3697_OLD_HEADER) !== 1) {
    throw new Error("base #3697 count-header anchor is absent or duplicated");
  }
  if (countExactLine(base, I3697_ANCHOR) !== 1) {
    throw new Error("base #3697 insertion anchor is absent or duplicated");
  }
  return base
    .replace(I3697_OLD_HEADER, I3697_NEW_HEADER)
    .replace(`${I3697_ANCHOR}\n`, `${I3697_ANCHOR}\n${I3697_BLOCK}\n`);
};

const expectedAfter3682 = (base) => {
  if (
    I3682_SIGNATURES.every((signature) => countExactLine(base, signature) === 1) &&
    base.includes(`${I3682_ANCHOR}\n${I3682_BLOCK}\n`)
  ) {
    return base;
  }
  if (
    I3682_NAMES.some((name) => base.includes(name)) ||
    base.includes("# #3682: aggregate-only brand follower counts")
  ) {
    throw new Error("base contains a partial or lookalike #3682 follower-count reader set");
  }
  if (countExactLine(base, I3682_ANCHOR) !== 1) {
    throw new Error("base #3682 insertion anchor is absent or duplicated");
  }
  return base.replace(`${I3682_ANCHOR}\n`, `${I3682_ANCHOR}\n${I3682_BLOCK}\n`);
};

// #4111 — applied after #3682 (its anchor is the #3682 block's last reader).
const expectedAfter4111 = (base) => {
  if (
    I4111_SIGNATURES.every((signature) => countExactLine(base, signature) === 1) &&
    base.includes(`${I4111_ANCHOR}\n${I4111_BLOCK}\n`)
  ) {
    return base;
  }
  if (I4111_NAMES.some((name) => base.includes(name)) || base.includes("# #4111:")) {
    throw new Error("base contains a partial or lookalike #4111 brand-page enquiry reader set");
  }
  if (countExactLine(base, I4111_ANCHOR) !== 1) {
    throw new Error("base #4111 insertion anchor is absent or duplicated");
  }
  return base.replace(`${I4111_ANCHOR}\n`, `${I4111_ANCHOR}\n${I4111_BLOCK}\n`);
};

// #3872 R3/R4 — applied last; its anchor is the final PostGIS reader.
const expectedAfter3872Public = (base) => {
  if (
    I3872P_SIGNATURES.every((signature) => countExactLine(base, signature) === 1) &&
    base.includes(`${I3872P_ANCHOR}\n${I3872P_BLOCK}\n`)
  ) {
    return base;
  }
  if (I3872P_NAMES.some((name) => base.includes(name)) || base.includes("# === #3872 Creator Program public surfaces")) {
    throw new Error("base contains a partial or lookalike #3872 R3/R4 public reader set");
  }
  if (countExactLine(base, I3872P_ANCHOR) !== 1) {
    throw new Error("base #3872 R3/R4 insertion anchor is absent or duplicated");
  }
  return base.replace(`${I3872P_ANCHOR}\n`, `${I3872P_ANCHOR}\n${I3872P_BLOCK}\n`);
};

// #2829 W4 — applied after the existing eight amendments. A settled base must
// retain the exact comment, signature, placement, and count correction.
const expectedAfter2829 = (base) => {
  if (
    countExactLine(base, I2829_SIGNATURE) === 1 &&
    base.includes(`${I2829_ANCHOR}\n${I2829_BLOCK}\n`) &&
    countExactLine(base, I2829_NEW_HEADER) === 1
  ) {
    return base;
  }
  if (base.includes(I2829_NAME) || base.includes("# #2829 W4:")) {
    throw new Error("base contains a partial or lookalike #2829 W4 trip-guide reader");
  }
  if (countExactLine(base, I2829_OLD_HEADER) !== 1) {
    throw new Error("base #2829 W4 count-header anchor is absent or duplicated");
  }
  if (countExactLine(base, I2829_ANCHOR) !== 1) {
    throw new Error("base #2829 W4 insertion anchor is absent or duplicated");
  }
  return base
    .replace(I2829_OLD_HEADER, I2829_NEW_HEADER)
    .replace(`${I2829_ANCHOR}\n`, `${I2829_ANCHOR}\n${I2829_BLOCK}\n`);
};

export const expectedAllowlist = (base) =>
  expectedAfter2829(
    expectedAfter3872Public(
      expectedAfter4111(
        expectedAfter3872(
          expectedAfter3682(
            expectedAfter3697(expectedAfter3281(expectedAfter3426(expectedAfter2986(base)))),
          ),
        ),
      ),
    ),
  );

export const validate = ({ baseAllowlist, currentAllowlist }) => {
  const failures = [];
  let expected = "";
  try {
    expected = expectedAllowlist(baseAllowlist);
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  }
  if (expected && currentAllowlist !== expected) {
    failures.push(
      "allowlist delta is not the exact #2986 pair/comments/header correction plus the exact #3426 reader, #3281 R3 slot reader, #3697 pixel-mode reader, #3682 aggregate follower-count readers, #3872 R1 display readers, #4111 brand-page enquiry readers, #3872 R3/R4 public creator, Local and referral readers, and #2829 W4 public trip-guide reader",
    );
  }
  for (const signature of [
    ...SIGNATURES,
    I3426_SIGNATURE,
    I3281_SIGNATURE,
    I3697_SIGNATURE,
    ...I3682_SIGNATURES,
    ...I3872_SIGNATURES,
    ...I4111_SIGNATURES,
    ...I3872P_SIGNATURES,
    I2829_SIGNATURE,
  ]) {
    if (countExactLine(currentAllowlist, signature) !== 1) failures.push(`signature must occur exactly once: ${signature}`);
  }
  return failures;
};

const fixtureBase = () => [
  "# fixture",
  OLD_HEADER,
  I3697_ANCHOR,
  I3426_ANCHOR,
  ANCHOR,
  I3872_ANCHOR,
  I3281_ANCHOR,
  "place_discovery_range_for_viewer(p_place_pool_id uuid)",
  I3872P_ANCHOR,
  "",
].join("\n");

const runPostFoldBaseRegression = (allowlist) => {
  const root = mkdtempSync(resolve(tmpdir(), "allowlist-post-fold-"));
  const script = resolve(root, "scripts/ci/issue_2986_allowlist_delta_gate.mjs");
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
  try {
    mkdirSync(dirname(script), { recursive: true });
    mkdirSync(dirname(resolve(root, ALLOWLIST_PATH)), { recursive: true });
    writeFileSync(script, readFileSync(fileURLToPath(import.meta.url)));
    writeFileSync(resolve(root, ALLOWLIST_PATH), allowlist);
    git("init", "--quiet");
    git("add", ".");
    git("-c", "user.name=CI fixture", "-c", "user.email=fixture@example.invalid",
      "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "commit", "--quiet", "-m", "Post-fold base fixture");
    const base = git("rev-parse", "HEAD").trim();
    if (git("ls-tree", "--name-only", base, "--", RETIRED_WORKFLOW_PATH).trim()) {
      throw new Error("post-fold fixture unexpectedly contains the retired workflow");
    }
    const invoke = () => spawnSync(process.execPath, [script, "--base-sha", base],
      { cwd: root, encoding: "utf8", timeout: 10_000 });
    const clean = invoke();
    if (clean.status !== 0) throw new Error(`post-fold base was refused: ${clean.stderr}`);
    writeFileSync(resolve(root, ALLOWLIST_PATH), `${allowlist}forged_after_fold()\n`);
    const forged = invoke();
    if (forged.status === 0 || !forged.stderr.includes("allowlist delta")) {
      throw new Error("post-fold base did not reject an unauthorized anonymous reader");
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

const runSelfTest = () => {
  const base = fixtureBase();
  const head = expectedAllowlist(base);
  const cases = [
    ["canonical exact pair", head, true],
    ["third function", `${head}forged_third_function()\n`, false],
    ["signature removed", head.replace(`${SIGNATURES[0]}\n`, ""), false],
    ["signature changed", head.replace(SIGNATURES[0], "resolve_public_search_document(path text)"), false],
    ["lookalike overload", `${head}resolve_public_search_document(p_path text, p_debug boolean)\n`, false],
    ["comment substitution", head.replace("# #2986: exact Host-relative path only;", "# approved somehow:"), false],
    ["unrelated baseline edit", head.replace("place_discovery_range_for_viewer", "changed_baseline_reader"), false],
    // #3426 — the second amendment is exactly one reader and one comment.
    ["#3426 reader missing", head.replace(`${I3426_BLOCK}\n`, ""), false],
    ["#3426 comment missing", head.replace(`${I3426_BLOCK.split("\n")[0]}\n`, ""), false],
    ["#3426 comment substituted", head.replace("# #3426: one date-decided section", "# #3426: approved somehow"), false],
    ["#3426 signature changed", head.replace(I3426_SIGNATURE, I3426_SIGNATURE.replace("p_section text", "p_section_name text")), false],
    ["#3426 lookalike overload", `${head}pg_public_brand_offering_section(p_brand_slug text, p_section text)\n`, false],
    ["#3426 moved away from its anchor", head.replace(`${I3426_BLOCK}\n`, "").replace("place_discovery_range_for_viewer(p_place_pool_id uuid)\n", `place_discovery_range_for_viewer(p_place_pool_id uuid)\n${I3426_BLOCK}\n`), false],
    ["#3426 plus a forged neighbour", head.replace(`${I3426_BLOCK}\n`, `${I3426_BLOCK}\nforged_neighbour_function()\n`), false],
    // #3281 R3 — the third amendment is exactly one reader and its comment.
    ["#3281 reader missing", head.replace(`${I3281_BLOCK}\n`, ""), false],
    ["#3281 comment missing", head.replace(`${I3281_BLOCK.split("\n")[0]}\n`, ""), false],
    ["#3281 comment substituted", head.replace("# #3281 R3: buyer time-step remaining", "# #3281 R3: approved somehow"), false],
    ["#3281 signature changed", head.replace(I3281_SIGNATURE, I3281_SIGNATURE.replace("p_ticket_type_id uuid", "p_ticket uuid")), false],
    ["#3281 lookalike overload", `${head}pg_experience_slot_availability(p_event_id uuid)\n`, false],
    ["#3281 moved away from its anchor", head.replace(`${I3281_BLOCK}\n`, "").replace("place_discovery_range_for_viewer(p_place_pool_id uuid)\n", `place_discovery_range_for_viewer(p_place_pool_id uuid)\n${I3281_BLOCK}\n`), false],
    ["#3281 plus a forged neighbour", head.replace(`${I3281_BLOCK}\n`, `${I3281_BLOCK}\nforged_neighbour_function()\n`), false],
    // #3872 R1 — the fourth amendment is exactly three readers and three comments.
    ["#3872 reader set missing", head.replace(`${I3872_BLOCK}\n`, ""), false],
    ["#3872 comment missing", head.replace(`${I3872_BLOCK.split("\n")[0]}\n`, ""), false],
    ["#3872 comment substituted", head.replace("# #3872 R1: public event tiers", "# #3872 R1: approved somehow"), false],
    ["#3872 signature changed", head.replace(I3872_SIGNATURES[0], "pg_public_event_tier_pricing(p_event uuid)"), false],
    ["#3872 lookalike overload", `${head}pg_public_event_tier_pricing(p_event_id uuid, p_debug boolean)\n`, false],
    ["#3872 moved away from its anchor", head.replace(`${I3872_BLOCK}\n`, "").replace("place_discovery_range_for_viewer(p_place_pool_id uuid)\n", `place_discovery_range_for_viewer(p_place_pool_id uuid)\n${I3872_BLOCK}\n`), false],
    ["#3872 plus a forged neighbour", head.replace(`${I3872_BLOCK}\n`, `${I3872_BLOCK}\nforged_neighbour_function()\n`), false],
    // #3697 — the fourth amendment is exactly one reader, one comment and the
    // matching count correction.
    ["#3697 reader missing", head.replace(`${I3697_BLOCK}\n`, ""), false],
    ["#3697 comment missing", head.replace(`${I3697_BLOCK.split("\n")[0]}\n`, ""), false],
    ["#3697 comment substituted", head.replace("# #3697: one non-sensitive country-mode scalar", "# #3697: approved somehow"), false],
    ["#3697 signature changed", head.replace(I3697_SIGNATURE, "ad_pixel_public_config(country_code text)"), false],
    ["#3697 lookalike overload", `${head}ad_pixel_public_config(p_country_code text, p_debug boolean)\n`, false],
    ["#3697 moved away from its anchor", head.replace(`${I3697_BLOCK}\n`, "").replace("place_discovery_range_for_viewer(p_place_pool_id uuid)\n", `place_discovery_range_for_viewer(p_place_pool_id uuid)\n${I3697_BLOCK}\n`), false],
    ["#3697 plus a forged neighbour", head.replace(`${I3697_BLOCK}\n`, `${I3697_BLOCK}\nforged_neighbour_function()\n`), false],
    ["#3697 count not corrected", head.replace(I2829_NEW_HEADER, I3697_OLD_HEADER), false],
    // #3682 — the fifth amendment is exactly two aggregate-only readers and
    // their one product-decision comment.
    ["#3682 block missing", head.replace(`${I3682_BLOCK}\n`, ""), false],
    ["#3682 comment missing", head.replace(`${I3682_BLOCK.split("\n")[0]}\n`, ""), false],
    ["#3682 comment substituted", head.replace("# #3682: aggregate-only brand follower counts", "# #3682: approved somehow"), false],
    ["#3682 signature changed", head.replace(I3682_SIGNATURES[0], "get_brand_follower_count(brand_id uuid)"), false],
    ["#3682 lookalike overload", `${head}get_brand_follower_count(p_brand_id uuid, p_debug boolean)\n`, false],
    ["#3682 moved away from its anchor", head.replace(`${I3682_BLOCK}\n`, "").replace("place_discovery_range_for_viewer(p_place_pool_id uuid)\n", `place_discovery_range_for_viewer(p_place_pool_id uuid)\n${I3682_BLOCK}\n`), false],
    ["#3682 plus a forged neighbour", head.replace(`${I3682_BLOCK}\n`, `${I3682_BLOCK}\nforged_neighbour_function()\n`), false],
    // #4111 — the sixth amendment is exactly two brand-page readers and their
    // one comment, directly after the #3682 block, with no header change.
    ["#4111 block missing", head.replace(`${I4111_BLOCK}\n`, ""), false],
    ["#4111 comment missing", head.replace(`${I4111_BLOCK.split("\n")[0]}\n`, ""), false],
    ["#4111 comment substituted", head.replace("# #4111: signed-out brand pages need", "# #4111: approved somehow"), false],
    ["#4111 signature changed", head.replace(I4111_SIGNATURES[0], "brand_enquiry_public_profile(brand_id uuid)"), false],
    ["#4111 lookalike overload", `${head}issue_4111_brand_takes_enquiries(p_brand_id uuid, p_debug boolean)\n`, false],
    ["#4111 moved away from its anchor", head.replace(`${I4111_BLOCK}\n`, "").replace("place_discovery_range_for_viewer(p_place_pool_id uuid)\n", `place_discovery_range_for_viewer(p_place_pool_id uuid)\n${I4111_BLOCK}\n`), false],
    ["#4111 plus a forged neighbour", head.replace(`${I4111_BLOCK}\n`, `${I4111_BLOCK}\nforged_neighbour_function()\n`), false],
    // #3872 R3/R4 — the seventh amendment is exactly the commented public
    // block after the PostGIS tail, with no header change.
    ["#3872 R3/R4 block missing", head.replace(`${I3872P_BLOCK}\n`, ""), false],
    ["#3872 R3/R4 comment substituted", head.replace("# === #3872 Creator Program public surfaces", "# === approved somehow"), false],
    ["#3872 R3/R4 signature changed", head.replace(I3872P_SIGNATURES[0], "gig_ratings_public(creator_account_id uuid)"), false],
    ["#3872 R3/R4 lookalike overload", `${head}referral_link_resolve(p_slug text, p_debug boolean)\n`, false],
    ["#3872 R3/R4 reader dropped", head.replace(`${I3872P_SIGNATURES[8]}\n`, ""), false],
    ["#3872 R3/R4 plus a forged neighbour", head.replace(`${I3872P_BLOCK}\n`, `${I3872P_BLOCK}\nforged_neighbour_function()\n`), false],
    // #2829 W4 — the ninth amendment is exactly one public trip-guide reader,
    // its decision comment, its placement, and the matching count correction.
    ["#2829 W4 block missing", head.replace(`${I2829_BLOCK}\n`, ""), false],
    ["#2829 W4 comment missing", head.replace(`${I2829_BLOCK.split("\n")[0]}\n`, ""), false],
    ["#2829 W4 comment substituted", head.replace("# #2829 W4: one public trip's guide", "# #2829 W4: approved somehow"), false],
    ["#2829 W4 signature changed", head.replace(I2829_SIGNATURE, "pg_public_trip_guide(trip_id uuid)"), false],
    ["#2829 W4 lookalike overload", `${head}pg_public_trip_guide(p_trip_id uuid, p_debug boolean)\n`, false],
    ["#2829 W4 moved away from its anchor", head.replace(`${I2829_BLOCK}\n`, "").replace("place_discovery_range_for_viewer(p_place_pool_id uuid)\n", `place_discovery_range_for_viewer(p_place_pool_id uuid)\n${I2829_BLOCK}\n`), false],
    ["#2829 W4 plus a forged neighbour", head.replace(`${I2829_BLOCK}\n`, `${I2829_BLOCK}\nforged_neighbour_function()\n`), false],
    ["#2829 W4 count not corrected", head.replace(I2829_NEW_HEADER, I2829_OLD_HEADER), false],
    ["#2829 W4 header edited", head.replace(I2829_NEW_HEADER, "# Signature count: 207 (intended-public 38, internally-gated 108, predicate/read-helper 58, PostGIS 3)."), false],
  ];
  for (const [name, candidate, shouldPass] of cases) {
    const passed = validate({ baseAllowlist: base, currentAllowlist: candidate }).length === 0;
    if (passed !== shouldPass) throw new Error(`self-test ${name} ${shouldPass ? "failed" : "was not rejected"}`);
  }
  // Once a base carries all nine amendments, the ONLY accepted head is that
  // base, byte for byte.
  const settled = expectedAllowlist(base);
  if (validate({ baseAllowlist: settled, currentAllowlist: settled }).length !== 0) {
    throw new Error("self-test settled base with all nine amendments failed");
  }
  if (validate({ baseAllowlist: settled, currentAllowlist: `${settled}forged_after_settle()\n` }).length === 0) {
    throw new Error("self-test settled base accepted a new line");
  }
  runPostFoldBaseRegression(settled);
  process.stdout.write("#2986 allowlist delta gate self-test PASS\n");
};

const runReal = (baseSha) => {
  if (!/^[0-9a-f]{7,64}$/i.test(baseSha || "")) throw new Error("a concrete git base SHA is required");
  const root = resolve(SCRIPT_DIR, "../..");
  const baseAllowlist = execFileSync("git", ["show", `${baseSha}:${ALLOWLIST_PATH}`], { cwd: root, encoding: "utf8" });
  const currentAllowlist = readFileSync(resolve(root, ALLOWLIST_PATH), "utf8");
  // Registration and replay order are enforced by the live batch contract.
  // This gate compares the immutable base allowlist with the proposed one.
  const failures = validate({ baseAllowlist, currentAllowlist });
  if (failures.length) throw new Error(failures.join("\n"));
  process.stdout.write(
    "#2986 exact allowlist pair + #3426 exact reader + #3281 R3 slot reader + #3697 pixel-mode reader + #3682 aggregate follower-count readers + #3872 R1 display readers + #4111 brand-page enquiry readers + #3872 R3/R4 public readers + #2829 W4 public trip-guide reader PASS\n",
  );
};

if (process.argv.includes("--self-test")) {
  runSelfTest();
} else {
  const baseIndex = process.argv.indexOf("--base-sha");
  runReal(baseIndex >= 0 ? process.argv[baseIndex + 1] : "");
}
