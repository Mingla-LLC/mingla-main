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
  | "host_first_sale";

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
};

/**
 * W5-1: Google is attempted only for the kinds that have their own conversion
 * action (a Google click is still required).
 */
export const HOST_FUNNEL_GOOGLE_KIND: Partial<
  Record<HostFunnelKind, "host_lead" | "host_signup">
> = {
  host_lead: "host_lead",
  host_signup: "host_signup",
};

/** The event_id prefix of each server-side host kind. */
export const HOST_FUNNEL_EVENT_ID_PREFIX = {
  host_lead: "lead:",
  host_signup: "host_signup:",
  host_first_publish: "host_publish:",
  host_first_sale: "host_sale:",
} as const;

export type ServerHostFunnelKind = keyof typeof HOST_FUNNEL_EVENT_ID_PREFIX;

/** ad_conversions.event_type for each server-side host kind. */
export const HOST_FUNNEL_EVENT_TYPE: Record<
  ServerHostFunnelKind,
  "lead" | "host_signup" | "host_first_publish" | "host_first_sale"
> = {
  host_lead: "lead",
  host_signup: "host_signup",
  host_first_publish: "host_first_publish",
  host_first_sale: "host_first_sale",
};

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
      subjectType: kind === "host_lead" ? "lead" : "host_user",
      subjectId,
    };
  }
  return null;
}
