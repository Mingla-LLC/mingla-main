/**
 * issue #4522 slice 6 — the Stripe paths roll a missed payment over before they
 * flag at risk; reminder, notice and dunning emails carry a "Pay toward your
 * balance" link only for a flexible v2 order; a manual charge refuses while a
 * traveler payment is processing.
 */
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

import { rollOverMissedPayment } from "../missedRollover.ts";
import { balanceLinkUrlForOrder } from "../balanceLinks.ts";
import { renderInstallmentReminderEmail } from "../../email/installmentReminderEmail.ts";
import { renderInstallmentDunningEmail } from "../../email/installmentDunningEmail.ts";
import { renderInstallmentPreChargeNoticeEmail } from "../../email/installmentPreChargeNoticeEmail.ts";
import { fakeSupabase } from "./issue_3645_fake_supabase.ts";

const read = (path: string) =>
  Deno.readTextFile(new URL(path, import.meta.url));

Deno.test("rollover: true only when the database rolled it over; an error flags at risk", async () => {
  const rolled = fakeSupabase({
    rpc: () => ({ data: { rolledOver: true }, error: null }),
  });
  // deno-lint-ignore no-explicit-any
  assertEquals(await rollOverMissedPayment(rolled.client as any, "i1"), true);
  const legacy = fakeSupabase({
    rpc: () => ({ data: { rolledOver: false }, error: null }),
  });
  // deno-lint-ignore no-explicit-any
  assertEquals(await rollOverMissedPayment(legacy.client as any, "i1"), false);
  const broken = fakeSupabase({
    rpc: () => ({ data: null, error: { message: "boom" } }),
  });
  // deno-lint-ignore no-explicit-any
  assertEquals(await rollOverMissedPayment(broken.client as any, "i1"), false);
});

Deno.test("both Stripe failure paths ask for a rollover before flagging at risk", async () => {
  for (
    const path of [
      "../createInstallmentPI.ts",
      "../../installmentWebhookHandlers.ts",
    ]
  ) {
    const src = await read(path);
    const roll = src.indexOf("rollOverMissedPayment(supabase");
    const flag = src.indexOf("at_risk: true,", roll);
    assert(
      roll > 0 && flag > roll,
      `${path}: rollover precedes the at-risk flag`,
    );
    assertStringIncludes(src, "const willBeAtRisk = lastRetry &&");
  }
});

Deno.test("a balance link is minted only for a flexible v2 order", async () => {
  const flexible = fakeSupabase({
    table: () => ({
      data: { payment_plan_terms: { v: 2, flex_enabled: true } },
      error: null,
    }),
    rpc: () => ({ data: { ok: true }, error: null }),
  });
  const url = await balanceLinkUrlForOrder(
    // deno-lint-ignore no-explicit-any
    flexible.client as any,
    "o1",
    () => "b".repeat(43),
  );
  assertEquals(url?.endsWith(`/pay/balance/${"b".repeat(43)}`), true);
  assertEquals(flexible.rpcCalls[0].name, "issue_4522_issue_balance_link");
  for (
    const terms of [null, { v: 2, flex_enabled: false }, { deposit_pct: 25 }]
  ) {
    const other = fakeSupabase({
      table: () => ({ data: { payment_plan_terms: terms }, error: null }),
    });
    // deno-lint-ignore no-explicit-any
    assertEquals(await balanceLinkUrlForOrder(other.client as any, "o1"), null);
    assertEquals(other.rpcCalls.length, 0);
  }
});

Deno.test("emails add the balance link only when given one", () => {
  const base = {
    buyerName: "Ada",
    buyerEmail: "a@example.test",
    tripTitle: "Lisbon",
    brandDisplayName: "Brand",
    nextInstallmentAmount: "₦300,000",
    nextInstallmentDueAt: "17 Dec",
    bookingId: "abcd1234",
    unsubscribeUrl: "https://usemingla.com/unsubscribe",
  };
  const without = renderInstallmentReminderEmail(base);
  assertEquals(without.htmlBody.includes("Pay toward your balance"), false);
  const withLink = renderInstallmentReminderEmail({
    ...base,
    balanceUrl: "https://host.usemingla.com/pay/balance/x",
  });
  assertStringIncludes(withLink.htmlBody, "Pay toward your balance");
  assertStringIncludes(
    withLink.textBody,
    "Pay toward your balance: https://host.usemingla.com/pay/balance/x",
  );
  const notice = renderInstallmentPreChargeNoticeEmail({
    buyerName: "Ada",
    tripTitle: "Lisbon",
    brandName: "Brand",
    amountCents: 30000000,
    currency: "NGN",
    dueAt: "2026-12-17T08:00:00Z",
    timezone: "Africa/Lagos",
    cardLast4: null,
    balanceUrl: "https://host.usemingla.com/pay/balance/y",
  });
  assertStringIncludes(notice.html, "Pay toward your balance");
  const dunning = renderInstallmentDunningEmail({
    recipient: { name: "Ada", email: "a@example.test" },
    trip: { title: "Lisbon" },
    installment: {
      ordinal: 1,
      amountCents: 30000000,
      currency: "NGN",
      failureReason: "card_declined",
      retryCount: 1,
      nextRetryAt: "2026-12-20T08:00:00Z",
    },
    brand: { name: "Brand", contactEmail: null },
    order: { shortId: "abcd1234" },
    balanceUrl: "https://host.usemingla.com/pay/balance/z",
  });
  assertStringIncludes(dunning.html, "Pay toward your balance");
  // A non-https value is never rendered as a link.
  assertEquals(
    renderInstallmentReminderEmail({
      ...base,
      balanceUrl: "javascript:alert(1)",
    }).htmlBody.includes("Pay toward your balance"),
    false,
  );
});

Deno.test("send-installment-reminder adds the link; manual charge refuses while a flexible payment is open", async () => {
  assertStringIncludes(
    await read("../../../send-installment-reminder/index.ts"),
    "const balanceUrl = await balanceLinkUrlForOrder(admin, body.orderId);",
  );
  assertStringIncludes(
    await read("../../../manual-charge-installment/index.ts"),
    'return jsonResponse({ ok: false, error: "flex_payment_in_flight" }, 409);',
  );
});

Deno.test("pre-charge and dunning senders mint and pass the optional balance link", async () => {
  const source = await read("../../../ticket-confirmation-dispatch/index.ts");
  assertStringIncludes(
    source,
    'import { balanceLinkUrlForOrder } from "../_shared/installments/balanceLinks.ts";',
  );

  const lifecycleStart = source.indexOf(
    "async function handleInstallmentLifecycleEmail(",
  );
  const dunningStart = source.indexOf(
    "async function handleInstallmentDunning(",
    lifecycleStart,
  );
  const paidInFullStart = source.indexOf(
    "async function handleInstallmentPaidInFull(",
    dunningStart,
  );
  assert(lifecycleStart >= 0 && dunningStart > lifecycleStart);
  assert(paidInFullStart > dunningStart);

  const lifecycle = source.slice(lifecycleStart, dunningStart);
  const dunning = source.slice(dunningStart, paidInFullStart);
  for (
    const [label, handler] of [
      ["pre-charge", lifecycle],
      ["dunning", dunning],
    ] as const
  ) {
    assertStringIncludes(
      handler,
      "const balanceUrl = await balanceLinkUrlForOrder(supabase, orderId);",
      `${label} must mint an eligible order's balance link`,
    );
    assertStringIncludes(
      handler,
      "balanceUrl,",
      `${label} must pass the link to its renderer`,
    );
  }
});
