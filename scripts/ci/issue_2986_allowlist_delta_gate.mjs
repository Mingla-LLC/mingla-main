#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

const ALLOWLIST_PATH = "supabase/security/anon_executable_definer_allowlist.txt";
const WORKFLOW_PATH = ".github/workflows/issue-2117-offering-visibility-gate-tests.yml";
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
const LIVE_GATE_LINE = "run: bash scripts/ci/security_definer_anon_gate.sh";
const SELF_TEST_TOKEN = "node scripts/ci/issue_2986_allowlist_delta_gate.mjs --self-test";
const REAL_GATE_TOKEN = "node scripts/ci/issue_2986_allowlist_delta_gate.mjs --base-sha \"$BASE_SHA\"";
const MIGRATION_FILE = "20270614002986_issue_2986_public_search_documents.sql";
const MIGRATION_PATH = `supabase/migrations/${MIGRATION_FILE}`;
const PHASE_TWO_TOKEN = "Canonical migration replay — phase 2 (#2117)";
const TESTER_SUITE_TOKEN = "#2117 tester adversarial suite";
const EXACT_SKIP_LINE = `*${MIGRATION_FILE}) continue ;;`;
const EXACT_APPLY_LINE = `-f ${MIGRATION_PATH}`;

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

export const expectedAllowlist = (base) =>
  expectedAfter3872(
    expectedAfter3682(
      expectedAfter3697(expectedAfter3281(expectedAfter3426(expectedAfter2986(base)))),
    ),
  );

export const validate = ({ baseAllowlist, currentAllowlist, workflow }) => {
  const failures = [];
  let expected = "";
  try {
    expected = expectedAllowlist(baseAllowlist);
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  }
  if (expected && currentAllowlist !== expected) {
    failures.push(
      "allowlist delta is not the exact #2986 pair/comments/header correction plus the exact #3426 reader, #3281 R3 slot reader, #3697 pixel-mode reader, #3682 aggregate follower-count readers, and #3872 R1 display readers",
    );
  }
  for (const signature of [
    ...SIGNATURES,
    I3426_SIGNATURE,
    I3281_SIGNATURE,
    I3697_SIGNATURE,
    ...I3682_SIGNATURES,
    ...I3872_SIGNATURES,
  ]) {
    if (countExactLine(currentAllowlist, signature) !== 1) failures.push(`signature must occur exactly once: ${signature}`);
  }
  if (countExactLine(workflow, LIVE_GATE_LINE) !== 1) failures.push("the live ORCH-1392 anon-definer gate was removed, duplicated, or bypassed");
  if (!workflow.includes(SELF_TEST_TOKEN)) failures.push("the #2986 negative-control self-test is not registered in #2117 CI");
  if (!workflow.includes(REAL_GATE_TOKEN)) failures.push("the #2986 real base-delta check is not registered in #2117 CI");
  if (countExactLine(workflow, EXACT_SKIP_LINE) !== 1) failures.push("#2986 must have one exact-filename phase-1 skip");
  if (countExactLine(workflow, EXACT_APPLY_LINE) !== 1) failures.push("#2986 must have one exact post-phase-2 migration apply");
  const phaseTwoIndex = workflow.indexOf(PHASE_TWO_TOKEN);
  const testerSuiteIndex = workflow.indexOf(TESTER_SUITE_TOKEN);
  const applyIndex = workflow.indexOf(EXACT_APPLY_LINE);
  if (phaseTwoIndex < 0 || applyIndex < phaseTwoIndex) failures.push("#2986 migration apply must occur after #2117 phase 2");
  if (testerSuiteIndex < 0 || applyIndex < testerSuiteIndex) failures.push("#2986 migration apply must not contaminate the frozen #2117 executable suites");
  if (/\*[^\n)]*2986[^\n)]*\*\)\s*continue\s*;;/.test(workflow)) failures.push("#2986 phase-1 skip must not use a wildcard issue match");
  const migrationMentions = workflow.split(/\r?\n/).filter((line) => line.includes("2986") && /\.sql|continue\s*;;|-f\s+/.test(line));
  if (migrationMentions.length !== 2) failures.push("#2986 migration ordering has an additional, renamed, or duplicated command");
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
  "",
].join("\n");

const fixtureWorkflow = () => [
  `              ${EXACT_SKIP_LINE}`,
  `      - name: "${PHASE_TWO_TOKEN}"`,
  `      - name: "${TESTER_SUITE_TOKEN}"`,
  `            ${EXACT_APPLY_LINE}`,
  `      ${LIVE_GATE_LINE}`,
  `          ${SELF_TEST_TOKEN}`,
  `          ${REAL_GATE_TOKEN}`,
  "",
].join("\n");

const runSelfTest = () => {
  const base = fixtureBase();
  const head = expectedAllowlist(base);
  const workflow = fixtureWorkflow();
  const cases = [
    ["canonical exact pair", head, workflow, true],
    ["third function", `${head}forged_third_function()\n`, workflow, false],
    ["signature removed", head.replace(`${SIGNATURES[0]}\n`, ""), workflow, false],
    ["signature changed", head.replace(SIGNATURES[0], "resolve_public_search_document(path text)"), workflow, false],
    ["lookalike overload", `${head}resolve_public_search_document(p_path text, p_debug boolean)\n`, workflow, false],
    ["comment substitution", head.replace("# #2986: exact Host-relative path only;", "# approved somehow:"), workflow, false],
    ["unrelated baseline edit", head.replace("place_discovery_range_for_viewer", "changed_baseline_reader"), workflow, false],
    ["live gate removed", head, workflow.replace(`      ${LIVE_GATE_LINE}\n`, ""), false],
    ["live gate bypassed", head, workflow.replace(LIVE_GATE_LINE, `run: true # ${LIVE_GATE_LINE}`), false],
    ["migration skip renamed", head, workflow.replace(MIGRATION_FILE, `renamed_${MIGRATION_FILE}`), false],
    ["migration skip missing", head, workflow.replace(`              ${EXACT_SKIP_LINE}\n`, ""), false],
    ["migration apply duplicated", head, `${workflow}            ${EXACT_APPLY_LINE}\n`, false],
    ["migration wildcard skip", head, workflow.replace(EXACT_SKIP_LINE, "*2986*) continue ;;"), false],
    ["migration applied early", head, workflow.replace(`      - name: "${PHASE_TWO_TOKEN}"\n      - name: "${TESTER_SUITE_TOKEN}"\n            ${EXACT_APPLY_LINE}`, `            ${EXACT_APPLY_LINE}\n      - name: "${PHASE_TWO_TOKEN}"\n      - name: "${TESTER_SUITE_TOKEN}"`), false],
    ["migration contaminates tester suite", head, workflow.replace(`      - name: "${TESTER_SUITE_TOKEN}"\n            ${EXACT_APPLY_LINE}`, `            ${EXACT_APPLY_LINE}\n      - name: "${TESTER_SUITE_TOKEN}"`), false],
    ["additional issue migration", head, workflow.replace(EXACT_SKIP_LINE, `${EXACT_SKIP_LINE}\n              *20270614002987_issue_2986_extra.sql) continue ;;`), false],
    // #3426 — the second amendment is exactly one reader and one comment.
    ["#3426 reader missing", head.replace(`${I3426_BLOCK}\n`, ""), workflow, false],
    ["#3426 comment missing", head.replace(`${I3426_BLOCK.split("\n")[0]}\n`, ""), workflow, false],
    ["#3426 comment substituted", head.replace("# #3426: one date-decided section", "# #3426: approved somehow"), workflow, false],
    ["#3426 signature changed", head.replace(I3426_SIGNATURE, I3426_SIGNATURE.replace("p_section text", "p_section_name text")), workflow, false],
    ["#3426 lookalike overload", `${head}pg_public_brand_offering_section(p_brand_slug text, p_section text)\n`, workflow, false],
    ["#3426 moved away from its anchor", head.replace(`${I3426_BLOCK}\n`, "").replace("place_discovery_range_for_viewer(p_place_pool_id uuid)\n", `place_discovery_range_for_viewer(p_place_pool_id uuid)\n${I3426_BLOCK}\n`), workflow, false],
    ["#3426 plus a forged neighbour", head.replace(`${I3426_BLOCK}\n`, `${I3426_BLOCK}\nforged_neighbour_function()\n`), workflow, false],
    // #3281 R3 — the third amendment is exactly one reader and its comment.
    ["#3281 reader missing", head.replace(`${I3281_BLOCK}\n`, ""), workflow, false],
    ["#3281 comment missing", head.replace(`${I3281_BLOCK.split("\n")[0]}\n`, ""), workflow, false],
    ["#3281 comment substituted", head.replace("# #3281 R3: buyer time-step remaining", "# #3281 R3: approved somehow"), workflow, false],
    ["#3281 signature changed", head.replace(I3281_SIGNATURE, I3281_SIGNATURE.replace("p_ticket_type_id uuid", "p_ticket uuid")), workflow, false],
    ["#3281 lookalike overload", `${head}pg_experience_slot_availability(p_event_id uuid)\n`, workflow, false],
    ["#3281 moved away from its anchor", head.replace(`${I3281_BLOCK}\n`, "").replace("place_discovery_range_for_viewer(p_place_pool_id uuid)\n", `place_discovery_range_for_viewer(p_place_pool_id uuid)\n${I3281_BLOCK}\n`), workflow, false],
    ["#3281 plus a forged neighbour", head.replace(`${I3281_BLOCK}\n`, `${I3281_BLOCK}\nforged_neighbour_function()\n`), workflow, false],
    // #3872 R1 — the fourth amendment is exactly three readers and three comments.
    ["#3872 reader set missing", head.replace(`${I3872_BLOCK}\n`, ""), workflow, false],
    ["#3872 comment missing", head.replace(`${I3872_BLOCK.split("\n")[0]}\n`, ""), workflow, false],
    ["#3872 comment substituted", head.replace("# #3872 R1: public event tiers", "# #3872 R1: approved somehow"), workflow, false],
    ["#3872 signature changed", head.replace(I3872_SIGNATURES[0], "pg_public_event_tier_pricing(p_event uuid)"), workflow, false],
    ["#3872 lookalike overload", `${head}pg_public_event_tier_pricing(p_event_id uuid, p_debug boolean)\n`, workflow, false],
    ["#3872 moved away from its anchor", head.replace(`${I3872_BLOCK}\n`, "").replace("place_discovery_range_for_viewer(p_place_pool_id uuid)\n", `place_discovery_range_for_viewer(p_place_pool_id uuid)\n${I3872_BLOCK}\n`), workflow, false],
    ["#3872 plus a forged neighbour", head.replace(`${I3872_BLOCK}\n`, `${I3872_BLOCK}\nforged_neighbour_function()\n`), workflow, false],
    // #3697 — the fourth amendment is exactly one reader, one comment and the
    // matching count correction.
    ["#3697 reader missing", head.replace(`${I3697_BLOCK}\n`, ""), workflow, false],
    ["#3697 comment missing", head.replace(`${I3697_BLOCK.split("\n")[0]}\n`, ""), workflow, false],
    ["#3697 comment substituted", head.replace("# #3697: one non-sensitive country-mode scalar", "# #3697: approved somehow"), workflow, false],
    ["#3697 signature changed", head.replace(I3697_SIGNATURE, "ad_pixel_public_config(country_code text)"), workflow, false],
    ["#3697 lookalike overload", `${head}ad_pixel_public_config(p_country_code text, p_debug boolean)\n`, workflow, false],
    ["#3697 moved away from its anchor", head.replace(`${I3697_BLOCK}\n`, "").replace("place_discovery_range_for_viewer(p_place_pool_id uuid)\n", `place_discovery_range_for_viewer(p_place_pool_id uuid)\n${I3697_BLOCK}\n`), workflow, false],
    ["#3697 plus a forged neighbour", head.replace(`${I3697_BLOCK}\n`, `${I3697_BLOCK}\nforged_neighbour_function()\n`), workflow, false],
    ["#3697 count not corrected", head.replace(I3697_NEW_HEADER, I3697_OLD_HEADER), workflow, false],
    // #3682 — the fifth amendment is exactly two aggregate-only readers and
    // their one product-decision comment.
    ["#3682 block missing", head.replace(`${I3682_BLOCK}\n`, ""), workflow, false],
    ["#3682 comment missing", head.replace(`${I3682_BLOCK.split("\n")[0]}\n`, ""), workflow, false],
    ["#3682 comment substituted", head.replace("# #3682: aggregate-only brand follower counts", "# #3682: approved somehow"), workflow, false],
    ["#3682 signature changed", head.replace(I3682_SIGNATURES[0], "get_brand_follower_count(brand_id uuid)"), workflow, false],
    ["#3682 lookalike overload", `${head}get_brand_follower_count(p_brand_id uuid, p_debug boolean)\n`, workflow, false],
    ["#3682 moved away from its anchor", head.replace(`${I3682_BLOCK}\n`, "").replace("place_discovery_range_for_viewer(p_place_pool_id uuid)\n", `place_discovery_range_for_viewer(p_place_pool_id uuid)\n${I3682_BLOCK}\n`), workflow, false],
    ["#3682 plus a forged neighbour", head.replace(`${I3682_BLOCK}\n`, `${I3682_BLOCK}\nforged_neighbour_function()\n`), workflow, false],
  ];
  for (const [name, candidate, candidateWorkflow, shouldPass] of cases) {
    const passed = validate({ baseAllowlist: base, currentAllowlist: candidate, workflow: candidateWorkflow }).length === 0;
    if (passed !== shouldPass) throw new Error(`self-test ${name} ${shouldPass ? "failed" : "was not rejected"}`);
  }
  // Once a base carries all six amendments, the ONLY accepted head is that
  // base, byte for byte.
  const settled = expectedAllowlist(base);
  if (validate({ baseAllowlist: settled, currentAllowlist: settled, workflow }).length !== 0) {
    throw new Error("self-test settled base with all six amendments failed");
  }
  if (validate({ baseAllowlist: settled, currentAllowlist: `${settled}forged_after_settle()\n`, workflow }).length === 0) {
    throw new Error("self-test settled base accepted a new line");
  }
  process.stdout.write("#2986 allowlist delta gate self-test PASS\n");
};

const runReal = (baseSha) => {
  if (!/^[0-9a-f]{7,64}$/i.test(baseSha || "")) throw new Error("a concrete git base SHA is required");
  const root = resolve(SCRIPT_DIR, "../..");
  const baseAllowlist = execFileSync("git", ["show", `${baseSha}:${ALLOWLIST_PATH}`], { cwd: root, encoding: "utf8" });
  const currentAllowlist = readFileSync(resolve(root, ALLOWLIST_PATH), "utf8");
  const workflow = readFileSync(resolve(root, WORKFLOW_PATH), "utf8");
  const failures = validate({ baseAllowlist, currentAllowlist, workflow });
  if (failures.length) throw new Error(failures.join("\n"));
  process.stdout.write(
    "#2986 exact allowlist pair + #3426 exact reader + #3281 R3 slot reader + #3697 pixel-mode reader + #3682 aggregate follower-count readers + #3872 R1 display readers + frozen #2117 live gate PASS\n",
  );
};

if (process.argv.includes("--self-test")) {
  runSelfTest();
} else {
  const baseIndex = process.argv.indexOf("--base-sha");
  runReal(baseIndex >= 0 ? process.argv[baseIndex + 1] : "");
}
