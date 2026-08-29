const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { test } = require("node:test");

const sql = fs.readFileSync(path.resolve(__dirname, "../20270608002796_issue_2796_competitor_decision_report_v3.sql"), "utf8");
test("issue 2796 migration is additive, exact, service-role-only and preserves v2", () => {
  for (const expected of [
    "ADD COLUMN IF NOT EXISTS decision_report jsonb",
    "issue_2796_valid_decision_report",
    "schema_version IN (2,3)",
    "schema_version=2 AND decision_report IS NULL",
    "schema_version=3 AND public.issue_2796_valid_decision_report",
    "REVOKE ALL ON FUNCTION public.issue_2796_valid_decision_report",
    "TO service_role",
    "payload_schema NOT IN (2,3)",
  ]) assert.ok(sql.includes(expected), expected);
  assert.ok(!/UPDATE public\.tool_competitor_briefs SET schema_version=3/.test(sql));
  assert.equal(
    (sql.match(/RETURN jsonb_build_object\('applied',true,'state',terminal_state,'brief_id',brief_id\);/g) ?? []).length,
    1,
    "finish-job RPC must have exactly one terminal success return",
  );
});
