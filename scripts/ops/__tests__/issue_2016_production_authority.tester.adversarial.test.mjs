import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { AuthorityError, verifyProductionAuthority } from "../verify-production-supabase-authority.mjs";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(TEST_DIR, "..", "..", "..");
const CANONICAL_REF = "gqnoajqerqhnvulmnyvv";
const PADDED_REF = `${CANONICAL_REF}\n`;

test("canonical-looking refs and origins fail closed when any hidden syntax is appended", () => {
  const poisonedTargets = [
    `${CANONICAL_REF}\n`,
    `${CANONICAL_REF}\t`,
    `${CANONICAL_REF}\r`,
  ];
  for (const targetRef of poisonedTargets) {
    assert.throws(
      () => verifyProductionAuthority({ targetRef, variableName: "opaque-target" }),
      (error) => {
        assert.ok(error instanceof AuthorityError);
        assert.match(error.message, /actual=<malformed>/);
        assert.doesNotMatch(error.message, /[\n\r\t]/);
        return true;
      },
    );
  }

  const poisonedOrigins = [
    `https://${CANONICAL_REF}.supabase.co/`,
    `https://${CANONICAL_REF}.supabase.co?next=https://attacker.invalid`,
    `https://${CANONICAL_REF}.supabase.co#authority`,
    `https://user@${CANONICAL_REF}.supabase.co`,
    `https://${CANONICAL_REF}.supabase.co:443`,
  ];
  for (const restUrl of poisonedOrigins) {
    assert.throws(
      () => verifyProductionAuthority({ targetRef: CANONICAL_REF, restUrl }),
      (error) => {
        assert.ok(error instanceof AuthorityError);
        assert.match(error.message, /rest-url/);
        assert.match(error.message, /reason=(?:malformed|noncanonical_origin)/);
        assert.doesNotMatch(error.message, /attacker|user@|next=/);
        return true;
      },
    );
  }
});

test("malformed canonical-looking target reaches none of the three privileged side-effect boundaries", () => {
  const root = mkdtempSync(join(tmpdir(), "issue-2016-tester-containment-"));
  const bin = join(root, "bin");
  const functions = join(root, "functions", "probe");
  const deployMarker = join(root, "deploy-called");
  const auditMarker = join(root, "audit-called");
  const fetchMarker = join(root, "fetch-called");
  mkdirSync(bin, { recursive: true });
  mkdirSync(functions, { recursive: true });
  writeFileSync(join(functions, "index.ts"), "export {};\n");

  const supabaseStub = join(bin, "supabase");
  writeFileSync(
    supabaseStub,
    `#!/usr/bin/env bash\ncase "$*" in\n  *"secrets list"*) printf called > "${auditMarker}" ;;\n  *) printf called > "${deployMarker}" ;;\nesac\n`,
  );
  chmodSync(supabaseStub, 0o755);

  const fetchPreload = join(root, "fetch-preload.mjs");
  writeFileSync(
    fetchPreload,
    `import { writeFileSync } from "node:fs";\nglobalThis.fetch = async () => { writeFileSync(${JSON.stringify(fetchMarker)}, "called"); return { ok: false, status: 599, statusText: "stubbed" }; };\n`,
  );

  const deploy = spawnSync(
    "bash",
    [
      join(REPO_ROOT, "scripts/deploy-supabase-functions.sh"),
      "--project-ref",
      PADDED_REF,
      "--merged-commit",
      "0123456789abcdef0123456789abcdef01234567",
      "--function",
      "probe",
    ],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
      },
    },
  );
  assert.notEqual(deploy.status, 0);
  assert.match(deploy.stderr, /no action executed/);
  assert.equal(existsSync(deployMarker), false);

  const audit = spawnSync(
    process.execPath,
    [join(REPO_ROOT, "scripts/secrets/audit-supabase-secret-budget.mjs"), "--project-ref", PADDED_REF],
    {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    },
  );
  assert.notEqual(audit.status, 0);
  assert.match(audit.stderr, /no action executed/);
  assert.equal(existsSync(auditMarker), false);

  const rotation = spawnSync(process.execPath, [join(REPO_ROOT, "scripts/rotate-apple-jwt.mjs")], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      APPLE_P8_PRIVATE_KEY: "tester-private-material-must-not-appear",
      APPLE_TEAM_ID: "tester-team-must-not-appear",
      APPLE_SERVICE_ID: "tester-service-must-not-appear",
      APPLE_KEY_ID: "tester-key-must-not-appear",
      SUPABASE_PROJECT_REF: PADDED_REF,
      SUPABASE_MANAGEMENT_TOKEN: "tester-token-must-not-appear",
      NODE_OPTIONS: `--import=${fetchPreload}`,
    },
  });
  assert.notEqual(rotation.status, 0);
  assert.match(rotation.stderr, /no action executed/);
  assert.doesNotMatch(rotation.stderr, /tester-|jsonwebtoken|ERR_MODULE_NOT_FOUND/);
  assert.equal(existsSync(fetchMarker), false);
});

test("offline verifier and its CI owner have no network-enabled execution path", () => {
  const verifier = readFileSync(
    join(REPO_ROOT, "scripts/ops/verify-production-supabase-authority.mjs"),
    "utf8",
  );
  const workflow = readFileSync(
    join(REPO_ROOT, ".github/workflows/production-supabase-authority.yml"),
    "utf8",
  );
  assert.doesNotMatch(verifier, /\bfetch\s*\(|node:https|node:http|https\.request|http\.request/);
  assert.match(workflow, /node --test scripts\/ops\/__tests__\/issue_2016_\*\.test\.mjs/);
  assert.match(workflow, /--mode=offline/);
  assert.match(workflow, /--check-sources/);
});
