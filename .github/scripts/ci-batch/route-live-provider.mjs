#!/usr/bin/env node
// [#3072] Path routing for the live-provider lanes that ci-batch does NOT execute.
//
// #2882 gave every REGISTERED SUITE an `originPaths` list and taught the batch
// runner to execute only the suites a pull request's diff invalidates. Six lanes
// were left outside that: they are recorded in `.github/ci-batch/MANIFEST.json`
// under `legacyOrigins` with disposition `database-special` or
// `operational-excluded` — the reviewed decision that they cannot be folded into
// a shared batch class, because they stand up their own PostgreSQL 17 container,
// their own Deno toolchain, or their own web export. They stayed live providers,
// and the ONLY filter on them excluded one machine-written baseline file, so they
// fired on every human pull request including documentation-only ones.
//
// They could not simply be moved into `suites[]`: validate-manifest-v2.mjs
// requires `batched-active` and `batched-historical` suites to have NO live
// wrapper, and the only lifecycle that permits a live wrapper is `shadow-active`,
// which is a wave-scoped, digest-sealed migration state that would ADD a parallel
// run rather than remove one. So the routing DATA lives beside their existing
// registry record, under `legacyOrigins[].routing`, and is read by exactly the
// same grammar and the same matcher #2882 uses for `suites[].originPaths`:
// `parseOriginPattern` / `pathMatches` from select-phase3b-suites.mjs. There is
// one origin-pattern grammar in this repository and this file does not add a
// second.
//
// FAIL-SAFE, deliberately, and this is the one place it differs from #2882's
// batch runner. That runner hard-fails when it cannot see the diff, because a
// router that cannot see the diff would otherwise select nothing and report green
// having tested nothing. Here the fallback is `selected=true`: the lane runs in
// full. That cannot produce a false green — the tests still execute — and it
// cannot produce a silent skip. An unreadable registry, an unparseable pattern,
// an absent event payload and a failed git derivation all route TO the tests.
//
// The one hard refusal is an EMPTY or ABSENT `originPaths` on a registered lane.
// #2882 fails the build on that rather than letting a suite route to nothing, and
// this file must not become the first exception, so it exits non-zero AND selects
// the lane. Fail-closed on the registry, fail-safe on the observation.
//
// Lanes are addressed by OWNER ISSUE, never by workflow filename: a workflow
// filename literal in a tracked non-workflow file is counted by
// `discoverWorkflowProviders()` as an external provider reference and moves the
// frozen #2148 provider seal. The lane's own wrapper path is read from the
// registry at runtime instead, so editing a lane's wrapper still selects it
// without this file ever naming one.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { pathMatches } from "./select-phase3b-suites.mjs";
import { routingContext } from "./run-suite-batch.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, "../../..");
export const MANIFEST_PATH = path.join(ROOT, ".github/ci-batch/MANIFEST.json");

/**
 * [#3072] The registry record for one live-provider lane, or a refusal.
 *
 * Exactly one match is required. Zero means the lane was gated by a workflow that
 * no longer has a registry entry; more than one means two entries claim the same
 * owner issue and the decision would depend on array order.
 */
export function routedProvider(manifest, ownerIssue) {
  const wanted = `#${String(ownerIssue).replace(/^#/, "")}`;
  const matches = (manifest.legacyOrigins || []).filter(
    (origin) => origin.ownerIssue === wanted && origin.routing,
  );
  if (matches.length !== 1) {
    throw new Error(
      `expected exactly one routed live provider for ${wanted}, found ${matches.length}`,
    );
  }
  return matches[0];
}

/**
 * [#3072] The routing patterns for one lane, under #2882's emptiness rule.
 *
 * Mirrors `suiteOriginPatterns` in validate-manifest-v2.mjs: absent or empty is a
 * hard error, because a lane that routes to nothing would never run again and the
 * repository would have no signal that it had stopped.
 */
export function providerOriginPatterns(provider) {
  const entries = provider.routing?.originPaths;
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error(
      `originPaths is empty for ${provider.stem}: a lane that routes to nothing would never run`,
    );
  }
  for (const entry of entries) {
    if (typeof entry !== "string" || !entry) {
      throw new Error(`originPaths entry is not a string for ${provider.stem}`);
    }
  }
  return entries;
}

/**
 * [#3072] The decision.
 *
 * `mode: "full"` — anything that is not a routed pull-request event — selects
 * unconditionally, exactly as #2882's `selectSuites` does, so merges to `main`,
 * scheduled runs and manual dispatches keep running these lanes in full.
 *
 * A changed file that IS the lane's own wrapper always selects, derived from the
 * registry's `providerWorkflow` rather than from a literal in this file.
 */
export function decideSelection(provider, patterns, context) {
  if (context.mode !== "routed") {
    return { selected: true, reason: `event ${context.eventName} is not routed`, matchedPattern: null, matchedPath: null };
  }
  const wrapper = provider.providerWorkflow;
  if (wrapper && context.changedPaths.includes(wrapper)) {
    return { selected: true, reason: "the lane's own wrapper changed", matchedPattern: wrapper, matchedPath: wrapper };
  }
  for (const pattern of patterns) {
    const hit = context.changedPaths.find((file) => pathMatches(pattern, file));
    if (hit) return { selected: true, reason: "a routed path changed", matchedPattern: pattern, matchedPath: hit };
  }
  return { selected: false, reason: "no routed path changed", matchedPattern: null, matchedPath: null };
}

/**
 * [#3072 §8] The decision, always printed beside its denominator.
 *
 * A bare "skipped" line is indistinguishable from a router that saw nothing, so
 * the changed-path count is printed with every verdict.
 */
export function renderDecision(provider, patterns, context, decision) {
  const changed = context.mode === "routed" ? String(context.changedPaths.length) : "n/a";
  const verdict = decision.selected ? "RUN" : "SKIP";
  const detail = decision.matchedPattern ? ` via ${decision.matchedPattern} <- ${decision.matchedPath}` : "";
  return `[#3072] ${provider.ownerIssue} ${verdict}: ${decision.reason}${detail}`
    + ` (patterns=${patterns.length} changedPaths=${changed} mode=${context.mode} event=${context.eventName})`;
}

function writeOutput(selected) {
  const target = process.env.GITHUB_OUTPUT;
  const line = `selected=${selected ? "true" : "false"}\n`;
  if (target) fs.appendFileSync(target, line);
  else process.stdout.write(line);
}

export function main(argv = process.argv.slice(2), { env = process.env } = {}) {
  const index = argv.indexOf("--issue");
  if (index === -1 || !argv[index + 1]) throw new Error("expected --issue <number>");
  const ownerIssue = argv[index + 1];

  let provider;
  let patterns;
  try {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
    provider = routedProvider(manifest, ownerIssue);
    patterns = providerOriginPatterns(provider);
  } catch (error) {
    // Fail-closed on the REGISTRY: the lane still runs, and the run is red, so an
    // unregistered or empty-routing lane cannot quietly become permanently green.
    console.error(`::error title=Live-provider routing registry::${error.message}`);
    writeOutput(true);
    return 1;
  }

  let context;
  try {
    context = routingContext({ env, root: ROOT });
  } catch (error) {
    // Fail-SAFE on the OBSERVATION: run everything, say so loudly, stay green.
    console.error(`::warning title=Live-provider routing fell back to running in full::${error.message}`);
    writeOutput(true);
    return 0;
  }

  let decision;
  try {
    decision = decideSelection(provider, patterns, context);
  } catch (error) {
    console.error(`::warning title=Live-provider routing fell back to running in full::${error.message}`);
    writeOutput(true);
    return 0;
  }

  console.log(renderDecision(provider, patterns, context, decision));
  writeOutput(decision.selected);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`::error title=Live-provider routing::${error.message}`);
    writeOutput(true);
    process.exitCode = 1;
  }
}
