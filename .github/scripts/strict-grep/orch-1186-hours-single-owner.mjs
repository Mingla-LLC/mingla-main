#!/usr/bin/env node
/**
 * ORCH-1186-A — opening hours are a single owner (brand_hours), with the
 * reservation baseline service periods DERIVED ONLY by the shared bridge helper.
 *
 * Invariant I-PROPOSED-1186-HOURS-SINGLE-OWNER (DRAFT): the literal
 * `derived_from_hours` provenance marker is produced ONLY by
 * `biz_derive_service_periods_from_brand_hours`, and that helper is the SINGLE
 * bridge invoked from BOTH hours-write RPCs (create + edit). This gate fails if:
 *   (a) the migration does NOT define biz_derive_service_periods_from_brand_hours;
 *   (b) biz_create_venue_brand_authoring or biz_upsert_brand_hours stop calling
 *       (PERFORM) the helper (the live/edit bridge would be severed); OR
 *   (c) any SQL source OTHER than the helper writes the literal
 *       `derived_from_hours` (a second producer would re-fork the source of
 *       truth — the exact bug this leg eliminates).
 *
 * Mirrors the modular self-testing gate pattern (sibling: orch-1167-one-read-rpc.mjs).
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? join(process.cwd(), "..")
  : process.cwd();

const SELF_TEST = process.argv.includes("--self-test");

const MIGRATIONS_DIR = join(root, "supabase", "migrations");
const HELPER = "biz_derive_service_periods_from_brand_hours";
const MARKER = "derived_from_hours";
const WRITE_RPCS = [
  "biz_create_venue_brand_authoring",
  "biz_upsert_brand_hours",
];

const walkSql = (dir) => {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      // skip __tests__ — probes legitimately reference the marker/helper.
      if (entry === "__tests__") continue;
      out.push(...walkSql(path));
    } else if (/\.sql$/.test(entry)) {
      out.push(path);
    }
  }
  return out;
};

// Strip SQL line + block comments so explanatory notes never trip the gate.
const stripSql = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^-])--.*$/gm, "$1");

const run = (sqlFiles, readFile) => {
  const failures = [];

  // (a) — the helper must be defined somewhere in the migrations.
  const definesHelper = sqlFiles.some((f) => {
    const code = stripSql(readFile(f));
    return new RegExp(
      `CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${HELPER}\\b`,
    ).test(code);
  });
  if (!definesHelper) {
    failures.push(
      `No migration defines public.${HELPER} — the single hours→service_periods bridge is missing.`,
    );
  }

  // (b) — both hours-write RPCs must PERFORM/call the helper. Find each RPC's
  // CREATE OR REPLACE body and assert it references the helper.
  for (const rpc of WRITE_RPCS) {
    let wired = false;
    for (const f of sqlFiles) {
      const code = stripSql(readFile(f));
      // Grab the latest CREATE OR REPLACE of this RPC in the file (the migration
      // that re-states it with the PERFORM line).
      const re = new RegExp(
        `CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${rpc}\\b[\\s\\S]*?\\$\\$;`,
        "g",
      );
      let m;
      while ((m = re.exec(code)) !== null) {
        if (m[0].includes(HELPER)) wired = true;
      }
    }
    if (!wired) {
      failures.push(
        `${rpc} does not call ${HELPER} in any CREATE OR REPLACE — the hours-write → derive bridge is severed.`,
      );
    }
  }

  // (c) — no SQL source outside the helper definition writes the literal marker.
  for (const f of sqlFiles) {
    const code = stripSql(readFile(f));
    if (!code.includes(MARKER)) continue;
    // Allow the file that defines the helper (its body legitimately writes it).
    const definesHelperHere = new RegExp(
      `CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${HELPER}\\b`,
    ).test(code);
    if (definesHelperHere) {
      // Ensure the marker only appears inside the helper body, not in some other
      // function in the same file. Heuristic: the marker must appear AFTER the
      // helper's CREATE and BEFORE the next CREATE FUNCTION (or EOF).
      const helperStart = code.search(
        new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${HELPER}\\b`),
      );
      const after = code.slice(helperStart);
      const nextFn = after.slice(1).search(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/);
      const helperBody = nextFn === -1 ? after : after.slice(0, nextFn + 1);
      const elsewhere = code.slice(0, helperStart) +
        (nextFn === -1 ? "" : after.slice(nextFn + 1));
      if (elsewhere.includes(MARKER)) {
        failures.push(
          `${relative(root, f)}: writes the literal "${MARKER}" outside ${HELPER} — only the helper may produce derived periods (single owner).`,
        );
      }
      void helperBody;
    } else {
      failures.push(
        `${relative(root, f)}: writes the literal "${MARKER}" but does not define ${HELPER} — a second producer of derived periods re-forks the source of truth.`,
      );
    }
  }

  return failures;
};

if (SELF_TEST) {
  // Synthetic fixtures prove the gate FAILS on each violation and PASSES clean.
  const ok = {
    "m1.sql": `CREATE OR REPLACE FUNCTION public.${HELPER} (p uuid) RETURNS void AS $derive$ BEGIN UPDATE x SET sp = '[{"type":"${MARKER}"}]'; END; $derive$;`,
    "m2.sql": `CREATE OR REPLACE FUNCTION public.biz_create_venue_brand_authoring () RETURNS uuid AS $$ BEGIN PERFORM public.${HELPER}(v); RETURN v; END; $$;`,
    "m3.sql": `CREATE OR REPLACE FUNCTION public.biz_upsert_brand_hours (a uuid, b jsonb) RETURNS void AS $$ BEGIN PERFORM public.${HELPER}(a); END; $$;`,
  };
  const read = (set) => (f) => set[f.replace(/^.*\//, "")];
  const f1 = run(Object.keys(ok), read(ok));
  if (f1.length !== 0) {
    console.error("SELF-TEST FAIL: clean fixture should pass:", f1);
    process.exit(1);
  }
  // Violation (b): upsert drops the PERFORM.
  const bad = { ...ok, "m3.sql": `CREATE OR REPLACE FUNCTION public.biz_upsert_brand_hours (a uuid, b jsonb) RETURNS void AS $$ BEGIN END; $$;` };
  if (run(Object.keys(bad), read(bad)).length === 0) {
    console.error("SELF-TEST FAIL: should fail when upsert drops the helper call");
    process.exit(1);
  }
  // Violation (c): a second file writes the marker without defining the helper.
  const bad2 = { ...ok, "m4.sql": `CREATE OR REPLACE FUNCTION public.other () RETURNS void AS $$ BEGIN UPDATE x SET sp='[{"type":"${MARKER}"}]'; END; $$;` };
  if (run(Object.keys(bad2), read(bad2)).length === 0) {
    console.error("SELF-TEST FAIL: should fail when a second producer writes the marker");
    process.exit(1);
  }
  console.log("ORCH-1186 hours-single-owner gate self-test passed.");
  process.exit(0);
}

const sqlFiles = walkSql(MIGRATIONS_DIR);
const failures = run(sqlFiles, (f) => readFileSync(f, "utf8"));

if (failures.length > 0) {
  console.error("ORCH-1186 hours-single-owner gate failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("ORCH-1186 hours-single-owner gate passed.");
