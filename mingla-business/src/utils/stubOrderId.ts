/**
 * Stub order/ticket ID generators for Cycle 8 checkout.
 *
 * Replaced in B3 by Supabase-issued IDs (orders.id from BIGSERIAL or
 * UUID; tickets.id similar). The QR payload format stays similar but
 * the encoded ID switches from this stub format to a real signed JWT
 * containing { order_id, ticket_id, sig } for scanner validation.
 *
 * EXIT CONDITION: B3 Stripe webhook handler creates real order rows
 * via the orders + order_line_items tables (PR #59 §B.4). At that
 * point this file becomes irrelevant and should be deleted.
 *
 * Per Cycle 8 spec §4.12.
 */

const TS36 = (): string => Date.now().toString(36);

const RAND4 = (): string =>
  Math.floor(Math.random() * 36 ** 4)
    .toString(36)
    .padStart(4, "0");

/** Stub order ID — `ord_<base36-timestamp>_<base36-rand>`. */
export const generateOrderId = (): string => `ord_${TS36()}_${RAND4()}`;

/**
 * Stub ticket ID — composes from the order ID's suffix + line + seat
 * indices. Deterministic given (orderId, lineIdx, seatIdx) so the same
 * tuple always yields the same ticket ID (stable for QR re-renders).
 */
export const generateTicketId = (
  orderId: string,
  lineIdx: number,
  seatIdx: number,
): string => {
  // Strip "ord_" prefix; remainder is unique to this order.
  const orderSuffix = orderId.startsWith("ord_") ? orderId.slice(4) : orderId;
  return `tkt_${orderSuffix}_${lineIdx}_${seatIdx}`;
};

/**
 * QR payload encoded into the confirmation screen's QR code.
 *
 * Stub format: `mingla:order:{orderId}:ticket:{ticketId}`. B3 swaps this
 * for a signed JWT; the QR rendering code path stays identical.
 */
export const buildQrPayload = (orderId: string, ticketId: string): string =>
  `mingla:order:${orderId}:ticket:${ticketId}`;
