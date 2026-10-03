/**
 * useOfferingPayoutMoney — #3645 PR10. Paid-out vs on-its-way for ONE offering
 * (event / trip / experience — all are `events` rows, so the ledger's
 * `event_id` is the offering id), for the shared money card.
 *
 * Reuses the already-cached brand payout ledger (`useBrandPayoutLedger`) — no
 * new query, no parallel money path. Below finance_manager the ledger RLS
 * returns zero rows, which resolves to `null` here and the card keeps its
 * existing single PAYOUT figure.
 *
 * #1180 law: reads only the DTO the ledger service already builds (no
 * error_message / attempt_count). Money is only returned when the ledger
 * currency matches the card's currency, so a mixed-currency brand never sees a
 * wrong-symbol figure.
 */

import { useMemo } from "react";

import { useBrandPayoutLedger } from "./useBrandPayoutLedger";
import { majorFromMinor } from "../utils/currency";
import { summariseOfferingPayoutMoney } from "../utils/brandPayoutVisibilityData";

export interface OfferingPayoutMoneyMajor {
  paidOutMajor: number;
  onItsWayMajor: number;
}

export function useOfferingPayoutMoney(
  brandId: string | null,
  offeringId: string | null,
  cardCurrency: string | null | undefined,
): OfferingPayoutMoneyMajor | null {
  const ledger = useBrandPayoutLedger(brandId);
  const data = ledger.data;
  return useMemo(() => {
    if (data === undefined || offeringId === null) return null;
    const money = summariseOfferingPayoutMoney(
      data.releases,
      offeringId,
      data.adjustments,
    );
    if (money === null) return null;
    const code = cardCurrency?.trim().toLowerCase();
    if (code === undefined || code.length === 0 || code !== money.currency) {
      return null;
    }
    return {
      paidOutMajor: majorFromMinor(money.paidCents, money.currency),
      onItsWayMajor: majorFromMinor(money.onItsWayCents, money.currency),
    };
  }, [data, offeringId, cardCurrency]);
}
