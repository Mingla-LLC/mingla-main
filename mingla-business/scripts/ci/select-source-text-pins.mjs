#!/usr/bin/env node
/**
 * select-source-text-pins.mjs — issue #1047 [business-jest-suite-audit]
 *
 * The reviewable, deterministic classifier behind Part 1 of the #1047 SPEC.
 * It partitions the currently-red `mingla-business` jest files that are either
 * brittle SOURCE-TEXT PINS or mis-swept RENDER-PROOFS into three lists:
 *
 *   QUARANTINE_SAFE   — pure source-text pins (readFileSync + every expect on a
 *                       source-derived value, no render, no behavioral exec).
 *                       Safe to exclude from the default jest config: they guard
 *                       nothing behavioral. The file stays in the repo (never
 *                       deleted — `tests-append-only.yml` makes deletion absolute).
 *   INVARIANT_CONVERT — source-text pins that DO encode a load-bearing rule. Each
 *                       is re-pinned by an additive strict-grep .mjs gate (that
 *                       actually runs in CI) BEFORE its jest pin is quarantined,
 *                       so the rule keeps being enforced.
 *   RENDER_EXCLUDE    — render/RTL suites that import a real render lib
 *                       (react-test-renderer / @testing-library / react-dom/server
 *                       / react-native-web) and run under their own dedicated
 *                       `jest.<orch>.render.cjs` configs + per-issue workflows.
 *                       They cannot pass under the default node/ts-jest config.
 *
 * DETERMINISM: the file universe below is the human-reviewed input set. Running
 * this script re-classifies each member from its ON-DISK CONTENT via the §4.1.1
 * algorithm (classifyFile) and emits the three lists. Output is byte-stable
 * across runs (fixed input + pure file reads, sorted). If a file's content ever
 * contradicts its declared bucket, the script FAILS loudly (exit 1) — the list
 * can never silently rot before the required-gate flip (§4.4.3).
 *
 * §4.1.1 mechanical criterion for a quarantine-safe (delete-safe) pin — ALL of:
 *   1. reads its target as TEXT (readFileSync / readFile), AND
 *   2. every expect(...) operates on a source-derived value (no behavioral or
 *      value assertion on executed code), AND
 *   3. contains NO render (render( / renderHook / react-test-renderer /
 *      @testing-library / ReactDOMServer / react-native-web), NO service/logic
 *      execution (no `await <fn>(`, no runtime-driving jest.mock factory), and
 *      no behavioral assertion on executed code.
 * A file failing ANY clause is NOT quarantine-eligible.
 *
 * Modes:
 *   node select-source-text-pins.mjs            — print the three lists (+ counts).
 *   node select-source-text-pins.mjs --json     — machine-readable JSON.
 *   node select-source-text-pins.mjs --check     — exit 1 if any declared bucket
 *                                                 disagrees with classifyFile.
 *   node select-source-text-pins.mjs --assert-no-new <baseRef>
 *        — I-PROPOSED-1047-NO-SOLE-SOURCE-PIN enforcement: fail if a NEW
 *          mingla-business `*.test.ts(x)` added in <baseRef>..HEAD is a pure
 *          source-text pin (its ONLY assertions read source text). Used by the
 *          strict-grep gate of the same name against the PR diff.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIZ_ROOT = path.resolve(HERE, "../.."); // mingla-business/ (script lives in scripts/ci/)

// ---------------------------------------------------------------------------
// The human-reviewed file universe (SPEC §4.1.3, re-grounded against the actual
// baseline run at origin/main). Paths are relative to mingla-business/.
// ---------------------------------------------------------------------------

const QUARANTINE_SAFE = [
  "app/checkout-trip/[tripEventId]/__tests__/orch_0915_pay_in_full_choice.test.tsx",
  "app/checkout/[eventId]/__tests__/orch_0911_confirm_loading_state.test.tsx",
  "app/checkout-trip/[tripEventId]/__tests__/orch_0911_trip_confirm_loading_state.test.tsx",
  "app/t/__tests__/public-trip-page.test.ts",
  "src/components/__tests__/desktopWebLayoutContracts.test.ts",
  "src/components/brand/__tests__/PublicBrandPage.nextEventTeaser.test.ts",
  "src/components/brand/__tests__/PublicBrandPage.orch_0962.test.ts",
  "src/components/brand/__tests__/PublicBrandPage.orch_0964_smoke_rework.test.ts",
  "src/components/brand/__tests__/PublicBrandPage.pastCap.adversarial.test.ts",
  "src/components/brand/__tests__/PublicBrandPage.pinCtaCount.adversarial.test.ts",
  "src/components/brand/__tests__/PublicBrandPage.tripBrand.test.ts",
  "src/components/brand/__tests__/PublicBrandPage.ve4.test.ts",
  "src/components/trip/__tests__/tr2RewordPolish.test.ts",
  "src/services/__tests__/createExperienceToolContract.test.ts",
  "src/services/__tests__/geminiActivitiesParser.contract.test.ts",
  "src/utils/__tests__/orch_1092_business_web_restoration_wave.test.ts",
];

// Source-text pins that DO encode a load-bearing invariant. Each is re-pinned by
// an additive strict-grep gate (named alongside) BEFORE its jest pin is
// quarantined — the rule keeps being enforced by a gate that actually runs.
const INVARIANT_CONVERT = [
  // bundle-budget: barrel import must be type-only; TicketTierEditSheet lazy.
  "__tests__/metaOrch1255R2.bundleBudgetDeferral.happy.test.ts",
  // Zustand persist no-server-snapshots: v4->v5 migrator drops events (Const #5).
  "src/store/__tests__/liveEventStore-v4-v5-migrator.test.ts",
  // RSVP preview module boundary: never imports the ticket renderer / submit fn.
  "app/rsvp/[id]/__tests__/preview.test.tsx",
  // PaymentPlanEditor money-safety constants (max installments, step locks).
  "src/components/trip/__tests__/PaymentPlanEditor.test.ts",
  // Persisted-state startup hydration gate (Const #14) in event/create.tsx.
  "src/utils/__tests__/orch_0893a_hydration_gate.test.ts",
  // Keyboard Done-bar mount coverage + keyed (never-unconditional) +42 offsets.
  "src/wrappers/__tests__/orch_1165_keyboard_toolbar_mount_coverage.test.ts",
  // Trip confirm black-screen fix: hasCs reads URL only; no realtimePending hero.
  "app/checkout-trip/[tripEventId]/__tests__/orch_0911_trip_confirm_loading_state.adversarial.test.tsx",
  // #874 Home Analytics order/marker refresh contract -> updated ORCH-0974 gate.
  "app/(tabs)/__tests__/home.orch_0974.test.tsx",
  "app/(tabs)/__tests__/home.orch_0974.adversarial.test.tsx",
  // #1403 removes the obsolete brand ad tile; opposite invariant is enforced
  // by issue-1403-listing-insights-wiring.mjs.
  "src/components/venue/__tests__/venueAdsDrivenTile.issue865pr1.test.ts",
  // #1421 replaces the placeholder-pinning rule with the CI-wired truthful
  // organic-insight gate and behavioral/render coverage.
  "src/components/venue/__tests__/venueIntelligence.noFabrication.test.ts",
  // #3025 moves the three merged #2986 structural source pins to one additive,
  // self-testing strict-grep owner while retaining every Jest file byte-for-byte.
  "server/__tests__/privateHostRoutesNoindex.issue2986.implementor.test.ts",
  "server/__tests__/privateHostRoutesNoindex.issue2986.tester.adversarial.test.ts",
  "server/__tests__/publicSearchMigration.issue2986.security.test.ts",
];

// Render/RTL suites mis-swept into the default node/ts-jest config. Each imports a
// real render lib and runs under its own dedicated config + per-issue workflow.
//   `configExcluded: true`  -> added to jest.config.cjs testPathIgnorePatterns
//                              (they only run via `--config jest.<orch>.render.cjs`).
//   `configExcluded: false` -> the 3 bare react-test-renderer orch0976 suites that
//                              run under the STOCK default config inside
//                              ci-batch:orch-0976-draft-promotion-tests (which installs
//                              react-test-renderer --no-save). Excluding them from
//                              the default config would BREAK that per-issue
//                              workflow (DO-NOT-TOUCH), so they are NOT excluded;
//                              the nightly suite installs react-test-renderer so
//                              they pass there too.
const RENDER_EXCLUDE = [
  { file: "src/components/notifications/__tests__/notifWebRender.orch1211.web.render.test.tsx", configExcluded: true },
  { file: "src/components/event/__tests__/EventPromotionRemount.orch1355.router.test.tsx", configExcluded: true },
  { file: "src/components/rsvp/__tests__/RsvpWizardNameFocus.orch1355.render.test.tsx", configExcluded: true },
  { file: "src/components/event/__tests__/EventPromotionAdversarial.orch1355.tester.test.tsx", configExcluded: true },
  { file: "src/components/rsvp/__tests__/RsvpPromotionRemount.orch1355.router.test.tsx", configExcluded: true },
  { file: "src/components/rsvp/__tests__/RsvpWizardToggleSnapback.orch1355.render.test.tsx", configExcluded: true },
  { file: "src/components/rsvp/__tests__/RsvpPromotionAdversarial.orch1355.tester.test.tsx", configExcluded: true },
  { file: "src/components/rsvp/__tests__/RsvpDeepLinkColdOpen.orch1355.tester.test.tsx", configExcluded: true },
  { file: "src/components/rsvp/__tests__/RsvpWizardToggleBurst.orch1355.tester.test.tsx", configExcluded: true },
  { file: "src/components/venue/__tests__/venueEmptyStateFullWidth.orch1190r2.web.render.test.tsx", configExcluded: true },
  { file: "src/components/venue/__tests__/venueEmptyStateFullWidth.orch1190r3.web.render.test.tsx", configExcluded: true },
  { file: "src/components/venue/__tests__/venueSuiteShell.orch1184.fullwidth.adversarial.render.test.tsx", configExcluded: true },
  { file: "src/components/ui/__tests__/glassChromeFullWidthSurface.orch1190.web.render.test.tsx", configExcluded: true },
  { file: "src/components/ui/__tests__/brandSwitch.orch1190r2.web.render.test.tsx", configExcluded: true },
  { file: "src/components/home/__tests__/LiveOfferingCard.flat.orch1143.render.test.tsx", configExcluded: true },
  { file: "src/components/home/__tests__/UpcomingDedup.orch1143.render.test.tsx", configExcluded: true },
  { file: "__tests__/venueTableCardMobileWidth.orch1190r2.web.render.test.tsx", configExcluded: true },
  { file: "src/hooks/__tests__/useServerDraftEvents.orch0976.activeDraft.test.tsx", configExcluded: false },
  { file: "src/components/event/__tests__/EventRouteKeystrokeSurvives.orch0976.test.tsx", configExcluded: false },
  { file: "src/components/rsvp/__tests__/RsvpRouteKeystrokeSurvives.orch0976.test.tsx", configExcluded: false },
];

// ---------------------------------------------------------------------------
// §4.1.1 algorithm
// ---------------------------------------------------------------------------

const RENDER_LIB_IMPORT =
  /(?:import[^;]*?from\s*|require\(\s*)["'](?:react-test-renderer|@testing-library\/[^"']+|react-dom\/server|react-native-web)["']/;
// Behavioral execution markers: awaiting a function call, or a jest.mock() with a
// factory (runtime-driving). Comments are stripped before this test runs.
const AWAIT_FN = /await\s+[A-Za-z_$][\w.]*\s*\(/;
const MOCK_FACTORY = /jest\.mock\([^)]*,\s*(?:async\s*)?\(\)\s*=>/;
const SOURCE_READ = /readFileSync\s*\(|\breadFile\s*\(/;

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function readBiz(rel) {
  return fs.readFileSync(path.join(BIZ_ROOT, rel), "utf8");
}

/**
 * Classify a single test file by CONTENT into one of:
 *   "render"      — imports a real render lib.
 *   "source-pin"  — reads source as text AND has no behavioral execution.
 *   "behavioral"  — executes real logic (await fn / mock factory).
 *   "unknown"     — none of the above (no source read, no render, no exec).
 * INVARIANT_CONVERT vs QUARANTINE_SAFE is a human-review split ON TOP of a
 * "source-pin" result (both are source-pins; the reviewed allowlist picks the
 * load-bearing ones), so classifyFile alone returns "source-pin" for both.
 */
export function classifyFile(rel) {
  const raw = readBiz(rel);
  const code = stripComments(raw);
  if (RENDER_LIB_IMPORT.test(code)) return "render";
  const reads = SOURCE_READ.test(code);
  const behavioral = AWAIT_FN.test(code) || MOCK_FACTORY.test(code);
  if (reads && !behavioral) return "source-pin";
  if (behavioral) return "behavioral";
  return "unknown";
}

function verifyPartition() {
  const problems = [];
  const invSet = new Set(INVARIANT_CONVERT);
  const qSet = new Set(QUARANTINE_SAFE);
  // QUARANTINE_SAFE + INVARIANT_CONVERT must every one classify as "source-pin".
  for (const rel of [...QUARANTINE_SAFE, ...INVARIANT_CONVERT]) {
    let kind;
    try {
      kind = classifyFile(rel);
    } catch (e) {
      problems.push(`MISSING or unreadable: ${rel} (${e.message})`);
      continue;
    }
    if (kind !== "source-pin") {
      problems.push(
        `${rel} is declared ${invSet.has(rel) ? "INVARIANT_CONVERT" : "QUARANTINE_SAFE"} ` +
          `but classifyFile() says "${kind}" (expected "source-pin").`,
      );
    }
  }
  // No file may be in both source-pin lists.
  for (const rel of QUARANTINE_SAFE) {
    if (invSet.has(rel)) problems.push(`${rel} is in BOTH QUARANTINE_SAFE and INVARIANT_CONVERT.`);
  }
  // RENDER_EXCLUDE must every one classify as "render".
  for (const { file } of RENDER_EXCLUDE) {
    let kind;
    try {
      kind = classifyFile(file);
    } catch (e) {
      problems.push(`MISSING or unreadable: ${file} (${e.message})`);
      continue;
    }
    if (kind !== "render") {
      problems.push(`${file} is declared RENDER_EXCLUDE but classifyFile() says "${kind}" (expected "render").`);
    }
    if (qSet.has(file) || invSet.has(file)) problems.push(`${file} is in RENDER_EXCLUDE and a source-pin list.`);
  }
  return problems;
}

// ---------------------------------------------------------------------------
// --assert-no-new: I-PROPOSED-1047-NO-SOLE-SOURCE-PIN
// ---------------------------------------------------------------------------

function isBizTest(p) {
  return (
    p.startsWith("mingla-business/") &&
    /\.test\.tsx?$/.test(p) &&
    p.includes("__tests__")
  );
}

function assertNoNewSourcePin(baseRef) {
  // Resolve the base ref best-effort (mirrors test-append-only-check.js).
  let base = baseRef;
  const REPO_ROOT = path.resolve(BIZ_ROOT, "..");
  const git = (args) => execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" });
  if (!base) {
    for (const cand of ["origin/main", "main", "HEAD~1"]) {
      try {
        git(["rev-parse", "--verify", cand]);
        base = cand;
        break;
      } catch {
        /* try next */
      }
    }
  }
  if (!base) {
    console.log("NO-SOLE-SOURCE-PIN: no base ref resolvable — skipping (nothing to diff).");
    return 0;
  }
  let added;
  try {
    added = git(["diff", "--name-only", "--diff-filter=A", `${base}...HEAD`, "--"])
      .split("\n")
      .filter(Boolean)
      .filter(isBizTest);
  } catch (e) {
    console.log(`NO-SOLE-SOURCE-PIN: cannot diff against ${base} (${e.message.split("\n")[0]}) — skipping.`);
    return 0;
  }
  const offenders = [];
  for (const p of added) {
    const rel = p.slice("mingla-business/".length);
    let kind;
    try {
      kind = classifyFile(rel);
    } catch {
      continue; // file not on disk (deleted later in range) — nothing to assert
    }
    if (kind === "source-pin") offenders.push(rel);
  }
  if (offenders.length) {
    console.error(
      "\nFAIL [I-PROPOSED-1047-NO-SOLE-SOURCE-PIN]: a NEW mingla-business test asserts ONLY\n" +
        "source text (readFileSync + source-derived expects, no render, no executed behavior).\n" +
        "Such pins rot on every refactor and caught zero of the #1047 regressions. Write a test\n" +
        "that exercises real behavior, or (for a genuine structural rule) an additive strict-grep gate.\n",
    );
    for (const o of offenders) console.error(`  x ${o}`);
    console.error("");
    return 1;
  }
  console.log(`NO-SOLE-SOURCE-PIN: OK — no new source-only pin among ${added.length} added biz test file(s) vs ${base}.`);
  return 0;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function emit(json) {
  const configExcluded = RENDER_EXCLUDE.filter((r) => r.configExcluded).map((r) => r.file).sort();
  const rtrHandled = RENDER_EXCLUDE.filter((r) => !r.configExcluded).map((r) => r.file).sort();
  const out = {
    QUARANTINE_SAFE: [...QUARANTINE_SAFE].sort(),
    INVARIANT_CONVERT: [...INVARIANT_CONVERT].sort(),
    RENDER_EXCLUDE: [...RENDER_EXCLUDE].map((r) => r.file).sort(),
    RENDER_EXCLUDE_configExcluded: configExcluded,
    RENDER_EXCLUDE_rtrInstallHandled: rtrHandled,
    counts: {
      QUARANTINE_SAFE: QUARANTINE_SAFE.length,
      INVARIANT_CONVERT: INVARIANT_CONVERT.length,
      RENDER_EXCLUDE: RENDER_EXCLUDE.length,
    },
  };
  if (json) {
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  const section = (title, files) => {
    console.log(`\n${title} (${files.length}):`);
    for (const f of files) console.log(`  ${f}`);
  };
  console.log("select-source-text-pins — #1047 [business-jest-suite-audit]");
  section("QUARANTINE_SAFE", out.QUARANTINE_SAFE);
  section("INVARIANT_CONVERT", out.INVARIANT_CONVERT);
  section("RENDER_EXCLUDE — config-excluded (added to testPathIgnorePatterns)", out.RENDER_EXCLUDE_configExcluded);
  section("RENDER_EXCLUDE — react-test-renderer install (kept in default config)", out.RENDER_EXCLUDE_rtrInstallHandled);
  console.log(
    `\ncounts: QUARANTINE_SAFE=${out.counts.QUARANTINE_SAFE} ` +
      `INVARIANT_CONVERT=${out.counts.INVARIANT_CONVERT} ` +
      `RENDER_EXCLUDE=${out.counts.RENDER_EXCLUDE}`,
  );
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--assert-no-new")) {
    const i = argv.indexOf("--assert-no-new");
    process.exit(assertNoNewSourcePin(argv[i + 1]));
  }
  // Every mode except --assert-no-new re-verifies the partition against disk.
  const problems = verifyPartition();
  if (problems.length) {
    console.error("\nselect-source-text-pins FAILED — declared partition disagrees with classifyFile():\n");
    for (const p of problems) console.error(`  x ${p}`);
    console.error("");
    process.exit(1);
  }
  emit(argv.includes("--json"));
  if (argv.includes("--check")) process.exit(0);
}

// Auto-run ONLY when executed directly as a CLI (`node select-source-text-pins.mjs …`,
// including the spawnSync in i-proposed-1047-biz-no-sole-source-pin.mjs) — NOT when
// imported for its `classifyFile`/`assertNoNewSourcePin` exports (e.g. by the tester's
// orch-1047 anti-quarantine gate), so importing has no side effects. `fileURLToPath`
// DECODES any %5B/%5D in a bracketed worktree path (#1047 D-1047), so this comparison
// is robust to the worktree-name fileURLToPath footgun.
const invokedDirectly =
  Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) main();
