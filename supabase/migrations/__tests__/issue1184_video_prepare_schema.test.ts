// ISSUE-1184 implementor schema regression — static, zero DB/provider writes.
import {
  assert,
  assertEquals,
  assertMatch,
  assertStringIncludes,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

const migrationUrl = new URL(
  "../20270111001184_issue_1184_video_prepare_lifecycle.sql",
  import.meta.url,
);
const sql = await Deno.readTextFile(migrationUrl);

Deno.test("ISSUE-1184 migration owns the exact lifecycle schema", () => {
  for (
    const token of [
      "poster_content_hash",
      "attempt_id",
      "attempt_count",
      "attempt_started_at",
      "provider_ref_recorded_at",
      "last_checked_at",
      "deadline_at",
      "error_code",
      "retryable",
      "trace_id",
      "provider_terminal_attempt_id",
      "provider_terminal_at",
      "provider_terminal_code",
      "creative_ref_id",
    ]
  ) assertStringIncludes(sql, token);
  for (
    const status of [
      "pending",
      "uploading",
      "processing",
      "ready",
      "failed",
      "timed_out",
    ]
  ) {
    assertStringIncludes(sql, `'${status}'`);
  }
});

Deno.test("ISSUE-1184 RPC is service-role-only SECURITY DEFINER", () => {
  assertMatch(
    sql,
    /CREATE OR REPLACE FUNCTION public\.ad_creative_prepare_begin\s*\(/,
  );
  assertMatch(
    sql,
    /LANGUAGE plpgsql\s+SECURITY DEFINER\s+SET search_path = public, pg_temp/i,
  );
  assertStringIncludes(sql, "ALTER FUNCTION public.ad_creative_prepare_begin");
  assertMatch(
    sql,
    /REVOKE EXECUTE ON FUNCTION public\.ad_creative_prepare_begin[\s\S]+FROM PUBLIC, anon, authenticated/i,
  );
  assertMatch(
    sql,
    /GRANT EXECUTE ON FUNCTION public\.ad_creative_prepare_begin[\s\S]+TO service_role/i,
  );
  assertStringIncludes(sql, "pg_get_userbyid(p.proowner) = 'postgres'");
  assertStringIncludes(sql, "NOT relrowsecurity");
});

Deno.test("ISSUE-1184 stale reload is audit payload, never an action value", () => {
  const actionAdds = [...sql.matchAll(/action\s*=\s*'stale_attempt_reload'/g)];
  assertEquals(actionAdds.length, 0);
  assertStringIncludes(sql, "'stale_attempt_reload'");
  assertStringIncludes(sql, "'prepare_check'");
  assertMatch(sql, /reject[\s\S]{0,300}stale_attempt_reload/i);
});

Deno.test("ISSUE-1184 migration keeps unique identity and terminal proof all-or-none", () => {
  assertStringIncludes(sql, "ad_creative_platform_refs_uniq");
  assertMatch(
    sql,
    /provider_terminal_attempt_id IS NULL[\s\S]+provider_terminal_at IS NULL[\s\S]+provider_terminal_code IS NULL/,
  );
  assertMatch(
    sql,
    /provider_terminal_attempt_id IS NOT NULL[\s\S]+provider_terminal_at IS NOT NULL[\s\S]+provider_terminal_code IS NOT NULL/,
  );
  assert(sql.includes("FOR UPDATE"));
  assert(
    sql.includes(
      "ON CONFLICT ON CONSTRAINT ad_creative_platform_refs_uniq DO NOTHING",
    ),
  );
});
