import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const paths = {
  issue873: "supabase/migrations/__tests__/issue_0873_guest_status_roster.test.sql",
  issue1821: "supabase/migrations/__tests__/issue_1821_accepted_email_sms_invites.test.sql",
  orch1270: "supabase/migrations/__tests__/orch_1270_tester_double_send.test.sql",
  workflow: path.join(".github", "workflows", ["ci", "batch.yml"].join("-")),
  runner: ".github/scripts/ci-batch/run-suite-batch.mjs",
  manifest: ".github/ci-batch/MANIFEST.json",
};

const baseDigests = {
  issue873: "5e06d0c6b9dee5d4b7b805ee94b133466921caf440d4ccd867392bd772a768d8",
  issue1821: "a5e4d81c6c33d94c922989941694dcb86942da2a4d1b5ad4161bbe099238d8b0",
  orch1270: "b0175c026d69df7e8bcc11867886f5010427070106a5a4952687dd8058ce1c2f",
};

const read = (relativePath) => readFileSync(path.join(repoRoot, relativePath), "utf8");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function replaceExactly(source, current, original, label) {
  const occurrences = source.split(current).length - 1;
  assert.equal(occurrences, 1, `${label}: expected exactly one allowlisted current fragment, got ${occurrences}`);
  return source.replace(current, original);
}

function reconstructBase(files) {
  const reconstructed = {};
  reconstructed.issue873 = replaceExactly(
    files.issue873,
    `'Issue 873 Campaign','email','{"kind":"email","subject":"Issue 873 roster fixture","body_html":"Issue 873 roster fixture"}','sending'`,
    `'Issue 873 Campaign','email','{"kind":"email"}','sending'`,
    "#873 fixture payload",
  );
  // #4134 moved the roster's stale-state raises from 40001 to PT409; its four
  // handlers are the only other allowlisted change.
  const pt409Handler = "EXCEPTION WHEN sqlstate 'PT409' THEN";
  assert.equal(
    reconstructed.issue873.split(pt409Handler).length - 1,
    4,
    "#4134 PT409 handlers: expected exactly four",
  );
  reconstructed.issue873 = reconstructed.issue873
    .split(pt409Handler)
    .join("EXCEPTION WHEN serialization_failure THEN");
  reconstructed.orch1270 = replaceExactly(
    files.orch1270,
    `'ADV2','email', '{"kind":"email","subject":"ORCH-1270 double-send fixture","body_html":"ORCH-1270 double-send fixture"}', 'sending'`,
    `'ADV2','email', '{"kind":"email"}',          'sending'`,
    "ORCH-1270 fixture payload",
  );

  let issue1821 = replaceExactly(
    files.issue1821,
    `-- #2393: dblink opens new sessions, so inherit this run's generated CI
-- credential through this psql session only. \\getenv does not print it, and
-- the setting must survive the suite's intentional first-phase ROLLBACK.
\\getenv issue_2393_dblink_password PGPASSWORD
SET issue_2393.dblink_password TO :'issue_2393_dblink_password';
`,
    "",
    "#1821 ephemeral credential setup",
  );
  for (const [id, suffix] of [
    ["18210000-0000-4000-8000-000000000001", "\n"],
    ["18218888-0000-4000-8000-000000000001", ""],
  ]) {
    issue1821 = replaceExactly(
      issue1821,
      `INSERT INTO public.creator_accounts(id)
VALUES ('${id}');
${suffix}`,
      "",
      `#1821 creator parent ${id}`,
    );
  }
  issue1821 = replaceExactly(
    issue1821,
    `    CASE p_channel
      WHEN 'email' THEN jsonb_build_object(
        'kind','email',
        'subject','Issue 1821 accepted email fixture',
        'body_html','Issue 1821 accepted email fixture'
      )
      ELSE jsonb_build_object(
        'kind','sms','body','Issue 1821 accepted SMS fixture'
      )
    END,'sending'`,
    `    jsonb_build_object('kind',p_channel),'sending'`,
    "#1821 helper fixture payloads",
  );
  issue1821 = replaceExactly(
    issue1821,
    `'Concurrent Email','email','{"kind":"email","subject":"Issue 1821 concurrent email fixture","body_html":"Issue 1821 concurrent email fixture"}','sending'`,
    `'Concurrent Email','email','{"kind":"email"}','sending'`,
    "#1821 concurrent email fixture",
  );
  issue1821 = replaceExactly(
    issue1821,
    `'Concurrent SMS','sms','{"kind":"sms","body":"Issue 1821 concurrent SMS fixture"}','sending'`,
    `'Concurrent SMS','sms','{"kind":"sms"}','sending'`,
    "#1821 concurrent SMS fixture",
  );
  issue1821 = replaceExactly(
    issue1821,
    `    'dbname=%L user=%L password=%L host=%L port=%L',
    current_database(),current_user,
    current_setting('issue_2393.dblink_password'),
    current_setting('unix_socket_directories'),current_setting('port')`,
    `    'dbname=%L user=%L host=%L port=%L',
    current_database(),current_user,
    current_setting('unix_socket_directories'),current_setting('port')`,
    "#1821 dblink credential binding",
  );
  reconstructed.issue1821 = issue1821;
  return reconstructed;
}

function validateCredentialContract(issue1821, workflow, runner, suite) {
  const failures = [];
  const requiredSql = [
    "\\getenv issue_2393_dblink_password PGPASSWORD",
    "SET issue_2393.dblink_password TO :'issue_2393_dblink_password';",
    "'dbname=%L user=%L password=%L host=%L port=%L'",
    "current_setting('issue_2393.dblink_password')",
  ];
  for (const anchor of requiredSql) {
    if (!issue1821.includes(anchor)) failures.push(`missing SQL credential anchor: ${anchor}`);
  }
  if ((issue1821.match(/dblink_connect\('issue1821_(?:email|sms|push)',v_conn\)/g) ?? []).length !== 3) {
    failures.push("all three dblink sessions must consume the credential-bound v_conn");
  }
  // #3643 replaced four credentials in the retired wrapper with one generated
  // service credential shared by setup and suite execution. Verify that live
  // chain, including retries, instead of accepting historical wrapper bytes.
  const generated = "${{ format('ci-batch-{0}-{1}', github.run_id, github.run_attempt) }}";
  const bindings = [...workflow.matchAll(/^\s*(POSTGRES_PASSWORD|PG_BATCH_PASSWORD):[ \t]*([^\r\n#]+)/gm)];
  if (bindings.length !== 3 || bindings.filter(([, name]) => name === "POSTGRES_PASSWORD").length !== 1
      || bindings.some(([, , value]) => value.trim() !== generated)) {
    failures.push("batch must bind service, setup, and suites to the same generated run-and-attempt credential");
  }
  if (!runner.includes("PGPASSWORD: process.env.PG_BATCH_PASSWORD,")) {
    failures.push("suite runner must inherit PGPASSWORD from the generated batch credential");
  }
  if (suite?.id !== "issue-2393-valid-marketing-test-fixtures" || suite.migrationWave !== "phase3e-postgres-fold-wave"
      || suite.lifecycle !== "batched-historical" || suite.envNames?.length !== 0
      || suite.steps?.some((step) => step.env || step.envNames?.length)) {
    failures.push("folded #2393 suite must use only the inherited batch credential");
  }
  if (bindings.some(([, , value]) => value.trim() !== generated)) {
    failures.push("forbidden credential behavior: literal workflow password");
  }
  const forbidden = [
    [/\\echo[^\n]*(?:password|issue_2393_dblink_password)/i, "password echo"],
    [/RAISE\s+(?:NOTICE|INFO|LOG|WARNING)[^\n]*(?:password|issue_2393_dblink_password)/i, "password raise"],
    [/ALTER\s+(?:SYSTEM|ROLE)[^;]*(?:password|issue_2393_dblink_password)/i, "persistent password mutation"],
    [/\$\{\{\s*secrets\./, "repository secret reference"],
  ];
  const combined = `${issue1821}\n${workflow}\n${JSON.stringify(suite)}`;
  for (const [pattern, label] of forbidden) {
    if (pattern.test(combined)) failures.push(`forbidden credential behavior: ${label}`);
  }
  return failures;
}

function loadFiles() {
  return {
    issue873: read(paths.issue873),
    issue1821: read(paths.issue1821),
    orch1270: read(paths.orch1270),
    workflow: read(paths.workflow),
    runner: read(paths.runner),
    suite: JSON.parse(read(paths.manifest)).suites.find((suite) => suite.id === "issue-2393-valid-marketing-test-fixtures"),
  };
}

test("#2393 tester guard proves the complete pre-existing SQL bytes outside the allowlist", () => {
  const reconstructed = reconstructBase(loadFiles());
  for (const key of ["issue873", "issue1821", "orch1270"]) {
    assert.equal(sha256(reconstructed[key]), baseDigests[key], `${key}: non-allowlisted bytes changed`);
  }
});

test("#2393 tester guard rejects a one-byte mutation to a pre-existing assertion", () => {
  const files = loadFiles();
  files.issue873 = replaceExactly(
    files.issue873,
    "T-873-01 FAIL: accepted invite truth wrong",
    "T-873-01 FAIL: accepted invite truth changed",
    "hostile assertion mutation",
  );
  assert.notEqual(sha256(reconstructBase(files).issue873), baseDigests.issue873);
});

test("#2393 tester guard binds generated credentials without printing or persisting them", () => {
  const files = loadFiles();
  assert.deepEqual(validateCredentialContract(files.issue1821, files.workflow, files.runner, files.suite), []);
});

test("#2393 tester guard rejects credential leakage and missing dblink binding", () => {
  const files = loadFiles();
  files.issue1821 += "\n\\echo :issue_2393_dblink_password\n";
  files.workflow = files.workflow.replace(
    "PG_BATCH_PASSWORD: ${{ format('ci-batch-{0}-{1}', github.run_id, github.run_attempt) }}",
    "PG_BATCH_PASSWORD: static-password",
  );
  assert.deepEqual(validateCredentialContract(files.issue1821, files.workflow, files.runner, files.suite).sort(), [
    "batch must bind service, setup, and suites to the same generated run-and-attempt credential",
    "forbidden credential behavior: literal workflow password",
    "forbidden credential behavior: password echo",
  ]);
});

test("#2393 tester guard rejects each broken batch credential handoff", () => {
  const files = loadFiles();
  for (let binding = 0; binding < 3; binding += 1) {
    let index = 0;
    const workflow = files.workflow.replace(/format\('ci-batch-\{0\}-\{1\}', github\.run_id, github\.run_attempt\)/g,
      (value) => index++ === binding ? value.replace("github.run_attempt", "0") : value);
    assert.ok(validateCredentialContract(files.issue1821, workflow, files.runner, files.suite).length > 0,
      `credential binding ${binding} must fail independently`);
  }
  const runner = files.runner.replace("PGPASSWORD: process.env.PG_BATCH_PASSWORD,", "PGPASSWORD: 'static-password',");
  assert.ok(validateCredentialContract(files.issue1821, files.workflow, runner, files.suite)
    .includes("suite runner must inherit PGPASSWORD from the generated batch credential"));
  const suite = { ...files.suite, envNames: ["DATABASE_PASSWORD"] };
  assert.ok(validateCredentialContract(files.issue1821, files.workflow, files.runner, suite)
    .includes("folded #2393 suite must use only the inherited batch credential"));
});
