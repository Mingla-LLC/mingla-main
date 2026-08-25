#!/usr/bin/env node
//
// #2417 — Ari contract collision census.
//
// WHY THIS EXISTS
// PR #2069 (issue #1974) merged with 11 checks red and 9 still queued because the
// shared Ari integration guards on that branch were malformed and NOTHING
// cross-checked them against one another. Each guard pinned its own denominator in
// its own file; no single check proved those denominators still agreed with the
// canonical ledger, or that the files themselves were even parseable.
//
// This gate is that cross-file census. Every number it asserts is DERIVED AT
// RUNTIME from docs/contracts/ari-capability-ledger.json. Nothing here is
// hardcoded: bump the ledger honestly and every downstream census must move with
// it or this gate reds.
//
// SYNTAX VERDICTS ARE DELEGATED TO REAL PARSERS — NEVER HAND-ROLLED.
// The first draft of this census (stale PR #2419, head bfd7bdd7) hand-rolled a JS
// tokenizer. Its `stripTriviaAndLiterals()` treated any `/` not followed by `/` or
// `*` as the start of a regex literal — and the FIRST LINE of every gate file is
// the shebang `#!/usr/bin/env node`, whose `/` sits at byte offset 2. That opened a
// phantom regex that desynchronised the entire scan, and the census emitted
//     delegatedGate: delimiter collision near byte 8551
// against issue-2019-ari-delegated-auth.mjs — a file `node --check` accepts and
// which passes its own gate cleanly. A gate that reds correct code is worse than no
// gate at all, so the tokenizer is gone:
//   *.json -> JSON.parse            (definitive)
//   *.mjs  -> `node --check`        (the real parser; also catches duplicate
//                                    const/let/class in one scope, which is exactly
//                                    the "duplicate declaration collision" the
//                                    hand-rolled version was groping for)
//   *.ts   -> NOT parsed here, deliberately. See TYPESCRIPT below.
//
// TYPESCRIPT
// `node --check` CANNOT judge these .ts files. Measured on this repo:
//   node 22 (local, type-stripping on by default) -> exit 0
//   node 20 (what `Strict grep — static gates (class A)` actually runs) -> exit 1
// so wiring `node --check` here would pass locally and then red EVERY PR on CI
// forever. Deno is not installed on the class-A runner and adding it would be a CI
// topology change plus a network dependency. So instead of faking a verdict this
// gate proves the verdict still has a real owner: each .ts census TEST file must
// still be named in a `deno test` / `deno check` invocation recorded in the CI
// registries. If someone quietly drops one out of its Deno lane, this reds.
// agentToolAuthorization.ts is type-checked transitively by those same suites; its
// census here is the role-declaration count plus merge-marker freedom.
//
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");

const PATHS = Object.freeze({
  ledger: "docs/contracts/ari-capability-ledger.json",
  ledgerTester: ".github/scripts/strict-grep/__tests__/issue-2000-ari-capability-ledger.tester.test.mjs",
  delegatedGate: ".github/scripts/strict-grep/issue-2019-ari-delegated-auth.mjs",
  authorization: "supabase/functions/_shared/agentToolAuthorization.ts",
  providerTest: "supabase/functions/_shared/__tests__/issue_1999_ari_provider_schema_contract.test.ts",
  authorizationTest: "supabase/functions/_shared/__tests__/issue_2019_agent_authorization.test.ts",
});

// The .ts census files whose syntax/type verdict must still be owned by a Deno lane.
const DENO_OWNED = Object.freeze(["providerTest", "authorizationTest"]);

const CI_BATCH_MANIFEST = ".github/ci-batch/MANIFEST.json";
const WORKFLOW_DIR = ".github/workflows";

// Git conflict markers, including the diff3 `|||||||` form. Anchored at line start
// and required to be followed by a space or EOL so that a legitimate `=======`
// inside prose or a divider cannot be mistaken for residue.
const MERGE_MARKER = /^(?:<{7}|\|{7}|={7}|>{7})(?: |$)/m;

function readSources() {
  const sources = Object.fromEntries(
    Object.entries(PATHS).map(([key, file]) => [key, read(file)]),
  );
  sources.ciBatchManifest = read(CI_BATCH_MANIFEST);
  sources.workflows = fs
    .readdirSync(path.join(ROOT, WORKFLOW_DIR))
    .filter((name) => /\.ya?ml$/.test(name))
    .sort()
    .map((name) => read(path.join(WORKFLOW_DIR, name)))
    .join("\n#--census-workflow-boundary--\n");
  return sources;
}

// ---------------------------------------------------------------------------
// Definitive syntax verdict for .mjs, via the real Node parser.
// ---------------------------------------------------------------------------
let scratchDir = null;
process.on("exit", () => {
  if (scratchDir) fs.rmSync(scratchDir, { recursive: true, force: true });
});
// Content-keyed, so --self-test does not re-spawn `node --check` once per mutant
// for the files that mutant left untouched. Same bytes, same parser verdict — this
// is a pure memo, never a skip: an unseen body is always really parsed.
const verdicts = new Map();
function nodeCheck(source, extension) {
  const key = `${extension}\x00${source}`;
  if (verdicts.has(key)) return verdicts.get(key);
  scratchDir ??= fs.mkdtempSync(path.join(os.tmpdir(), "issue-2417-census-"));
  const file = path.join(scratchDir, `candidate${extension}`);
  fs.writeFileSync(file, source);
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  let verdict = null;
  if (result.status !== 0) {
    verdict = (String(result.stderr || result.error?.message || "")
      .split("\n")
      .find((line) => /Error/.test(line)) ?? `exit ${result.status}`).trim();
  }
  verdicts.set(key, verdict);
  return verdict;
}

// ---------------------------------------------------------------------------
// Deno-lane ownership for the .ts census files.
// ---------------------------------------------------------------------------
function denoCommandWindows(text) {
  // YAML block scalars (`run: >-`) fold a command across many lines, so flatten
  // whitespace first, then take each `deno test|check` up to the next step marker.
  const flat = text.replace(/\s+/g, " ");
  const windows = [];
  const pattern = /deno (?:test|check)\b/g;
  let match;
  while ((match = pattern.exec(flat)) !== null) {
    const rest = flat.slice(match.index);
    const stop = rest.search(/ - (?:name|uses|id|run):|#--census-workflow-boundary--/);
    windows.push(stop > 0 ? rest.slice(0, stop) : rest.slice(0, 4000));
  }
  return windows;
}

function jsonStrings(node, out = []) {
  if (typeof node === "string") out.push(node);
  else if (Array.isArray(node)) for (const item of node) jsonStrings(item, out);
  else if (node && typeof node === "object") for (const value of Object.values(node)) jsonStrings(value, out);
  return out;
}

function denoOwnershipFailures(sources) {
  const failures = [];
  let batchStrings = [];
  try {
    batchStrings = jsonStrings(JSON.parse(sources.ciBatchManifest));
  } catch (error) {
    failures.push(`${CI_BATCH_MANIFEST}: invalid JSON (${error.message})`);
  }
  const workflowWindows = denoCommandWindows(sources.workflows);
  for (const key of DENO_OWNED) {
    const target = PATHS[key];
    const inBatch = batchStrings.some((value) => /deno (?:test|check)\b/.test(value) && value.includes(target));
    const inWorkflow = workflowWindows.some((window) => window.includes(target));
    if (!inBatch && !inWorkflow) {
      failures.push(
        `${key}: ${target} is no longer named in any \`deno test\`/\`deno check\` invocation — ` +
          "its syntax/type verdict has no owner",
      );
    }
  }
  return failures;
}

// ---------------------------------------------------------------------------
// Census-number helpers. Every expected value is passed in derived, never literal.
// ---------------------------------------------------------------------------
function numbers(source, pattern) {
  return [...source.matchAll(pattern)].map((match) => Number(match[1]));
}

function requireCensus(failures, label, values, expected, occurrences = 1) {
  if (values.length !== occurrences) {
    failures.push(`${label}: expected ${occurrences} census assertion(s), got ${values.length}`);
    return;
  }
  const wrong = values.filter((value) => value !== expected);
  if (wrong.length) failures.push(`${label}: expected ${expected}, got ${values.join(",")}`);
}

function duplicateTestNames(source, pattern) {
  const seen = new Set();
  const duplicates = new Set();
  for (const match of source.matchAll(pattern)) {
    if (seen.has(match[1])) duplicates.add(match[1]);
    seen.add(match[1]);
  }
  return [...duplicates];
}

// ---------------------------------------------------------------------------
// The census.
// ---------------------------------------------------------------------------
function checkSources(sources) {
  const failures = [];

  // 1. The ledger parses, and its tool mapping is collision-free.
  let ledger;
  try {
    ledger = JSON.parse(sources.ledger);
  } catch (error) {
    return [`ledger: invalid JSON (${error.message})`];
  }
  const capabilities = Array.isArray(ledger.capabilities) ? ledger.capabilities : [];
  if (!capabilities.length) return ["ledger: no capabilities array"];

  const mapped = capabilities.filter((row) => typeof row.ari_tool === "string");
  const canonicalTools = mapped.map((row) => row.ari_tool).sort();
  const toolCount = canonicalTools.length;
  const capabilityCount = capabilities.length;
  if (new Set(canonicalTools).size !== toolCount) {
    const dupes = canonicalTools.filter((tool, index) => canonicalTools[index - 1] === tool);
    failures.push(`ledger: duplicate ari_tool mapping (${[...new Set(dupes)].join(",")})`);
  }

  // The ledger's own status universe is authoritative for every downstream census.
  const statusUniverse = Object.keys(ledger.status_definitions ?? {});
  if (!statusUniverse.length) failures.push("ledger: status_definitions is missing or empty");
  const statusCounts = Object.fromEntries(
    statusUniverse.map((status) => [status, capabilities.filter((row) => row.status === status).length]),
  );
  const unknownStatuses = [
    ...new Set(capabilities.map((row) => row.status).filter((status) => !statusUniverse.includes(status))),
  ];
  if (unknownStatuses.length) {
    failures.push(`ledger: capabilities carry statuses absent from status_definitions (${unknownStatuses.join(",")})`);
  }

  // The ledger's in-file audit block is itself a census and must agree.
  const audit = ledger.audit ?? {};
  if (audit.capability_count !== capabilityCount) {
    failures.push(`ledger audit: capability_count ${audit.capability_count} != ${capabilityCount} actual`);
  }
  if (audit.registered_tool_count !== toolCount) {
    failures.push(`ledger audit: registered_tool_count ${audit.registered_tool_count} != ${toolCount} actual`);
  }
  for (const status of statusUniverse) {
    const declared = (audit.status_breakdown ?? {})[status];
    if (declared !== statusCounts[status]) {
      failures.push(`ledger audit: status_breakdown.${status} ${declared} != ${statusCounts[status]} actual`);
    }
  }

  // 2. Every census file is free of merge-marker residue; .mjs files must parse.
  for (const [key, file] of Object.entries(PATHS)) {
    const source = sources[key];
    if (MERGE_MARKER.test(source)) failures.push(`${key}: merge-marker residue in ${file}`);
    if (file.endsWith(".mjs")) {
      const syntaxError = nodeCheck(source, ".mjs");
      if (syntaxError) failures.push(`${key}: does not parse (${syntaxError})`);
    }
  }
  failures.push(...denoOwnershipFailures(sources));

  // 3. One role declaration per mapped ledger tool.
  const declarationCount = (sources.authorization.match(/:\s*role\("/g) ?? []).length;
  if (declarationCount !== toolCount) {
    failures.push(`authorization: ${declarationCount} role declarations for ${toolCount} mapped ledger tools`);
  }

  // 4. Exactly one census assertion per denominator, in every downstream file.
  requireCensus(failures, "delegated gate declarationCount", numbers(sources.delegatedGate, /declarationCount\s*!==\s*(\d+)/g), toolCount);
  requireCensus(failures, "provider test title", numbers(sources.providerTest, /all (\d+) actual Ari tools/g), toolCount);
  requireCensus(failures, "provider test registry baseline", numbers(sources.providerTest, /tools\.length,\s*(\d+),\s*"registry baseline/g), toolCount);
  for (const [label, pattern] of [
    ["AGENT_TOOLS", /AGENT_TOOLS\.length\s*===\s*(\d+)/g],
    ["unique tool names", /\)\)\.size\s*===\s*(\d+)/g],
    ["AGENT_TOOL_AUTHORIZATION", /Object\.keys\(AGENT_TOOL_AUTHORIZATION\)\.length\s*===\s*(\d+)/g],
    ["ledger rows", /rows\.length\s*===\s*(\d+)/g],
  ]) {
    requireCensus(failures, `authorization test ${label}`, numbers(sources.authorizationTest, pattern), toolCount);
  }
  requireCensus(failures, "ledger tester capabilityCount", numbers(sources.ledgerTester, /capabilityCount:\s*(\d+)/g), capabilityCount);
  requireCensus(failures, "ledger tester tool-set message", numbers(sources.ledgerTester, /(\d+)-tool set changed/g), toolCount);

  // A bad merge duplicates a test rather than deleting one. Duplicate test NAMES
  // are the tell — and unlike a hardcoded suite-size count this cannot red a
  // legitimately added case.
  for (const [key, pattern] of [
    ["provider test", /Deno\.test\(\s*"([^"]+)"/g],
    ["ledger tester", /(?:^|\W)test\(\s*"([^"]+)"/g],
  ]) {
    const source = key === "provider test" ? sources.providerTest : sources.ledgerTester;
    const duplicates = duplicateTestNames(source, pattern);
    if (duplicates.length) failures.push(`${key}: duplicated test name(s) ${duplicates.join(" | ")}`);
  }

  // 5. The tester's pinned tool-name set equals the ledger's canonical set.
  const namesBlock = sources.ledgerTester.match(/const EXPECTED_TOOL_NAMES = \[([\s\S]*?)\n\];/);
  if (!namesBlock) {
    failures.push("ledger tester: EXPECTED_TOOL_NAMES census block not found");
  } else {
    const pinned = [...namesBlock[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]).sort();
    if (JSON.stringify(pinned) !== JSON.stringify(canonicalTools)) {
      const missing = canonicalTools.filter((tool) => !pinned.includes(tool));
      const extra = pinned.filter((tool) => !canonicalTools.includes(tool));
      failures.push(
        `ledger tester: pinned tool census differs from the canonical ledger` +
          `${missing.length ? ` (missing ${missing.join(",")})` : ""}` +
          `${extra.length ? ` (unknown ${extra.join(",")})` : ""}`,
      );
    }
  }

  // 6. The tester's statusBreakdown pins the whole ledger universe, at the right counts.
  const statusBlock = sources.ledgerTester.match(/statusBreakdown:\s*Object\.freeze\(\{([\s\S]*?)\}\),/);
  if (!statusBlock) {
    failures.push("ledger tester: statusBreakdown census block not found");
  } else {
    const pinnedStatuses = [...statusBlock[1].matchAll(/(\w+):\s*(\d+)/g)].map((match) => [match[1], Number(match[2])]);
    const pinnedNames = pinnedStatuses.map(([status]) => status);
    for (const status of statusUniverse) {
      if (!pinnedNames.includes(status)) failures.push(`ledger tester: statusBreakdown does not census "${status}"`);
    }
    for (const [status, value] of pinnedStatuses) {
      if (!statusUniverse.includes(status)) {
        failures.push(`ledger tester: statusBreakdown censuses "${status}", absent from ledger status_definitions`);
      } else if (value !== statusCounts[status]) {
        failures.push(`ledger tester: statusBreakdown.${status} pins ${value}, ledger says ${statusCounts[status]}`);
      }
    }
  }

  // The classification MESSAGE. Its field order is not declared anywhere in this
  // repo: the message reads 54/25/29/8/4/0 (registered_unverified first) while
  // status_definitions orders verified first and audit.status_breakdown orders
  // guided_handoff before unsupported — three different orders, no canonical one.
  // Assuming any single order is how the first draft of this census produced a
  // second false positive. So the message is asserted as a MULTISET of the
  // ledger-derived counts; the exact status->count binding is already pinned
  // above, keyed, by the statusBreakdown check. Together they are exhaustive.
  const expectedMultiset = statusUniverse.map((status) => statusCounts[status]).sort((a, b) => a - b);
  const messages = [...sources.ledgerTester.matchAll(/((?:\d+\/){5}\d+) classification changed/g)].map((match) => match[1]);
  if (messages.length !== 1) {
    failures.push(`ledger tester: expected 1 classification message, got ${messages.length}`);
  } else {
    const actual = messages[0].split("/").map(Number).sort((a, b) => a - b);
    if (JSON.stringify(actual) !== JSON.stringify(expectedMultiset)) {
      failures.push(
        `ledger tester: classification message "${messages[0]}" is not the ledger's status counts ` +
          `{${statusUniverse.map((status) => `${status}:${statusCounts[status]}`).join(", ")}}`,
      );
    }
  }

  return failures;
}

// ---------------------------------------------------------------------------
const sources = readSources();
const LABEL = "issue-2417-ari-contract-collision-census";

if (process.argv.includes("--self-test")) {
  const mutate = (key, from, to) => {
    const source = sources[key];
    const next = typeof from === "string" ? source.replace(from, to) : source.replace(from, to);
    if (next === source) {
      console.error(`${LABEL} self-test SETUP FAIL: mutant anchor not found in ${key}: ${from}`);
      process.exit(1);
    }
    return { ...sources, [key]: next };
  };
  const mutateAll = (key, from, to) => {
    const source = sources[key];
    const next = source.replaceAll(from, to);
    if (next === source) {
      console.error(`${LABEL} self-test SETUP FAIL: mutant anchor not found in ${key}: ${from}`);
      process.exit(1);
    }
    return { ...sources, [key]: next };
  };

  const mutants = [
    ["ledger is not valid JSON", { ...sources, ledger: sources.ledger.slice(0, -12) }],
    ["ledger maps two capabilities to one ari_tool",
      mutate("ledger", '"ari_tool": "create_brand"', '"ari_tool": "create_event"')],
    ["ledger audit capability_count drifts",
      mutate("ledger", '"capability_count": 120', '"capability_count": 119')],
    ["ledger audit status_breakdown drifts",
      mutate("ledger", '"broken": 0', '"broken": 1')],
    ["merge-marker residue in the tester",
      mutate("ledgerTester", "const EXPECTED = Object.freeze({", "<<<<<<< HEAD\nconst EXPECTED = Object.freeze({")],
    ["delegated gate no longer parses",
      mutate("delegatedGate", "function check(s, manifest) {", "function check(s, manifest) { {")],
    ["a role declaration is dropped from agentToolAuthorization",
      mutate("authorization", /:\s*role\("/, ": removed(")],
    ["delegated gate denominator goes stale",
      mutate("delegatedGate", "declarationCount !== 107", "declarationCount !== 106")],
    ["delegated gate carries a second, conflicting denominator",
      mutate("delegatedGate", "if (declarationCount !== 107)", "if (declarationCount !== 106) failures.push(`stale`);\n  if (declarationCount !== 107)")],
    ["provider test title goes stale",
      mutate("providerTest", "all 107 actual Ari tools", "all 106 actual Ari tools")],
    ["provider test registry baseline goes stale",
      mutate("providerTest", /tools\.length,\s*107,\s*"registry baseline/, 'tools.length,\n    106,\n    "registry baseline')],
    ["provider test carries a duplicated Deno.test name",
      mutate("providerTest", 'Deno.test("#1999 happy: all 107 actual Ari tools compile for Gemini typed parameters", () => {',
        'Deno.test("#1999 happy: all 106 actual Ari tools compile for Gemini typed parameters", () => {});\nDeno.test("#1999 happy: all 107 actual Ari tools compile for Gemini typed parameters", () => {')],
    ["authorization test AGENT_TOOLS census goes stale",
      mutate("authorizationTest", /AGENT_TOOLS\.length === 107/, "AGENT_TOOLS.length === 106")],
    ["authorization test ledger-rows census goes stale",
      mutate("authorizationTest", /rows\.length === 107/, "rows.length === 108")],
    ["tester capabilityCount goes stale",
      mutate("ledgerTester", "capabilityCount: 120", "capabilityCount: 119")],
    ["tester tool-set message goes stale",
      mutate("ledgerTester", "107-tool set changed", "106-tool set changed")],
    ["tester pins a tool name the ledger does not have",
      mutate("ledgerTester", '"cancel_campaign",', '"cancel_campaigns",')],
    ["tester statusBreakdown count drifts from the ledger",
      mutate("ledgerTester", "broken: 0,", "broken: 1,")],
    ["tester stops censusing one ledger status",
      mutate("ledgerTester", "    verified: 0,\n", "")],
    ["tester classification message drifts from the ledger",
      mutate("ledgerTester", "106/0/1/8/5/0 classification changed", "106/1/1/8/5/0 classification changed")],
    // The .ts files are not parsed here, so this mutant proves the merge-marker
    // scan fires on its OWN merit and is not just riding on `node --check`.
    ["merge-marker residue in a .ts census file (never reaches a parser)",
      mutate("authorizationTest", "const tool = (name: string) => {", ">>>>>>> theirs\nconst tool = (name: string) => {")],
    ["provider test is dropped out of its deno lane",
      mutateAll("ciBatchManifest", "issue_1999_ari_provider_schema_contract.test.ts", "issue_1999_ari_provider_schema_contract.retired.ts")],
    ["a capability carries a status absent from status_definitions",
      // [TEST-MOD-APPROVED #424/#1983] No capability is "broken" anymore; anchor on
      // a status that still appears in the ledger body.
      mutate("ledger", '"status": "unsupported"', '"status": "mostly_fine"')],
    ["authorization test unique-tool-name census goes stale",
      mutate("authorizationTest", ".size === 107", ".size === 106")],
    ["authorization test AGENT_TOOL_AUTHORIZATION census goes stale",
      mutate("authorizationTest", "Object.keys(AGENT_TOOL_AUTHORIZATION).length === 107", "Object.keys(AGENT_TOOL_AUTHORIZATION).length === 106")],
    // Anti-unfalsifiability: if a census BLOCK is renamed away, the gate must fail
    // loudly rather than quietly matching nothing and reporting success.
    ["tester EXPECTED_TOOL_NAMES block is renamed away",
      mutate("ledgerTester", "const EXPECTED_TOOL_NAMES = [", "const PINNED_TOOL_NAMES = [")],
    ["tester statusBreakdown block is restructured away",
      mutate("ledgerTester", "statusBreakdown: Object.freeze({", "statusBreakdown: ({")],
  ];

  const escaped = mutants.filter(([, mutatedSources]) => checkSources(mutatedSources).length === 0);
  if (escaped.length) {
    console.error(
      `${LABEL} self-test FAIL: ${escaped.length} mutant(s) escaped:\n` +
        escaped.map(([name]) => `  - ${name}`).join("\n"),
    );
    process.exit(1);
  }
  console.log(`${LABEL} self-test PASS (${mutants.length} collision mutants rejected)`);
  process.exit(0);
}

const failures = checkSources(sources);
if (failures.length) {
  console.error(`${LABEL} FAIL:\n` + failures.map((failure) => `  - ${failure}`).join("\n"));
  process.exit(1);
}
console.log(
  `${LABEL} PASS: ledger, authorization, delegated gate, provider test, authorization test ` +
    "and capability-ledger tester all census the same canonical denominators; no residue, no parse break",
);
