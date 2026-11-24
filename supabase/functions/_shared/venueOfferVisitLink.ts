// ===========================================================================
// #4490 P2 — the guest's booking link in venue booking emails.
// ---------------------------------------------------------------------------
// `notify-outbox-drain` BUILDS the link at send time (reconciliation ruling:
// links are generated when the email is sent, never stored): it re-derives the
// booking token from the booking id (venueOfferBookingToken.ts) and passes the
// link to `notify-dispatch` in the request body only. `notify-dispatch`
// VALIDATES it before rendering it as the email's button, so no caller can put
// any other address behind "See your pass".
//
// Shape: `<origin>/visit/<groupId>#t=<token>`. The token rides in the URL
// FRAGMENT, which browsers never send to a server; the booking page keeps it on
// the guest's device and scrubs it from the address bar.
//
// Origin: production unless BUSINESS_WEB_ORIGIN names the production origin, a
// Vercel preview of the business app, or (only when the function itself runs
// on a local stack) a loopback origin: the same rule as the payment return.
// ===========================================================================
import { PRODUCTION_BUSINESS_WEB_ORIGIN } from "./businessWebOrigin.ts";
import { isLocalSupabaseUrl } from "./localSupabaseUrl.ts";
import { APP_CTA_LABEL, resolveAppCtaUrl } from "./email/appLink.ts";
import { venueMemberUrlSubscriptionId } from "./venueMembershipToken.ts";
import {
  isVenueMembershipCategory,
  VENUE_MEMBERSHIP_CTA,
} from "./email/templates/venueMembershipEmails.ts";
import { isVenueWaitlistCategory } from "./email/templates/venueWaitlistEmails.ts";
import { isVenueHostCategory } from "./email/templates/venueBookingEmails.ts";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_RE = /^(?:[a-z0-9_-]{1,16}\.)?[A-Za-z0-9_-]{43}$/;
const PREVIEW_ORIGIN_RE = /^https:\/\/mingla-business-[a-z0-9-]+\.vercel\.app$/;
// A loopback origin: 127.0.0.1, localhost or a `*.localhost` name (RFC 6761
// reserves .localhost for loopback), so a local signed-out test can use its
// own browser origin. Only honoured when the function runs on a local stack.
const LOOPBACK_ORIGIN_RE =
  /^http:\/\/(127\.0\.0\.1|localhost|[a-z0-9-]{1,40}\.localhost):\d{2,5}$/;

export const VENUE_VISIT_CATEGORIES = new Set([
  "venue_booking_confirmed",
  "venue_booking_cancelled",
  "venue_refund_state",
  "venue_balance_due",
  "venue_balance_overdue",
  "venue_booking_changed",
  "venue_balance_paid",
  "venue_request_received",
  "venue_payment_required",
  "venue_hold_expiring",
  "venue_request_declined",
  "venue_request_expired",
  // #4490 Explorer W2: visit reminders.
  "venue_visit_reminder",
]);

export { isLocalSupabaseUrl };

/** The public web origin guest links use. */
export function resolveVenueVisitOrigin(
  env: (name: string) => string | undefined,
): string {
  const configured = (env("BUSINESS_WEB_ORIGIN") ?? "").trim().replace(
    /\/+$/,
    "",
  );
  if (!configured) return PRODUCTION_BUSINESS_WEB_ORIGIN;
  if (configured === PRODUCTION_BUSINESS_WEB_ORIGIN) return configured;
  if (PREVIEW_ORIGIN_RE.test(configured)) return configured;
  if (
    LOOPBACK_ORIGIN_RE.test(configured) &&
    isLocalSupabaseUrl(env("SUPABASE_URL") ?? "")
  ) {
    return configured;
  }
  return PRODUCTION_BUSINESS_WEB_ORIGIN;
}

export function buildVenueVisitUrl(input: {
  origin: string;
  groupId: string;
  token: string;
}): string {
  if (!UUID_RE.test(input.groupId) || !TOKEN_RE.test(input.token)) {
    throw new Error("visit_link_input_invalid");
  }
  return `${input.origin}/visit/${input.groupId.toLowerCase()}#t=${
    encodeURIComponent(input.token)
  }`;
}

/**
 * The booking id a well-formed visit link opens, or null for anything else:
 * another origin, another path, a query string, extra fragment keys, a
 * malformed id or token. Exact rebuild, so there is one accepted spelling.
 */
export function venueVisitUrlGroupId(
  url: unknown,
  origin: string,
): string | null {
  if (typeof url !== "string" || url.length > 512) return null;
  const prefix = `${origin}/visit/`;
  if (!url.startsWith(prefix)) return null;
  const match = url.slice(prefix.length).match(
    /^([0-9a-f-]{36})#t=([A-Za-z0-9_.-]{1,64})$/,
  );
  if (!match) return null;
  try {
    return buildVenueVisitUrl({
        origin,
        groupId: match[1],
        token: match[2],
      }) ===
        url
      ? match[1]
      : null;
  } catch {
    return null;
  }
}

const CTA: Record<string, { label: string; note: string }> = {
  venue_booking_confirmed: {
    label: "See your pass",
    note:
      "Your pass is on your booking page. Show its code at the gate. The link is private to you, so please don't forward this email.",
  },
  venue_booking_cancelled: {
    label: "See your booking",
    note:
      "Your booking page shows what was refunded. The link is private to you.",
  },
  venue_refund_state: {
    label: "See your booking",
    note: "Your booking page shows your refund. The link is private to you.",
  },
  venue_balance_due: {
    label: "Pay the rest",
    note:
      "Pay the rest from your booking page. The link is private to you, so please don't forward this email.",
  },
  venue_balance_overdue: {
    label: "Pay the rest",
    note:
      "Pay the rest from your booking page. The link is private to you, so please don't forward this email.",
  },
  venue_booking_changed: {
    label: "See your booking",
    note:
      "Your booking page shows the new details and your pass. The link is private to you.",
  },
  venue_balance_paid: {
    label: "See your booking",
    note: "Your booking page shows what is paid. The link is private to you.",
  },
  venue_request_received: {
    label: "See your request",
    note:
      "Your booking page shows your request and the venue's answer when it comes. The link is private to you.",
  },
  venue_payment_required: {
    label: "Pay to hold your date",
    note:
      "Pay from your booking page before the hold ends. The link is private to you, so please don't forward this email.",
  },
  venue_hold_expiring: {
    label: "Pay to hold your date",
    note:
      "Pay from your booking page before the hold ends. The link is private to you, so please don't forward this email.",
  },
  venue_request_declined: {
    label: "See your request",
    note:
      "Your booking page shows the venue's answer. The link is private to you.",
  },
  venue_request_expired: {
    label: "See your request",
    note: "Your booking page shows what happened. The link is private to you.",
  },
  // #4490 Explorer W2: the visit reminder reuses the confirmation's words.
  venue_visit_reminder: {
    label: "See your pass",
    note:
      "Your pass is on your booking page. Show its code at the gate. The link is private to you, so please don't forward this email.",
  },
};

/**
 * #4490 Explorer W2 (spec 06 W2 item 6): the web pay link a membership renewal
 * TEXT carries ("Pay here: {link}"). Only for a service-role caller, the
 * renewal category, and exactly the member page link of the SAME member the
 * payload names, on the expected origin (the same checks as the email
 * button). Transit only: notify-dispatch passes it to the text and nowhere
 * else. Undefined for anything else (the text then goes without a web link).
 */
export function trustedVenueMemberPayUrl(input: {
  serviceCaller: boolean;
  categoryKey: unknown;
  payload: Record<string, unknown>;
  visitUrl: unknown;
  origin: string;
}): string | undefined {
  if (String(input.categoryKey ?? "") !== "venue_membership_renewal") {
    return undefined;
  }
  if (input.visitUrl === undefined || input.visitUrl === null) return undefined;
  const subscriptionId = venueMemberUrlSubscriptionId(
    input.visitUrl,
    input.origin,
  );
  if (
    !input.serviceCaller || subscriptionId === null ||
    String(input.payload.subscription_id ?? "").toLowerCase() !==
      subscriptionId
  ) {
    return undefined;
  }
  return input.visitUrl as string;
}

/**
 * The email button notify-dispatch may render for a venue booking: only for a
 * service-role caller, a venue booking category, and exactly the visit link of
 * the SAME booking the payload names, on the expected origin. Anything else is
 * dropped (the email still sends, without a button).
 */
export function trustedVenueVisitCta(input: {
  serviceCaller: boolean;
  categoryKey: unknown;
  payload: Record<string, unknown>;
  visitUrl: unknown;
  origin: string;
  /** #4490 Explorer W1: the claim link minted at send time (VENUE_APP_HANDOFF). */
  appUrl?: unknown;
}): VenueEmailCta | undefined {
  const web = trustedVenueWebCta(input);
  const appUrl = venueAppClaimUrl(input.appUrl);
  const category = String(input.categoryKey ?? "");
  if (
    appUrl === null || !input.serviceCaller || isVenueHostCategory(category) ||
    !(VENUE_VISIT_CATEGORIES.has(category) ||
      isVenueMembershipCategory(category) ||
      isVenueWaitlistCategory(category))
  ) {
    return web;
  }
  // The app link leads (#2240's owner gives its words and decides its
  // destination); the web action becomes the second link (§6 copy).
  return {
    label: APP_CTA_LABEL,
    url: resolveAppCtaUrl(appUrl),
    note: VENUE_PASS_CATEGORIES.has(category)
      ? "No app? Give your name at the door."
      : web?.note ?? "Open it in the Mingla app.",
    ...(web
      ? { secondary: { label: venueWebLinkLabel(category), url: web.url } }
      : {}),
  };
}

export interface VenueEmailCta {
  label: string;
  url: string;
  note: string;
  secondary?: { label: string; url: string };
}

/** Categories whose message is about a pass the guest shows at the door. */
const VENUE_PASS_CATEGORIES = new Set([
  "venue_booking_confirmed",
  "venue_booking_changed",
  "venue_balance_paid",
  "venue_membership_paid",
  "venue_visit_reminder",
]);

const CLAIM_URL_RE = /^https:\/\/usemingla\.com\/c\/[0-9A-Z]{10}$/;

/** Only a claim link Mingla minted (usemingla.com/c/<code>) may lead an email. */
export function venueAppClaimUrl(value: unknown): string | null {
  return typeof value === "string" && CLAIM_URL_RE.test(value.trim())
    ? value.trim()
    : null;
}

/** §6: the second link's words under the app link. */
export function venueWebLinkLabel(categoryKey: string): string {
  if (
    [
      "venue_balance_due",
      "venue_balance_overdue",
      "venue_payment_required",
      "venue_hold_expiring",
      "venue_membership_renewal",
      "venue_membership_lapsed",
    ].includes(categoryKey)
  ) return "Pay on the web";
  if (isVenueMembershipCategory(categoryKey)) return "See your plan on the web";
  if (isVenueWaitlistCategory(categoryKey)) return "See your place in line";
  return "See your booking on the web";
}

function trustedVenueWebCta(input: {
  serviceCaller: boolean;
  categoryKey: unknown;
  payload: Record<string, unknown>;
  visitUrl: unknown;
  origin: string;
}): VenueEmailCta | undefined {
  if (input.visitUrl === undefined || input.visitUrl === null) return undefined;
  const category = String(input.categoryKey ?? "");
  // #4490 P6: a member message's button is exactly the member page link of
  // the SAME member the payload names.
  if (isVenueMembershipCategory(category)) {
    const subscriptionId = venueMemberUrlSubscriptionId(
      input.visitUrl,
      input.origin,
    );
    if (
      !input.serviceCaller || subscriptionId === null ||
      String(input.payload.subscription_id ?? "").toLowerCase() !==
        subscriptionId
    ) {
      console.warn("[notify-dispatch v2] venue_member_url_rejected");
      return undefined;
    }
    return { ...VENUE_MEMBERSHIP_CTA[category], url: input.visitUrl as string };
  }
  const groupId = venueVisitUrlGroupId(input.visitUrl, input.origin);
  if (
    !input.serviceCaller ||
    !VENUE_VISIT_CATEGORIES.has(category) ||
    groupId === null ||
    String(input.payload.venue_group_id ?? "").toLowerCase() !== groupId
  ) {
    console.warn("[notify-dispatch v2] venue_visit_url_rejected");
    return undefined;
  }
  return { ...CTA[category], url: input.visitUrl as string };
}
