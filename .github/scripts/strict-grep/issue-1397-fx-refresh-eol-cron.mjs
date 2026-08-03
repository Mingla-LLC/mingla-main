#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const paths = {
  parser: "supabase/functions/_shared/fxRates.ts",
  parserTest: "supabase/functions/_shared/fxRates.issue1397.test.ts",
  handler: "supabase/functions/refresh-fx-rates/index.ts",
  handlerTest:
    "supabase/functions/refresh-fx-rates/index.issue1397.test.ts",
  migration:
    "supabase/migrations/20270130001397_issue_1397_fx_refresh_eol_cron.sql",
  sqlTest:
    "supabase/migrations/__tests__/issue_1397_fx_refresh_eol_cron.test.sql",
  config: "supabase/config.toml",
  workflow: ".github/workflows/strict-grep-mingla-business.yml",
};

function includesAll(source, tokens, label, failures) {
  for (const token of tokens) {
    if (!source.includes(token)) failures.push(`${label}: missing ${token}`);
  }
}

export function violations(files) {
  const failures = [];
  includesAll(files.parser ?? "", [
    "providerEolAt: string | null",
    "if (value === 0) return null",
    'return unixSecondsToIso(value, "provider_eol_at")',
    "providerEolAt !== null",
    'throw new Error("provider_data_expired")',
  ], "parser", failures);
  const parser = files.parser ?? "";
  const canonicalStart = parser.indexOf(
    "const canonicalPayload = canonicalJson({",
  );
  const canonicalEnd = parser.indexOf("\n  return {", canonicalStart);
  const canonicalBlock = canonicalStart >= 0 && canonicalEnd > canonicalStart
    ? parser.slice(canonicalStart, canonicalEnd)
    : "";
  if (!canonicalBlock.includes("\n    providerEolAt,\n")) {
    failures.push(
      "parser: validated EOL disconnected from canonical payload",
    );
  }
  includesAll(files.parserTest ?? "", [
    "assertEquals(first.providerEolAt, null)",
    "assertEquals(JSON.parse(first.canonicalPayload).providerEolAt, null)",
    "preserves a positive future provider EOL",
    "fails closed for a past nonzero provider EOL",
    "canonical hash distinguishes no EOL from an announced future EOL",
    "assertNotEquals(sentinel.canonicalPayload, future.canonicalPayload)",
    "await sha256Hex(repeatedSentinel.canonicalPayload)",
    "await sha256Hex(future.canonicalPayload)",
  ], "parserTest", failures);
  includesAll(files.handler ?? "", [
    "p_provider_eol_at: validated.providerEolAt",
  ], "handler", failures);
  includesAll(files.handlerTest ?? "", [
    "passes no-EOL sentinel to activation as null",
    "activation?.params?.p_provider_eol_at, null",
    "preserves positive future EOL",
    "rejects expired nonzero EOL before activation",
  ], "handlerTest", failures);
  includesAll(files.migration ?? "", [
    "ALTER COLUMN provider_eol_at DROP NOT NULL",
    "p_provider_eol_at IS NOT NULL AND p_provider_eol_at <= now()",
    "issue_1397_fx_refresh_daily",
    "'15 1 * * *'",
    "/functions/v1/refresh-fx-rates",
    "'Authorization', 'Bearer ' ||",
    "WHERE name = 'service_role_key'",
    "timeout_milliseconds := 30000",
    "PERFORM cron.unschedule('issue_1397_fx_refresh_daily')",
  ], "migration", failures);
  const migration = files.migration ?? "";
  const cronStart = migration.indexOf("SELECT cron.schedule(");
  const cronEnd = migration.indexOf("\nDO $$", cronStart);
  const cronRegistration = cronStart >= 0 && cronEnd > cronStart
    ? migration.slice(cronStart, cronEnd)
    : "";
  if (
    !/cron\.schedule\(\s*'issue_1397_fx_refresh_daily',\s*'15 1 \* \* \*'/s
      .test(cronRegistration)
  ) {
    failures.push(
      "migration: daily cadence disconnected from FX cron registration",
    );
  }
  if (
    !cronRegistration.includes("'Authorization', 'Bearer ' ||") ||
    !cronRegistration.includes("WHERE name = 'service_role_key'") ||
    !cronRegistration.includes("/functions/v1/refresh-fx-rates")
  ) {
    failures.push(
      "migration: service-role Vault authorization disconnected from FX cron registration",
    );
  }
  includesAll(files.sqlTest ?? "", [
    "provider_eol_at must be nullable",
    "no-EOL sentinel was fabricated",
    "positive future EOL was not preserved",
    "expired nonzero EOL activated",
    "expected one daily cron at 15 1 * * *",
    "cron command lost its authenticated Vault/pg_net contract",
  ], "sqlTest", failures);
  includesAll(files.workflow ?? "", [
    "supabase/functions/_shared/fxRates.issue1397.test.ts",
    "supabase/functions/refresh-fx-rates/index.issue1397.test.ts",
    "supabase/migrations/20270130001397_issue_1397_fx_refresh_eol_cron.sql",
    "supabase/migrations/__tests__/issue_1397_fx_refresh_eol_cron.test.sql",
  ], "workflow", failures);

  const config = files.config ?? "";
  const refreshBlock = config.match(
    /\[functions\.refresh-fx-rates\]\s*\nverify_jwt\s*=\s*(true|false)/,
  );
  if (!refreshBlock || refreshBlock[1] !== "false") {
    failures.push("config: refresh-fx-rates verify_jwt=false contract drifted");
  }

  return failures;
}

function readFiles() {
  return Object.fromEntries(
    Object.entries(paths).map(([name, relative]) => [
      name,
      fs.readFileSync(path.join(root, relative), "utf8"),
    ]),
  );
}

function selfTest() {
  const valid = readFiles();
  const baseline = violations(valid);
  if (baseline.length > 0) {
    throw new Error(`self-test baseline invalid:\n${baseline.join("\n")}`);
  }

  const reversions = [
    {
      key: "parser",
      value: valid.parser.replace(
        "if (value === 0) return null",
        'if (value === 0) return "2099-01-01T00:00:00.000Z"',
      ),
      expected: "if (value === 0) return null",
    },
    {
      key: "parser",
      value: valid.parser.replace(
        "providerEolAt !== null &&",
        "providerEolAt === null ||",
      ),
      expected: "providerEolAt !== null",
    },
    {
      key: "parser",
      value: valid.parser.replace(
        "    providerEolAt,\n    rates: canonicalJson(rates),",
        "    providerEolAt: null,\n    rates: canonicalJson(rates),",
      ),
      expected: "validated EOL disconnected from canonical payload",
    },
    {
      key: "migration",
      value: valid.migration.replace(
        "p_provider_eol_at IS NOT NULL AND p_provider_eol_at <= now()",
        "p_provider_eol_at IS NULL",
      ),
      expected: "p_provider_eol_at IS NOT NULL",
    },
    {
      key: "migration",
      value: valid.migration.replace(
        "  '15 1 * * *',",
        "  '* * * * *',",
      ),
      expected: "cadence disconnected",
    },
    {
      key: "migration",
      value: valid.migration.replace(
        "'Authorization', 'Bearer ' ||",
        "'X-Unauthenticated', 'yes' ||",
      ),
      expected: "'Authorization', 'Bearer ' ||",
    },
    {
      key: "config",
      value: valid.config.replace(
        "[functions.refresh-fx-rates]\nverify_jwt = false",
        "[functions.refresh-fx-rates]\nverify_jwt = true",
      ),
      expected: "verify_jwt=false",
    },
    {
      key: "handlerTest",
      value: valid.handlerTest.replace(
        "activation?.params?.p_provider_eol_at, null",
        "activation?.params?.p_provider_eol_at, undefined",
      ),
      expected: "p_provider_eol_at, null",
    },
    {
      key: "workflow",
      value: valid.workflow.replaceAll(
        "supabase/functions/_shared/fxRates.issue1397.test.ts",
        "supabase/functions/_shared/disconnected.issue1397.test.ts",
      ),
      expected: "fxRates.issue1397.test.ts",
    },
  ];

  for (const reversion of reversions) {
    const broken = { ...valid, [reversion.key]: reversion.value };
    if (
      !violations(broken).some((failure) =>
        failure.includes(reversion.expected)
      )
    ) {
      throw new Error(
        `source reversion not caught: ${reversion.expected}`,
      );
    }
  }
  console.log(
    `issue-1397 self-test PASS (${reversions.length} true-source reversions)`,
  );
}

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  const failures = violations(readFiles());
  if (failures.length > 0) {
    console.error(failures.join("\n"));
    process.exit(1);
  }
  console.log(
    `issue-1397 FX EOL/cron gate PASS (${Object.keys(paths).length} independently enforced files)`,
  );
}
