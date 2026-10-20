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
const migration = () =>
  Deno.readTextFile(
    new URL(
      "../../../supabase/migrations/20271123023988_issue_3988_support_email_alerts.sql",
      import.meta.url,
    ),
  );

Deno.test("#3988 the page lists exactly the alerts the server lets a teammate switch", async () => {
  const sql = await migration();
  const block = sql.slice(
    sql.indexOf("FUNCTION public.issue_3988_email_alert_categories()"),
    sql.indexOf("REVOKE ALL ON FUNCTION public.issue_3988_email_alert_categories()"),
  );
  const serverKeys = [...block.matchAll(/\('([a-z_.]+)', (true|false), (\d+)\)/g)]
    .map((m) => ({ key: m[1], on: m[2] === "true", order: Number(m[3]) }))
    .sort((a, b) => a.order - b.order);
  assertEquals(EMAIL_ALERTS.map((a) => a.key), serverKeys.map((k) => k.key));
  // Everything starts on except mentions.
  assertEquals(serverKeys.filter((k) => !k.on).map((k) => k.key), ["admin.team_mention"]);
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
  const [page, service] = await Promise.all([
    read("pages/NotificationsPage.jsx"),
    read("services/teamCollaborationService.js"),
  ]);
  assertMatch(page, /title="Email alerts"/);
  assertMatch(page, /state\.rows\.map\(\(row\) => \(/);
  assertMatch(page, /<Toggle\s+label=\{row\.label\}/);
  assertMatch(page, /collaboration\.setEmailAlertPreference\(row\.key, enabled\)/);
  assertMatch(page, /addToast\(\{\s*variant: "error"/);
  assertMatch(page, /title="Support alerts"/);
  assertMatch(page, /title="Mentions"/);
  // No dead taps: an alert row without an Admin page is not a button.
  assertMatch(page, /\{route \? \(\s*<button type="button" onClick=\{\(\) => openAlert\(alert, route\)\}/);
  // The old single mention switch is gone (its setting is one of the rows now).
  assertNotMatch(page, /setMentionEmail|getTeamNotificationPreferences/);
  assertMatch(service, /rpc\("issue_3988_my_email_alert_preferences"\)/);
  assertMatch(service, /rpc\("issue_3988_set_email_alert_preference", \{ p_category_key: categoryKey, p_enabled: !!enabled \}\)/);
  assertMatch(service, /\.from\("notifications"\)\s*\.select\("id, type, title, body, deep_link, data, created_at, read_at"\)\s*\.in\("type", types\)/);
});
