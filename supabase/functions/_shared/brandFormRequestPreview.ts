// #4514 wave 4 — the reach and cost preview of a form request (guest-roster-
// actions only). Segments are the SMS adapter's own count (computeSegments over
// composeSmsBody: the STOP footer, GSM-7 clean-up, UCS-2 for an emoji or a
// letter GSM-7 lacks), so the estimate matches what is billed. Kept apart from
// brandFormRequests.ts so the reminder cron does not bundle the SMS adapter.

import {
  BRAND_FORM_REQUEST_CATEGORY,
  renderBrandFormMessage,
} from "./brandFormNotify.ts";
import { composeSmsBody, computeSegments } from "./adapters/smsAdapter.ts";
import { countryFromE164 } from "./e164Country.ts";
import type { SmsRateV1 } from "./smsPriceTable.ts";
import {
  FORM_LINK_ORIGIN,
  type FormRequestAudience,
  type FormRequestChannel,
  type FormRequestKind,
  routeFor,
} from "./brandFormRequests.ts";

/** The text a request sends (the renderer's own words, with a full-length link). */
export function requestSmsText(
  brandName: string,
  eventTitle: string,
  eventDate: string | null,
  eventTimezone: string | null = null,
): string {
  const fakeLink = `${FORM_LINK_ORIGIN}/form/${"0".repeat(8)}-${
    "0".repeat(4)
  }-${"0".repeat(4)}-${"0".repeat(4)}-${"0".repeat(12)}#t=${"0".repeat(64)}`;
  return renderBrandFormMessage(BRAND_FORM_REQUEST_CATEGORY, {
    brand_name: brandName,
    event_title: eventTitle,
    event_date: eventDate,
    event_timezone: eventTimezone,
    form_url: fakeLink,
  }).sms;
}

/**
 * The segments one request text takes, as the SMS adapter will send it (the
 * STOP footer, GSM-7 clean-up, UCS-2 for an emoji or a letter GSM-7 lacks).
 */
export function requestSmsSegments(
  brandName: string,
  eventTitle: string,
  eventDate: string | null = null,
): number {
  return computeSegments(
    composeSmsBody(requestSmsText(brandName, eventTitle, eventDate)),
  );
}

export type TextsOffReason = "monthly_allowance" | "daily_cap";

export interface FormRequestPreview {
  selectedCount: number;
  reachableCount: number;
  throttledCount: number;
  smsOptedOutCount: number;
  unreachableCount: number;
  perChannelReachable: Record<FormRequestChannel, number>;
  smsCount: number;
  smsSegments: number;
  estimatedCostMinor: number | null;
  currency: string | null;
  textsToday: number;
  textCap: number;
  /**
   * Today's meaning, kept for Host 1.3.x (it refuses the send on it). New
   * sheets ignore it: over a limit texts are off instead (textsOff).
   */
  overTextCap: boolean;
  textsWaitUntil: string | null;
  /** #4541 R3.1: BRAND_FORMS_PUSH is on ("Push: not available yet" when false). */
  pushAvailable: boolean;
  /** #4541 R5.5: the shared monthly text allowance (null: no limit). */
  monthlyTextCap: number | null;
  textsLeftThisMonth: number | null;
  /** The texts this send will use (0 when texts are off). */
  textsThisSendUses: number;
  textsTodayUsed: number;
  dailyTextCap: number;
  /** Texts are off for this send: email and push still go. */
  textsOff: { reason: TextsOffReason; needed: number; remaining: number } | null;
}

/**
 * Reach and cost before sending. A text is counted for every person whose
 * route includes one. Unpriced countries or mixed currencies: no amount, never
 * a guess (the send then needs the host's explicit confirmation). #4541 R5.4:
 * when the texts needed are more than the month (or today) has left, texts are
 * off for the whole send, exactly as brand_form_request_enqueue decides: the
 * preview is computed without texts and says why.
 */
export function previewFormRequest(
  audience: FormRequestAudience,
  channels: readonly FormRequestChannel[],
  rates: readonly SmsRateV1[] | null,
  kind: FormRequestKind = "ask",
): FormRequestPreview {
  const first = reach(audience, channels, rates, kind);
  const dailyLeft = Math.max(audience.textCap - audience.textsToday, 0);
  let textsOff: FormRequestPreview["textsOff"] = null;
  if (first.smsCount > 0) {
    if (
      audience.textsLeftThisMonth !== null &&
      first.smsCount > audience.textsLeftThisMonth
    ) {
      textsOff = {
        reason: "monthly_allowance",
        needed: first.smsCount,
        remaining: audience.textsLeftThisMonth,
      };
    } else if (first.smsCount > dailyLeft) {
      textsOff = { reason: "daily_cap", needed: first.smsCount, remaining: dailyLeft };
    }
  }
  const sent = textsOff === null
    ? first
    : reach(audience, channels.filter((c) => c !== "sms"), rates, kind);
  return {
    ...sent,
    textsToday: audience.textsToday,
    textCap: audience.textCap,
    overTextCap: first.smsCount > 0 &&
      audience.textsToday + first.smsCount > audience.textCap,
    textsWaitUntil: sent.smsCount > 0 ? audience.textsWaitUntil : null,
    pushAvailable: audience.pushAvailable,
    monthlyTextCap: audience.monthlyTextCap,
    textsLeftThisMonth: audience.textsLeftThisMonth,
    textsThisSendUses: sent.smsCount,
    textsTodayUsed: audience.textsToday,
    dailyTextCap: audience.textCap,
    textsOff,
  };
}

type Reach = Pick<
  FormRequestPreview,
  | "selectedCount"
  | "reachableCount"
  | "throttledCount"
  | "smsOptedOutCount"
  | "unreachableCount"
  | "perChannelReachable"
  | "smsCount"
  | "smsSegments"
  | "estimatedCostMinor"
  | "currency"
>;

function reach(
  audience: FormRequestAudience,
  channels: readonly FormRequestChannel[],
  rates: readonly SmsRateV1[] | null,
  kind: FormRequestKind,
): Reach {
  const per: Record<FormRequestChannel, number> = { push: 0, sms: 0, email: 0 };
  let reachable = 0, throttled = 0, optedOut = 0, unreachable = 0, smsCount = 0;
  let costNumer = 0;
  let priced = rates !== null;
  let currency: string | null = null;
  const segments = requestSmsSegments(
    audience.brandName,
    audience.eventTitle,
    audience.eventStartsAt,
  );
  let selected = 0;
  for (const r of audience.recipients) {
    if (kind !== "ask" && r.answered) continue;
    selected += 1;
    if (r.throttled) {
      throttled += 1;
      continue;
    }
    const route = routeFor(r, channels);
    if (route.length === 0) {
      if (r.smsOptedOut) optedOut += 1;
      else unreachable += 1;
      continue;
    }
    reachable += 1;
    per[route[0]] += 1;
    if (route.includes("sms") && r.phone !== null) {
      smsCount += 1;
      const country = countryFromE164(r.phone);
      const rate = rates?.find((x) => x.country === country);
      if (
        rate === undefined || (currency !== null && rate.currency !== currency)
      ) {
        priced = false;
      } else {
        currency = rate.currency;
        costNumer += (segments * rate.minorNumerator) / rate.minorDenominator;
      }
    }
  }
  return {
    selectedCount: selected,
    reachableCount: reachable,
    throttledCount: throttled,
    smsOptedOutCount: optedOut,
    unreachableCount: unreachable,
    perChannelReachable: per,
    smsCount,
    smsSegments: segments,
    estimatedCostMinor: smsCount === 0
      ? 0
      : priced
      ? Math.ceil(costNumer)
      : null,
    currency: smsCount === 0 ? null : priced ? currency : null,
  };
}
