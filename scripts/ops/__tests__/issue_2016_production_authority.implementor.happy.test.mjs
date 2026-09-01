import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  AuthorityError,
  DEFAULT_AUTHORITY_FILE,
  extractProjectRefFromJwt,
  loadProductionAuthority,
  validateRepositoryAuthority,
  verifyProductionAuthority,
} from "../verify-production-supabase-authority.mjs";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(TEST_DIR, "..", "..", "..");
const CANONICAL_REF = "gqnoajqerqhnvulmnyvv";
const UNRELATED_REF = "gupxgpmukdwhozqfmzgd";

function fakeJwt(ref) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none" })}.${encode({ ref })}.signature`;
}

test("canonical contract, origins, URL and documented JWT ref agree", () => {
  const authority = loadProductionAuthority(DEFAULT_AUTHORITY_FILE);
  assert.equal(authority.schema_version, 1);
  assert.equal(authority.environment, "production");
  assert.equal(authority.project_ref, CANONICAL_REF);
  assert.equal(authority.origins.rest, `https://${CANONICAL_REF}.supabase.co`);
  assert.equal(
    authority.origins.functions,
    `https://${CANONICAL_REF}.functions.supabase.co`,
  );
  assert.equal(extractProjectRefFromJwt(fakeJwt(CANONICAL_REF), "key"), CANONICAL_REF);
  assert.equal(
    verifyProductionAuthority({
      targetRef: CANONICAL_REF,
      restUrl: authority.origins.rest,
      functionsUrl: authority.origins.functions,
      publishableKey: fakeJwt(CANONICAL_REF),
    }).project_ref,
    CANONICAL_REF,
  );
});

test("wrong, padded, concatenated, lookalike and missing refs fail with redacted diagnostics", () => {
  const invalid = [
    undefined,
    "",
    ` ${CANONICAL_REF}`,
    `${CANONICAL_REF} `,
    `${CANONICAL_REF}${UNRELATED_REF}`,
    `${CANONICAL_REF.slice(0, -1)}x`,
    UNRELATED_REF,
  ];
  for (const targetRef of invalid) {
    assert.throws(
      () => verifyProductionAuthority({ targetRef, variableName: "TARGET" }),
      (error) => {
        assert.ok(error instanceof AuthorityError);
        assert.match(error.message, /no action executed/);
        assert.doesNotMatch(error.message, /signature|Bearer|eyJ/);
        return true;
      },
    );
  }
  assert.throws(
    () =>
      verifyProductionAuthority({
        targetRef: CANONICAL_REF,
        restUrl: `https://${CANONICAL_REF}.supabase.co/rest/v1`,
      }),
    /noncanonical_origin/,
  );
  assert.throws(
    () =>
      verifyProductionAuthority({
        targetRef: CANONICAL_REF,
        functionsUrl: `https://${UNRELATED_REF}.functions.supabase.co`,
      }),
    /unrelated_project_do_not_target/,
  );
});

test("repository production sources and both CLI configs resolve to canonical", () => {
  assert.deepEqual(validateRepositoryAuthority(REPO_ROOT), []);
});

test("edge deploy rejects unrelated target before the Supabase executable runs", () => {
  const root = mkdtempSync(join(tmpdir(), "issue-2016-deploy-"));
  const bin = join(root, "bin");
  const functions = join(root, "functions", "probe");
  const marker = join(root, "supabase-called");
  mkdirSync(bin, { recursive: true });
  mkdirSync(functions, { recursive: true });
  writeFileSync(join(functions, "index.ts"), "export {};\n");
  const stub = join(bin, "supabase");
  writeFileSync(stub, `#!/usr/bin/env bash\nprintf called > "${marker}"\n`);
  chmodSync(stub, 0o755);

  const result = spawnSync(
    "bash",
    [
      join(REPO_ROOT, "scripts/deploy-supabase-functions.sh"),
      "--project-ref",
      UNRELATED_REF,
      "--merged-commit",
      "0123456789abcdef0123456789abcdef01234567",
      "--function",
      "probe",
    ],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
      },
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /no action executed/);
  assert.throws(() => readFileSync(marker, "utf8"), /ENOENT/);
});

test("Apple rotation and secret audit place authority checks before side effects", () => {
  const rotation = readFileSync(join(REPO_ROOT, "scripts/rotate-apple-jwt.mjs"), "utf8");
  const audit = readFileSync(
    join(REPO_ROOT, "scripts/secrets/audit-supabase-secret-budget.mjs"),
    "utf8",
  );
  assert.ok(rotation.indexOf("verifyProductionAuthority({") < rotation.indexOf("jwt.sign("));
  assert.ok(rotation.indexOf("verifyProductionAuthority({") < rotation.indexOf('import("jsonwebtoken")'));
  assert.ok(rotation.indexOf("verifyProductionAuthority({") < rotation.indexOf("await fetch("));
  assert.doesNotMatch(rotation, /response body:|errBody\.slice|cfg\.external_apple_client_id\);/);
  assert.ok(
    audit.lastIndexOf("verifyProductionAuthority({") <
      audit.lastIndexOf("liveNamesFromSupabase(projectRef)"),
  );
});

test("secret audit rejects unrelated target before the Supabase executable runs", () => {
  const root = mkdtempSync(join(tmpdir(), "issue-2016-audit-"));
  const bin = join(root, "bin");
  const marker = join(root, "supabase-called");
  mkdirSync(bin, { recursive: true });
  const stub = join(bin, "supabase");
  writeFileSync(stub, `#!/usr/bin/env bash\nprintf called > "${marker}"\n`);
  chmodSync(stub, 0o755);

  const result = spawnSync(
    process.execPath,
    [
      join(REPO_ROOT, "scripts/secrets/audit-supabase-secret-budget.mjs"),
      "--project-ref",
      UNRELATED_REF,
    ],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /no action executed/);
  assert.throws(() => readFileSync(marker, "utf8"), /ENOENT/);
});

test("Apple rotation rejects unrelated target before signing dependency or HTTP", () => {
  const result = spawnSync(process.execPath, [join(REPO_ROOT, "scripts/rotate-apple-jwt.mjs")], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      APPLE_P8_PRIVATE_KEY: "do-not-log-private-key",
      APPLE_TEAM_ID: "do-not-log-team",
      APPLE_SERVICE_ID: "do-not-log-service",
      APPLE_KEY_ID: "do-not-log-key-id",
      SUPABASE_PROJECT_REF: UNRELATED_REF,
      SUPABASE_MANAGEMENT_TOKEN: "do-not-log-management-token",
    },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /no action executed/);
  assert.doesNotMatch(result.stderr, /do-not-log|ERR_MODULE_NOT_FOUND|jsonwebtoken/);
});
