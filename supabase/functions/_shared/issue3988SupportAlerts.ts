// #3988 — support and product alerts for Mingla teammates.
//
// Producers live in SQL (20271123003988_issue_3988_support_email_alerts.sql)
// and write notification_outbox rows only. This module is the one place the
// dispatcher and the outbox drain learn about those categories. Pure: no env
// reads, no I/O.

export const ISSUE_3988_ALERT_CATEGORIES = [
  "business.support_ticket_reply",
  "admin.support_staff_ticket",
  "admin.support_assigned",
  "admin.support_overdue",
  "admin.product_signal_new",
  "admin.product_signal_assigned",
  "admin.product_signal_progress",
] as const;

export type Issue3988AlertCategory = typeof ISSUE_3988_ALERT_CATEGORIES[number];

export function isIssue3988AlertCategory(
  category: string,
): category is Issue3988AlertCategory {
  return (ISSUE_3988_ALERT_CATEGORIES as readonly string[]).includes(category);
}

/** Categories that carry an email channel (the drain resolves the address). */
export const ISSUE_3988_EMAIL_CATEGORIES: readonly string[] =
  ISSUE_3988_ALERT_CATEGORIES.filter((key) =>
    key !== "admin.product_signal_progress"
  );

/**
 * Push is a per-row decision for these categories: the producer sets
 * payload.push (available roster + assignee for a Host reply; high or urgent
 * for a new product signal). Absent or false means no push attempt.
 */
const PUSH_GATED = new Set<string>([
  "business.support_ticket_reply",
  "admin.product_signal_new",
]);

export function issue3988PushAllowed(
  category: string,
  payload: Record<string, unknown>,
): boolean {
  if (!PUSH_GATED.has(category)) return true;
  return payload.push === true;
}

const UUID =
  /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/;
const ADMIN_ORIGIN = "https://admin.usemingla.com";

function adminLinkPattern(tab: "support" | "product", param: string): RegExp {
  return new RegExp(
    `^${ADMIN_ORIGIN.replace(/[.]/g, "[.]")}/#/community-support\\?tab=${tab}&${param}=${UUID.source}$`,
  );
}

const ADMIN_TICKET_LINK = adminLinkPattern("support", "ticket");
const ADMIN_THREAD_LINK = adminLinkPattern("support", "thread");
const ADMIN_SIGNAL_LINK = adminLinkPattern("product", "signal");

export function isIssue3988AdminLink(value: unknown): value is string {
  return typeof value === "string" &&
    (ADMIN_TICKET_LINK.test(value) || ADMIN_THREAD_LINK.test(value) ||
      ADMIN_SIGNAL_LINK.test(value));
}

/** The deep link each category may carry. Anything else is refused. */
export function issue3988DeepLinkValid(
  category: Issue3988AlertCategory,
  deepLink: string | null | undefined,
  payload: Record<string, unknown> = {},
): boolean {
  switch (category) {
    case "business.support_ticket_reply": {
      const id = typeof payload.ticket_id === "string" ? payload.ticket_id : "";
      return new RegExp(`^${UUID.source}$`).test(id) &&
        deepLink === `mingla-business://support/${id}`;
    }
    case "admin.support_staff_ticket":
    case "admin.support_assigned":
      return typeof deepLink === "string" && ADMIN_THREAD_LINK.test(deepLink);
    case "admin.support_overdue":
      return typeof deepLink === "string" &&
        (ADMIN_THREAD_LINK.test(deepLink) || ADMIN_SIGNAL_LINK.test(deepLink));
    case "admin.product_signal_new":
    case "admin.product_signal_assigned":
    case "admin.product_signal_progress":
      return typeof deepLink === "string" && ADMIN_SIGNAL_LINK.test(deepLink);
  }
}

/** Only these keys ever reach the push provider. */
const PROVIDER_SAFE_KEYS: Record<Issue3988AlertCategory, string[]> = {
  "business.support_ticket_reply": ["ticket_id", "message_id"],
  "admin.support_staff_ticket": ["thread_id"],
  "admin.support_assigned": ["thread_id"],
  "admin.support_overdue": ["kind", "item_id"],
  "admin.product_signal_new": ["signal_id"],
  "admin.product_signal_assigned": ["signal_id"],
  "admin.product_signal_progress": ["signal_id", "event"],
};

export function issue3988ProviderSafeKeys(
  category: Issue3988AlertCategory,
): string[] {
  return PROVIDER_SAFE_KEYS[category];
}

/** The email button: always the Mingla Admin page for the item. */
export function issue3988EmailCta(
  category: string,
  deepLink: string | null | undefined,
  payload: Record<string, unknown>,
): { label: string; url: string; note: string } | undefined {
  if (!isIssue3988AlertCategory(category)) return undefined;
  const url = category === "business.support_ticket_reply"
    ? payload.admin_link
    : deepLink;
  if (!isIssue3988AdminLink(url)) return undefined;
  return {
    label: "Open in Mingla Admin",
    url,
    note: "You get this email because of your role on the Mingla team. " +
      "You can turn this alert off on the Notifications page in Mingla Admin.",
  };
}
