import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const root = new URL("../../../", import.meta.url);
const migration = await Deno.readTextFile(
  new URL(
    "supabase/migrations/20280211004179_issue_4179_release_reason_json_null.sql",
    root,
  ),
);
const recordWriter = await Deno.readTextFile(
  new URL(".github/scripts/release-records/record.mjs", root),
);
const runtimeProof = await Deno.readTextFile(
  new URL(
    "supabase/migrations/__tests__/issue_4179_release_reason_json_null.implementor.pg17.test.sql",
    root,
  ),
);

Deno.test("#4179 accepts the merge bot's explicit null for keyed guide records", () => {
  assert(
    recordWriter.includes(
      'feature_guide_reason: guide.kind === "none" ? guide.reason : null,',
    ),
  );
  assert(
    migration.includes(
      "OR jsonb_typeof(d->'feature_guide_reason') = 'null'",
    ),
  );
  assert(runtimeProof.includes("'feature_guide_reason', p_reason"));
  assert(runtimeProof.includes("'null'::jsonb"));
  assert(!runtimeProof.includes("jsonb_strip_nulls"));
});

Deno.test("#4179 keeps the keyed-record reason prohibition and hardened authority", () => {
  assert(
    migration.includes(
      "jsonb_array_length(d->'feature_guide') = 0",
    ),
  );
  assert(
    migration.includes(
      "jsonb_typeof(d->'feature_guide_reason') = 'string'",
    ),
  );
  assert(
    migration.includes(
      "REVOKE EXECUTE ON FUNCTION public.ops_release_records_ingest(jsonb) FROM PUBLIC, anon, authenticated",
    ),
  );
  assert(
    migration.includes(
      "GRANT EXECUTE ON FUNCTION public.ops_release_records_ingest(jsonb) TO service_role",
    ),
  );
  assertEquals(
    migration.match(/CREATE OR REPLACE FUNCTION public\.ops_release_records_ingest/g)?.length,
    1,
  );
});

Deno.test("#4179 static rewrite fails closed unless the exact predecessor is live", () => {
  assert(migration.includes("pg_get_functiondef"));
  assert(migration.includes("v_old_occurrences <> 1"));
  assert(
    migration.includes(
      "issue4179_release_reason_json_null_contract_drift",
    ),
  );
  assert(!/\bEXECUTE\s+(?:format|v_)/.test(migration));
});
