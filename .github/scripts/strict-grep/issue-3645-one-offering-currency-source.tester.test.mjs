// Issue #3645 — tester's adversarial test for the one-offering-currency-source
// gate. Written independently of the implementor's test; it does not repeat it.
//
// Every case runs the REAL gate as a child process against a migration
// directory on disk and judges its exit code and what it printed. Four things
// are pinned:
//
//   1. FAILS CLOSED, one case per thing that can go missing: each of the three
//      offering functions on its own, the helper, a body it cannot delimit, a
//      missing or empty directory, a directory flag with no value.
//   2. AUDIBLE: on the repository's own migrations it names the anchor, the
//      latest definition of each function with its verdict, the helper, and
//      every migration whose CHECKs it inspected. A silent pass is a failure.
//   3. The plausible ways a list comes BACK are refused: spread over lines and
//      comments, concatenated arrays, an array string, IN, a typed OR chain,
//      a definition built inside a DO block, and the retired CHECK re-added
//      word for word.
//   4. The gate's reach has an edge, and this file prints where it is. The
//      KNOWN LIMITS block runs each shape the gate does not see today and
//      prints the verdict. It asserts nothing about them on purpose: tests are
//      append-only, and a pinned weakness would block the fix that closes it.
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

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GATE = path.join(HERE, "issue-3645-one-offering-currency-source.mjs");
const REPO_ROOT = path.resolve(HERE, "..", "..", "..");
const REAL_MIGRATIONS = path.join(REPO_ROOT, "supabase", "migrations");

const ANCHOR_NAME = "20270819003645_issue_3645_shared_offering_currency_source.sql";
const THREE = ["business_publish_event_draft", "biz_publish_experience", "biz_create_experience"];

const VIA_HELPER = `
  IF v_currency IS NOT NULL
     AND NOT public.is_supported_offering_currency(v_currency::text) THEN
    RAISE EXCEPTION 'event_currency_unsupported';
  END IF;`;
const OLD_LIST = `
  IF v_currency <> ALL (ARRAY['GBP'::bpchar, 'USD'::bpchar, 'NGN'::bpchar]) THEN
    RAISE EXCEPTION 'event_currency_unsupported';
  END IF;`;

function fnSql(name, block, { args = "p jsonb", schema = "public" } = {}) {
  return `
CREATE OR REPLACE FUNCTION ${schema}.${name}(${args})
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $function$
DECLARE v_currency character(3) := 'USD';
BEGIN${block}
  RETURN NULL;
END;
$function$;
`;
}

const HELPER_SQL = `
CREATE OR REPLACE FUNCTION public.is_supported_offering_currency(p_code text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.supported_brand_currencies AS c
    WHERE c.active AND c.code = pg_catalog.upper(p_code)::character(3)
  );
$function$;
`;

/** The tree as it stands today: three old bodies with lists, then the anchor. */
function todayFiles() {
  return {
    "20270505001973_old_bodies.sql": THREE.map((name) => fnSql(name, OLD_LIST)).join("\n"),
    [ANCHOR_NAME]: HELPER_SQL,
  };
}

function makeDir(t, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "issue-3645-tester-gate-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [name, sql] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), sql);
  return dir;
}

function runGate(args) {
  const proc = spawnSync("node", [GATE, ...args], { cwd: REPO_ROOT, encoding: "utf8" });
  return { status: proc.status, out: `${proc.stdout ?? ""}${proc.stderr ?? ""}` };
}

function gateOn(t, files) {
  return runGate(["--migrations-dir", makeDir(t, files)]);
}

const LATER = "20270820000001_later.sql";

// ── 0. the fixture itself is sound, or nothing below means anything ─────────
test("control: today's shape passes, and re-emitting through the helper passes", (t) => {
  const today = gateOn(t, todayFiles());
  assert.equal(today.status, 0, today.out);
  const reEmitted = gateOn(t, { ...todayFiles(), [LATER]: THREE.map((name) => fnSql(name, VIA_HELPER)).join("\n") });
  assert.equal(reEmitted.status, 0, reEmitted.out);
  assert.match(reEmitted.out, /JUDGED/);
});

// ── 1. fails closed ─────────────────────────────────────────────────────────
for (const missing of THREE) {
  test(`fails closed: ${missing} has no definition anywhere`, (t) => {
    const files = todayFiles();
    files["20270505001973_old_bodies.sql"] = THREE.filter((name) => name !== missing)
      .map((name) => fnSql(name, OLD_LIST))
      .join("\n");
    const result = gateOn(t, files);
    assert.equal(result.status, 1, result.out);
    assert.match(result.out, new RegExp(`R1: no definition of public\\.${missing}`));
    assert.match(result.out, new RegExp(`${missing}: NO DEFINITION FOUND`));
  });
}

test("fails closed: the helper has no definition anywhere", (t) => {
  const files = todayFiles();
  files[ANCHOR_NAME] = "ALTER TABLE public.events VALIDATE CONSTRAINT events_currency_supported_fkey;";
  const result = gateOn(t, files);
  assert.equal(result.status, 1, result.out);
  assert.match(result.out, /R3: no definition of public\.is_supported_offering_currency/);
});

test("fails closed: the helper stops reading the table", (t) => {
  const result = gateOn(t, {
    ...todayFiles(),
    [LATER]:
      "CREATE OR REPLACE FUNCTION public.is_supported_offering_currency(p_code text) RETURNS boolean " +
      "LANGUAGE sql AS $f$ SELECT p_code IS NOT NULL $f$;",
  });
  assert.equal(result.status, 1, result.out);
  assert.match(result.out, /R3: .* no longer reads public\.supported_brand_currencies/);
});

test("fails closed: a judged definition whose body is not dollar-quoted is refused, not skipped", (t) => {
  const result = gateOn(t, {
    ...todayFiles(),
    [LATER]:
      "CREATE OR REPLACE FUNCTION public.biz_publish_experience(p jsonb) RETURNS jsonb " +
      "LANGUAGE sql AS 'SELECT NULL::jsonb';",
  });
  assert.equal(result.status, 1, result.out);
  assert.match(result.out, /could not delimit the body of public\.biz_publish_experience/);
});

test("fails closed: a missing directory, an empty directory, and a flag with no value", (t) => {
  const gone = runGate(["--migrations-dir", path.join(os.tmpdir(), "issue-3645-no-such-dir-tester")]);
  assert.equal(gone.status, 1, gone.out);
  assert.match(gone.out, /migrations directory not found/);

  const empty = gateOn(t, {});
  assert.equal(empty.status, 1, empty.out);
  assert.match(empty.out, /no versioned migrations were found/);

  const noValue = runGate(["--migrations-dir"]);
  assert.equal(noValue.status, 1, noValue.out);

  // Files that carry no 14-digit version are not migrations; a directory of
  // only those is still "nothing to judge", and each one is named.
  const unversioned = gateOn(t, { "notes.sql": HELPER_SQL, "draft_later.sql": fnSql(THREE[0], OLD_LIST) });
  assert.equal(unversioned.status, 1, unversioned.out);
  assert.match(unversioned.out, /skipped \(no 14-digit version\): notes\.sql/);
});

test("fails closed: an anchor that was renamed to a later version is 'missing', not 'moved'", (t) => {
  const files = todayFiles();
  files["20270901000000_issue_3645_shared_offering_currency_source.sql"] = files[ANCHOR_NAME];
  delete files[ANCHOR_NAME];
  const result = gateOn(t, files);
  assert.equal(result.status, 1, result.out);
  assert.match(result.out, /anchor migration 20270819003645_\*\.sql is missing/);
});

// ── 2. audible on the real tree ─────────────────────────────────────────────
test("audible: on the repository's migrations it names everything it judged", () => {
  const result = runGate(["--migrations-dir", REAL_MIGRATIONS]);
  assert.equal(result.status, 0, result.out);
  assert.match(result.out, /migrations read: \d{3,}; ratchet anchor: 20270819003645/);
  assert.ok(result.out.includes(`anchor present: ${ANCHOR_NAME}`), "the anchor is not named");
  for (const name of THREE) {
    const latest = result.out.split("\n").filter((line) => line.includes(`${name} @ `) && line.includes("LATEST"));
    assert.equal(latest.length, 1, `expected exactly one LATEST line for ${name}, got ${latest.length}`);
  }
  assert.match(result.out, /is_supported_offering_currency @ 20270819003645_[^:]+: LATEST, JUDGED/);
  assert.ok(
    result.out.includes(`${ANCHOR_NAME}: `) && /CHECK expression\(s\) inspected, 0 violation\(s\)/.test(result.out),
    "the R2 line for the anchor migration is missing",
  );
  assert.match(result.out, /PASS: no offering function or constraint at or after 20270819003645/);
});

test("audible: a failure names the function, the file and the shape it found", (t) => {
  const result = gateOn(t, { ...todayFiles(), [LATER]: fnSql("biz_create_experience", OLD_LIST) });
  assert.equal(result.status, 1, result.out);
  // Two reasons, both reported: the list itself, and the refusal raised without the helper.
  assert.match(result.out, /FAIL \(2\):/);
  assert.match(result.out, /R1: public\.biz_create_experience in 20270820000001_later\.sql carries an inline currency list/);
  assert.match(result.out, /R1: public\.biz_create_experience in 20270820000001_later\.sql raises event_currency_unsupported without calling/);
  assert.match(result.out, /biz_create_experience @ 20270820000001_later\.sql: LATEST, at or after the anchor, JUDGED/);
});

// ── 3. the ways a list plausibly comes back ─────────────────────────────────
const MUST_REFUSE = [
  {
    label: "a list spread over lines with comments between the codes",
    sql: fnSql(
      "biz_publish_experience",
      `${VIA_HELPER}
  IF v_currency <> ALL (ARRAY[
       'GBP',   -- pounds
       'USD'    /* dollars */,
       'NGN'
     ]) THEN RAISE EXCEPTION 'nope'; END IF;`,
    ),
    want: /R1: public\.biz_publish_experience/,
  },
  {
    label: "one-element arrays concatenated into a list",
    sql: fnSql(
      "biz_publish_experience",
      `${VIA_HELPER}\n  IF v_currency <> ALL (ARRAY['GBP'] || ARRAY['USD'] || ARRAY['NGN']) THEN RAISE EXCEPTION 'nope'; END IF;`,
    ),
    want: /R1: public\.biz_publish_experience/,
  },
  {
    label: "= ANY ('{GBP,USD}'::bpchar[])",
    sql: fnSql(
      "business_publish_event_draft",
      `${VIA_HELPER}\n  IF NOT (v_currency = ANY ('{GBP,USD}'::bpchar[])) THEN RAISE EXCEPTION 'nope'; END IF;`,
    ),
    want: /array string of currency codes/,
  },
  {
    label: "an array string with quoted, spaced elements",
    sql: fnSql(
      "business_publish_event_draft",
      `${VIA_HELPER}\n  IF NOT (v_currency = ANY ('{"GBP", "USD"}'::text[])) THEN RAISE EXCEPTION 'nope'; END IF;`,
    ),
    want: /array string of currency codes/,
  },
  {
    label: "NOT IN ('GBP','USD') beside a call to the helper",
    sql: fnSql("biz_create_experience", `${VIA_HELPER}\n  IF v_currency NOT IN ('GBP','USD') THEN RAISE EXCEPTION 'nope'; END IF;`),
    want: /IN \(…\) holding 2 currency literals/,
  },
  {
    label: "an OR chain of type-cast comparisons",
    sql: fnSql(
      "biz_create_experience",
      `${VIA_HELPER}\n  IF NOT (v_currency = 'GBP'::bpchar OR v_currency = 'USD'::bpchar) THEN RAISE EXCEPTION 'nope'; END IF;`,
    ),
    want: /type-cast currency literals/,
  },
  {
    label: "the function created from inside a DO block",
    sql:
      "DO $do$ BEGIN EXECUTE $q$ CREATE OR REPLACE FUNCTION public.biz_publish_experience(p jsonb) RETURNS jsonb " +
      "LANGUAGE sql AS $b$ SELECT to_jsonb('USD' IN ('GBP','USD')) $b$ $q$; END $do$;",
    want: /R1: public\.biz_publish_experience/,
  },
  {
    label: "the refusal raised with the helper named only in a comment",
    sql: fnSql(
      "biz_publish_experience",
      "\n  -- TODO call is_supported_offering_currency\n  IF v_currency IS NULL THEN RAISE EXCEPTION 'event_currency_unsupported'; END IF;",
    ),
    want: /raises event_currency_unsupported without calling is_supported_offering_currency/,
  },
  {
    label: "the retired events CHECK re-added word for word",
    sql:
      "ALTER TABLE public.events ADD CONSTRAINT events_currency_supported_check\n" +
      "  CHECK (currency IS NULL OR currency = ANY (ARRAY['GBP'::bpchar, 'USD'::bpchar, 'NGN'::bpchar]));",
    want: /R2: 20270820000001_later\.sql adds a CHECK on a currency column/,
  },
  {
    label: "a currency CHECK written as an OR chain of bare literals",
    sql: "ALTER TABLE public.trips ADD CONSTRAINT c CHECK (currency = 'GBP' OR currency = 'USD');",
    want: /R2: /,
  },
  {
    label: "a currency CHECK using an array string",
    sql: "ALTER TABLE public.trips ADD CONSTRAINT c CHECK (deposit_currency = ANY ('{GBP,USD}'::bpchar[]));",
    want: /R2: /,
  },
  {
    label: "a NOT VALID currency CHECK (still a second list, validated or not)",
    sql: "ALTER TABLE public.trips ADD CONSTRAINT c CHECK (currency IN ('GBP', 'USD')) NOT VALID;",
    want: /R2: /,
  },
];

for (const item of MUST_REFUSE) {
  test(`refused: ${item.label}`, (t) => {
    const result = gateOn(t, { ...todayFiles(), [LATER]: item.sql });
    assert.equal(result.status, 1, `the gate passed this:\n${item.sql}\n${result.out}`);
    assert.match(result.out, item.want);
  });
}

test("a dirty re-emit is still refused when a LATER migration touches a different function", (t) => {
  const result = gateOn(t, {
    ...todayFiles(),
    "20270820000001_dirty.sql": fnSql("biz_publish_experience", OLD_LIST),
    "20270821000001_other.sql": fnSql("biz_create_experience", VIA_HELPER),
  });
  assert.equal(result.status, 1, result.out);
  assert.match(result.out, /R1: public\.biz_publish_experience in 20270820000001_dirty\.sql/);
});

test("ratchet edge: a definition AT the anchor version is judged; one just before it is not", (t) => {
  const at = gateOn(t, {
    "20270505001973_old_bodies.sql": THREE.map((name) => fnSql(name, OLD_LIST)).join("\n"),
    [ANCHOR_NAME]: HELPER_SQL + fnSql("biz_publish_experience", OLD_LIST),
  });
  assert.equal(at.status, 1, at.out);
  assert.match(at.out, new RegExp(`R1: public\\.biz_publish_experience in ${ANCHOR_NAME}`));

  const before = gateOn(t, {
    ...todayFiles(),
    "20270819003644_just_before.sql": fnSql("biz_publish_experience", OLD_LIST),
  });
  assert.equal(before.status, 0, before.out);
  assert.match(before.out, /20270819003644_just_before\.sql: LATEST, before the anchor, not judged/);
});

// ── 4. known limits: printed, never asserted ────────────────────────────────
// Each of these carries a second currency list and the gate does not see it
// today. They are recorded on #3645 with a severity. This block exists so the
// edge of the gate is visible in every CI log; it must never be turned into an
// assertion that the gate PASSES them, or it would forbid the fix.
const KNOWN_LIMITS = [
  { label: "a NEW offering function (not one of the three) with a copied list", sql: fnSql("biz_publish_stay", OLD_LIST) },
  {
    label: "the list moved into a function the offering function calls",
    sql:
      fnSql("t3645_currency_ok", "\n  RETURN to_jsonb(v_currency IN ('GBP','USD'));") +
      fnSql("biz_publish_experience", `${VIA_HELPER}\n  PERFORM public.t3645_currency_ok(p);`),
  },
  {
    label: "the body renamed to _v2 and the original turned into a wrapper",
    sql: fnSql("biz_publish_experience_v2", OLD_LIST) + fnSql("biz_publish_experience", "\n  RETURN public.biz_publish_experience_v2(p);"),
  },
  {
    label: "an OR chain of bare (un-cast) literals inside a function",
    sql: fnSql("biz_publish_experience", `${VIA_HELPER}\n  IF NOT (v_currency = 'GBP' OR v_currency = 'USD') THEN RAISE EXCEPTION 'nope'; END IF;`),
  },
  {
    label: "lowercase codes",
    sql: fnSql("biz_publish_experience", `${VIA_HELPER}\n  IF lower(v_currency) NOT IN ('gbp','usd') THEN RAISE EXCEPTION 'nope'; END IF;`),
  },
  {
    label: "a regular expression of codes in a function",
    sql: fnSql("biz_publish_experience", `${VIA_HELPER}\n  IF v_currency !~ '^(GBP|USD)$' THEN RAISE EXCEPTION 'nope'; END IF;`),
  },
  { label: "a currency CHECK written as a regular expression", sql: "ALTER TABLE public.trips ADD CONSTRAINT c CHECK (currency ~ '^(GBP|USD)$');" },
  { label: "a DOMAIN whose CHECK lists the codes", sql: "CREATE DOMAIN public.currency_code AS character(3) CHECK (VALUE IN ('GBP','USD'));" },
  { label: "a currency CHECK on a column not named *currency*", sql: "ALTER TABLE public.trips ADD CONSTRAINT c CHECK (ccy IN ('GBP','USD'));" },
  {
    label: "a migration dated before the anchor that re-emits a list",
    name: "20270819000000_backdated.sql",
    sql: fnSql("biz_publish_experience", OLD_LIST),
  },
];

test("known limits are printed with today's verdict (nothing is asserted about them)", (t) => {
  for (const item of KNOWN_LIMITS) {
    const result = gateOn(t, { ...todayFiles(), [item.name ?? LATER]: item.sql });
    console.log(`  known limit: ${result.status === 0 ? "NOT SEEN by the gate" : "now refused by the gate"} — ${item.label}`);
    assert.ok(result.status === 0 || result.status === 1, `the gate crashed on: ${item.label}\n${result.out}`);
  }
});
