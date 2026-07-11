#!/usr/bin/env node
/**
 * ORCH-1331 — I-PROPOSED-1331-PARTNER-SPLIT-FAIL-SOFT (DRAFT until CLOSE).
 *
 * Rule (constitutional): the partner-split machinery can NEVER fail, delay, or
 * alter the ack of a ticket checkout, an order finalize, or the charge.success
 * webhook. In supabase/functions/paystack-webhook/index.ts the
 * `handlePaystackPartnerSplit` fan-out call MUST:
 *   1. exist (the rail is wired),
 *   2. sit inside a DEDICATED try/catch whose catch ONLY logs — it must not
 *      assign `processingError`, and must not `throw`,
 *   3. run strictly AFTER `dispatchTicketConfirmation` (buyer confirmation
 *      always wins the ordering).
 *
 * Reverting the try/catch (or moving the fan-out ahead of the confirmation
 * dispatch, or letting the catch write processingError) = RED.
 *
 * Mirrors the modular self-testing gate pattern (sibling:
 * orch-1333-in-chunk-bounded.mjs).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const TARGET = "supabase/functions/paystack-webhook/index.ts";

const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

const evaluate = (rawCode) => {
  const code = stripComments(rawCode);
  const failures = [];

  // 1. The fan-out call site exists (import mentions don't count).
  const callRe = /await\s+handlePaystackPartnerSplit\s*\(/;
  const callMatch = code.match(callRe);
  if (!callMatch) {
    failures.push(
      `${TARGET}: no \`await handlePaystackPartnerSplit(\` call site — the partner-split fan-out is unwired. I-PROPOSED-1331-PARTNER-SPLIT-FAIL-SOFT.`,
    );
    return failures; // nothing more to check
  }

  // 2. The call sits inside a dedicated catch-and-log block:
  //    try { … await handlePaystackPartnerSplit(…) … } catch (e) { <log-only> }
  const wrapRe =
    /try\s*\{[^{}]*await\s+handlePaystackPartnerSplit\s*\([\s\S]*?\)\s*;?[^{}]*\}\s*catch\s*\([^)]*\)\s*\{([\s\S]*?)\}/;
  const wrap = code.match(wrapRe);
  if (!wrap) {
    failures.push(
      `${TARGET}: the handlePaystackPartnerSplit call is NOT inside its own try/catch — a split failure would fail the charge.success webhook (breaks ticketing). I-PROPOSED-1331-PARTNER-SPLIT-FAIL-SOFT.`,
    );
  } else {
    const catchBody = wrap[1];
    if (!/console\.(error|warn)\s*\(/.test(catchBody)) {
      failures.push(
        `${TARGET}: the split fan-out catch does not log — silent failure (Const #3). I-PROPOSED-1331-PARTNER-SPLIT-FAIL-SOFT.`,
      );
    }
    if (/processingError\s*=/.test(catchBody)) {
      failures.push(
        `${TARGET}: the split fan-out catch assigns processingError — the split failure would poison the webhook ack/inbox. I-PROPOSED-1331-PARTNER-SPLIT-FAIL-SOFT.`,
      );
    }
    if (/\bthrow\b/.test(catchBody)) {
      failures.push(
        `${TARGET}: the split fan-out catch rethrows — the failure would escape into the handler. I-PROPOSED-1331-PARTNER-SPLIT-FAIL-SOFT.`,
      );
    }
  }

  // 3. Ordering — the fan-out call must come AFTER dispatchTicketConfirmation.
  const dispatchIdx = code.search(/await\s+dispatchTicketConfirmation\s*\(/);
  const splitIdx = code.search(callRe);
  if (dispatchIdx < 0) {
    failures.push(
      `${TARGET}: dispatchTicketConfirmation call site not found — webhook shape changed; re-verify the fail-soft ordering contract. I-PROPOSED-1331-PARTNER-SPLIT-FAIL-SOFT.`,
    );
  } else if (splitIdx < dispatchIdx) {
    failures.push(
      `${TARGET}: handlePaystackPartnerSplit runs BEFORE dispatchTicketConfirmation — the split may never delay the buyer confirmation. I-PROPOSED-1331-PARTNER-SPLIT-FAIL-SOFT.`,
    );
  }

  return failures;
};

const SELF_TEST = process.argv.includes("--self-test");
if (SELF_TEST) {
  // GOOD — mirrors the shipped shape.
  const GOOD = `
    if (finalizedOrderId) {
      await dispatchTicketConfirmation(finalizedOrderId);
    }
    if (splitFanOut) {
      try {
        await handlePaystackPartnerSplit(supabase, splitFanOut);
      } catch (splitErr) {
        console.error("[paystack-webhook] partner split fan-out failed (non-fatal)", splitErr);
      }
    }
  `;
  // BAD-1 — try/catch deleted (bare call).
  const BAD_BARE = `
    if (finalizedOrderId) {
      await dispatchTicketConfirmation(finalizedOrderId);
    }
    if (splitFanOut) {
      await handlePaystackPartnerSplit(supabase, splitFanOut);
    }
  `;
  // BAD-2 — catch poisons processingError.
  const BAD_POISON = `
    await dispatchTicketConfirmation(finalizedOrderId);
    try {
      await handlePaystackPartnerSplit(supabase, splitFanOut);
    } catch (splitErr) {
      console.error("boom", splitErr);
      processingError = String(splitErr);
    }
  `;
  // BAD-3 — catch rethrows.
  const BAD_RETHROW = `
    await dispatchTicketConfirmation(finalizedOrderId);
    try {
      await handlePaystackPartnerSplit(supabase, splitFanOut);
    } catch (splitErr) {
      console.error("boom", splitErr);
      throw splitErr;
    }
  `;
  // BAD-4 — fan-out moved AHEAD of the confirmation dispatch.
  const BAD_ORDER = `
    try {
      await handlePaystackPartnerSplit(supabase, splitFanOut);
    } catch (splitErr) {
      console.error("boom", splitErr);
    }
    await dispatchTicketConfirmation(finalizedOrderId);
  `;
  // BAD-5 — call removed entirely (rail unwired).
  const BAD_UNWIRED = `
    await dispatchTicketConfirmation(finalizedOrderId);
  `;
  const g = evaluate(GOOD);
  const b1 = evaluate(BAD_BARE);
  const b2 = evaluate(BAD_POISON);
  const b3 = evaluate(BAD_RETHROW);
  const b4 = evaluate(BAD_ORDER);
  const b5 = evaluate(BAD_UNWIRED);
  const ok = g.length === 0 && b1.length >= 1 && b2.length >= 1 &&
    b3.length >= 1 && b4.length >= 1 && b5.length >= 1;
  if (!ok) {
    console.error("ORCH-1331 partner-split-fail-soft SELF-TEST failed:", {
      g,
      b1,
      b2,
      b3,
      b4,
      b5,
    });
    process.exit(1);
  }
  console.log("ORCH-1331 partner-split-fail-soft gate self-test passed (5/5 BAD shapes rejected).");
  process.exit(0);
}

const root = process.cwd().endsWith("mingla-business")
  ? join(process.cwd(), "..")
  : process.cwd();
const abs = join(root, TARGET);
const failures = [];
if (!existsSync(abs)) failures.push(`${TARGET}: not found.`);
else failures.push(...evaluate(readFileSync(abs, "utf8")));

if (failures.length > 0) {
  console.error("ORCH-1331 partner-split-fail-soft gate FAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("ORCH-1331 partner-split-fail-soft gate passed.");
