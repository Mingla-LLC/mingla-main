export type NativeCheckoutLanding =
  | { kind: "purchase"; href: `/purchases/order/${string}` }
  | { kind: "sent"; buyerFirstName: string | null };

function firstName(name: string | null | undefined): string | null {
  return name?.trim().split(/\s+/)[0] || null;
}

/**
 * #4063 — the server owns account attachment. A checkout explicitly marked
 * unattached must never route the purchaser into a ticket they cannot read.
 * Older responses that omit the flag retain the safe historical purchase route.
 */
export function resolveNativeCheckoutLanding(
  orderId: string,
  attachedToAccount: boolean | undefined,
  buyerName?: string | null,
): NativeCheckoutLanding {
  if (attachedToAccount === false) {
    return { kind: "sent", buyerFirstName: firstName(buyerName) };
  }
  return { kind: "purchase", href: `/purchases/order/${orderId}` };
}
