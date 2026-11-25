/**
 * #4490 spec 08 O2 — what the Till's Tap to pay panel says for each state of
 * the shared TapToPaySaleFlow. Pure; tested state by state.
 */
import type { TapSaleState } from "../../../services/terminal/tapToPayFlow";
import { TILL_COPY } from "./tillCopy";

export interface TillTapPanelCopy {
  title: string;
  danger: string | null;
  /** Money may be moving: the sheet cannot be dismissed. */
  busy: boolean;
  canTryAnother: boolean;
  canSaveAgain: boolean;
  canScanInstead: boolean;
}

export const tillTapPanelCopy = (state: TapSaleState): TillTapPanelCopy => {
  const base = { danger: null, busy: false, canTryAnother: false, canSaveAgain: false, canScanInstead: true };
  switch (state.kind) {
    case "idle":
    case "starting":
      return { ...base, title: TILL_COPY.tapToPay, busy: true, canScanInstead: false };
    case "ready":
      return { ...base, title: TILL_COPY.tapHold };
    case "reading":
      return { ...base, title: TILL_COPY.readingCard, busy: true, canScanInstead: false };
    case "saving":
      return { ...base, title: TILL_COPY.savingPayment, busy: true, canScanInstead: false };
    case "approved":
      return { ...base, title: TILL_COPY.paymentTaken, canScanInstead: false };
    case "declined":
    case "needs_pin":
    case "timed_out":
    case "cancelled":
      return { ...base, title: TILL_COPY.tapToPay, danger: TILL_COPY.cardDeclined, canTryAnother: true };
    case "unknown_result":
    case "save_failed":
      // Money may have moved: never "no money was taken"; keep it until saved.
      return { ...base, title: TILL_COPY.paymentTakenSaving, busy: true, canSaveAgain: true, canScanInstead: false };
    case "ios_update_required":
      return { ...base, title: TILL_COPY.tapToPay, danger: TILL_COPY.tapUpdateIos };
    case "not_on_this_phone":
    case "needs_setup":
    case "reader_problem":
      return { ...base, title: TILL_COPY.tapToPay, danger: TILL_COPY.tapNotOnPhone };
    case "failed":
      return { ...base, title: TILL_COPY.tapToPay, danger: state.message };
    default:
      return { ...base, title: TILL_COPY.tapToPay };
  }
};

/**
 * #4490 O2 fix 3: a tap payment found already waiting when the sheet reopened.
 * This phone cannot pick the reader back up, so the panel says the payment is
 * waiting and offers the working cancel (pay_card_cancel), never a dead end.
 */
export const tillTapResumedCopy = (): TillTapPanelCopy => ({
  title: TILL_COPY.waitingForPayment,
  danger: null,
  busy: false,
  canTryAnother: false,
  canSaveAgain: false,
  canScanInstead: false,
});
