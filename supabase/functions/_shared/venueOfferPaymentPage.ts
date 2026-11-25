// #4490 spec 06 W4 fix 1 (W4-N3): one live payment page per booking.
//
// `issue_4490_prepare_offer_payment` (and the plan path on top of it) answers
// a second `pay` for a booking whose payment of the same stage and amount is
// still pending with THAT attempt and its remembered page (`reused: true`,
// `checkoutUrl`). The edge then returns that page and never asks the provider
// for a second one. After the provider opens a new page, the edge remembers
// it (`issue_4490_record_payment_page`, service role only) so the next caller
// can be given the same page. Only Paystack pages are remembered; anything
// else falls back to today's "already in progress" answer.

const PAYSTACK_PAGE =
  /^https:\/\/checkout\.paystack\.com\/[A-Za-z0-9_-]{1,120}$/;

export type ReusedPaymentPage = {
  kind: "requires_redirect";
  provider: "paystack";
  attemptId: string;
  providerPaymentRef: string;
  authorizationUrl: string;
  amountMinor: string;
  currencyCode: string;
  reused: true;
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** The remembered page of an attempt the database handed back; null for a new attempt. */
export function reusedPaymentPage(prepared: unknown): ReusedPaymentPage | null {
  if (!isRecord(prepared) || prepared.reused !== true) return null;
  const url = prepared.checkoutUrl;
  const attemptId = prepared.attemptId;
  const ref = prepared.providerPaymentRef;
  if (
    prepared.provider !== "paystack" || prepared.state !== "pending" ||
    typeof url !== "string" || !PAYSTACK_PAGE.test(url) ||
    typeof attemptId !== "string" || typeof ref !== "string" || ref.length === 0
  ) {
    return null;
  }
  return {
    kind: "requires_redirect",
    provider: "paystack",
    attemptId,
    providerPaymentRef: ref,
    authorizationUrl: url,
    amountMinor: String(prepared.amountMinor ?? ""),
    currencyCode: String(prepared.currencyCode ?? ""),
    reused: true,
  };
}

type RpcClient = {
  rpc: (
    name: string,
    params: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: unknown }>;
};

/**
 * Remember a new Paystack page for its attempt. Best effort: when it cannot
 * be written, a second `pay` gets "already in progress" (today's answer)
 * instead of this page; it never fails the payment that just opened.
 */
export async function rememberPaymentPage(
  client: RpcClient,
  session: {
    provider?: unknown;
    attemptId?: unknown;
    authorizationUrl?: unknown;
  },
): Promise<void> {
  if (
    session.provider !== "paystack" || typeof session.attemptId !== "string" ||
    typeof session.authorizationUrl !== "string" ||
    !PAYSTACK_PAGE.test(session.authorizationUrl)
  ) {
    return;
  }
  try {
    await client.rpc("issue_4490_record_payment_page", {
      p_attempt_id: session.attemptId,
      p_checkout_url: session.authorizationUrl,
    });
  } catch {
    // Remembering the page is an optimisation of the second caller's answer.
  }
}
