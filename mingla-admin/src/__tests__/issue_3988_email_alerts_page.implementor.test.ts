// #3988 — the admin Notifications page shows one email switch per alert type,
// the teammate's in-app support alerts, and their mentions.
import {
  assert,
  assertEquals,
  assertMatch,
  assertNotMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  alertHashRoute,
  EMAIL_ALERTS,
  emailAlertRows,
  SUPPORT_ALERT_TYPES,
} from "../lib/emailAlerts.js";

const read = (relative: string) =>
  Deno.readTextFile(new URL(`../${relative}`, import.meta.url));

Deno.test("#3988 the page lists exactly the alerts the server lets a teammate switch", async () => {
  // #4255: the alert list's current definition (mention email now on by default).
  const sql = await Deno.readTextFile(
    new URL("../../../supabase/migrations/20280524004255_issue_4255_work_card_email.sql", import.meta.url),
  );
  const block = sql.slice(
    sql.indexOf("FUNCTION public.issue_3988_email_alert_categories()"),
    sql.indexOf("REVOKE ALL ON FUNCTION public.issue_3988_email_alert_categories()"),
  );
  const serverKeys = [...block.matchAll(/\('([a-z_.]+)', (true|false), (\d+)\)/g)]
    .map((m) => ({ key: m[1], on: m[2] === "true", order: Number(m[3]) }))
    .sort((a, b) => a.order - b.order);
  assertEquals(EMAIL_ALERTS.map((a) => a.key), serverKeys.map((k) => k.key));
  // #4255: every alert starts on, mentions (work card email) included.
  assertEquals(serverKeys.filter((k) => !k.on).map((k) => k.key), []);
  for (const alert of EMAIL_ALERTS) {
    assert(alert.label.length > 0 && alert.description.length > 0, alert.key);
    assertNotMatch(alert.label, /admin\.|business\.|_/, `${alert.key} label is plain English`);
  }
});

Deno.test("#3988 server rows merge onto the known alerts; unknown or malformed rows never show", () => {
  const rows = emailAlertRows([
    { category_key: "admin.team_mention", email_enabled: false },
    { category_key: "business.support_ticket_reply", email_enabled: true },
    { category_key: "admin.support_overdue", email_enabled: false },
    { category_key: "admin.something_else", email_enabled: true },
    { category_key: "admin.support_assigned", email_enabled: "yes" },
    null,
  ]);
  assertEquals(rows.map((r) => [r.key, r.enabled]), [
    ["business.support_ticket_reply", true],
    ["admin.support_overdue", false],
    ["admin.team_mention", false],
  ]);
  assertEquals(emailAlertRows(null), []);
});

Deno.test("#3988 an in-app alert opens its Admin page, or offers no tap at all", () => {
  const id = "39880000-0000-4000-8000-0000000000a1";
  assertEquals(
    alertHashRoute({
      deep_link: `mingla-business://support/${id}`,
      data: { admin_link: `https://admin.usemingla.com/#/community-support?tab=support&ticket=${id}` },
    }),
    `#/community-support?tab=support&ticket=${id}`,
  );
  assertEquals(
    alertHashRoute({ deep_link: `https://admin.usemingla.com/#/community-support?tab=product&signal=${id}` }),
    `#/community-support?tab=product&signal=${id}`,
  );
  assertEquals(alertHashRoute({ deep_link: "https://evil.example/#/community-support" }), null);
  assertEquals(alertHashRoute({ deep_link: "mingla-business://support/x", data: {} }), null);
  assertEquals(SUPPORT_ALERT_TYPES.includes("admin.team_mention"), false);
});

Deno.test("#3988 the page wires one switch per row to the per-category RPC and keeps mentions", async () => {
  // #4255 W4: the Notifications page became Messages. Email settings are in
  // the Settings tab (same per-category RPC, nothing reset); the inbox is the
  // Notifications tab, read through the one Messages poll.
  const [page, inbox, poll, service] = await Promise.all([
    read("components/messages/MessagesSettings.jsx"),
    read("components/messages/MessagesNotifications.jsx"),
    read("hooks/useMessages.js"),
    read("services/teamCollaborationService.js"),
  ]);
  assertMatch(page, /otherAlerts\.map\(\(row\) => \(/);
  assertMatch(page, /collaboration\.setEmailAlertPreference\(alertKey, enabled\)/);
  assertMatch(page, /setEmail\(row\.key, on, row\.label\)/);
  assertMatch(page, /addToast\(\{\s*variant: "error"/);
  assertMatch(poll, /getInbox\(SUPPORT_ALERT_TYPES\)/);
  // No dead taps: a row without somewhere to go has no Open button.
  assertMatch(inbox, /\{target && <button type="button" onClick=\{open\}/);
  assertMatch(inbox, /row\.kind === "support" \? \(alertHashRoute\(row\.alert\)/);
  // The old single mention switch is gone (its setting is one of the rows now).
  assertNotMatch(page, /setMentionEmail|getTeamNotificationPreferences/);
  assertMatch(service, /rpc\("issue_3988_my_email_alert_preferences"\)/);
  assertMatch(service, /rpc\("issue_3988_set_email_alert_preference", \{ p_category_key: categoryKey, p_enabled: !!enabled \}\)/);
  assertMatch(service, /\.from\("notifications"\)\s*\.select\("id, type, title, body, deep_link, data, created_at, read_at"\)\s*\.in\("type", types\)/);
});
