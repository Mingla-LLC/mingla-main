/**
 * #4514 wave 4 — the cost line of the form request send sheet (§4.7): the
 * server's estimate in the currency's own minor unit, or the number of texts
 * when a country has no price yet. Never a guessed amount (Constitution #9).
 */

import { FORM_REQUEST_COPY as COPY } from "../components/forms/brandFormsCopy";
import type { FormRequestPreview } from "../services/brandFormRequestService";

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

