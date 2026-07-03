#!/usr/bin/env node
/**
 * ORCH-1270 — I-PROPOSED-1270-SEND-IDEMPOTENT (DRAFT until CLOSE).
 *
 * Rule: no recipient is ever dispatched twice for one campaign under cron
 * re-invocation. Two structural guarantees must BOTH be present:
 *   (1) the edge fn's in-loop terminal-skip guard (a recipient with an existing
 *       terminal row is skipped: no write, no send), AND the SMS writes are
 *       upserts on the (campaign, phone) unique key, AND
 *   (2) the migration creates the uq_mkt_msg_campaign_phone +
 *       uq_mkt_msg_campaign_email UNIQUE indexes (the last-line structural
 *       anti-double-text backbone).
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
  // Terminal-skip guard: a terminal-status list consulted before dispatch.
  if (!/SMS_TERMINAL_STATUSES/.test(code)) {
    failures.push(
      `${EDGE}: the in-loop terminal-skip guard (SMS_TERMINAL_STATUSES) must exist so a recipient with a terminal row is never re-dispatched. I-PROPOSED-1270-SEND-IDEMPOTENT.`,
    );
  }
  if (!/\.includes\(\s*existing\.status\s*\)/.test(code)) {
    failures.push(
      `${EDGE}: the guard must test the EXISTING row's status against the terminal list (\`.includes(existing.status)\`). I-PROPOSED-1270-SEND-IDEMPOTENT.`,
    );
  }
  // Upsert on the (campaign, phone) unique key.
  if (!/\.upsert\(/.test(code)) {
    failures.push(
      `${EDGE}: SMS marketing_messages writes must use .upsert(...). I-PROPOSED-1270-SEND-IDEMPOTENT.`,
    );
  }
  if (!/onConflict:\s*["']campaign_id,recipient_phone["']/.test(code)) {
    failures.push(
      `${EDGE}: the upsert must target onConflict: "campaign_id,recipient_phone" (the uq_mkt_msg_campaign_phone index). I-PROPOSED-1270-SEND-IDEMPOTENT.`,
    );
  }
  return failures;
};

const evaluateMig = (rawSql) => {
  const sql = stripSqlComments(rawSql);
  const failures = [];
  if (!/CREATE UNIQUE INDEX[\s\S]*?uq_mkt_msg_campaign_phone[\s\S]*?\(\s*campaign_id\s*,\s*recipient_phone\s*\)/i.test(sql)) {
    failures.push(
      `${MIG}: the uq_mkt_msg_campaign_phone UNIQUE index on (campaign_id, recipient_phone) must exist. I-PROPOSED-1270-SEND-IDEMPOTENT.`,
    );
  }
  if (!/CREATE UNIQUE INDEX[\s\S]*?uq_mkt_msg_campaign_email[\s\S]*?\(\s*campaign_id\s*,\s*recipient_email\s*\)/i.test(sql)) {
    failures.push(
      `${MIG}: the uq_mkt_msg_campaign_email UNIQUE index on (campaign_id, recipient_email) must exist. I-PROPOSED-1270-SEND-IDEMPOTENT.`,
    );
  }
  return failures;
};

const SELF_TEST = process.argv.includes("--self-test");
if (SELF_TEST) {
  const EDGE_GOOD = `
    if (existing !== null && (SMS_TERMINAL_STATUSES).includes(existing.status)) { continue; }
    await supabase.from("marketing_messages").upsert(
      { campaign_id: c.id, recipient_phone: phone, channel: "sms", status: "queued" },
      { onConflict: "campaign_id,recipient_phone" },
    );
  `;
  // BAD_A: guard removed.
  const EDGE_BAD_A = `
    await supabase.from("marketing_messages").upsert(
      { campaign_id: c.id, recipient_phone: phone, status: "queued" },
      { onConflict: "campaign_id,recipient_phone" },
    );
  `;
  // BAD_B: reverted to plain insert (no upsert / onConflict).
  const EDGE_BAD_B = `
    if (existing !== null && (SMS_TERMINAL_STATUSES).includes(existing.status)) { continue; }
    await supabase.from("marketing_messages").insert({ campaign_id: c.id, status: "queued" });
  `;
  const MIG_GOOD = `
    CREATE UNIQUE INDEX IF NOT EXISTS uq_mkt_msg_campaign_phone ON public.marketing_messages (campaign_id, recipient_phone);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_mkt_msg_campaign_email ON public.marketing_messages (campaign_id, recipient_email);
  `;
  const MIG_BAD = `CREATE INDEX idx_foo ON public.marketing_messages (campaign_id);`;
  const eg = evaluateEdge(EDGE_GOOD), ea = evaluateEdge(EDGE_BAD_A), eb = evaluateEdge(EDGE_BAD_B);
  const mg = evaluateMig(MIG_GOOD), mb = evaluateMig(MIG_BAD);
  const ok = eg.length === 0 && ea.length >= 1 && eb.length >= 1 && mg.length === 0 && mb.length >= 1;
  if (!ok) {
    console.error("ORCH-1270 send-idempotent SELF-TEST failed:", { eg, ea, eb, mg, mb });
    process.exit(1);
  }
  console.log("ORCH-1270 send-idempotent gate self-test passed.");
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
  console.error("ORCH-1270 send-idempotent gate FAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("ORCH-1270 send-idempotent gate passed.");
