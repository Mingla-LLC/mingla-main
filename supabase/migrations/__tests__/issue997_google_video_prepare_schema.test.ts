// ISSUE-997 D1 implementor schema regression — static, zero DB/provider writes.
// Asserts the new migration admits 'google' to the prepare RPC platform guard,
// still admits meta/snapchat/tiktok, still rejects unknown platforms, preserves
// the #1184 SECURITY DEFINER + service-role-only privilege contract verbatim, and
// carries a read-only self-verify DO block. No create is opened here (D2).
import {
  assert,
  assertEquals,
  assertMatch,
  assertStringIncludes,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

const migrationUrl = new URL(
  "../20270111001185_issue_997_google_video_prepare.sql",
  import.meta.url,
);
const sql = await Deno.readTextFile(migrationUrl);

// Fails-on-revert: dropping 'google' from the guard fails this.
Deno.test("ISSUE-997 D1 migration admits google to the prepare RPC platform guard", () => {
  const match = sql.match(
    /IF p_platform NOT IN \(([^)]*)\) THEN/,
  );
  assert(match, "platform guard IN-list must be present");
  const list = match![1];
  for (const platform of ["meta", "snapchat", "tiktok", "google"]) {
    assertStringIncludes(list, `'${platform}'`);
  }
  // Unknown platforms are STILL rejected — reddit is not a preparation platform.
  assertEquals(list.includes("'reddit'"), false);
  assertStringIncludes(sql, "'platform_invalid'");
});

Deno.test("ISSUE-997 D1 migration is a CREATE OR REPLACE that preserves the #1184 security contract", () => {
  assertMatch(
    sql,
    /CREATE OR REPLACE FUNCTION public\.ad_creative_prepare_begin\s*\(/,
  );
  assertMatch(
    sql,
    /LANGUAGE plpgsql\s+SECURITY DEFINER\s+SET search_path = public, pg_temp/i,
  );
  assertStringIncludes(sql, "OWNER TO postgres");
  assertMatch(
    sql,
    /REVOKE EXECUTE ON FUNCTION public\.ad_creative_prepare_begin[\s\S]+FROM PUBLIC, anon, authenticated/i,
  );
  assertMatch(
    sql,
    /GRANT EXECUTE ON FUNCTION public\.ad_creative_prepare_begin[\s\S]+TO service_role/i,
  );
  // The 9-arg identity is preserved exactly.
  assertStringIncludes(sql, "p_now timestamptz DEFAULT clock_timestamp()");
});

Deno.test("ISSUE-997 D1 migration is additive — no table/column/constraint/index DDL on ad_creative_platform_refs", () => {
  assertEquals(sql.includes("ALTER TABLE"), false);
  assertEquals(sql.includes("CREATE TABLE"), false);
  assertEquals(sql.includes("ADD COLUMN"), false);
  assertEquals(sql.includes("ADD CONSTRAINT"), false);
  assertEquals(sql.includes("CREATE INDEX"), false);
  assertEquals(sql.includes("DROP CONSTRAINT"), false);
});

Deno.test("ISSUE-997 D1 migration self-verify DO block is read-only and asserts the full contract", () => {
  // Isolate the self-verify block — the RPC body itself legitimately INSERTs/UPDATEs
  // ad_creative_platform_refs (the #1184 state machine, byte-identical here); the
  // read-only assertion is about the VERIFY block only.
  const verifyMatch = sql.match(/DO \$verify\$([\s\S]*?)\$verify\$;/);
  assert(verifyMatch, "a DO $verify$ self-check block must be present");
  const verify = verifyMatch![1];
  // Read-only: no write DML inside the verify block (contrast #1184's probe which
  // inserts+rolls back — D1 asserts against the empty live tables, zero rows written).
  assertEquals(/\bINSERT\b/i.test(verify), false);
  assertEquals(/\bUPDATE\b/i.test(verify), false);
  assertEquals(/\bDELETE\b/i.test(verify), false);
  // google present + meta/snap/tiktok intact + secdef/owner/search_path + privileges.
  assertStringIncludes(
    sql,
    "google not present in ad_creative_prepare_begin platform guard",
  );
  assertStringIncludes(sql, "meta/snapchat/tiktok missing");
  assertStringIncludes(sql, "prepare RPC security contract regressed");
  assertStringIncludes(sql, "prepare RPC privileges regressed");
  assertStringIncludes(sql, "has_function_privilege('anon'");
  assertStringIncludes(sql, "has_function_privilege('authenticated'");
  assertStringIncludes(sql, "has_function_privilege('service_role'");
  assertStringIncludes(sql, "pg_get_userbyid(p.proowner) = 'postgres'");
  // 866 base-table CHECKs already list google + video — asserted, never altered.
  assertStringIncludes(sql, "platform CHECK missing google");
  assertStringIncludes(sql, "external_kind CHECK missing video");
});
