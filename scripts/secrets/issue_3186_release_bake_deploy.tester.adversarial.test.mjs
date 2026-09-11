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

// ── #3217 — the bake must not outlive the deploy ─────────────────────────────
//
// The bake rewrites a TRACKED file. Before #3217 it was never put back, so any
// run outside a throwaway CI checkout — a hand deploy from a worktree, or
// scripts/ci/issue1456-edge-deploy-idempotency.test.mjs, which runs this script
// for real — left the stamped SHA behind as an uncommitted change. These cases
// run the real script with `supabase` and `node` mocked on PATH, and prove BOTH
// halves: the deploy command saw the baked SHA while it ran, and the file is
// byte-identical to the original after the script exits — on success AND on a
// failed deploy.

async function runMockedDeploy({ sha, deployExitCode }) {
  const { chmod, mkdtemp, writeFile, readFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const root = await mkdtemp(join(tmpdir(), "mingla-3217-"));
  const seenPath = join(root, "seen.txt");
  // `supabase` records what the bake file said AT DEPLOY TIME, then succeeds or
  // fails as instructed. A non-409 failure is fatal to the wrapper.
  await writeFile(
    join(root, "supabase"),
    `#!/usr/bin/env bash
grep '^export const BAKED_RELEASE_SHA = ' "$MINGLA_3217_BAKE" >> "$MINGLA_3217_SEEN"
if [[ "$MINGLA_3217_EXIT" != 0 ]]; then
  printf '%s\\n' 'unexpected deploy status 500: {"message":"boom"}' >&2
  exit "$MINGLA_3217_EXIT"
fi
printf 'deployed %s\\n' "$3"
`,
  );
  await chmod(join(root, "supabase"), 0o755);
  // Authority, preflight and the post-deploy watch have their own suites.
  await writeFile(join(root, "node"), "#!/usr/bin/env bash\nexit 0\n");
  await chmod(join(root, "node"), 0o755);
  const result = spawnSync("bash", [
    DEPLOY,
    "--function",
    "agent-chat",
    "--merged-commit",
    sha,
  ], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 120_000,
    env: {
      ...process.env,
      PATH: `${root}:${process.env.PATH}`,
      SUPABASE_PROJECT_ID: PRODUCTION_REF,
      MINGLA_3217_BAKE: BAKE,
      MINGLA_3217_SEEN: seenPath,
      MINGLA_3217_EXIT: String(deployExitCode),
    },
  });
  const seen = await readFile(seenPath, "utf8").catch(() => "");
  return { result, seen };
}

test("#3217 adversarial: a SUCCESSFUL deploy ships the baked SHA and leaves the file untouched", async () => {
  const before = readFileSync(BAKE, "utf8");
  const sha = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
  const { result, seen } = await runMockedDeploy({ sha, deployExitCode: 0 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(seen, new RegExp(`BAKED_RELEASE_SHA = "${sha}";`), "the deploy must see the baked SHA");
  assert.equal(readFileSync(BAKE, "utf8"), before, "the tracked file must be restored after success");
});

test("#3217 adversarial: a FAILED deploy still restores the file and keeps its non-zero status", async () => {
  const before = readFileSync(BAKE, "utf8");
  const sha = "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c";
  const { result, seen } = await runMockedDeploy({ sha, deployExitCode: 1 });
  // The restore must not mask the verdict: a failed deploy is still a failure.
  assert.notEqual(result.status, 0, "a failed deploy must not exit 0 because the trap ran");
  assert.match(`${result.stderr}`, /function deployment failed/);
  assert.match(seen, new RegExp(`BAKED_RELEASE_SHA = "${sha}";`), "the bake happened before the failure");
  assert.equal(readFileSync(BAKE, "utf8"), before, "the tracked file must be restored after failure");
});
