// Issue #4423 (W2.2) — tester adversarial: the admin board and the database
// agree on the "board" card shape, read from BOTH sides of the wire.
//
// The implementor's coverage test (issue4423_board_shape_coverage) pins the
// fields the admin board reads against a hand-written list. Nothing there reads
// the server: a migration that drops a field from the board shape (or stops
// sending instructions when the board searches) would leave every admin test
// green while the board silently loses data. This test reads the newest
// migration that defines public.ops_cards_json and public.ops_work_list and
// checks, against the admin's own list (parsed from the coverage test, so the
// two can never drift apart):
//   1. every field the admin board needs is built for BOTH board shapes (the
//      jsonb object every shape carries, not the full-only branch);
//   2. drawer-only fields stay out of the shared object (the board stays light);
//   3. a board search (q) is served the board_text shape, which adds the full
//      instructions the client re-filters on;
//   4. the admin falls back only on the old server's exact refusal text, and
//      the new server's refusals never contain it.
//
// FAILS-ON-REVERT: delete 'links' (or any required key) from the shared
// jsonb_build_object in 20280705004423_issue_4423_w2_ops_set_based_card_builders.sql,
// or drop the board_text mapping in 20280705014423_..._review_counts.sql, and
// this file goes red.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..");
const MIGRATIONS = path.join(REPO, "supabase", "migrations");

function newestDefining(fn) {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  const re = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\(`);
  const hits = files.filter((f) => re.test(readFileSync(path.join(MIGRATIONS, f), "utf8")));
  assert.ok(hits.length, `no migration defines public.${fn}`);
  return readFileSync(path.join(MIGRATIONS, hits[hits.length - 1]), "utf8");
}

function functionSql(src, fn) {
  const start = src.search(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\(`));
  const end = src.indexOf("$function$;", start);
  assert.ok(start >= 0 && end > start, `body of ${fn} not found`);
  return src.slice(start, end);
}

// Keys at even argument positions of the top-level jsonb_build_object calls.
function objectKeys(block) {
  const keys = new Set();
  let i = 0;
  while ((i = block.indexOf("jsonb_build_object(", i)) >= 0) {
    let depth = 0; let arg = 0; let j = i + "jsonb_build_object".length; let sawToken = false;
    for (; j < block.length; j += 1) {
      const ch = block[j];
      if (ch === "'") {
        const close = block.indexOf("'", j + 1);
        if (depth === 1 && arg % 2 === 0 && !sawToken) keys.add(block.slice(j + 1, close));
        sawToken = true; j = close; continue;
      }
      if (ch === "(") { depth += 1; if (depth > 1) sawToken = true; continue; }
      if (ch === ")") { depth -= 1; if (depth === 0) break; continue; }
      if (ch === "," && depth === 1) { arg += 1; sawToken = false; continue; }
      if (!/\s/.test(ch) && depth === 1) sawToken = true;
    }
    // continue scanning AFTER this whole call so nested objects are not read as top level
    i = j + 1;
  }
  return keys;
}

const coverageSrc = readFileSync(path.join(HERE, "issue4423_board_shape_coverage.implementor.test.js"), "utf8");
const BOARD_FIELDS = JSON.parse(
  coverageSrc.match(/export const BOARD_FIELDS = \[([\s\S]*?)\];/)[1]
    .replace(/\/\/[^\n]*/g, "").replace(/,\s*$/, "").replace(/^/, "[").concat("]").replace(/,\s*\]$/, "]"),
);
const DRAWER_ONLY = ["done_means", "description", "result", "plan", "github", "close_reason", "override", "files_url", "blocked_reason"];

const builder = functionSql(newestDefining("ops_cards_json"), "ops_cards_json");
const shared = builder.slice(builder.indexOf("jsonb_build_object(", builder.indexOf("SELECT p.ord")), builder.indexOf("AS common"));
const sharedKeys = objectKeys(shared);
const fullOnly = builder.slice(builder.indexOf("AS common"), builder.indexOf("AS extra"));
const listSql = functionSql(newestDefining("ops_work_list"), "ops_work_list");
const serviceSrc = readFileSync(path.join(HERE, "..", "services", "opsService.js"), "utf8");

describe("#4423 tester: the board shape the admin needs is the shape the database builds", () => {
  it("parses a real admin field list and a real server key list (no empty-set pass)", () => {
    assert.ok(BOARD_FIELDS.length >= 30, `admin list too short: ${BOARD_FIELDS.length}`);
    assert.ok(sharedKeys.size >= 30, `server shared keys too few: ${[...sharedKeys].join(",")}`);
  });

  it("every field the admin board reads is built for every board shape (not only full)", () => {
    const required = BOARD_FIELDS.filter((f) => f !== "instructions");
    const missing = required.filter((f) => !sharedKeys.has(f));
    assert.deepEqual(missing, [], `the server's board shape lacks: ${missing.join(", ")}`);
  });

  it("drawer-only fields stay out of the shared board object", () => {
    const leaked = DRAWER_ONLY.filter((f) => sharedKeys.has(f));
    assert.deepEqual(leaked, [], `drawer-only fields in the board shape: ${leaked.join(", ")}`);
    for (const f of DRAWER_ONLY) assert.match(fullOnly, new RegExp(`'${f}'`), `full shape still carries ${f}`);
  });

  it("a board search gets the board_text shape, which carries the full instructions", () => {
    assert.match(listSql, /WHEN v_shape = 'board' AND v_q IS NOT NULL THEN 'board_text'/);
    assert.match(builder, /WHEN p_shape = 'board_text' THEN jsonb_build_object\('instructions', p\.instructions\)/);
    assert.ok(!sharedKeys.has("instructions"), "instructions must not ride on every board card");
  });

  it("links on the board keep kind and id (the Linked to filter and the draft split read them)", () => {
    const linksCte = builder.slice(builder.indexOf("board links carry"), builder.indexOf("board links carry") + 900);
    assert.match(linksCte, /'kind'/);
    assert.match(linksCte, /'id'/);
  });

  it("the fallback triggers only on the old server's refusal, never on the new server's own words", () => {
    const fallback = serviceSrc.match(/function refusesShape[\s\S]*?\n}/)[0];
    assert.match(fallback, /cannot filter by "shape"/);
    // Every refusal text the new ops_work_list can raise, with any %s filled by "shape".
    const texts = [...listSql.matchAll(/RAISE EXCEPTION '([^']*)'/g), ...listSql.matchAll(/format\('([^']*)'/g)]
      .map((m) => m[1].replace(/%s/g, "shape"));
    assert.ok(texts.length >= 3, "found the server's refusal texts");
    // The unknown-key refusal is only reached for keys outside the allowed list, and shape is in it.
    assert.match(listSql.match(/k NOT IN \(([^)]*)\)/)[1], /'shape'/, "the new server must accept the shape key");
  });
});
