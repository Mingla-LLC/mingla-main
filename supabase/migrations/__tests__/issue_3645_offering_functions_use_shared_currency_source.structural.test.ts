/**
 * #3645 — structural contract for the LATEST definition of the three offering
 * functions, wherever it lives.
 *
 * `issue_3645_organiser_terms_paid_publish_rpc.structural.test.ts` reads one
 * named migration file. A later migration that re-emits one of these functions
 * (as 20270830003645 does) is invisible to it, so a re-emit that dropped the
 * Organiser Terms requirement would still pass there. This test walks every
 * migration in version order and judges whichever definition is last.
 */

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const migrationsDir = new URL("../", import.meta.url);

type Definition = { file: string; text: string };

async function latestDefinitions(names: readonly string[]): Promise<Map<string, Definition>> {
  const files: string[] = [];
  for await (const entry of Deno.readDir(migrationsDir)) {
    if (entry.isFile && /^\d{14}_.*\.sql$/.test(entry.name)) files.push(entry.name);
  }
  files.sort();
  const latest = new Map<string, Definition>();
  for (const file of files) {
    const sql = await Deno.readTextFile(new URL(file, migrationsDir));
    for (const name of names) {
      const marker = new RegExp(
        `CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`,
        "gi",
      );
      for (const match of sql.matchAll(marker)) {
        const rest = sql.slice(match.index);
        const tag = /\bAS\s+(\$[A-Za-z0-9_]*\$)/i.exec(rest);
        assert(tag, `${name} in ${file}: no dollar-quoted body`);
        const bodyStart = tag.index + tag[0].length;
        const bodyEnd = rest.indexOf(tag[1], bodyStart);
        assert(bodyEnd > bodyStart, `${name} in ${file}: unterminated body`);
        latest.set(name, { file, text: rest.slice(bodyStart, bodyEnd) });
      }
    }
  }
  return latest;
}

/** Function body with `--` comments removed, so prose cannot satisfy a check. */
function code(text: string): string {
  return text.split("\n").map((line) => line.replace(/--.*$/, "")).join("\n");
}

function count(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

const OFFERING_FUNCTIONS = [
  "business_publish_event_draft",
  "biz_publish_experience",
  "biz_create_experience",
] as const;

const latest = await latestDefinitions(OFFERING_FUNCTIONS);

const HELPER_BLOCK =
  /IF v_currency IS NOT NULL\s+AND NOT public\.is_supported_offering_currency\(v_currency::text\) THEN\s+RAISE EXCEPTION 'event_currency_unsupported';/;
const FREE_ONLY = "PERFORM set_config('mingla.publish_free_only', 'on', true);";
const TERMS = "PERFORM public.biz_require_current_organiser_terms(";
const EXPERIENCE_PAID = "IF p_publish AND NOT v_is_free AND v_resolved_total > 0 THEN";

for (const name of OFFERING_FUNCTIONS) {
  Deno.test(`#3645: the latest ${name} asks the shared currency source and holds no list`, () => {
    const definition = latest.get(name);
    assert(definition, `no definition of ${name} found in any migration`);
    const body = code(definition.text);
    assert(
      definition.file >= "20270830003645",
      `${name}: latest definition is in ${definition.file}, which predates the shared-source re-emit`,
    );
    assert(HELPER_BLOCK.test(body), `${name} (${definition.file}): helper block missing`);
    assert(!/'[A-Z]{3}'\s*::\s*bpchar/.test(body), `${name} (${definition.file}): inline currency literal`);
    assert(
      !/ARRAY\s*\[\s*'[A-Z]{3}'/.test(body),
      `${name} (${definition.file}): inline currency array`,
    );
  });

  Deno.test(`#3645: the latest ${name} requires Organiser Terms exactly once, on its paid publish`, () => {
    const definition = latest.get(name)!;
    const body = code(definition.text);
    assertEquals(count(body, "biz_require_current_organiser_terms"), 1, `${name} (${definition.file})`);
    assert(body.includes(TERMS), `${name} (${definition.file}): terms requirement is not a PERFORM`);
    assert(
      body.includes("IF NOT public.pg_brand_can_collect("),
      `${name} (${definition.file}): paid can-collect check missing`,
    );
  });

  Deno.test(`#3645: the latest ${name} declares a free-only publish once, transaction-locally`, () => {
    const definition = latest.get(name)!;
    const body = code(definition.text);
    assertEquals(count(body, "mingla.publish_free_only"), 1, `${name} (${definition.file})`);
    assert(body.includes(FREE_ONLY), `${name} (${definition.file}): not the transaction-local form`);
  });
}

for (const name of ["biz_publish_experience", "biz_create_experience"] as const) {
  Deno.test(`#3645: ${name} asks for terms inside the paid branch, before the can-collect check`, () => {
    const body = code(latest.get(name)!.text);
    const paid = body.indexOf(EXPERIENCE_PAID);
    const terms = body.indexOf(TERMS);
    const collect = body.indexOf("IF NOT public.pg_brand_can_collect(");
    assert(paid >= 0, `${name}: paid-publish branch not found`);
    assert(terms > paid, `${name}: terms requirement sits outside the paid branch`);
    assert(collect > terms, `${name}: terms must be asked before the can-collect check`);
    // Nothing closes the paid branch between its opening and the requirement.
    assert(!/\bEND IF;/.test(body.slice(paid, terms)), `${name}: terms requirement is not in the paid branch`);
  });

  Deno.test(`#3645: ${name} declares free-only only when nothing is priced`, () => {
    const body = code(latest.get(name)!.text);
    const flag = body.indexOf(FREE_ONLY);
    const guard = body.lastIndexOf("IF p_publish", flag);
    assert(guard >= 0 && flag > guard);
    const condition = body.slice(guard, flag);
    assert(/AND v_resolved_total <= 0/.test(condition), `${name}: free-only is not tied to a zero total`);
    assert(/v_pricing_mode = 'per_stop'/.test(condition), `${name}: free-only ignores per-stop prices`);
    assert(/\(s->>'price_cents'\)::integer, 0\) > 0/.test(condition), `${name}: free-only ignores priced stops`);
    // The paid branch must not contain the declaration.
    const paid = body.indexOf(EXPERIENCE_PAID);
    assert(flag < paid || /\bEND IF;/.test(body.slice(paid, flag)), `${name}: free-only declared inside the paid branch`);
  });
}

Deno.test("#3645: the event function asks for terms after it decides the publish carries money", () => {
  const body = code(latest.get("business_publish_event_draft")!.text);
  const money = body.indexOf("INTO v_money_bearing");
  const terms = body.indexOf(TERMS);
  assert(money >= 0 && terms > money);
  assert(/IF COALESCE\(v_money_bearing, false\) THEN\s+PERFORM public\.biz_require_current_organiser_terms\(v_event\.brand_id\);/.test(body));
  assert(/IF NOT COALESCE\(v_money_bearing, false\) THEN\s+PERFORM set_config\('mingla\.publish_free_only', 'on', true\);/.test(body));
});

// The file re-emits three functions and nothing else. An earlier draft carried
// a fourth, public.biz_publish_stay, copied along by accident from the file it
// was cut from: identical today, but a silent rewind of whatever a later
// migration made of that function. This counts every function the file creates.
Deno.test("#3645: migration 20270830003645 creates exactly the three offering functions", async () => {
  const sql = await Deno.readTextFile(
    new URL(
      "20270830003645_issue_3645_offering_functions_use_shared_currency_source.sql",
      migrationsDir,
    ),
  );
  const withoutComments = sql.split("\n").map((line) => line.replace(/--.*$/, "")).join("\n");
  const created = [
    ...withoutComments.matchAll(
      /\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)\s+([A-Za-z_"][\w".]*)\s*\(/gi,
    ),
  ].map((match) => match[1].replaceAll('"', "").toLowerCase());
  assertEquals(
    [...created].sort(),
    OFFERING_FUNCTIONS.map((name) => `public.${name}`).sort(),
  );
  // And it changes nothing else: no trigger, table, grant or drop.
  for (const statement of ["CREATE TRIGGER", "CREATE TABLE", "ALTER TABLE", "DROP ", "GRANT ", "REVOKE "]) {
    assert(!withoutComments.toUpperCase().includes(statement), `unexpected ${statement.trim()} in the migration`);
  }
});

