/**
 * expandDoorTickets — Re-derive the full set of ticketIds for a door sale.
 *
 * Used by:
 *   - J-D3 auto-check-in fire (per Decision #5 — N scan records per
 *     multi-line cart)
 *   - J-D4 detail view per-ticket section
 *   - J-G2 detail view for `kind: "door"` ticket rendering
 *   - J-D5 reconciliation report (if surfacing per-ticket detail)
 *
 * Door-ticket ID format: `dt_<saleSuffix>_<lineIdx>_<seatIdx>` where
 * saleSuffix is the door sale ID without the `ds_` prefix.
 *
 * **Why a different prefix from `tkt_`:** door tickets never round-trip
 * through `parseQrPayload` / `parseTicketId` (no QR generation, no camera
 * scan path — door buyers walk up; sale itself is the check-in). Different
 * prefix prevents accidental misparse if a future cycle adds a code path
 * that scans door tickets via camera.
 *
 * Per Cycle 12 SPEC §4.4.
 */

import type { DoorSaleLine } from "../store/doorSalesStore";

export interface ExpandedDoorTicket {
  /** dt_<saleSuffix>_<lineIdx>_<seatIdx> */
  ticketId: string;
  lineIdx: number;
  seatIdx: number;
  ticketName: string; // FROZEN at sale time
  isFreeAtSale: boolean;
  unitPriceGbpAtSale: number;
}

const generateDoorTicketId = (
  saleId: string,
  lineIdx: number,
  seatIdx: number,
): string => {
  const saleSuffix = saleId.startsWith("ds_") ? saleId.slice(3) : saleId;
  return `dt_${saleSuffix}_${lineIdx}_${seatIdx}`;
};

export const expandDoorTickets = (
  saleId: string,
  lines: DoorSaleLine[],
): ExpandedDoorTicket[] => {
  const out: ExpandedDoorTicket[] = [];
  lines.forEach((line, lineIdx) => {
    for (let seatIdx = 0; seatIdx < line.quantity; seatIdx += 1) {
      out.push({
        ticketId: generateDoorTicketId(saleId, lineIdx, seatIdx),
        lineIdx,
        seatIdx,
        ticketName: line.ticketNameAtSale,
        isFreeAtSale: line.isFreeAtSale,
        unitPriceGbpAtSale: line.unitPriceGbpAtSale,
      });
    }
  });
  return out;
};
