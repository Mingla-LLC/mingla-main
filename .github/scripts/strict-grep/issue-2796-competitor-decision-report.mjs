import fs from "node:fs";
import assert from "node:assert/strict";

const read = (path) => fs.readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20270608002796_issue_2796_competitor_decision_report_v3.sql");
const worker = read("supabase/functions/competitor-intel-worker/index.ts");
const report = read("supabase/functions/growth-tools-report/index.ts");
const service = read("mingla-business/src/services/competitorIntelligenceService.ts");
const brief = read("mingla-business/src/components/venue/insights/CompetitorBriefSheet.tsx");
const add = read("mingla-business/src/components/venue/insights/CompetitorAddSheet.tsx");
const tokens = read("mingla-business/src/constants/designSystem.ts");
const legacyJourney = read("mingla-business/src/components/venue/insights/__tests__/competitorIntelligence.liveJourney.issue2725.rework.test.tsx");
const legacyHappy = read("mingla-business/src/components/venue/insights/__tests__/competitorIntelligence.issue2725.happy.test.ts");

for (const [source, values] of [
  [migration, ["issue_2796_valid_decision_report", "schema_version IN (2,3)", "decision_report"]],
  [worker, ["competitor-brief-v3.3", "MAX_SYNTHESIS_REQUEST_BYTES = 65_536", "MAX_SYNTHESIS_OUTPUT_TOKENS = 1_200", "RESERVED_MICROUSD = 50_000", "groundedThemeSignals", "groundedDecisionComparisons", "groundedDecisionBindings", "primaryActionFirst", "validateDecisionReport"]],
  [report, ["max_schema_version", "wantsV3", "decision_report"]],
  [service, ["max_schema_version: 3", "authorizedEvidence", "schemaVersion: 3"]],
  [tokens, ["contentInsetCompact: 16", "contentInsetRegular: 24", "contentInsetWide: 32", "readableCopyMaxWidth: 600"]],
]) for (const value of values) assert.ok(source.includes(value), value);
assert.ok(brief.includes("Evidence ·"));
for (const forbidden of ["SOURCE EVIDENCE", "Open source evidence", "View evidence"]) assert.ok(!brief.includes(forbidden), forbidden);
for (const forbidden of ["legacyUntypedFixture", "as unknown as View", "{ paddingHorizontal: inset }"]) assert.ok(!brief.includes(forbidden), forbidden);
assert.ok(brief.includes("const data = normalizeBriefSchema(query.data);"));
assert.ok(brief.includes("androidOpaque.rowBorder"));
assert.ok(!add.includes('label="Cancel"'));
assert.ok(add.includes("Enter details manually"));
assert.ok(!add.includes("{ paddingHorizontal: contentInset }"));
assert.ok(add.includes("panelBackground={competition.surface}"));
for (const forbidden of ["sort((left: Record<string, any>", "event: Record<string, any>"]) assert.ok(!worker.includes(forbidden), forbidden);
for (const expected of ["competitor-signal-f1-evidence", "competitor-brief-primary-action-a1", "competitor-brief-secondary-action-a2"]) assert.ok(legacyJourney.includes(expected), expected);
for (const expected of ["CURRENT PUBLIC SIGNALS", "competitor-signal-f1-evidence"]) assert.ok(legacyHappy.includes(expected), expected);
console.log("issue 2796 competitor decision report gate: PASS");
