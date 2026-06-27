#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Strict-grep gate — META-ORCH-1235
 * I-PROPOSED-1235-C — no unbounded full-screen spinner: every enumerated
 * full-screen loading gate has a sibling error branch that renders a Retry
 * affordance wired to `refetch()`.
 *
 * WHY: a bare `if (query.isLoading) return <Spinner/>` with no error+retry
 * sibling is a freeze waiting to happen — a hung read leaves it spinning with
 * no escape but a page reload. With §2 wrapping the gating reads in withTimeout,
 * the query now rejects after retries → `isError` fires; the gate must surface a
 * recoverable error + Retry (→ refetch), NOT an indefinite spinner.
 *
 * THIS GATE: for each enumerated screen, assert it has BOTH a loading return
 * (spinner / skeleton) AND an error return that references a retry handler
 * (`refetch(` and/or `onRetry`). This in-script registry is the source of truth
 * for which gates count; adding a full-screen-gating screen without an error+
 * retry sibling fails CI.
 *
 * Exit codes: 0 pass · 1 fail · 2 fs error. Self-test (--self-test).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

// Each entry: file + a loading-detector + an error+retry-detector.
const REGISTRY = [
  {
    rel: "mingla-business/app/(tabs)/hub/experiences.tsx",
    loading: /isLoading[\s\S]{0,120}?ActivityIndicator/,
    errorRetry: /isError[\s\S]{0,600}?refetch\s*\(/,
  },
  {
    rel: "mingla-business/app/(tabs)/hub/trips.tsx",
    loading: /isLoading[\s\S]{0,120}?ActivityIndicator/,
    errorRetry: /isError[\s\S]{0,600}?refetch\s*\(/,
  },
  {
    // The brand profile gate lives in BrandProfileView (isResolving spinner +
    // isError → Retry); the route wires onRetry → brandQuery.refetch().
    rel: "mingla-business/src/components/brand/BrandProfileView.tsx",
    loading: /brand === null && isResolving[\s\S]{0,400}?ActivityIndicator/,
    errorRetry: /isError[\s\S]{0,600}?onRetry/,
  },
  {
    rel: "mingla-business/app/brand/[id]/index.tsx",
    // Route side: passes isError + onRetry(→refetch) to BrandProfileView.
    loading: /isResolving=\{/,
    errorRetry: /isError=\{[\s\S]{0,400}?refetch\s*\(/,
  },
  {
    rel: "mingla-business/app/(tabs)/marketing/index.tsx",
    loading: /hasResolved[\s\S]{0,800}?ActivityIndicator/,
    errorRetry: /isError[\s\S]{0,800}?refetch\s*\(/,
  },
];

let failures = 0;
const fail = (check, msg) => {
  failures += 1;
  console.error(`FAIL [${check}] ${msg}`);
};
const ok = (check, msg) => console.log(`OK   [${check}] ${msg}`);

function read(rel) {
  const abs = path.join(REPO_ROOT, rel);
  try {
    return fs.readFileSync(abs, "utf8");
  } catch (e) {
    console.error(`fs error reading ${rel}: ${e.message}`);
    process.exit(2);
  }
}
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

function runSelfTest() {
  let f = 0;
  const good = stripComments(`
    if (q.isLoading) { return <ActivityIndicator/>; }
    if (q.isError) { return <Pressable onPress={() => q.refetch()}><Text>Retry</Text></Pressable>; }
  `);
  const bad = stripComments(`
    if (q.isLoading) { return <ActivityIndicator/>; }
  `);
  const L = /isLoading[\s\S]{0,120}?ActivityIndicator/;
  const E = /isError[\s\S]{0,600}?refetch\s*\(/;
  if (!L.test(good) || !E.test(good)) {
    console.error("SELF-TEST FAIL: good gate (loading + error+retry) not detected");
    f++;
  }
  if (E.test(bad)) {
    console.error("SELF-TEST FAIL: bare loading-only gate falsely matched error+retry");
    f++;
  }
  if (f > 0) {
    console.error(`SELF-TEST: ${f} expectation(s) failed`);
    process.exit(1);
  }
  console.log("SELF-TEST OK: I-PROPOSED-1235-C detectors behave");
  process.exit(0);
}
if (process.argv.includes("--self-test")) runSelfTest();

for (const { rel, loading, errorRetry } of REGISTRY) {
  const src = stripComments(read(rel));
  const tag = rel.split("/").slice(-2).join("/");
  if (loading.test(src)) {
    ok(`${tag}-loading`, `has a full-screen loading gate`);
  } else {
    fail(`${tag}-loading`, `${rel} loading gate not found by detector`);
  }
  if (errorRetry.test(src)) {
    ok(`${tag}-error-retry`, `loading gate has an error+Retry sibling (refetch)`);
  } else {
    fail(
      `${tag}-error-retry`,
      `${rel} has a full-screen loading gate with NO error+Retry sibling — a hung read can freeze it. Add an isError branch with a Retry that calls refetch().`,
    );
  }
}

if (failures > 0) {
  console.error(`\nI-PROPOSED-1235-C: ${failures} violation(s)`);
  process.exit(1);
}
console.log("\nI-PROPOSED-1235-C: PASS · violations=0");
process.exit(0);
