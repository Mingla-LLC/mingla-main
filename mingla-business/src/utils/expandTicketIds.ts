/**
 * expandTicketIds — Re-derive the full set of ticketIds for an order.
 *
 * Used by:
 *   - J-S8 multi-QR carousel (one QR per expanded ticket)
 *   - Cycle 11 scanner to validate decoded ticketId matches an existing
 *     order line + seat index
 *   - J-S5 manual check-in CTA per-ticket section
 *
 * Inverse `parseTicketId` recovers (orderId, lineIdx, seatIdx) from a
 * tkt_ string. The orderSuffix MAY contain underscores (Cycle 8 stub
 * format: `tkt_<base36-ts>_<base36-rand>_<lineIdx>_<seatIdx>`), so the
 * parser splits and assumes the LAST two underscore-separated segments
 * are the indices.
 *
 * Per Cycle 11 SPEC §4.4.
 */

import type { OrderLineRecord } from "../store/orderStore";
import { generateTicketId } from "./stubOrderId";

export interface ExpandedTicket {
  /** tkt_<orderSuffix>_<lineIdx>_<seatIdx> */
  ticketId: string;
  lineIdx: number;
  seatIdx: number;
  ticketName: string; // from line.ticketNameAtPurchase
  isFreeAtPurchase: boolean;
  unitPriceGbpAtPurchase: number;
}

export const expandTicketIds = (
  orderId: string,
  lines: OrderLineRecord[],
): ExpandedTicket[] => {
  const out: ExpandedTicket[] = [];
  lines.forEach((line, lineIdx) => {
    for (let seatIdx = 0; seatIdx < line.quantity; seatIdx += 1) {
      out.push({
        ticketId: generateTicketId(orderId, lineIdx, seatIdx),
        lineIdx,
        seatIdx,
        ticketName: line.ticketNameAtPurchase,
        isFreeAtPurchase: line.isFreeAtPurchase,
        unitPriceGbpAtPurchase: line.unitPriceGbpAtPurchase,
      });
    }
  });
  return out;
};

/**
 * Inverse — parse a ticketId string back into (orderId, lineIdx, seatIdx).
 * Returns null if malformed.
 */
export const parseTicketId = (
  ticketId: string,
): { orderId: string; lineIdx: number; seatIdx: number } | null => {
  if (!ticketId.startsWith("tkt_")) return null;
  const remainder = ticketId.slice(4);
  const parts = remainder.split("_");
  if (parts.length < 3) return null;
  const seatIdxStr = parts[parts.length - 1];
  const lineIdxStr = parts[parts.length - 2];
  const seatIdx = Number.parseInt(seatIdxStr, 10);
  const lineIdx = Number.parseInt(lineIdxStr, 10);
  if (Number.isNaN(seatIdx) || Number.isNaN(lineIdx)) return null;
  if (seatIdx < 0 || lineIdx < 0) return null;
  const orderSuffix = parts.slice(0, -2).join("_");
  if (orderSuffix.length === 0) return null;
  return { orderId: `ord_${orderSuffix}`, lineIdx, seatIdx };
};
