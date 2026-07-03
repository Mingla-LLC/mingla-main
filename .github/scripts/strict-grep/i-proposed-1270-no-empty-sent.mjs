#!/usr/bin/env node
/**
 * ORCH-1270 — I-PROPOSED-1270-NO-EMPTY-SENT (DRAFT until CLOSE).
 *
 * Rule: a campaign is NEVER status='sent' with recipient_count=0. The serve loop
 * must call the mkt_finalize_campaign RPC (which only sets 'sent' when
 * delivered>0 OR preview_skipped>0) and must NOT inline-UPDATE the campaign to
 * status='sent' in the success path.
 *
 * Scans BOTH:
 *   - supabase/functions/marketing-send/index.ts (comments stripped): must call
 *     mkt_finalize_campaign AND must NOT inline-UPDATE marketing_campaigns to
 *     status:"sent".
 *   - supabase/migrations/20261203000000_orch_1270_sms_quiet_hours_defer.sql:
 *     the finalizer function + its ordered branch tokens must exist.
 *
 * Mirrors the modular gate pattern (sibling: i-proposed-1161-sms-from-approved-sender-and-kill-switch.mjs).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const EDGE = "supabase/functions/marketing-send/index.ts";
const MIG = "supabase/migrations/20261203000000_orch_1270_sms_quiet_hours_defer.sql";

const stripLineComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const stripSqlComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--.*$/gm, "");

const evaluateEdge = (rawCode) => {
  const code = stripLineComments(rawCode);
  const failures = [];
  if (!/mkt_finalize_campaign/.test(code)) {
    failures.push(
      `${EDGE}: the serve loop must call the mkt_finalize_campaign RPC for honest campaign status. I-PROPOSED-1270-NO-EMPTY-SENT.`,
    );
  }
  // The old RC-2 defect: an inline campaign UPDATE forcing status:'sent'. Match a
  // marketing_campaigns .update({...status:"sent"...}) within a bounded window.
  if (/marketing_campaigns[\s\S]{0,160}status:\s*["']sent["']/.test(code)) {
    failures.push(
      `${EDGE}: must NOT inline-UPDATE marketing_campaigns to status:"sent" — the finalizer owns campaign status (never sent with 0 delivered). I-PROPOSED-1270-NO-EMPTY-SENT.`,
    );
  }
  return failures;
};

const evaluateMig = (rawSql) => {
  const sql = stripSqlComments(rawSql);
  const failures = [];
  if (!/CREATE OR REPLACE FUNCTION\s+public\.mkt_finalize_campaign\s*\(\s*p_campaign_id\s+uuid\s*\)/i.test(sql)) {
    failures.push(
      `${MIG}: mkt_finalize_campaign(p_campaign_id uuid) definition missing. I-PROPOSED-1270-NO-EMPTY-SENT.`,
    );
  }
  // Ordered branch tokens: deferred→scheduled, delivered/preview→sent, else failed.
  const branchTokens = [
    /v_deferred\s*>\s*0/i,
    /status\s*=\s*'scheduled'/i,
    /v_delivered\s*>\s*0/i,
    /v_preview\s*>\s*0/i,
    /status\s*=\s*'sent'/i,
    /status\s*=\s*'failed'/i,
  ];
  for (const t of branchTokens) {
    if (!t.test(sql)) {
      failures.push(
        `${MIG}: finalizer is missing an ordered-branch token matching ${t}. I-PROPOSED-1270-NO-EMPTY-SENT.`,
      );
    }
  }
  return failures;
};

const SELF_TEST = process.argv.includes("--self-test");
if (SELF_TEST) {
  const EDGE_GOOD = `
    const { error } = await supabase.rpc("mkt_finalize_campaign", { p_campaign_id: c.id });
    results.push({ campaign_id: c.id, status: "succeeded" });
  `;
  const EDGE_BAD = `
    await supabase.from("marketing_campaigns").update({
      status: "sent", sent_at: new Date().toISOString(), recipient_count: outcome.recipients,
    }).eq("id", c.id);
  `;
  const MIG_GOOD = `
    CREATE OR REPLACE FUNCTION public.mkt_finalize_campaign(p_campaign_id uuid) RETURNS text AS $$
    BEGIN
      IF v_deferred > 0 THEN UPDATE t SET status = 'scheduled';
      ELSIF v_delivered > 0 THEN UPDATE t SET status = 'sent';
      ELSIF v_preview > 0 THEN UPDATE t SET status = 'sent';
      ELSE UPDATE t SET status = 'failed';
      END IF;
    END; $$;
  `;
  const MIG_BAD = `CREATE INDEX foo ON bar (x);`;
  const eg = evaluateEdge(EDGE_GOOD), eb = evaluateEdge(EDGE_BAD);
  const mg = evaluateMig(MIG_GOOD), mb = evaluateMig(MIG_BAD);
  const ok = eg.length === 0 && eb.length >= 1 && mg.length === 0 && mb.length >= 1;
  if (!ok) {
    console.error("ORCH-1270 no-empty-sent SELF-TEST failed:", { eg, eb, mg, mb });
    process.exit(1);
  }
  console.log("ORCH-1270 no-empty-sent gate self-test passed.");
  process.exit(0);
}

const root = process.cwd().endsWith("mingla-business")
  ? join(process.cwd(), "..")
  : process.cwd();
const failures = [];
const edgeAbs = join(root, EDGE);
const migAbs = join(root, MIG);
if (!existsSync(edgeAbs)) failures.push(`${EDGE}: not found.`);
else failures.push(...evaluateEdge(readFileSync(edgeAbs, "utf8")));
if (!existsSync(migAbs)) failures.push(`${MIG}: migration not found.`);
else failures.push(...evaluateMig(readFileSync(migAbs, "utf8")));

if (failures.length > 0) {
  console.error("ORCH-1270 no-empty-sent gate FAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("ORCH-1270 no-empty-sent gate passed.");
