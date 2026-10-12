// Issue #3645 — regression test for the one-offering-currency-source gate.
//
// Runs the REAL gate as a child process against migration directories written
// to disk, so what is proved is the gate's exit code and message, not an
// internal function. Three things are pinned:
//
//   1. a compliant fixture directory passes;
//   2. a violating fixture directory fails and names what is wrong;
//   3. the repository's own migrations pass today, and the same migrations plus
//      ONE newer migration that re-introduces a list fail. That is the forward
//      ratchet: the old lists that still exist before the anchor do not red the
//      gate, a new one does.
//
// Fixture directories are made under the OS temp dir and removed afterwards;
// nothing is written inside the checkout.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  OFFERING_FUNCTIONS,
  RATCHET_VERSION,
  evaluate,
  inlineCurrencyListReason,
  stripSqlComments,
} from "./issue-3645-one-offering-currency-source.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GATE = path.join(HERE, "issue-3645-one-offering-currency-source.mjs");
const REPO_ROOT = path.resolve(HERE, "..", "..", "..");
const REAL_MIGRATIONS = path.join(REPO_ROOT, "supabase", "migrations");

const LIST_BLOCK = `
  IF v_currency <> ALL (
    ARRAY['GBP'::bpchar, 'USD'::bpchar, 'NGN'::bpchar]
  ) THEN
    RAISE EXCEPTION 'event_currency_unsupported';
  END IF;`;
const HELPER_BLOCK = `
  IF v_currency IS NOT NULL
     AND NOT public.is_supported_offering_currency(v_currency::text) THEN
    RAISE EXCEPTION 'event_currency_unsupported';
  END IF;`;

function offeringFunction(name, block) {
  return `
CREATE OR REPLACE FUNCTION public.${name}(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $function$
DECLARE v_currency character(3) := p->>'currency';
BEGIN${block}
  RETURN p;
END;
$function$;
`;
}

const ANCHOR_SQL = `
CREATE OR REPLACE FUNCTION public.is_supported_offering_currency(p_code text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.supported_brand_currencies AS c
    WHERE c.active AND c.code = pg_catalog.upper(pg_catalog.btrim(p_code))::character(3)
  );
$function$;
ALTER TABLE public.events
  ADD CONSTRAINT events_currency_supported_fkey
  FOREIGN KEY (currency) REFERENCES public.supported_brand_currencies (code) NOT VALID;
`;

function makeDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "issue-3645-currency-gate-"));
  for (const [name, sql] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), sql);
  return dir;
}

function runGate(dir) {
  const result = spawnSync(process.execPath, [GATE, "--migrations-dir", dir], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  return { code: result.status, out: `${result.stdout}\n${result.stderr}` };
}

const baseFixture = () => ({
  // Before the anchor: the old hand-written lists, exactly the shape on main.
  "20270505001973_old_offering_functions.sql": OFFERING_FUNCTIONS.map((name) =>
    offeringFunction(name, LIST_BLOCK),
  ).join("\n"),
  [`${RATCHET_VERSION}_issue_3645_shared_offering_currency_source.sql`]: ANCHOR_SQL,
});

test("compliant fixture: every offering function re-emitted through the helper passes", (t) => {
  const dir = makeDir({
    ...baseFixture(),
    "20270820000001_reemit_through_helper.sql": OFFERING_FUNCTIONS.map((name) =>
      offeringFunction(name, HELPER_BLOCK),
    ).join("\n"),
  });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const { code, out } = runGate(dir);
  assert.equal(code, 0, out);
  // Audible: each function is named with the file that now owns it.
  for (const name of OFFERING_FUNCTIONS) {
    assert.match(out, new RegExp(`${name} @ 20270820000001_reemit_through_helper\\.sql: LATEST, at or after the anchor, JUDGED`));
  }
  assert.match(out, /PASS/);
});

test("violating fixture: a newer definition that re-introduces a list fails and is named", (t) => {
  const dir = makeDir({
    ...baseFixture(),
    "20270820000001_reintroduces_list.sql": offeringFunction("biz_publish_experience", LIST_BLOCK),
  });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const { code, out } = runGate(dir);
  assert.equal(code, 1, out);
  assert.match(out, /R1: public\.biz_publish_experience in 20270820000001_reintroduces_list\.sql carries an inline currency list/);
  assert.match(out, /raises event_currency_unsupported without calling is_supported_offering_currency/);
});

test("violating fixture: a newer CHECK on a currency column with a code list fails", (t) => {
  const dir = makeDir({
    ...baseFixture(),
    "20270820000002_new_currency_check.sql":
      "ALTER TABLE public.events ADD CONSTRAINT events_currency_supported_check\n" +
      "  CHECK (currency = ANY (ARRAY['GBP','USD','NGN']::bpchar[]));\n",
  });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const { code, out } = runGate(dir);
  assert.equal(code, 1, out);
  assert.match(out, /R2: 20270820000002_new_currency_check\.sql adds a CHECK on a currency column/);
});

test("the same CHECK in a migration BEFORE the anchor is not judged (ratchet, not a sweep)", (t) => {
  const dir = makeDir({
    ...baseFixture(),
    "20260916000000_old_currency_check.sql":
      "ALTER TABLE public.events ADD CONSTRAINT events_currency_supported_check\n" +
      "  CHECK (currency = ANY (ARRAY['GBP','USD','NGN']::bpchar[]));\n",
  });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const { code, out } = runGate(dir);
  assert.equal(code, 0, out);
});

test("fails closed: a directory without the anchor migration is refused", (t) => {
  const files = baseFixture();
  delete files[`${RATCHET_VERSION}_issue_3645_shared_offering_currency_source.sql`];
  const dir = makeDir(files);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const { code, out } = runGate(dir);
  assert.equal(code, 1, out);
  assert.match(out, /anchor migration 20270819003645_\*\.sql is missing/);
});

test("the repository's migrations pass today, and fail once ONE newer migration re-introduces a list", (t) => {
  const today = runGate(REAL_MIGRATIONS);
  assert.equal(today.code, 0, today.out);
  // The three functions are found and reported, not silently skipped.
  for (const name of OFFERING_FUNCTIONS) {
    assert.match(today.out, new RegExp(`${name} @ \\d{14}_[\\w.]+\\.sql: LATEST`));
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "issue-3645-currency-gate-real-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const entry of fs.readdirSync(REAL_MIGRATIONS, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".sql")) {
      fs.copyFileSync(path.join(REAL_MIGRATIONS, entry.name), path.join(dir, entry.name));
    }
  }
  // Sanity: the untouched copy passes, so the failure below is the new file's.
  assert.equal(runGate(dir).code, 0);

  fs.writeFileSync(
    path.join(dir, "20991231000000_reintroduces_list.sql"),
    offeringFunction("business_publish_event_draft", LIST_BLOCK),
  );
  const after = runGate(dir);
  assert.equal(after.code, 1, after.out);
  assert.match(after.out, /R1: public\.business_publish_event_draft in 20991231000000_reintroduces_list\.sql/);
});

test("the real anchor migration itself carries no list and no currency CHECK", () => {
  const anchorName = fs
    .readdirSync(REAL_MIGRATIONS)
    .find((name) => name.startsWith(`${RATCHET_VERSION}_`));
  assert.ok(anchorName, "anchor migration must exist in the repository");
  const sql = stripSqlComments(fs.readFileSync(path.join(REAL_MIGRATIONS, anchorName), "utf8"));
  assert.equal(inlineCurrencyListReason(sql), null);
  assert.doesNotMatch(sql, /\bCHECK\s*\(/i);
});

test("comment stripping: a list in a comment is ignored, a '--' inside a string is kept", () => {
  const sql = "SELECT '--not a comment', 1; -- ARRAY['GBP'::bpchar,'USD'::bpchar]\n/* IN ('GBP','USD') */ SELECT 2;";
  const stripped = stripSqlComments(sql);
  assert.match(stripped, /'--not a comment'/);
  assert.equal(inlineCurrencyListReason(stripped), null);
  assert.notEqual(inlineCurrencyListReason("x = ANY (ARRAY['GBP'::bpchar,'USD'::bpchar])"), null);
});

test("evaluate() reports every definition it read, so a silent skip is visible", () => {
  const { log, failures } = evaluate([
    { name: "20270505001973_old.sql", sql: OFFERING_FUNCTIONS.map((name) => offeringFunction(name, LIST_BLOCK)).join("\n") },
    { name: `${RATCHET_VERSION}_anchor.sql`, sql: ANCHOR_SQL },
  ]);
  assert.deepEqual(failures, []);
  for (const name of OFFERING_FUNCTIONS) {
    assert.ok(log.some((line) => line.includes(`${name} @ 20270505001973_old.sql`)), `${name} missing from the log`);
  }
});
