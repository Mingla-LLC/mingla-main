// #3988 — the email alerts a Mingla teammate can switch on or off, in the
// order the Notifications page shows them. The server
// (issue_3988_my_email_alert_preferences) is the truth for each person's
// setting; this file only owns the words.

export const EMAIL_ALERTS = Object.freeze([
  {
    key: "business.support_new_ticket",
    label: "New support tickets",
    description: "A Host or Explorer opens a support ticket.",
  },
  {
    key: "business.support_ticket_reply",
    label: "Host replies",
    description: "A Host replies on a support ticket. Push still goes only to people marked available.",
  },
  {
    key: "admin.support_staff_ticket",
    label: "New staff tickets",
    description: "A teammate opens a staff ticket.",
  },
  {
    key: "admin.support_assigned",
    label: "Tickets assigned to me",
    description: "A staff ticket is handed to you.",
  },
  {
    key: "admin.support_overdue",
    label: "Overdue follow-ups",
    description: "A promised update on your ticket or signal is late. Leads also hear after 24 hours.",
  },
  {
    key: "admin.product_signal_new",
    label: "New product signals",
    description: "Support raises a product signal. For the Owner and Support leads.",
  },
  {
    key: "admin.product_signal_assigned",
    label: "Product signals handed to me",
    description: "A product signal is handed to you.",
  },
  {
    key: "admin.team_mention",
    label: "Mentions",
    description: "A teammate mentions you.",
  },
]);

const KNOWN = new Set(EMAIL_ALERTS.map((alert) => alert.key));

// Categories whose in-app alerts this page lists (mentions have their own list).
// #4130: new tickets are listed too; they were left out, so "New support
// tickets" alerts never showed in the app.
export const SUPPORT_ALERT_TYPES = Object.freeze([
  "business.support_new_ticket",
  "business.support_ticket_reply",
  "admin.support_staff_ticket",
  "admin.support_assigned",
  "admin.support_overdue",
  "admin.product_signal_new",
  "admin.product_signal_assigned",
  "admin.product_signal_progress",
]);

/**
 * Merge the server's rows onto the known alerts. A row the page does not know
 * is dropped; a known alert the server did not return is hidden rather than
 * shown with a guessed value (never fabricate a setting).
 */
export function emailAlertRows(serverRows) {
  const byKey = new Map();
  for (const row of Array.isArray(serverRows) ? serverRows : []) {
    if (row && KNOWN.has(row.category_key) && typeof row.email_enabled === "boolean") {
      byKey.set(row.category_key, row.email_enabled);
    }
  }
  return EMAIL_ALERTS
    .filter((alert) => byKey.has(alert.key))
    .map((alert) => ({ ...alert, enabled: byKey.get(alert.key) }));
}

const ADMIN_ORIGIN = "https://admin.usemingla.com/";

/**
 * Where an in-app alert opens inside this app: the Admin hash route from its
 * link, or null when the alert has no Admin page (never a dead tap: the row
 * then shows no Open action).
 */
export function alertHashRoute(alert) {
  const candidates = [alert?.data?.admin_link, alert?.deep_link];
  for (const link of candidates) {
    if (typeof link === "string" && link.startsWith(`${ADMIN_ORIGIN}#/`)) {
      return link.slice(ADMIN_ORIGIN.length);
    }
  }
  return null;
}
