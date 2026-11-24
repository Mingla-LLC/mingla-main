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
 * The channels the send sheet offers (#4541 R3): Push (free; only people whose
 * app can open the form, and only while the server's push switch is on), Text
 * and Email.
 */
export const REQUEST_CHANNELS: readonly FormRequestChannel[] = ["push", "sms", "email"];

/**
 * The channels that go to the server. Push is dropped while the preview says
 * it is not available (never promise a push the server would drop).
 */
export function requestChannels(
  picked: readonly FormRequestChannel[],
  pushAvailable: boolean,
): FormRequestChannel[] {
  return picked.filter((c) => c !== "push" || pushAvailable);
}

/** The automatic reminder never pushes: its stored channels are text and email. */
export const autoRemindChannels = (picked: readonly FormRequestChannel[]): FormRequestChannel[] => {
  const kept = picked.filter((c) => c !== "push");
  return kept.length > 0 ? kept : ["email"];
};

/** Ask for named guests reaches them even if they already answered ("Ask again"). */
export function initialAudience(mode: "ask" | "remind" | "earlier", named: boolean): FormRequestAudience {
  return named && mode !== "remind" ? "everyone" : "unanswered";
}

/**
 * Texts with no price need the host's tick. #4541 R5.5: a text limit (the
 * monthly allowance or today's 300) never blocks: texts are off for that send
 * and email and push still go. Only "no one can be reached" blocks.
 */
export function canSendRequest(p: FormRequestPreview, confirmUnpriced: boolean): boolean {
  const unpriced = p.smsCount > 0 && p.estimatedCostMinor === null;
  return p.reachableCount > 0 && (!unpriced || confirmUnpriced);
}

/**
 * #4541 R5.5: the allowance lines, in order. "{left} of {cap} texts left this
 * month" (Blast's own words) with "Shared with your Blasts.", "This send uses
 * {n} texts", "{today} of 300 form texts used in the last 24 hours.", and,
 * when texts are off, why. Pure; exported for tests.
 */
export function allowanceLines(p: FormRequestPreview, textPicked: boolean): {
  monthly: string | null;
  shared: string | null;
  uses: string | null;
  today: string | null;
  textsOff: string | null;
} {
  const monthly =
    p.monthlyTextCap !== null && p.textsLeftThisMonth !== null
      ? COPY.monthlyLeft(p.textsLeftThisMonth, p.monthlyTextCap)
      : null;
  return {
    monthly,
    shared: monthly !== null ? COPY.sharedWithBlasts : null,
    uses: textPicked ? COPY.sendUses(p.textsThisSendUses) : null,
    today: textPicked ? COPY.capLine(p.textsTodayUsed, p.dailyTextCap) : null,
    textsOff:
      p.textsOff === null
        ? null
        : p.textsOff.reason === "monthly_allowance"
          ? COPY.textsOffMonthly
          : COPY.textsOffDaily,
  };
}
