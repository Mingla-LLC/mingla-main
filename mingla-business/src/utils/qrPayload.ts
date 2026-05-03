/**
 * qrPayload — Parse the scanner-side QR payload string.
 *
 * Mirror of `buildQrPayload` in stubOrderId.ts. Format:
 *   `mingla:order:<orderId>:ticket:<ticketId>`
 *
 * Used by J-S1 scanner to decode camera barcode hits before downstream
 * order/ticket validation.
 *
 * Per Cycle 11 SPEC §4.5.
 */

const QR_REGEX =
  /^mingla:order:(ord_[a-z0-9_]+):ticket:(tkt_[a-z0-9_]+)$/i;

export interface ParsedQrPayload {
  orderId: string;
  ticketId: string;
}

export const parseQrPayload = (raw: string): ParsedQrPayload | null => {
  const match = raw.trim().match(QR_REGEX);
  if (match === null) return null;
  return {
    orderId: match[1],
    ticketId: match[2],
  };
};
