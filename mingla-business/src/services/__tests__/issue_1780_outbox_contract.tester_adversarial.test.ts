/**
 * #1780 tester-owned adversarial guard for the locked §6/§8 outbox boundary.
 * The durable job is metadata-only. Delivery payload/candidate/group truth stays
 * in the canonical #1770 rail and a committed group is recovered by the stable
 * outbox id used as that rail's client_request_id.
 */

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const migration = fs.readFileSync(path.join(
  root,"../supabase/migrations/20270712001780_issue_1780_wizard_invite_plans.sql", // [TEST-MOD-APPROVED #1780] renumbered above the merge train
),"utf8");
const worker = fs.readFileSync(path.join(
  root,"../supabase/functions/offering-invite-dispatch/index.ts",
),"utf8");

const stripComments = (value: string): string => value
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/--.*$/gm, "")
  .replace(/\/\/.*$/gm, "");

const sql = stripComments(migration);
const edge = stripComments(worker);

function block(start: RegExp, end: RegExp): string {
  const startMatch = start.exec(sql);
  if (!startMatch?.index && startMatch?.index !== 0) return "";
  const rest = sql.slice(startMatch.index + startMatch[0].length);
  const endMatch = end.exec(rest);
  return sql.slice(
    startMatch.index,
    endMatch ? startMatch.index + startMatch[0].length + endMatch.index : sql.length,
  );
}

describe("#1780 metadata-only canonical outbox", () => {
  test("the exact private outbox owns the complete operation identity", () => {
    expect(sql).toMatch(/CREATE\s+TABLE\s+private\.brand_offering_invite_outbox\s*\(/i);
    expect(sql).not.toMatch(/CREATE\s+TABLE\s+private\.brand_offering_invite_publish_outbox\s*\(/i);
    const table = block(
      /CREATE\s+TABLE\s+private\.brand_offering_invite_outbox\s*\(/i,
      /CREATE\s+(?:TABLE|INDEX|OR\s+REPLACE\s+FUNCTION)|ALTER\s+TABLE/i,
    );
    for (const column of [
      "id","plan_id","brand_id","event_id","event_type","selection_revision",
      "operation_key","state","attempt_count","next_attempt_at","lease_token",
      "lease_expires_at","sealed_selection_id","last_error_code","created_at",
      "updated_at","completed_at",
    ]) {
      expect(table).toMatch(new RegExp(`\\b${column}\\b`,"i"));
    }
    expect(table).toMatch(/UNIQUE\s*\(\s*event_id\s*,\s*selection_revision\s*\)/i);
    expect(table).toMatch(/operation_key[\s\S]{0,100}(?:UNIQUE|unique)/i);
    expect(table).not.toMatch(
      /execution_snapshot|send_group|group_id|recipient|destination|provider|payload|message|email|phone|brand_person_ids|person_ids/i,
    );
  });

  test("enqueue derives the exact immutable operation key and seals one revision", () => {
    const enqueue = block(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+private\.enqueue_wizard_invites_on_publish_v1\s*\(/i,
      /CREATE\s+OR\s+REPLACE\s+FUNCTION/i,
    );
    expect(enqueue).toMatch(/brand_offering_invite_outbox/i);
    expect(enqueue).toMatch(/wizard:v1:/i);
    expect(enqueue).toMatch(/event_type[\s\S]{0,180}event_id[\s\S]{0,180}selection_revision/i);
    expect(enqueue).toMatch(/ON\s+CONFLICT/i);
    expect(enqueue).not.toMatch(/execution_snapshot|send_group_id|provider|destination|message/i);
  });

  test("claim/retry uses canonical due and lease columns with dispatch-off before mutation", () => {
    const claim = block(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.issue_1780_claim_wizard_invite_outbox_v1\s*\(/i,
      /CREATE\s+OR\s+REPLACE\s+FUNCTION/i,
    );
    expect(claim).toMatch(/business_wizard_invite_dispatch_v1/i);
    expect(claim).toMatch(/next_attempt_at/i);
    expect(claim).toMatch(/lease_expires_at/i);
    expect(claim).toMatch(/FOR\s+UPDATE\s+SKIP\s+LOCKED/i);
    expect(claim).not.toMatch(/execution_snapshot|send_group_id/i);
  });

  test("resume derives the canonical #1770 group from outbox-id client_request_id", () => {
    const executionSurface = `${sql}\n${edge}`;
    expect(executionSurface).toMatch(
      /marketing_send_groups[\s\S]{0,700}client_request_id[\s\S]{0,300}(?:outbox|job)[_A-Za-z]*id|(?:outbox|job)[_A-Za-z]*id[\s\S]{0,300}client_request_id[\s\S]{0,700}marketing_send_groups/i,
    );
    expect(edge).not.toMatch(/job\.executionSnapshot|job\.sendGroupId/i);
  });

  test("worker execution accepts identifiers only, never a caller-built delivery snapshot", () => {
    const signatures = [...sql.matchAll(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+(?:public|private)\.(issue_1780_[a-z0-9_]*outbox[a-z0-9_]*|execute_brand_offering_invite_wizard_v1)\s*\(([\s\S]*?)\)\s*RETURNS/gi,
    )];
    expect(signatures.length).toBeGreaterThan(0);
    for (const signature of signatures) {
      if (!/(?:execute|complete)/i.test(signature[1])) continue;
      expect(signature[2]).not.toMatch(/jsonb|snapshot|brand_person|channel|destination|provider|cost|message|origin/i);
    }
  });
});
