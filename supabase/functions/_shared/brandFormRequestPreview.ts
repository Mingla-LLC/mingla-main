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
  overTextCap: boolean;
  textsWaitUntil: string | null;
}

/**
 * Reach and cost before sending. A text is counted for every person whose
 * route includes one. Unpriced countries or mixed currencies: no amount, never
 * a guess (the send then needs the host's explicit confirmation).
 */
export function previewFormRequest(
  audience: FormRequestAudience,
  channels: readonly FormRequestChannel[],
  rates: readonly SmsRateV1[] | null,
  kind: FormRequestKind = "ask",
): FormRequestPreview {
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
    textsToday: audience.textsToday,
    textCap: audience.textCap,
    overTextCap: smsCount > 0 &&
      audience.textsToday + smsCount > audience.textCap,
    textsWaitUntil: smsCount > 0 ? audience.textsWaitUntil : null,
  };
}
