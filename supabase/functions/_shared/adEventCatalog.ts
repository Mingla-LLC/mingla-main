/**
 * adEventCatalog.ts — #4238 spec section 5.1, host-funnel rows (W3-3, W3-4).
 *
 * One owner for the per-platform event name of each host-funnel kind. The
 * browser twin lives in mingla-business/src/analytics/adPixelRuntime.web.ts
 * (HOST_FUNNEL_PIXEL_EVENTS); issue_4238_event_catalog_parity.test.ts reads both
 * files as text and asserts the browser rows equal the rows below.
 *
 * Step 0 corrections (binding, spec section 0b):
 *   Z2  TikTok: a lead is `Lead`. Custom names are accepted (reporting only).
 *   Z3  Snap has no lead event: a host lead is `SIGN_UP`. Snap CUSTOM_EVENT_n
 *       is NOT confirmed for web events, so it is never used: a host kind with
 *       no standard Snap event sends nothing to Snap (`no_channel_event`).
 *   Z5  Reddit v3: any non-standard name rides as tracking_type CUSTOM with
 *       custom_event_name (redditCapi.ts redditEventType).
 *
 * Host sign-up is a custom event, not CompleteRegistration, because buyer free
 * tickets already use CompleteRegistration on the same Meta dataset (#3697 F-4).
 *
 * Pure: no imports, no I/O.
 */

export type HostFunnelKind =
  | "host_lead"
  | "host_signup_started"
  | "host_signup"
  | "host_first_publish"
  | "host_first_sale"
  // #4452 §4.1: every lead carries its label; a booked call is its own result.
  | "creator_lead"
  | "local_lead"
  | "host_call_booked"
  | "creator_call_booked"
  | "local_call_booked";

export type CatalogChannel = "meta" | "tiktok" | "snap" | "reddit";

/** null = this platform gets nothing for that kind. */
export const HOST_FUNNEL_EVENT_NAMES: Record<
  HostFunnelKind,
  Record<CatalogChannel, string | null>
> = {
  host_lead: {
    meta: "Lead",
    tiktok: "Lead",
    snap: "SIGN_UP",
    reddit: "Lead",
  },
  host_signup_started: {
    meta: "HostSignUpStarted",
    tiktok: "HostSignUpStarted",
    snap: null,
    reddit: "HostSignUpStarted",
  },
  host_signup: {
    meta: "HostSignUp",
    tiktok: "HostSignUp",
    snap: "SIGN_UP",
    reddit: "HostSignUp",
  },
  host_first_publish: {
    meta: "HostFirstEventPublished",
    tiktok: "HostFirstEventPublished",
    snap: null,
    reddit: "HostFirstEventPublished",
  },
  host_first_sale: {
    meta: "HostFirstTicketSold",
    tiktok: "HostFirstTicketSold",
    snap: null,
    reddit: "HostFirstTicketSold",
  },
  creator_lead: { meta: "Lead", tiktok: "Lead", snap: "SIGN_UP", reddit: "Lead" },
  local_lead: { meta: "Lead", tiktok: "Lead", snap: "SIGN_UP", reddit: "Lead" },
  // A booked call: Meta and TikTok Schedule; Snap RESERVE (Q-3: the closest
  // standard event, Z3 forbids custom); Reddit CUSTOM "CallBooked" (Z5).
  host_call_booked: { meta: "Schedule", tiktok: "Schedule", snap: "RESERVE", reddit: "CallBooked" },
  creator_call_booked: { meta: "Schedule", tiktok: "Schedule", snap: "RESERVE", reddit: "CallBooked" },
  local_call_booked: { meta: "Schedule", tiktok: "Schedule", snap: "RESERVE", reddit: "CallBooked" },
};

/**
 * W5-1: Google is attempted only for the kinds that have their own conversion
 * action (a Google click is still required).
 */
export const HOST_FUNNEL_GOOGLE_KIND: Partial<
  Record<
    HostFunnelKind,
    | "host_lead"
    | "host_signup"
    | "creator_lead"
    | "local_lead"
    | "host_call_booked"
    | "creator_call_booked"
    | "local_call_booked"
  >
> = {
  host_lead: "host_lead",
  host_signup: "host_signup",
  // #4452: one Google conversion action per label (I-4238-GOOGLE-ACTION-PER-KIND).
  creator_lead: "creator_lead",
  local_lead: "local_lead",
  host_call_booked: "host_call_booked",
  creator_call_booked: "creator_call_booked",
  local_call_booked: "local_call_booked",
};

/** The event_id prefix of each server-side host kind. */
export const HOST_FUNNEL_EVENT_ID_PREFIX = {
  host_lead: "lead:",
  host_signup: "host_signup:",
  host_first_publish: "host_publish:",
  host_first_sale: "host_sale:",
  // #4452 I-4452-LEAD-PREFIX-PER-LABEL: a prefix per label, so the retry lane
  // can never resend a creator lead as a host lead. host_lead keeps `lead:`
  // (Book-a-call and tools ids stay byte-identical).
  creator_lead: "creator_lead:",
  local_lead: "local_lead:",
  host_call_booked: "host_call:",
  creator_call_booked: "creator_call:",
  local_call_booked: "local_call:",
} as const;

export type ServerHostFunnelKind = keyof typeof HOST_FUNNEL_EVENT_ID_PREFIX;

/** ad_conversions.event_type for each server-side host kind. */
export const HOST_FUNNEL_EVENT_TYPE: Record<
  ServerHostFunnelKind,
  "lead" | "host_signup" | "host_first_publish" | "host_first_sale" | "call_booked"
> = {
  host_lead: "lead",
  host_signup: "host_signup",
  host_first_publish: "host_first_publish",
  host_first_sale: "host_first_sale",
  creator_lead: "lead",
  local_lead: "lead",
  host_call_booked: "call_booked",
  creator_call_booked: "call_booked",
  local_call_booked: "call_booked",
};

/** #4452 §4.1: the labels a Lead or a booked call carries. */
export type LeadLabel = "host" | "creator" | "local";

/** #4452: the lead kind of each label. */
export const LEAD_KIND_FOR_LABEL: Record<LeadLabel, ServerHostFunnelKind> = {
  host: "host_lead",
  creator: "creator_lead",
  local: "local_lead",
};

/** #4452: the call-booked kind of each label. */
export const CALL_KIND_FOR_LABEL: Record<LeadLabel, ServerHostFunnelKind> = {
  host: "host_call_booked",
  creator: "creator_call_booked",
  local: "local_call_booked",
};

/**
 * #4452 §4.2: what each platform receives as the label (content_category /
 * event_tag / products[].category) and the label name (content_name).
 * Null for kinds that carry no label (sign-up, publish, sale).
 */
export const HOST_FUNNEL_LABEL: Partial<
  Record<ServerHostFunnelKind, { label: LeadLabel; value: string; name: string }>
> = {
  host_lead: { label: "host", value: "host_lead", name: "Host lead" },
  creator_lead: { label: "creator", value: "creator_lead", name: "Creator lead" },
  local_lead: { label: "local", value: "local_lead", name: "Local lead" },
  host_call_booked: { label: "host", value: "host_call", name: "Host call booked" },
  creator_call_booked: { label: "creator", value: "creator_call", name: "Creator call booked" },
  local_call_booked: { label: "local", value: "local_call", name: "Local call booked" },
};

/** Kinds whose subject is a lead (a booking, a tool row or a form submission). */
const LEAD_SUBJECT_KINDS = new Set<ServerHostFunnelKind>([
  "host_lead", "creator_lead", "local_lead", "host_call_booked", "creator_call_booked", "local_call_booked",
]);

/**
 * Parse a stored host-funnel event_id back into its kind and subject, for the
 * retry lane. `lead:tool:<id>` is a tools-gate lead (subject `tool:<id>`).
 */
export function parseHostFunnelEventId(
  eventId: string,
): {
  kind: ServerHostFunnelKind;
  subjectType: "host_user" | "lead";
  subjectId: string;
} | null {
  for (
    const kind of Object.keys(
      HOST_FUNNEL_EVENT_ID_PREFIX,
    ) as ServerHostFunnelKind[]
  ) {
    const prefix = HOST_FUNNEL_EVENT_ID_PREFIX[kind];
    if (!eventId.startsWith(prefix)) continue;
    const subjectId = eventId.slice(prefix.length);
    if (!subjectId) return null;
    return {
      kind,
      subjectType: LEAD_SUBJECT_KINDS.has(kind) ? "lead" : "host_user",
      subjectId,
    };
  }
  return null;
}
