#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

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

const countExactLine = (source, expected) => source.split(/\r?\n/).filter((line) => line.trim() === expected).length;

export const expectedAllowlist = (base) => {
  const baseHasPair = SIGNATURES.every((signature) => countExactLine(base, signature) === 1);
  if (baseHasPair) return base;
  if (SIGNATURES.some((signature) => base.includes(signature))) {
    throw new Error("base contains a partial or lookalike #2986 signature set");
  }
  if (countExactLine(base, OLD_HEADER) !== 1) throw new Error("base #2986 count-header anchor is absent or duplicated");
  if (countExactLine(base, ANCHOR) !== 1) throw new Error("base #2986 insertion anchor is absent or duplicated");
  return base.replace(OLD_HEADER, NEW_HEADER).replace(ANCHOR, `${ANCHOR}\n${EXACT_BLOCK}`);
};

export const validate = ({ baseAllowlist, currentAllowlist, workflow }) => {
  const failures = [];
  let expected = "";
  try {
    expected = expectedAllowlist(baseAllowlist);
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  }
  if (expected && currentAllowlist !== expected) {
    failures.push("allowlist delta is not the exact #2986 pair/comments/header correction");
  }
  for (const signature of SIGNATURES) {
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
  "# === INTENDED-PUBLIC READS ===",
  ANCHOR,
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
  ];
  for (const [name, candidate, candidateWorkflow, shouldPass] of cases) {
    const passed = validate({ baseAllowlist: base, currentAllowlist: candidate, workflow: candidateWorkflow }).length === 0;
    if (passed !== shouldPass) throw new Error(`self-test ${name} ${shouldPass ? "failed" : "was not rejected"}`);
  }
  process.stdout.write("#2986 allowlist delta gate self-test PASS\n");
};

const runReal = (baseSha) => {
  if (!/^[0-9a-f]{7,64}$/i.test(baseSha || "")) throw new Error("a concrete git base SHA is required");
  const root = resolve(import.meta.dirname, "../..");
  const baseAllowlist = execFileSync("git", ["show", `${baseSha}:${ALLOWLIST_PATH}`], { cwd: root, encoding: "utf8" });
  const currentAllowlist = readFileSync(resolve(root, ALLOWLIST_PATH), "utf8");
  const workflow = readFileSync(resolve(root, WORKFLOW_PATH), "utf8");
  const failures = validate({ baseAllowlist, currentAllowlist, workflow });
  if (failures.length) throw new Error(failures.join("\n"));
  process.stdout.write("#2986 exact allowlist pair + frozen #2117 live gate PASS\n");
};

if (process.argv.includes("--self-test")) {
  runSelfTest();
} else {
  const baseIndex = process.argv.indexOf("--base-sha");
  runReal(baseIndex >= 0 ? process.argv[baseIndex + 1] : "");
}
