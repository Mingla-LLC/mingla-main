/**
 * Issue #3645 — the webhook inbox keeps only the masked card reference.
 *
 * MINGLA-INVARIANT: I-3645-PS-2 | issue #3645 | saved card details never leave the server and are never stored outside the private schema
 *
 * A Paystack card event carries a reusable saved-card value. Handlers never
 * read it from the body (they verify by reference), so it is removed before
 * the event is stored; last4, brand and bank stay for support.
 */
export function inboxPayloadForPaystackEvent(event: unknown): unknown {
  if (event === null || typeof event !== "object" || Array.isArray(event)) return event;
  const e = event as Record<string, unknown>;
  const data = e.data;
  if (data === null || typeof data !== "object" || Array.isArray(data)) return event;
  const d = data as Record<string, unknown>;
  const auth = d.authorization;
  if (auth === null || typeof auth !== "object" || Array.isArray(auth)) return event;
  if (!("authorization_code" in (auth as Record<string, unknown>))) return event;
  const { authorization_code: _removed, ...kept } = auth as Record<string, unknown>;
  return { ...e, data: { ...d, authorization: kept } };
}
