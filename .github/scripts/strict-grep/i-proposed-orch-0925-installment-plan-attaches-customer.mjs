#!/usr/bin/env node
/**
 * I-PROPOSED-ORCH-0925-INSTALLMENT-PLAN-ATTACHES-CUSTOMER strict-grep gate.
 *
 * ORCH-0925: every Stripe Checkout Session OR raw PaymentIntent created
 * under supabase/functions/ that sets `setup_future_usage: "off_session"`
 * guarded by `isInstallmentPlan` MUST also attach a Customer:
 *   - Checkout Session: `customer_creation: "always"` within the same
 *     payload (also `isInstallmentPlan`-guarded).
 *   - PaymentIntent: `customer: customerId` (or `customer: <varname>`)
 *     within the same payload (also `isInstallmentPlan`-guarded).
 *
 * Without this attachment, Stripe saves the PM in an "orphan" state with
 * no Customer attached, and the cron `process-scheduled-installments`
 * cannot charge off-session via `{customer, payment_method}`. Revenue
 * silently leaks. See INVESTIGATION_ORCH-0925_TICKET_CHECKOUT_CREATE_NO_
 * CUSTOMER_ATTACHED.md for the full proof.
 *
 * Self-test mode (`--self-test`): synthesizes positive + negative fixtures
 * in a tmp dir and asserts the script flags the negative + passes the
 * positive.
 */

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..", "..", "..");

function argValue(name) {
  const idx = process.argv.indexOf(name);
  return idx === -1 ? null : process.argv[idx + 1] ?? null;
}

const SELF_TEST = process.argv.includes("--self-test");
const requestedScanDir = argValue("--scan-dir");
const DEFAULT_SCAN_DIR = join(REPO_ROOT, "supabase", "functions");

const SFU_OFF_SESSION_RE = /setup_future_usage\s*:\s*["']off_session["']/;
const IS_INSTALLMENT_RE = /\bisInstallmentPlan\b/;
const CHECKOUT_SESSION_CREATE_RE = /\b(?:stripe|stripeWeb|stripeForCustomer)\.checkout\.sessions\.create\s*\(/g;
const PI_CREATE_RE = /\b(?:stripe|stripeWeb|stripeForCustomer)\.paymentIntents\.create\s*\(/g;
const CUSTOMER_CREATION_ALWAYS_RE =
  /customer_creation\s*:\s*["']always["']/;
const CUSTOMER_ATTACH_RE = /\bcustomer\s*:\s*[A-Za-z_][\w]*\b/;
const ALLOWLIST_TAG = "orch-strict-grep-allow orch-0925-installment-customer-attached";
const CALL_CONTEXT_LINES = 30;
const ALLOWLIST_CONTEXT_LINES = 5;

function* walkTs(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch (err) {
    console.error(
      `[i-proposed-orch-0925-installment-plan-attaches-customer] filesystem error: cannot read ${dir} - ${err.message}`,
    );
    process.exit(2);
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry.startsWith(".") || entry === "__tests__") continue;
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch (err) {
      console.error(
        `[i-proposed-orch-0925-installment-plan-attaches-customer] filesystem error: cannot stat ${full} - ${err.message}`,
      );
      process.exit(2);
    }
    if (st.isDirectory()) {
      yield* walkTs(full);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) {
      yield full;
    }
  }
}

function scanDir(scanDir) {
  let filesScanned = 0;
  let checkoutSessionCallers = 0;
  let piCallers = 0;
  let violations = 0;
  const violationDetails = [];

  for (const file of walkTs(scanDir)) {
    filesScanned += 1;
    let source;
    try {
      source = readFileSync(file, "utf8");
    } catch (err) {
      console.error(
        `[i-proposed-orch-0925-installment-plan-attaches-customer] filesystem error: cannot read ${file} - ${err.message}`,
      );
      process.exit(2);
    }
    const lines = source.split("\n");

    // Rule 1: Checkout Session create calls.
    for (const match of source.matchAll(CHECKOUT_SESSION_CREATE_RE)) {
      checkoutSessionCallers += 1;
      const lineIdx = source.slice(0, match.index ?? 0).split("\n").length - 1;
      const callEnd = Math.min(lines.length, lineIdx + CALL_CONTEXT_LINES);
      const callContext = lines.slice(lineIdx, callEnd).join("\n");
      const needsCustomer =
        SFU_OFF_SESSION_RE.test(callContext) && IS_INSTALLMENT_RE.test(callContext);
      if (!needsCustomer) continue;

      // Allowlist within 5-line window.
      const allowStart = Math.max(0, lineIdx - ALLOWLIST_CONTEXT_LINES);
      const allowEnd = Math.min(lines.length, lineIdx + ALLOWLIST_CONTEXT_LINES + 1);
      const allowContext = lines.slice(allowStart, allowEnd).join("\n");
      if (allowContext.includes(ALLOWLIST_TAG)) continue;

      if (!CUSTOMER_CREATION_ALWAYS_RE.test(callContext)) {
        violations += 1;
        violationDetails.push(
          `x ${relative(REPO_ROOT, file)}:${lineIdx + 1} - checkout.sessions.create with off_session + isInstallmentPlan missing customer_creation: "always"`,
        );
      }
    }

    // Rule 2: PaymentIntent create calls.
    for (const match of source.matchAll(PI_CREATE_RE)) {
      piCallers += 1;
      const lineIdx = source.slice(0, match.index ?? 0).split("\n").length - 1;
      const callEnd = Math.min(lines.length, lineIdx + CALL_CONTEXT_LINES);
      const callContext = lines.slice(lineIdx, callEnd).join("\n");
      const needsCustomer =
        SFU_OFF_SESSION_RE.test(callContext) && IS_INSTALLMENT_RE.test(callContext);
      if (!needsCustomer) continue;

      const allowStart = Math.max(0, lineIdx - ALLOWLIST_CONTEXT_LINES);
      const allowEnd = Math.min(lines.length, lineIdx + ALLOWLIST_CONTEXT_LINES + 1);
      const allowContext = lines.slice(allowStart, allowEnd).join("\n");
      if (allowContext.includes(ALLOWLIST_TAG)) continue;

      if (!CUSTOMER_ATTACH_RE.test(callContext)) {
        violations += 1;
        violationDetails.push(
          `x ${relative(REPO_ROOT, file)}:${lineIdx + 1} - paymentIntents.create with off_session + isInstallmentPlan missing customer: <id> attachment`,
        );
      }
    }
  }

  return { filesScanned, checkoutSessionCallers, piCallers, violations, violationDetails };
}

function runSelfTest() {
  const tmpRoot = mkdtempSync(join(tmpdir(), "orch-0925-selftest-"));
  try {
    // Positive fixture: both call types correctly attach customer.
    const posDir = join(tmpRoot, "positive");
    const posFnDir = join(posDir, "fn-pos");
    writeFileSync(join(tmpRoot, "_seed.txt"), "");
    require_mkdir(posFnDir);
    writeFileSync(
      join(posFnDir, "index.ts"),
      `// positive: customer correctly attached
const isInstallmentPlan = true;
await stripeWeb.checkout.sessions.create({
  mode: "payment",
  payment_intent_data: {
    setup_future_usage: "off_session",
  },
  ...(isInstallmentPlan ? { customer_creation: "always" as const } : {}),
});
await stripe.paymentIntents.create({
  amount: 100,
  ...(isInstallmentPlan ? { setup_future_usage: "off_session" } : {}),
  ...(isInstallmentPlan && customerId !== null ? { customer: customerId } : {}),
});
`,
    );

    const posResult = scanDir(posDir);
    if (posResult.violations !== 0) {
      console.error(
        `[self-test] POSITIVE fixture should have 0 violations, got ${posResult.violations}:\n${posResult.violationDetails.join("\n")}`,
      );
      process.exit(3);
    }

    // Negative fixture: both call types MISS customer attachment.
    const negDir = join(tmpRoot, "negative");
    const negFnDir = join(negDir, "fn-neg");
    require_mkdir(negFnDir);
    writeFileSync(
      join(negFnDir, "index.ts"),
      `// negative: customer NOT attached (the pre-ORCH-0925 bug shape)
const isInstallmentPlan = true;
await stripeWeb.checkout.sessions.create({
  mode: "payment",
  payment_intent_data: {
    setup_future_usage: "off_session",
  },
  customer_email: buyerEmail,
});
await stripe.paymentIntents.create({
  amount: 100,
  ...(isInstallmentPlan ? { setup_future_usage: "off_session" } : {}),
  payment_method_types: ["card"],
});
`,
    );

    const negResult = scanDir(negDir);
    if (negResult.violations !== 2) {
      console.error(
        `[self-test] NEGATIVE fixture should have EXACTLY 2 violations (1 per call type), got ${negResult.violations}:\n${negResult.violationDetails.join("\n")}`,
      );
      process.exit(3);
    }

    // Allowlist fixture: bypassed via the allowlist tag.
    const allowDir = join(tmpRoot, "allowlist");
    const allowFnDir = join(allowDir, "fn-allow");
    require_mkdir(allowFnDir);
    writeFileSync(
      join(allowFnDir, "index.ts"),
      `// allowlist: orch-strict-grep-allow orch-0925-installment-customer-attached — intentionally bypassed
const isInstallmentPlan = true;
// orch-strict-grep-allow orch-0925-installment-customer-attached
await stripeWeb.checkout.sessions.create({
  payment_intent_data: { setup_future_usage: "off_session" },
});
`,
    );

    const allowResult = scanDir(allowDir);
    if (allowResult.violations !== 0) {
      console.error(
        `[self-test] ALLOWLIST fixture should have 0 violations, got ${allowResult.violations}:\n${allowResult.violationDetails.join("\n")}`,
      );
      process.exit(3);
    }

    console.log(
      "I-PROPOSED-ORCH-0925-INSTALLMENT-PLAN-ATTACHES-CUSTOMER self-test: 3 fixtures (positive=0, negative=2, allowlist=0) — PASS",
    );
  } finally {
    try {
      rmSync(tmpRoot, { recursive: true, force: true });
    } catch (cleanupErr) {
      console.warn(`[self-test] tmp cleanup warning: ${cleanupErr.message}`);
    }
  }
}

function require_mkdir(p) {
  mkdirSync(p, { recursive: true });
}

if (SELF_TEST) {
  runSelfTest();
  process.exit(0);
}

const SCAN_DIR = requestedScanDir
  ? (isAbsolute(requestedScanDir)
    ? requestedScanDir
    : resolve(process.cwd(), requestedScanDir))
  : DEFAULT_SCAN_DIR;

const result = scanDir(SCAN_DIR);
for (const detail of result.violationDetails) {
  console.error(detail);
}
console.log(
  [
    "I-PROPOSED-ORCH-0925-INSTALLMENT-PLAN-ATTACHES-CUSTOMER:",
    `scanned ${result.filesScanned} files,`,
    `${result.checkoutSessionCallers} checkout.sessions.create callers,`,
    `${result.piCallers} paymentIntents.create callers,`,
    `${result.violations} violations`,
  ].join(" "),
);
process.exit(result.violations === 0 ? 0 : 1);
