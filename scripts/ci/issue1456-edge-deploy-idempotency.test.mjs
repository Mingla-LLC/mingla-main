import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = resolve(import.meta.dirname, "../..");
const deployScript = join(repoRoot, "scripts/deploy-supabase-functions.sh");

async function fixture(mode) {
  const root = await mkdtemp(join(tmpdir(), `mingla-1456-${mode}-`));
  const functionsRoot = join(root, "functions");
  const binRoot = join(root, "bin");
  const callsPath = join(root, "calls.txt");
  await mkdir(binRoot, { recursive: true });
  for (const name of ["alpha", "beta", "gamma"]) {
    const dir = join(functionsRoot, name);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "index.ts"), "Deno.serve(() => new Response('ok'));\n");
  }
  const mock = `#!/usr/bin/env bash
set -u
printf '%s\\n' "$*" >> "$ISSUE1456_CALLS"
name="$3"
if [[ "$name" == beta ]]; then
  if [[ "$ISSUE1456_MODE" == duplicate ]]; then
    printf '%s\\n' 'unexpected deploy status 409: {"message":"deployment already exists"}' >&2
  else
    printf '%s\\n' 'unexpected deploy status 409: {"message":"different conflict"}' >&2
  fi
  exit 1
fi
printf 'deployed %s\\n' "$name"
`;
  const mockPath = join(binRoot, "supabase");
  await writeFile(mockPath, mock);
  await chmod(mockPath, 0o755);
  const nodeStub = join(binRoot, "node");
  await writeFile(
    nodeStub,
    "#!/usr/bin/env bash\n# #1456 isolates the wrapper's deploy loop; authority/preflight have their own executable suites.\nexit 0\n",
  );
  await chmod(nodeStub, 0o755);
  return { root, functionsRoot, binRoot, callsPath };
}

async function run(mode) {
  const current = await fixture(mode);
  const result = spawnSync("bash", [
    deployScript,
    "--project-ref",
    "gqnoajqerqhnvulmnyvv",
    "--merged-commit",
    "0123456789abcdef0123456789abcdef01234567",
    "--function",
    "alpha",
    "--function",
    "beta",
    "--function",
    "gamma",
  ], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${current.binRoot}:${process.env.PATH}`,
      SUPABASE_PROJECT_ID: "gqnoajqerqhnvulmnyvv",
      ISSUE1456_CALLS: current.callsPath,
      ISSUE1456_MODE: mode,
    },
  });
  const calls = (await readFile(current.callsPath, "utf8")).trim().split("\n");
  return { result, calls };
}

const duplicate = await run("duplicate");
assert.equal(duplicate.result.status, 0, duplicate.result.stderr);
assert.equal(duplicate.calls.length, 3, "the exact duplicate response must not starve later functions");
assert.match(duplicate.calls[2], /gamma/);
assert.ok(duplicate.calls.every((call) => !call.includes("--no-verify-jwt")));
assert.ok(duplicate.calls.every((call) => call.includes("--use-api")));
assert.ok(
  duplicate.calls.every((call) =>
    call.includes("--project-ref gqnoajqerqhnvulmnyvv")
  ),
);

const conflict = await run("other-conflict");
assert.notEqual(conflict.result.status, 0, "any different deployment failure must stay fatal");
assert.equal(conflict.calls.length, 2, "a real failure must stop before the next function");
assert.doesNotMatch(conflict.calls.join("\n"), /gamma/);

console.log("issue #1456 deployment idempotency regression: PASS");
