#!/usr/bin/env node
/**
 * I-PROPOSED-1047-BIZ-NO-SOLE-SOURCE-PIN  (issue #1047 [business-jest-suite-audit])
 *
 * DRAFT invariant (flips ACTIVE at CLOSE): a NEW mingla-business test whose ONLY
 * assertions read source text (readFileSync + source-derived expects, no render,
 * no executed behavior — the §4.1.1 pure source-text pin) is disallowed as a
 * regression proof. Such pins caught ZERO of the ~245 regressions #1047 cleaned up;
 * they rot on every refactor and manufacture false confidence. Codifies "brittle
 * source-text pins are not reintroduced."
 *
 * Enforced by running the committed selector in --assert-no-new mode against the
 * PR diff (it classifies each ADDED biz *.test.ts(x) and fails on a pure pin). The
 * selector resolves the base ref best-effort and passes cleanly when there is
 * nothing to diff, so this gate is safe on any checkout depth.
 */
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const SELECTOR = path.join(REPO, "mingla-business/scripts/ci/select-source-text-pins.mjs");

const base = process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : "";
const args = [SELECTOR, "--assert-no-new"];
if (base) args.push(base);

const r = spawnSync("node", args, { cwd: REPO, encoding: "utf8", env: process.env });
process.stdout.write(r.stdout || "");
process.stderr.write(r.stderr || "");
if (r.status !== 0) {
  console.error("\nFAIL [I-PROPOSED-1047-BIZ-NO-SOLE-SOURCE-PIN]: a new source-only pin was added as a regression proof (see above).");
  process.exit(r.status || 1);
}
console.log("OK [I-PROPOSED-1047-BIZ-NO-SOLE-SOURCE-PIN]: no new source-only pin in the diff.");
