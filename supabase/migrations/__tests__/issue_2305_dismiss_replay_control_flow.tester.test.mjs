import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = new URL(
  "../20270430002305_issue_2305_conflict_resolution_rework.sql",
  import.meta.url,
);

function resolveBody(source) {
  const start = source.indexOf(
    "CREATE OR REPLACE FUNCTION public.biz_resolve_brand_person_conflict(",
  );
  assert.notEqual(start, -1, "resolve RPC definition must exist");
  const end = source.indexOf("\n$function$;", start);
  assert.notEqual(end, -1, "resolve RPC definition must terminate");
  return source.slice(start, end);
}

test("#2305 dismissed replay stays canonical, outcome-safe, and link-independent", () => {
  const body = resolveBody(readFileSync(migration, "utf8"));

  const canonicalize = body.indexOf(
    "SELECT array_agg(DISTINCT x ORDER BY x) INTO v_ids FROM unnest(p_conflict_ids) x;",
  );
  const outcomeMismatch = body.indexOf(
    "RAISE EXCEPTION 'people_conflict_already_resolved' USING ERRCODE='23505';",
  );
  const pureReplay = body.indexOf("IF v_open_count=0 THEN");
  const dismissReplay = body.indexOf("IF p_resolution='dismiss' THEN", pureReplay);
  const exactDismissShape = body.indexOf(
    "'links','[]'::jsonb,'mergedPersonIds','[]'::jsonb,'replayed',true",
    dismissReplay,
  );
  const linkReconstruction = body.indexOf(
    "JOIN public.brand_person_source_links l",
    pureReplay,
  );

  assert.notEqual(canonicalize, -1, "duplicate/permuted conflict ids must canonicalize");
  assert.notEqual(outcomeMismatch, -1, "a conflicting durable outcome must stay typed");
  assert.notEqual(pureReplay, -1, "pure replay branch must exist");
  assert.notEqual(dismissReplay, -1, "Dismiss needs its own replay branch");
  assert.notEqual(exactDismissShape, -1, "Dismiss replay needs deterministic empty arrays");
  assert.notEqual(linkReconstruction, -1, "merge/separate durable reconstruction must remain");
  assert.ok(canonicalize < outcomeMismatch, "canonicalize before checking durable outcomes");
  assert.ok(outcomeMismatch < pureReplay, "reject a different outcome before any replay return");
  assert.ok(pureReplay < dismissReplay, "Dismiss branch belongs only inside pure replay");
  assert.ok(dismissReplay < exactDismissShape, "the Dismiss branch must return the exact contract");
  assert.ok(
    exactDismissShape < linkReconstruction,
    "Dismiss must return before link reconstruction, because it intentionally has no link",
  );
});
