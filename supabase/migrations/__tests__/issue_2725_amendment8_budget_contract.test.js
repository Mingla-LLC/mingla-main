import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const coreSql=fs.readFileSync(new URL("../20270606002725_issue_2725_competitor_intelligence.sql",import.meta.url),"utf8");
const sql=fs.readFileSync(new URL("../20270606002726_issue_2725_amendment_8_budget.sql",import.meta.url),"utf8");
const worker=fs.readFileSync(new URL("../../functions/competitor-intel-worker/index.ts",import.meta.url),"utf8");

test("issue 2725 amendment 8 serializes one hard venue/week dollar",()=>{
  for(const needle of ["PRIMARY KEY(venue_listing_id,iso_week)","FOR UPDATE","used+p_amount>1000000","p_amount<>50000","measurement_failed"]) assert.ok(sql.includes(needle),needle);
  assert.ok(!/funding_lane\s*=\s*'manual'.*RETURN NULL/is.test(sql));
  assert.ok(!worker.includes('if (job.funding_lane === "scheduled")'));
});

test("issue 2725 amendment 8 meters deterministic bounded model calls",()=>{
  for(const needle of ["responseJsonSchema","PROMPT_CONTRACT_VERSION","canonical_input_fingerprint","usage_metadata_missing","usage_receipt_write_failed","model_response_invalid","issue_2725_record_model_usage"]) assert.ok(worker.includes(needle),needle);
  for(const needle of ["p_safe_error='model_usage_missing'","THEN 'measurement_failed'","THEN NULL ELSE 0 END"]) assert.ok(coreSql.includes(needle),needle);
  for(const pattern of [/additionalProperties:\s*false/,/temperature:\s*0/,/thinkingBudget:\s*0/,/candidateCount:\s*1/,/maxOutputTokens:\s*MAX_SYNTHESIS_OUTPUT_TOKENS/]) assert.match(worker,pattern);
  assert.match(worker,/Math\.ceil\(prompt\s*\*\s*0\.3\s*\+\s*\(candidate\s*\+\s*thinking\)\s*\*\s*2\.5\)/);
});

test("issue 2725 amendment 8 makes accepted reuse first-writer-wins and keeps ops redacted",()=>{
  for(const needle of ["UNIQUE(competitor_id,model_id,prompt_contract_version,canonical_input_fingerprint)","ON CONFLICT DO NOTHING","weekly_reserved_cents","weekly_actual_cents","weekly_remaining_cents"]) assert.ok(sql.includes(needle),needle);
  for(const forbidden of ["raw_prompt","prompt_content","response_body"]) assert.ok(!sql.includes(forbidden),forbidden);
});
