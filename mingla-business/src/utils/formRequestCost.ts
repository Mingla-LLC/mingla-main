/**
 * #4514 wave 4 — the cost line of the form request send sheet (§4.7): the
 * server's estimate in the currency's own minor unit, or the number of texts
 * when a country has no price yet. Never a guessed amount (Constitution #9).
 */

import { FORM_REQUEST_COPY as COPY } from "../components/forms/brandFormsCopy";
import type {
  FormRequestAudience,
  FormRequestChannel,
  FormRequestPreview,
} from "../services/brandFormRequestService";

/** The cost in the currency's own minor unit (no guessed amount). */
export function costLine(p: FormRequestPreview): string {
  if (p.smsCount === 0) return COPY.noCost;
  if (p.estimatedCostMinor === null || p.currency === null) return COPY.costUnpriced(p.smsCount);
  try {
    const f = new Intl.NumberFormat(undefined, { style: "currency", currency: p.currency });
    const digits = f.resolvedOptions().maximumFractionDigits ?? 2;
    return COPY.costLine(f.format(p.estimatedCostMinor / 10 ** digits));
  } catch {
    return COPY.costUnpriced(p.smsCount);
  }
}

/**
 * The channels the send sheet offers. Push is not one of them until the
 * Explorer form screen ships (a push would open nothing).
 */
export const REQUEST_CHANNELS: readonly FormRequestChannel[] = ["sms", "email"];

/** Ask for named guests reaches them even if they already answered ("Ask again"). */
export function initialAudience(mode: "ask" | "remind" | "earlier", named: boolean): FormRequestAudience {
  return named && mode !== "remind" ? "everyone" : "unanswered";
}

/** Texts with no price need the host's tick; over the daily text limit never sends. */
export function canSendRequest(p: FormRequestPreview, confirmUnpriced: boolean): boolean {
  const unpriced = p.smsCount > 0 && p.estimatedCostMinor === null;
  return p.reachableCount > 0 && !p.overTextCap && (!unpriced || confirmUnpriced);
}
