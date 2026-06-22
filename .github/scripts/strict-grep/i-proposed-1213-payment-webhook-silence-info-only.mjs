#!/usr/bin/env node
/**
 * ORCH-1213 [payment webhook-silence is info-only] —
 * I-PROPOSED-1213-PAYMENT-WEBHOOK-SILENCE-INFO-ONLY.
 *
 * WHY: stripe + paystack share the near-empty `payment_webhook_events` table.
 * In a low/zero-traffic env its newest row is routinely >6h old, which the
 * `webhookFreshness(...)` probe used to mark `degraded` with
 * `alert_on_silence=true`. `computeEffectiveStatus` escalated that to a
 * failedTick → 2 ticks → a FALSE "Stripe/Paystack is down" email, even though
 * the synthetic API/auth probes were fully healthy. The fix makes payment
 * webhook-silence INFORMATIONAL only — same class as cloudinary/twilio — by
 * passing `alertOnSilence=false` to BOTH payment `webhookFreshness(...)` calls.
 * The dashboard still records/displays `last_received`; silence never pages.
 * A genuine API/auth/charges outage still pages via the synthetic
 * probeStripe/probePaystack (untouched).
 *
 * RULE (must hold in supabase/functions/api-health-probe/index.ts):
 *   1. BOTH payment webhookFreshness calls MUST pass the boolean `false` as the
 *      4th arg (alertOnSilence):
 *        webhookFreshness("stripe",   "payment_webhook_events", "created_at", false)
 *        webhookFreshness("paystack", "payment_webhook_events", "created_at", false)
 *   2. NO webhookFreshness("stripe"|"paystack", "payment_webhook_events", ..., true)
 *      may exist anywhere in the file (a revert to `true` FAILS the PR).
 *
 * `--self-test` injects synthetic compliant / reverted source and asserts the
 * gate passes on the `false` shape and fires on a `true` revert (and on a
 * missing payment call).
 *
 * Model: orch-1211-notif-web-render-safe.mjs.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const TARGET = "supabase/functions/api-health-probe/index.ts";

// The two payment services that share payment_webhook_events.
const PAYMENT_SERVICES = ["stripe", "paystack"];

/**
 * Strip line + block comments so a webhookFreshness call mentioned in a comment
 * (e.g. the protective ORCH-1213 comment, or this gate's own JSDoc when swept)
 * is not matched. Preserve newlines so line numbers stay accurate.
 */
function stripComments(src) {
  let out = "";
  let i = 0;
  let mode = "code"; // code | line | block | str | tmpl
  let quote = "";
  while (i < src.length) {
    const c = src[i];
    const c2 = src[i + 1];
    if (mode === "code") {
      if (c === "/" && c2 === "/") {
        mode = "line";
        i += 2;
        continue;
      }
      if (c === "/" && c2 === "*") {
        mode = "block";
        out += "  ";
        i += 2;
        continue;
      }
      if (c === '"' || c === "'") {
        mode = "str";
        quote = c;
        out += c;
        i += 1;
        continue;
      }
      if (c === "`") {
        mode = "tmpl";
        out += c;
        i += 1;
        continue;
      }
      out += c;
      i += 1;
      continue;
    }
    if (mode === "line") {
      if (c === "\n") {
        mode = "code";
        out += "\n";
      }
      i += 1;
      continue;
    }
    if (mode === "block") {
      if (c === "*" && c2 === "/") {
        mode = "code";
        out += "  ";
        i += 2;
        continue;
      }
      out += c === "\n" ? "\n" : " ";
      i += 1;
      continue;
    }
    if (mode === "str") {
      out += c;
      if (c === "\\") {
        out += c2 ?? "";
        i += 2;
        continue;
      }
      if (c === quote) mode = "code";
      i += 1;
      continue;
    }
    if (mode === "tmpl") {
      out += c;
      if (c === "\\") {
        out += c2 ?? "";
        i += 2;
        continue;
      }
      if (c === "`") mode = "code";
      i += 1;
      continue;
    }
  }
  return out;
}

/**
 * Build a regex matching a payment webhookFreshness(...) call with the given
 * trailing boolean literal. Tolerant of whitespace; the table arg is pinned to
 * `payment_webhook_events` so cloudinary/twilio (different tables) never match.
 */
function paymentCallRe(service, boolLiteral) {
  return new RegExp(
    `webhookFreshness\\s*\\(\\s*["']${service}["']\\s*,\\s*["']payment_webhook_events["']\\s*,\\s*["'][^"']*["']\\s*,\\s*${boolLiteral}\\s*\\)`,
  );
}

function checkSource(src, failures) {
  const clean = stripComments(src);

  for (const service of PAYMENT_SERVICES) {
    const hasFalse = paymentCallRe(service, "false").test(clean);
    const hasTrue = paymentCallRe(service, "true").test(clean);

    // FAIL-on-revert: a `true` payment call is an outright violation.
    if (hasTrue) {
      failures.push(
        `${TARGET}: webhookFreshness("${service}", "payment_webhook_events", ..., true) ` +
          `is present — payment webhook-silence MUST be INFORMATIONAL only ` +
          `(alertOnSilence=false). Flipping it back to \`true\` re-arms the false ` +
          `"${service} is down" page (ORCH-1213).`,
      );
    }
    // PASS-on-fix: the compliant `false` call must be present.
    if (!hasFalse) {
      failures.push(
        `${TARGET}: missing webhookFreshness("${service}", "payment_webhook_events", ` +
          `"created_at", false) — the info-only payment webhook-silence call must ` +
          `exist with alertOnSilence=false (ORCH-1213).`,
      );
    }
  }
}

// ---- Self-test
if (process.argv.includes("--self-test")) {
  const selfFailures = [];
  const run = (src) => {
    const f = [];
    checkSource(src, f);
    return f;
  };

  // (a) Compliant: both payment calls pass false → MUST pass.
  const good =
    `await webhookFreshness("stripe", "payment_webhook_events", "created_at", false);\n` +
    `await webhookFreshness("paystack", "payment_webhook_events", "created_at", false);\n` +
    `await webhookFreshness("cloudinary", "event_cover_video_jobs", "created_at", false);\n` +
    `await webhookFreshness("twilio", "twilio_message_status_events", "received_at", false);\n`;
  if (run(good).length !== 0) {
    selfFailures.push("compliant (both payment calls false) wrongly flagged");
  }

  // (b) Reverted stripe to true → MUST fire.
  const revertStripe =
    `await webhookFreshness("stripe", "payment_webhook_events", "created_at", true);\n` +
    `await webhookFreshness("paystack", "payment_webhook_events", "created_at", false);\n`;
  if (run(revertStripe).length === 0) {
    selfFailures.push("reverted stripe (...true) not flagged");
  }

  // (c) Reverted paystack to true → MUST fire.
  const revertPaystack =
    `await webhookFreshness("stripe", "payment_webhook_events", "created_at", false);\n` +
    `await webhookFreshness("paystack", "payment_webhook_events", "created_at", true);\n`;
  if (run(revertPaystack).length === 0) {
    selfFailures.push("reverted paystack (...true) not flagged");
  }

  // (d) Missing the paystack payment call entirely → MUST fire (incomplete fix).
  const missingPaystack =
    `await webhookFreshness("stripe", "payment_webhook_events", "created_at", false);\n`;
  if (run(missingPaystack).length === 0) {
    selfFailures.push("missing paystack payment call not flagged");
  }

  // (e) The `true` mention only in a comment → must NOT fire (comments stripped).
  const commentOnly =
    `// old: webhookFreshness("stripe", "payment_webhook_events", "created_at", true);\n` +
    `await webhookFreshness("stripe", "payment_webhook_events", "created_at", false);\n` +
    `await webhookFreshness("paystack", "payment_webhook_events", "created_at", false);\n`;
  if (run(commentOnly).length !== 0) {
    selfFailures.push("`true` mention in a comment wrongly flagged");
  }

  // (f) cloudinary/twilio with a different table do NOT interfere (whitespace-tolerant).
  const spaced =
    `await webhookFreshness( "stripe" , "payment_webhook_events" , "created_at" , false );\n` +
    `await webhookFreshness('paystack','payment_webhook_events','created_at',false);\n`;
  if (run(spaced).length !== 0) {
    selfFailures.push("whitespace/quote-variant compliant calls wrongly flagged");
  }

  if (selfFailures.length) {
    console.error(
      "ORCH-1213 I-PROPOSED-1213-PAYMENT-WEBHOOK-SILENCE-INFO-ONLY self-test FAIL:",
    );
    selfFailures.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log(
    "ORCH-1213 I-PROPOSED-1213-PAYMENT-WEBHOOK-SILENCE-INFO-ONLY self-test PASS (6/6 cases).",
  );
  process.exit(0);
}

// ---- Live mode
const abs = path.join(root, TARGET);
if (!fs.existsSync(abs)) {
  console.error(
    `ORCH-1213 gate FAIL — target not found at ${TARGET} (gate path out of sync with source).`,
  );
  process.exit(1);
}
const failures = [];
checkSource(fs.readFileSync(abs, "utf8"), failures);

if (failures.length > 0) {
  console.error(
    "ORCH-1213 I-PROPOSED-1213-PAYMENT-WEBHOOK-SILENCE-INFO-ONLY FAIL — payment\n" +
      "webhook-silence is no longer info-only. Both stripe + paystack webhookFreshness\n" +
      "calls against payment_webhook_events MUST pass alertOnSilence=false, and NO `true`\n" +
      "variant may exist (it re-arms the false 'down' page).\n\nFailures:\n  " +
      failures.join("\n  "),
  );
  process.exit(1);
}
console.log(
  "ORCH-1213 I-PROPOSED-1213-PAYMENT-WEBHOOK-SILENCE-INFO-ONLY PASS — both payment\n" +
    "webhookFreshness calls pass alertOnSilence=false; no `true` revert present.",
);
