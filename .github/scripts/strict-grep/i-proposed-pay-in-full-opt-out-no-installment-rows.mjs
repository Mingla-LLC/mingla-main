#!/usr/bin/env node
/**
 * I-PROPOSED-PAY-IN-FULL-OPT-OUT-NO-INSTALLMENT-ROWS strict-grep gate.
 *
 * ORCH-0915: when a buyer chooses payment_plan_choice:"full" on a trip tier
 * that has a payment plan, checkout must stay non-installment: the UI/service
 * pass the explicit choice, edge validates/forwards it, and the newest RPC
 * migration suppresses installment_schedule generation for the full branch.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_REPO_ROOT = resolve(__dirname, "..", "..", "..");

function argValue(name) {
  const idx = process.argv.indexOf(name);
  return idx === -1 ? null : process.argv[idx + 1] ?? null;
}

const SELF_TEST = process.argv.includes("--self-test");
const REPO_ROOT = resolve(argValue("--repo-root") ?? DEFAULT_REPO_ROOT);

const REQUIRED_FILES = {
  service: "mingla-business/src/services/ticketCheckoutService.ts",
  payment: "mingla-business/app/checkout-trip/[tripEventId]/payment.tsx",
  edge: "supabase/functions/ticket-checkout-create/index.ts",
  migration: "supabase/migrations/20260724000007_orch_0915_pay_in_full_opt_out.sql",
  // ORCH-1130 — the pay-full DEFAULT relocated from payment.tsx's local
  // useState to the shared CartContext (seeded "full" on the public page).
  cartContext: "mingla-business/src/components/checkout/CartContext.tsx",
};

function read(rel, root = REPO_ROOT) {
  const full = join(root, rel);
  if (!existsSync(full)) {
    throw new Error(`missing required file: ${rel}`);
  }
  return readFileSync(full, "utf8");
}

function has(re, source) {
  return re.test(source);
}

function scan(root = REPO_ROOT) {
  const violations = [];
  let service = "";
  let payment = "";
  let edge = "";
  let migration = "";
  let cartContext = "";

  try {
    service = read(REQUIRED_FILES.service, root);
    payment = read(REQUIRED_FILES.payment, root);
    edge = read(REQUIRED_FILES.edge, root);
    migration = read(REQUIRED_FILES.migration, root);
    cartContext = read(REQUIRED_FILES.cartContext, root);
  } catch (err) {
    violations.push(err.message);
    return violations;
  }

  if (!has(/paymentPlanChoice\?\s*:\s*"full"\s*\|\s*"installments"/, service)) {
    violations.push(`${REQUIRED_FILES.service}: missing paymentPlanChoice input type`);
  }
  if (!has(/payment_plan_choice\s*:\s*input\.paymentPlanChoice/, service)) {
    violations.push(`${REQUIRED_FILES.service}: missing payment_plan_choice body mapping`);
  }
  // ORCH-1130 — the pay-full DEFAULT relocated from payment.tsx's local
  // `useState<PaymentPlanChoice>("full")` to the shared CartContext (seeded
  // "full" on the public page; the Review step is the last-chance editor). The
  // pay-in-full default invariant is PRESERVED — now proven at the CartContext
  // layer (the single shared default) instead of inline in payment.tsx.
  // The default is the INITIAL_STATE value `paymentPlanChoice: "full"`. Also
  // require the field be typed `TripPaymentPlanChoice` (the choice is a real
  // first-class cart field, not an ad-hoc string).
  if (
    !has(/paymentPlanChoice:\s*"full"/, cartContext) ||
    !has(/paymentPlanChoice:\s*TripPaymentPlanChoice/, cartContext)
  ) {
    violations.push(
      `${REQUIRED_FILES.cartContext}: missing CartContext default full selection (ORCH-1130 relocation)`,
    );
  }
  if (!has(/value=\{paymentPlanChoice\}/, payment)) {
    violations.push(`${REQUIRED_FILES.payment}: selector not bound to the payment-plan choice`);
  }
  if (
    !has(
      /paymentPlanChoice\s*:\s*paymentPlanChoice|\{\s*paymentPlanChoice\s*\}/,
      payment,
    )
  ) {
    violations.push(`${REQUIRED_FILES.payment}: checkout call does not pass paymentPlanChoice`);
  }
  if (!has(/body\.payment_plan_choice/, edge) || !edge.includes("payment_plan_choice_invalid")) {
    violations.push(`${REQUIRED_FILES.edge}: missing edge parse/validation for payment_plan_choice`);
  }
  if (!has(/p_payment_plan_choice\s*:\s*paymentPlanChoice/, edge)) {
    violations.push(`${REQUIRED_FILES.edge}: missing p_payment_plan_choice RPC argument`);
  }
  if (!migration.includes("p_payment_plan_choice text DEFAULT 'auto'")) {
    violations.push(`${REQUIRED_FILES.migration}: missing backward-compatible RPC default`);
  }
  if (!migration.includes("payment_plan_choice_invalid")) {
    violations.push(`${REQUIRED_FILES.migration}: missing RPC invalid-choice exception`);
  }
  if (!migration.includes("p_payment_plan_choice <> 'full'")) {
    violations.push(`${REQUIRED_FILES.migration}: full choice does not explicitly suppress installment generation`);
  }
  if (!migration.includes("ticket_lines_mixed_with_installments")) {
    violations.push(`${REQUIRED_FILES.migration}: mixed installment cart guard missing`);
  }

  return violations;
}

function writeFixture(root, { suppressFull }) {
  for (const rel of Object.values(REQUIRED_FILES)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
  }
  writeFileSync(
    join(root, REQUIRED_FILES.service),
    `export interface TicketCheckoutCreateInput {
  paymentPlanChoice?: "full" | "installments";
}
const body = { payment_plan_choice: input.paymentPlanChoice };
`,
  );
  writeFileSync(
    join(root, REQUIRED_FILES.cartContext),
    `export type TripPaymentPlanChoice = "full" | "installments";
interface CartState { paymentPlanChoice: TripPaymentPlanChoice; }
const INITIAL_STATE: CartState = { paymentPlanChoice: "full" };
`,
  );
  writeFileSync(
    join(root, REQUIRED_FILES.payment),
    `const { paymentPlanChoice } = useCart();
<TripPaymentChoice value={paymentPlanChoice} onChange={setPaymentPlanChoice} />;
createTicketCheckout({ paymentPlanChoice: paymentPlanChoice });
`,
  );
  writeFileSync(
    join(root, REQUIRED_FILES.edge),
    `const raw = body.payment_plan_choice;
if (raw !== "full" && raw !== "installments") return jsonResponse({ error: "payment_plan_choice_invalid" }, 400);
await supabase.rpc("biz_ticket_checkout_create_session", { p_payment_plan_choice: paymentPlanChoice });
`,
  );
  writeFileSync(
    join(root, REQUIRED_FILES.migration),
    `CREATE OR REPLACE FUNCTION public.biz_ticket_checkout_create_session(
  p_payment_plan_choice text DEFAULT 'auto'
) RETURNS jsonb AS $$
BEGIN
  IF p_payment_plan_choice NOT IN ('auto', 'full', 'installments') THEN
    RAISE EXCEPTION 'payment_plan_choice_invalid';
  END IF;
  IF v_line_count > 1 THEN
    RAISE EXCEPTION 'ticket_lines_mixed_with_installments';
  END IF;
  ${suppressFull ? "IF p_payment_plan_choice <> 'full' THEN v_total := v_deposit_cents::integer; END IF;" : "v_total := v_deposit_cents::integer;"}
  RETURN jsonb_build_object('installmentSchedule', CASE WHEN v_installments_out <> '[]'::jsonb THEN '{}'::jsonb ELSE NULL END);
END;
$$ LANGUAGE plpgsql;
`,
  );
}

function runSelfTest() {
  const tmpRoot = mkdtempSync(join(tmpdir(), "orch-0915-pay-full-gate-"));
  try {
    const positiveRoot = join(tmpRoot, "positive");
    writeFixture(positiveRoot, { suppressFull: true });
    const positiveViolations = scan(positiveRoot);
    if (positiveViolations.length !== 0) {
      console.error(`[self-test] positive fixture failed:\n${positiveViolations.join("\n")}`);
      process.exit(3);
    }

    const negativeRoot = join(tmpRoot, "negative");
    writeFixture(negativeRoot, { suppressFull: false });
    const negativeViolations = scan(negativeRoot);
    if (
      negativeViolations.length !== 1 ||
      !negativeViolations[0].includes("full choice does not explicitly suppress")
    ) {
      console.error(`[self-test] negative fixture should fail only full suppression:\n${negativeViolations.join("\n")}`);
      process.exit(3);
    }

    console.log(
      "I-PROPOSED-PAY-IN-FULL-OPT-OUT-NO-INSTALLMENT-ROWS self-test: positive=0, negative=1 — PASS",
    );
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
}

if (SELF_TEST) {
  runSelfTest();
  process.exit(0);
}

const violations = scan(REPO_ROOT);
for (const violation of violations) {
  console.error(`x ${violation}`);
}
console.log(
  [
    "I-PROPOSED-PAY-IN-FULL-OPT-OUT-NO-INSTALLMENT-ROWS:",
    `scanned ${Object.keys(REQUIRED_FILES).length} files,`,
    `${violations.length} violations`,
  ].join(" "),
);
process.exit(violations.length === 0 ? 0 : 1);
