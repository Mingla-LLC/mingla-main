import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const fixturePaths = [
  "supabase/migrations/__tests__/issue_0873_guest_status_roster.test.sql",
  "supabase/migrations/__tests__/issue_1821_accepted_email_sms_invites.test.sql",
  "supabase/migrations/__tests__/orch_1270_tester_double_send.test.sql",
];

const required = {
  [fixturePaths[0]]: [
    "'Issue 873 Campaign','email','{\"kind\":\"email\",\"subject\":\"Issue 873 roster fixture\",\"body_html\":\"Issue 873 roster fixture\"}','sending'",
    "T-873-01 FAIL: accepted invite truth wrong",
  ],
  [fixturePaths[1]]: [
    "VALUES ('18210000-0000-4000-8000-000000000001');",
    "VALUES ('18218888-0000-4000-8000-000000000001');",
    "'subject','Issue 1821 accepted email fixture'",
    "'body_html','Issue 1821 accepted email fixture'",
    "'kind','sms','body','Issue 1821 accepted SMS fixture'",
    "'Concurrent Email','email','{\"kind\":\"email\",\"subject\":\"Issue 1821 concurrent email fixture\",\"body_html\":\"Issue 1821 concurrent email fixture\"}','sending'",
    "'Concurrent SMS','sms','{\"kind\":\"sms\",\"body\":\"Issue 1821 concurrent SMS fixture\"}','sending'",
    "\\getenv issue_2393_dblink_password PGPASSWORD",
    "SET issue_2393.dblink_password TO :'issue_2393_dblink_password';",
    "current_setting('issue_2393.dblink_password')",
    "T-1821-07 PASS",
  ],
  [fixturePaths[2]]: [
    "'ADV2','email', '{\"kind\":\"email\",\"subject\":\"ORCH-1270 double-send fixture\",\"body_html\":\"ORCH-1270 double-send fixture\"}', 'sending'",
    "ORCH-1270 tester double-send attacks: ALL PASS",
  ],
};

function validateFixtureMap(files) {
  const failures = [];
  const actualPaths = [...files.keys()].sort();
  const expectedPaths = [...fixturePaths].sort();

  if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) {
    failures.push(
      `allowlist mismatch: expected exactly ${expectedPaths.join(", ")}; got ${actualPaths.join(", ")}`,
    );
  }

  for (const fixturePath of fixturePaths) {
    const source = files.get(fixturePath);
    if (source === undefined) {
      failures.push(`${fixturePath}: fixture is missing from the guard input`);
      continue;
    }
    if (/['"]\{\s*"kind"\s*:\s*"email"\s*\}['"]/.test(source)) {
      failures.push(`${fixturePath}: bare non-draft email payload is forbidden`);
    }
    for (const anchor of required[fixturePath]) {
      if (!source.includes(anchor)) {
        failures.push(`${fixturePath}: missing setup/scenario anchor ${JSON.stringify(anchor)}`);
      }
    }
  }

  const issue1821 = files.get(fixturePaths[1]) ?? "";
  for (const accountId of [
    "18210000-0000-4000-8000-000000000001",
    "18218888-0000-4000-8000-000000000001",
  ]) {
    const parent = new RegExp(
      `INSERT INTO auth\\.users\\(id\\)\\s+VALUES \\('${accountId}'\\);\\s+` +
        `INSERT INTO public\\.creator_accounts\\(id\\)\\s+VALUES \\('${accountId}'\\);`,
    );
    if (!parent.test(issue1821)) {
      failures.push(`${fixturePaths[1]}: creator_accounts parent is not adjacent for ${accountId}`);
    }
  }
  if (!issue1821.includes("'dbname=%L user=%L password=%L host=%L port=%L'")) {
    failures.push(`${fixturePaths[1]}: dblink conninfo does not bind the psql-session password`);
  }
  const dblinkConnects = issue1821.match(/dblink_connect\('issue1821_(?:email|sms|push)',v_conn\)/g) ?? [];
  if (dblinkConnects.length !== 3) {
    failures.push(`${fixturePaths[1]}: expected all three dblink sessions to use v_conn; got ${dblinkConnects.length}`);
  }

  return failures;
}

function loadFixtures() {
  return new Map(
    fixturePaths.map((fixturePath) => [
      fixturePath,
      readFileSync(path.join(repoRoot, fixturePath), "utf8"),
    ]),
  );
}

test("#2393 repaired marketing fixtures satisfy current setup contracts", () => {
  assert.deepEqual(validateFixtureMap(loadFixtures()), []);
});

test("#2393 hostile revert names the exact regressed fixture", () => {
  const files = loadFixtures();
  files.set(
    fixturePaths[0],
    files
      .get(fixturePaths[0])
      .replace(
        '{"kind":"email","subject":"Issue 873 roster fixture","body_html":"Issue 873 roster fixture"}',
        '{"kind":"email"}',
      ),
  );
  const failures = validateFixtureMap(files);
  assert.ok(failures.length > 0, "hostile bare-payload mutation unexpectedly passed");
  assert.match(failures.join("\n"), /issue_0873_guest_status_roster\.test\.sql: bare non-draft email payload/);
});

test("#2393 hostile parent removal fails independently of payload validation", () => {
  const files = loadFixtures();
  files.set(
    fixturePaths[1],
    files
      .get(fixturePaths[1])
      .replace(
        "INSERT INTO public.creator_accounts(id)\nVALUES ('18210000-0000-4000-8000-000000000001');\n",
        "",
      ),
  );
  assert.match(
    validateFixtureMap(files).join("\n"),
    /creator_accounts parent is not adjacent for 18210000-0000-4000-8000-000000000001/,
  );
});
