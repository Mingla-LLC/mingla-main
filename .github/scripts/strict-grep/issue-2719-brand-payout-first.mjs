#!/usr/bin/env node
// #2719 — payout-first brand creation structural guard.
//
// Currency selects pricing context; it never proves a bank can collect.
// Free creators stay open in every payout state.

// The tester file is deliberately reserved before independent testing begins.
// Once the tester creates it, this guard immediately makes its presence and
// non-skipped status permanent without forcing the implementor to author it.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const PATHS = Object.freeze({
  flow: "mingla-business/src/components/brand/BrandCreationFlow.tsx",
  chooser: "mingla-business/src/components/brand/OfferingChooser.tsx",
  mapper: "mingla-business/src/services/brandMapping.ts",
  state: "mingla-business/src/utils/brandCreationPayoutState.ts",
  happy: "mingla-business/src/components/brand/__tests__/issue_2719_brand_payout_first.happy.test.tsx",
  tester: "mingla-business/src/components/brand/__tests__/issue_2719_brand_payout_first.tester_adversarial.test.tsx",
  fullSuiteGuard: ".github/scripts/strict-grep/i-proposed-1047-biz-jest-wired.mjs",
  invariants: "docs/INVARIANT_REGISTRY.md",
});

const KINDS = ["event", "trip", "experience", "rsvp", "venue"];
const ROUTES = [
  "/event/create",
  "/trip/create",
  "/experience/create",
  "/rsvp/create",
  "/venue/create",
];
const hasWhy = (source) =>
  source.includes("Currency selects pricing context; it never proves a bank can collect.") &&
  source.includes("Free creators stay open in every payout state.");

function readSnapshot(root = ROOT) {
  const snapshot = new Map();
  for (const [key, relative] of Object.entries(PATHS)) {
    const absolute = path.join(root, relative);
    snapshot.set(key, fs.existsSync(absolute) ? fs.readFileSync(absolute, "utf8") : null);
  }
  return snapshot;
}

export function checkSnapshot(snapshot) {
  const failures = [];
  const need = (key) => {
    const value = snapshot.get(key);
    if (typeof value !== "string") failures.push(`${key}: required file is missing`);
    return typeof value === "string" ? value : "";
  };
  const flow = need("flow");
  const chooser = need("chooser");
  const mapper = need("mapper");
  const state = need("state");
  const happy = need("happy");
  const fullSuiteGuard = need("fullSuiteGuard");
  const invariants = need("invariants");
  const tester = snapshot.get("tester");

  if (!hasWhy(state) || !hasWhy(happy)) {
    failures.push("WHY: production and implementor proof must preserve the currency/readiness comment");
  }
  if (/\b(?:describe|test|it)\.(?:skip|todo)|\b(?:xdescribe|xit|xtest)\s*\(/.test(happy)) {
    failures.push("HAPPY: implementor proof may not be skipped or todo");
  }
  if (typeof tester === "string") {
    if (/\b(?:describe|test|it)\.(?:skip|todo)|\b(?:xdescribe|xit|xtest)\s*\(/.test(tester)) {
      failures.push("TESTER: staged independent proof exists but is skipped or todo");
    }
    if (!/issue[_ -]?2719/i.test(tester)) {
      failures.push("TESTER: staged independent proof does not identify issue 2719");
    }
  }

  const kindUnion = KINDS.map((kind) => `"${kind}"`).join(" | ");
  if (!chooser.includes(`export type OfferingKind = ${kindUnion};`)) {
    failures.push("CHOOSER: OfferingKind must be the exact five-member union");
  }
  for (const [index, kind] of KINDS.entries()) {
    if (!chooser.includes(`kind: "${kind}"`)) failures.push(`CHOOSER: missing ${kind} option`);
    if (!chooser.includes(`case "${kind}":`) || !chooser.includes(`return "${ROUTES[index]}";`)) {
      failures.push(`ROUTE: ${kind} must route exactly to ${ROUTES[index]}`);
    }
  }
  if (!chooser.includes("testID={`offering-chooser-${option.kind}`}")) {
    failures.push("CHOOSER: exact per-kind testID contract is missing");
  }
  if (!chooser.includes("const neverOffering: never = offering") || !chooser.includes("throw new Error")) {
    failures.push("ROUTE: unknown kinds must throw through an exhaustive branch");
  }
  if (!chooser.includes('option.kind === "venue" ? styles.optionVenuePressable')) {
    failures.push("LAYOUT: Venue must retain its full-width grid branch");
  }

  if (!flow.includes('state.mode === "client" && state.step === 3') ||
      !flow.includes('? 5') ||
      !flow.includes('state.mode === "self" && state.step === 4') ||
      !flow.includes('? 6')) {
    failures.push("FLOW: client must bypass Payouts/Create and self must advance Payouts to Create");
  }
  for (const label of ["Brand", "Place", "Look", "Payouts", "Create"]) {
    if (!flow.includes(`label: "${label}"`)) failures.push(`FLOW: missing self step label ${label}`);
  }
  if (!flow.includes("defaultCurrency: rail.currency") || !mapper.includes("out.default_currency = patch.defaultCurrency")) {
    failures.push("CURRENCY: resolver output must persist through the authenticated mapper path");
  }
  if (/defaultCurrency|default_currency/.test(state)) {
    failures.push("READINESS: payout-state derivation must never read currency");
  }
  if (!state.includes('state === "ready" || state === "pending" || state === "restricted"')) {
    failures.push("RESUME: ready, pending, and restricted must resume at Create");
  }

  if (!fullSuiteGuard.includes("const invokesSuite") ||
      !fullSuiteGuard.includes("process.exit(1)") ||
      !fullSuiteGuard.includes("runs the whole jest suite")) {
    failures.push("CI: the existing full-suite wiring guard is absent or fail-open");
  }
  for (const invariant of [
    "I-2719-CURRENCY-IS-NOT-PAYOUT-READINESS (ACTIVE)",
    "I-2719-FREE-CREATORS-ALWAYS-OPEN (ACTIVE)",
  ]) {
    if (!invariants.includes(invariant)) {
      failures.push(`INVARIANT: missing ${invariant}`);
    }
  }

  return failures;
}

function selfTest() {
  const clean = new Map([
    ["flow", 'label: "Brand"; label: "Place"; label: "Look"; label: "Payouts"; label: "Create"; state.mode === "client" && state.step === 3 ? 5 : state.mode === "self" && state.step === 4 ? 6 : 0; defaultCurrency: rail.currency'],
    ["chooser", 'export type OfferingKind = "event" | "trip" | "experience" | "rsvp" | "venue"; kind: "event"; kind: "trip"; kind: "experience"; kind: "rsvp"; kind: "venue"; case "event": return "/event/create"; case "trip": return "/trip/create"; case "experience": return "/experience/create"; case "rsvp": return "/rsvp/create"; case "venue": return "/venue/create"; const neverOffering: never = offering; throw new Error(); testID={`offering-chooser-${option.kind}`} option.kind === "venue" ? styles.optionVenuePressable'],
    ["mapper", "out.default_currency = patch.defaultCurrency"],
    ["state", '// Currency selects pricing context; it never proves a bank can collect.\n// Free creators stay open in every payout state.\nstate === "ready" || state === "pending" || state === "restricted"'],
    ["happy", '// Currency selects pricing context; it never proves a bank can collect.\n// Free creators stay open in every payout state.\ntest("issue 2719", () => {})'],
    ["tester", null],
    ["fullSuiteGuard", "const invokesSuite = true; process.exit(1); runs the whole jest suite"],
    ["invariants", "I-2719-CURRENCY-IS-NOT-PAYOUT-READINESS (ACTIVE)\nI-2719-FREE-CREATORS-ALWAYS-OPEN (ACTIVE)"],
  ]);
  if (checkSnapshot(clean).length !== 0) throw new Error(`clean fixture failed: ${checkSnapshot(clean).join("; ")}`);

  const mutations = [
    ["true deletion", "happy", null],
    ["currency implies ready", "state", `${clean.get("state")}\ndefaultCurrency`],
    ["RSVP removed", "chooser", clean.get("chooser").replace('kind: "rsvp";', "")],
    ["client enters payouts", "flow", clean.get("flow").replace('state.mode === "client" && state.step === 3 ? 5', 'state.mode === "client" && state.step === 3 ? 4')],
    ["tester skipped after staging", "tester", 'test.skip("issue 2719", () => {})'],
    ["full suite guard weakened", "fullSuiteGuard", "const invokesSuite = true"],
    ["invariant downgraded", "invariants", "I-PROPOSED-2719-CURRENCY-IS-NOT-PAYOUT-READINESS (DRAFT)\nI-PROPOSED-2719-FREE-CREATORS-ALWAYS-OPEN (DRAFT)"],
  ];
  for (const [label, key, value] of mutations) {
    const planted = new Map(clean);
    planted.set(key, value);
    if (checkSnapshot(planted).length === 0) throw new Error(`${label}: mutation escaped`);
  }
  process.stdout.write("[issue-2719-brand-payout-first] SELF-TEST PASS — 7 hostile mutations detected, including true deletion, staged tester skip, and invariant downgrade.\n");
}

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  const failures = checkSnapshot(readSnapshot());
  if (failures.length > 0) {
    process.stderr.write(`[issue-2719-brand-payout-first] FAIL\n${failures.map((failure) => `- ${failure}`).join("\n")}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write("[issue-2719-brand-payout-first] PASS — free creators remain open; currency remains pricing-only; staged tester reservation intact.\n");
  }
}
