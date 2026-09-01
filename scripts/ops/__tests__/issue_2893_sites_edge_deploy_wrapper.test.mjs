import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const wrapper = path.join(root, "scripts/ops/deploy-sites-edge-functions.sh");
const expected = [
  ["brand-site-control", true],
  ["brand-site-cms-callback", false],
  ["brand-site-runtime-resolve", false],
  ["brand-site-attribution", false],
];

test("#2893 wrapper deploys only the four pinned functions through the API", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "sites-deploy-"));
  const log = path.join(temporary, "calls.jsonl");
  const fake = path.join(temporary, "supabase");
  const beforeRows = expected.map(([name, verifyJwt], index) => ({
    name,
    slug: name,
    status: "ACTIVE",
    verify_jwt: verifyJwt,
    version: index + 1,
    ezbr_sha256: String(index + 1).repeat(64),
  }));
  const afterRows = beforeRows.map((row) => ({
    ...row,
    version: row.version + 1,
    ezbr_sha256: "a".repeat(64),
  }));
  const listCount = path.join(temporary, "list-count");
  fs.writeFileSync(fake, `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "${log}"
if [[ "$1 $2" == "functions list" ]]; then
  count="$(cat "${listCount}" 2>/dev/null || printf 0)"
  if [[ "$count" == "0" ]]; then
    printf '%s\\n' '${JSON.stringify(beforeRows)}'
  else
    printf '%s\\n' '${JSON.stringify(afterRows)}'
  fi
  printf '%s' "$((count + 1))" > "${listCount}"
fi
`);
  fs.chmodSync(fake, 0o755);

  const output = execFileSync("bash", [wrapper, "deploy"], {
    cwd: root,
    env: { ...process.env, SUPABASE_BIN: fake },
    encoding: "utf8",
  });
  assert.match(output, /only the four allowlisted functions were deployed/);

  const calls = fs.readFileSync(log, "utf8").trim().split("\n");
  const deploys = calls.filter((call) => call.startsWith("functions deploy "));
  assert.equal(deploys.length, 4);
  for (const [name, verifyJwt] of expected) {
    const call = deploys.find((candidate) => candidate.includes(` ${name} `));
    assert.ok(call, `${name} missing`);
    assert.match(call, /--project-ref gqnoajqerqhnvulmnyvv/);
    assert.match(call, /--use-api/);
    assert.equal(call.includes("--no-verify-jwt"), !verifyJwt);
  }
  assert.equal(
    deploys.some((call) => call.includes("--prune")),
    false,
  );
});

test("#2893 wrapper rejects a stale no-op deployment readback", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "sites-deploy-stale-"));
  const fake = path.join(temporary, "supabase");
  const rows = expected.map(([name, verifyJwt], index) => ({
    name,
    slug: name,
    status: "ACTIVE",
    verify_jwt: verifyJwt,
    version: index + 1,
    ezbr_sha256: String(index + 1).repeat(64),
  }));
  fs.writeFileSync(fake, `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1 $2" == "functions list" ]]; then
  printf '%s\\n' '${JSON.stringify(rows)}'
fi
`);
  fs.chmodSync(fake, 0o755);
  assert.throws(() => execFileSync("bash", [wrapper, "deploy"], {
    cwd: root,
    env: { ...process.env, SUPABASE_BIN: fake },
    stdio: "pipe",
  }), /deployment version did not advance/);
});

test("#2893 wrapper rejects a non-zero deploy even if output claims it exists", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "sites-deploy-error-"));
  const fake = path.join(temporary, "supabase");
  const rows = expected.map(([name, verifyJwt], index) => ({
    name,
    slug: name,
    status: "ACTIVE",
    verify_jwt: verifyJwt,
    version: index + 1,
    ezbr_sha256: String(index + 1).repeat(64),
  }));
  fs.writeFileSync(fake, `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1 $2" == "functions list" ]]; then
  printf '%s\\n' '${JSON.stringify(rows)}'
  exit 0
fi
printf '%s\\n' 'deployment already exists' >&2
exit 1
`);
  fs.chmodSync(fake, 0o755);
  assert.throws(() => execFileSync("bash", [wrapper, "deploy"], {
    cwd: root,
    env: { ...process.env, SUPABASE_BIN: fake },
    stdio: "pipe",
  }));
});

test("#2893 wrapper rejects every non-allowlisted mode", () => {
  assert.throws(() => execFileSync("bash", [wrapper, "brand-site-other"], {
    cwd: root,
    stdio: "pipe",
  }));
});
