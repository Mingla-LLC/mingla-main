/**
 * #3186 tester adversarial — runs the REAL deploy script and proves the bake
 * gate refuses before it can mutate anything or reach a deploy boundary.
 *
 * Reading the guard's source would not answer this: #2241 and #3185 both shipped
 * with passing tests over code that was never executed against the real path.
 * This spawns `scripts/deploy-supabase-functions.sh` and asserts on its exit
 * code, its message, and — the part that matters — that the bake file on disk is
 * byte-identical afterwards.
 */
import { strict as assert } from "node:assert";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEPLOY = resolve(REPO_ROOT, "scripts", "deploy-supabase-functions.sh");
const BAKE = resolve(
  REPO_ROOT,
  "supabase",
  "functions",
  "_shared",
  "releaseAttestationBake.ts",
);
const PRODUCTION_REF = "gqnoajqerqhnvulmnyvv";

function runDeploy(mergedCommit) {
  return spawnSync("bash", [
    DEPLOY,
    "--function",
    "agent-chat",
    "--merged-commit",
    mergedCommit,
  ], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 120_000,
    env: { ...process.env, SUPABASE_PROJECT_ID: PRODUCTION_REF },
  });
}

test("#3186 adversarial: a non-SHA merged commit is refused before any mutation", () => {
  const before = readFileSync(BAKE, "utf8");
  const result = runDeploy("not-a-sha");
  assert.equal(result.status, 2, `expected exit 2, got ${result.status}`);
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  assert.match(output, /must be exactly 40 lowercase hex/);
  assert.doesNotMatch(output, /PASS baked release attestation/);
  // The load-bearing assertion: a refused deploy leaves the tree untouched.
  assert.equal(readFileSync(BAKE, "utf8"), before);
});

test("#3186 adversarial: a 64-hex digest is refused, because no client accepts it", () => {
  // The edge pattern tolerates 40-64 hex; the Business app requires exactly 40.
  // A 64-char digest would therefore serve happily and be rejected by every
  // production build — the #3185 outage from the other end.
  const before = readFileSync(BAKE, "utf8");
  const result = runDeploy("e".repeat(64));
  assert.equal(result.status, 2);
  assert.match(
    `${result.stdout ?? ""}${result.stderr ?? ""}`,
    /must be exactly 40 lowercase hex/,
  );
  assert.equal(readFileSync(BAKE, "utf8"), before);
});

test("#3186 adversarial: an uppercase SHA is refused rather than silently lowercased", () => {
  // The deploy writes a literal into source. Normalising here would hide a
  // caller passing something other than a git SHA; refusing names the fault.
  const before = readFileSync(BAKE, "utf8");
  const result = runDeploy("A".repeat(40));
  assert.equal(result.status, 2);
  assert.equal(readFileSync(BAKE, "utf8"), before);
});

test("#3186 adversarial: the committed bake carries the sentinel, never a real SHA", () => {
  const source = readFileSync(BAKE, "utf8");
  const line = source
    .split("\n")
    .find((candidate) => candidate.startsWith("export const BAKED_RELEASE_SHA = "));
  assert.ok(line, "bake target line is missing");
  assert.equal(line, 'export const BAKED_RELEASE_SHA = "unattested";');
});
