// #3872 — Creator results roll-up (approved P-results).
import type { GigResult } from "../../services/creatorGigsService";
import { bookingFeeMinor } from "../../utils/creatorProgramFormat";

export type CreatorResultRow = {
  id: string;
  name: string;
  soldMinor: number;
  tickets: number;
  clicks: number;
  lastGigId: string;
};

export function summarizeResults(rows: readonly GigResult[]): {
  currency: string | null;
  soldMinor: number;
  spentMinor: number;
  tickets: number;
  clicks: number;
  orders: number;
  returnOnSpend: number | null;
  conversion: number | null;
  creators: CreatorResultRow[];
} {
  const byCreator = new Map<string, CreatorResultRow>();
  let soldMinor = 0;
  let spentMinor = 0;
  let tickets = 0;
  let clicks = 0;
  let orders = 0;
  for (const row of rows) {
    soldMinor += row.sold_minor;
    spentMinor += row.fee_minor + bookingFeeMinor(row.fee_minor);
    tickets += row.tickets;
    clicks += row.clicks;
    orders += row.orders;
    const current = byCreator.get(row.creator_id) ?? {
      id: row.creator_id,
      name: row.creator_display_name,
      soldMinor: 0,
      tickets: 0,
      clicks: 0,
      lastGigId: row.gig_id,
    };
    current.soldMinor += row.sold_minor;
    current.tickets += row.tickets;
    current.clicks += row.clicks;
    current.lastGigId = row.gig_id || current.lastGigId;
    byCreator.set(row.creator_id, current);
  }
  return {
    currency: rows[0]?.currency ?? null,
    soldMinor,
    spentMinor,
    tickets,
    clicks,
    orders,
    returnOnSpend: spentMinor > 0 ? soldMinor / spentMinor : null,
    conversion: clicks > 0 ? (orders / clicks) * 100 : null,
    creators: [...byCreator.values()].sort((a, b) => b.soldMinor - a.soldMinor),
  };
}
