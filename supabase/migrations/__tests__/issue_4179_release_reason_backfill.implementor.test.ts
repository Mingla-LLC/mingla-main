import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const migration = await Deno.readTextFile(
  new URL(
    "../20280210004179_issue_4179_release_reason_backfill.sql",
    import.meta.url,
  ),
);

Deno.test("#4179 repairs only a missing reason on matching empty classifications", () => {
  assert(migration.includes("cardinality(r.feature_guide) = 0"));
  assert(migration.includes("cardinality(EXCLUDED.feature_guide) = 0"));
  assert(migration.includes("r.feature_guide_reason IS NULL"));
  assert(migration.includes("ELSE r.feature_guide_reason"));
  assertEquals(
    migration.match(/THEN EXCLUDED\.feature_guide_reason/g)?.length,
    3,
  );
});

Deno.test("#4179 production backfill is sealed to PR 4184 and its merge SHA", () => {
  assert(migration.includes("pr = 4184"));
  assert(migration.includes("5d6c44510329da1b0c17478a76dc356558f1d037"));
  assert(migration.includes("cardinality(feature_guide) = 0"));
  assert(migration.includes("feature_guide_reason IS NULL"));
  assert(migration.includes("issue4179_pr_4184_release_record_drift"));
});

Deno.test("#4179 ingest rewrite fails closed if its predecessor contract drifts", () => {
  assert(migration.includes("v_occurrences <> 1"));
  assert(migration.includes("issue4179_release_ingest_contract_drift"));
  assert(migration.includes("pg_get_functiondef"));
});
