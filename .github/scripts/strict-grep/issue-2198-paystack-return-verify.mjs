#!/usr/bin/env node
/**
 * issue #2198 [paystack-return-verify] — structural guard on the Paystack
 * RETURN LEG.
 *
 * The defect this protects against is a DELETION, not a typo: for the whole
 * life of the Paystack rail neither `ticket-checkout-confirm` nor
 * `ticket-checkout-status` contained a single reference to Paystack, so the
 * buyer's return from the payment page never asked whether the payment
 * succeeded — it only waited for `charge.success`. Measured on a live ₦100
 * bank transfer: paid 01:41:05, webhook 01:45:11, four minutes of spinner on a
 * charge that had already cleared, with NO recovery at all if the webhook were
 * dropped.
 *
 * A runtime test proves the behaviour. This proves the SHAPE that keeps the
 * behaviour honest — specifically the three properties a well-meaning refactor
 * could quietly undo without any test noticing until money moved:
 *
 *   1. The call site exists in BOTH edge functions, and in confirm it runs
 *      BEFORE the Stripe slow-path (which returns `pending` for every Paystack
 *      session and would shadow it).
 *   2. Provider identity is read from the SERVER's provider-attempt row.
 *      Nothing on this path may branch on the `?cs=paystack` the client
 *      arrived with.
 *   3. The resolver owns NO finalize of its own — it delegates to the same
 *      `handlePaystackChargeSuccess` the webhook uses, so verify-then-finalize
 *      and webhook-then-finalize stay ONE idempotent mechanism.
 *
 * Run: node .github/scripts/strict-grep/issue-2198-paystack-return-verify.mjs
 *      node .github/scripts/strict-grep/issue-2198-paystack-return-verify.mjs --self-test
 */
import fs from "node:fs";

const paths = {
  resolver: "supabase/functions/_shared/paystackTicketReturnVerify.ts",
  confirm: "supabase/functions/ticket-checkout-confirm/index.ts",
  status: "supabase/functions/ticket-checkout-status/index.ts",
  router: "supabase/functions/_shared/paystackWebhookRouter.ts",
  service: "mingla-business/src/services/ticketCheckoutService.ts",
  screen: "mingla-business/app/checkout/[eventId]/confirm.tsx",
  // Surface parity: the trip confirmation screen is a second copy of the same
  // screen and returns through the SAME server path.
  tripScreen: "mingla-business/app/checkout-trip/[tripEventId]/confirm.tsx",
  workflow: ".github/workflows/issue-2198-paystack-return-verify-tests.yml",
};
const sources = Object.fromEntries(
  Object.entries(paths).map(([key, path]) => [key, fs.readFileSync(path, "utf8")]),
);

const fail = (message) => {
  throw new Error(`issue-2198: ${message}`);
};

/** Comments are documentation, not enforcement — assert on live code only. */
const stripComments = (value) =>
  value
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .replace(/[ \t]\/\/[^\n]*$/gm, "");

const check = (raw) => {
  const s = Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [key, stripComments(value)]),
  );

  // --- 1. The call site exists on BOTH return legs. ---
  for (const key of ["confirm", "status"]) {
    if (!s[key].includes("resolvePaystackTicketReturn(")) {
      fail(`${key} no longer verifies with Paystack on the buyer's return leg`);
    }
    if (!s[key].includes("paystackVerifyTransaction")) {
      fail(`${key} no longer passes the real Paystack verifier`);
    }
  }

  // --- 1b. In confirm it must run BEFORE the Stripe slow-path, which answers
  //         `pending` for every Paystack session and would shadow it. ---
  const resolveAt = s.confirm.indexOf("resolvePaystackTicketReturn(");
  const stripeRetrieveAt = s.confirm.indexOf("stripe.checkout.sessions.retrieve");
  if (stripeRetrieveAt >= 0 && resolveAt > stripeRetrieveAt) {
    fail("confirm verifies Paystack AFTER the Stripe slow-path — unreachable");
  }

  // --- 2. Never trust the client. ---
  if (!s.resolver.includes("ticket_checkout_provider_attempts")) {
    fail("resolver no longer reads provider identity from the server's attempt row");
  }
  for (const key of ["resolver", "confirm", "status"]) {
    if (/cs\s*===?\s*["']paystack["']/.test(s[key]) || s[key].includes("cs=paystack")) {
      fail(`${key} branches on the client's ?cs=paystack parameter`);
    }
    if (s[key].includes("searchParams") || s[key].includes("URLSearchParams")) {
      fail(`${key} reads a query string on the money path`);
    }
  }
  // Success must come from Paystack's `data.status`, never the API envelope's.
  if (!s.resolver.includes('verifyStatus !== "success"')) {
    fail("resolver no longer gates on the verified transaction status");
  }

  // --- 2b. issue #2216 crossing: the tickets this path returns must go
  //     through the SHARED order builder, which is where `attachQrImageDataUrls`
  //     runs. #2216's own gate asserts the FILE mentions that owner — which
  //     stays true if a new arm hand-rolls its own ticket list, so it cannot
  //     see this. A guest resolved in seconds onto a blank pass has simply
  //     swapped one defect for the other. ---
  const finalizedAt = s.confirm.indexOf('paystackReturn.kind === "finalized"');
  const pendingAt = s.confirm.indexOf('paystackReturn.kind === "pending"');
  if (finalizedAt < 0 || pendingAt < finalizedAt) {
    fail("confirm lost the Paystack finalized/pending arms");
  }
  if (!s.confirm.slice(finalizedAt, pendingAt).includes("fetchOrderPayload(")) {
    fail("the Paystack finalized arm builds tickets itself — it can ship a pass with no QR image");
  }
  if (!s.confirm.includes("attachQrImageDataUrls")) {
    fail("confirm no longer renders its tickets through the #2216 QR owner");
  }
  if (!s.status.includes("attachQrImageDataUrls")) {
    fail("status no longer renders its tickets through the #2216 QR owner");
  }
  // The resolver decides WHEN a guest is finalized; it must never decide what a
  // ticket carries (that owner is `_shared/ticketQrImage.ts`).
  if (s.resolver.includes("qrPayload") || s.resolver.includes("qrImageDataUrl")) {
    fail("the resolver builds ticket rows — one owner per truth (#2216)");
  }

  // --- 3. ONE finalize mechanism, shared with the webhook. ---
  if (!s.resolver.includes("handlePaystackChargeSuccess(")) {
    fail("resolver no longer delegates to the webhook's finalize owner");
  }
  if (s.resolver.includes("biz_ticket_checkout_finalize")) {
    fail("resolver grew a SECOND finalize path — one owner per truth (#1930)");
  }
  if (!s.router.includes("biz_ticket_checkout_finalize")) {
    fail("the shared finalize owner lost its RPC call");
  }
  // Amount + currency stay enforced in that one owner, fail-closed.
  for (const token of ["amount_mismatch", "currency_mismatch"]) {
    if (!s.router.includes(token)) fail(`shared finalize owner lost ${token}`);
  }

  // --- 4. A real reason, not a spinner. ---
  for (const token of [
    "paystack_charge_failed",
    "paystack_charge_abandoned",
    "paystack_payment_mismatch",
  ]) {
    if (!s.resolver.includes(token)) fail(`resolver no longer emits ${token}`);
    if (!s.service.includes(token)) {
      fail(`the #2188 error mapper no longer maps ${token}`);
    }
  }
  for (const key of ["screen", "tripScreen"]) {
    if (!s[key].includes("paidCheckoutErrorMessage")) {
      fail(`${key} no longer renders the mapped reason`);
    }
    if (!/status\s*===\s*"failed"/.test(s[key])) {
      fail(`${key} lost its terminal-failure branch (the spinner returns)`);
    }
  }
  // The mismatch case is the one where money may have moved. It must never
  // claim otherwise.
  const mismatchCopy = /PAID_CHECKOUT_PAYMENT_MISMATCH_MESSAGE\s*=\s*\n?\s*"([^"]*)"/
    .exec(s.service);
  if (mismatchCopy === null) fail("mismatch copy is no longer a literal constant");
  if (mismatchCopy[1].includes("You have not been charged")) {
    fail("mismatch copy tells a charged guest they were not charged");
  }

  // --- 5. The proofs are actually wired to CI. ---
  for (const token of [
    "issue_2198_paystack_return_verify.test.ts",
    "issue_2198_paystack_status_poll.test.ts",
    "issue_2198_paystack_return_confirm.test.tsx",
    "issue_2188_paid_checkout_provider_handoff.test.tsx",
    "issue_2160_multiday_provider_handoff.test.tsx",
    "issue-2198-paystack-return-verify.mjs --self-test",
    // #2216 owns what a ticket carries; this branch adds a new way one reaches
    // a guest, so its suites run here rather than on trust.
    "issue_2216_qr_image_never_silently_blank.test.ts",
    "ticketQrImage.test.ts",
  ]) {
    if (!s.workflow.includes(token)) fail(`workflow missing ${token}`);
  }
};

if (process.argv.includes("--self-test")) {
  check(sources);
  const mutations = [
    ["confirm", "resolvePaystackTicketReturn(", "skipPaystackTicketReturn("],
    ["status", "resolvePaystackTicketReturn(", "skipPaystackTicketReturn("],
    ["resolver", "ticket_checkout_provider_attempts", "ticket_checkout_sessions"],
    ["resolver", 'verifyStatus !== "success"', "false"],
    ["resolver", "handlePaystackChargeSuccess(", "myOwnFinalize("],
    ["resolver", "paystack_charge_abandoned", "removed_token"],
    ["service", "paystack_payment_mismatch", "removed_token"],
    ["router", "amount_mismatch", "amount_ignored"],
    ["confirm", "fetchOrderPayload(supabase, {\n      id: session.id,\n      order_id: finalizedOrderId,", "handRolledTickets(supabase, {\n      id: session.id,\n      order_id: finalizedOrderId,"],
    ["confirm", "attachQrImageDataUrls", "qrPayloadToDataUrl"],
    ["status", "attachQrImageDataUrls", "qrPayloadToDataUrl"],
    ["workflow", "issue_2216_qr_image_never_silently_blank.test.ts", "removed.test.ts"],
    ["screen", "paidCheckoutErrorMessage", "removedMapper"],
    ["tripScreen", "paidCheckoutErrorMessage", "removedMapper"],
    ["workflow", "issue_2198_paystack_return_verify.test.ts", "removed.test.ts"],
    ["workflow", "issue_2188_paid_checkout_provider_handoff.test.tsx", "removed.test.tsx"],
  ];
  for (const [key, from, to] of mutations) {
    let rejected = false;
    try {
      check({ ...sources, [key]: sources[key].replaceAll(from, to) });
    } catch {
      rejected = true;
    }
    if (!rejected) fail(`self-test mutation survived: ${key}:${from}`);
  }
  // A mutation that must be ACCEPTED — the gate must not be a tautology that
  // rejects everything. Reformatting a comment changes nothing it asserts.
  check({ ...sources, resolver: `// reworded\n${sources.resolver}` });
  console.log("issue-2198 Paystack return-leg verification self-test: PASS");
} else {
  check(sources);
  console.log("issue-2198 Paystack return-leg verification: PASS");
}
