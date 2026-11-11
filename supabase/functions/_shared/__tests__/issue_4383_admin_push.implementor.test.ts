// Issue #4383 — Admin pushes (Communications > Push) through the shared
// notification code.
//
//   T20  the two categories render the typed title and body as plain text,
//        bell + push only; the provider's data bag carries only campaign_id
//        and push_id; a deep link outside the destination table is refused
//   T21  mingla_updates goes to the Explorer (consumer) OneSignal app,
//        business.mingla_update to the Host (business) app
//   D    the destination table, the migration's SQL and the Admin composer's
//        choices agree row for row (one source of truth, spec §4.6)
//
// Run: deno test --allow-read supabase/functions/_shared/__tests__/issue_4383_admin_push.implementor.test.ts
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { renderCategoryMessage } from "../notifyTemplates.ts";
import { dispatchV2, providerSafePayload } from "../notifyV2.ts";
import { resolveOneSignalApp } from "../push-utils.ts";
import {
  ADMIN_PUSH_CATEGORY,
  ADMIN_PUSH_DESTINATIONS,
  adminPushDeepLink,
  adminPushDeepLinkValid,
} from "../adminPushDestinations.ts";
import {
  EXPLORER_DESTINATIONS,
  HOST_DESTINATIONS,
} from "../../../../mingla-admin/src/lib/pushDestinations.js";

const MIGRATION = new URL(
  "../../../migrations/20280608004383_issue_4383_communications_scheduling.sql",
  import.meta.url,
);

Deno.test("T20 the copy is what the admin typed, plain text, bell and push only", () => {
  for (const category of Object.values(ADMIN_PUSH_CATEGORY)) {
    const rendered = renderCategoryMessage(category, {
      title: "**Lagos** Friday drop",
      body: "12 new rooftop plans [near you](https://x.test). Tap to see.",
      campaign_id: "c",
      push_id: "p",
    });
    assertEquals(rendered.push.title, "Lagos Friday drop", category);
    assertEquals(rendered.push.body, "12 new rooftop plans near you. Tap to see.", category);
    assertEquals(rendered.email, { subject: "", body: "" }, `${category}: no email`);
    assertEquals(rendered.sms, "", `${category}: no SMS`);
  }
  const long = renderCategoryMessage("mingla_updates", { title: "t", body: "x".repeat(400) });
  assert(long.push.body.length <= 178, "body excerpted to the composer's limit");
  assertEquals(renderCategoryMessage("mingla_updates", {}).push.title, "Mingla update");
});

Deno.test("T20 the provider data bag carries only campaign_id and push_id", () => {
  for (const category of Object.values(ADMIN_PUSH_CATEGORY)) {
    assertEquals(
      providerSafePayload(category, {
        campaign_id: "c", push_id: "p", title: "private copy", body: "private copy", deep_link: "mingla://home",
      }),
      { campaign_id: "c", push_id: "p" },
      category,
    );
  }
});

Deno.test("T20 a deep link outside the destination table is refused, never rewritten", async () => {
  for (const row of ADMIN_PUSH_DESTINATIONS) {
    assert(adminPushDeepLinkValid(ADMIN_PUSH_CATEGORY[row.app], row.deepLink), row.deepLink);
    const other = row.app === "explorer" ? "host" : "explorer";
    assertEquals(adminPushDeepLinkValid(ADMIN_PUSH_CATEGORY[other], row.deepLink), false, `${row.deepLink} in the other app`);
  }
  for (const bad of ["mingla://connections", "mingla://saved", "mingla://profile", "mingla-business://home", "https://evil.test", "", null]) {
    assertEquals(adminPushDeepLinkValid("mingla_updates", bad), false, String(bad));
    assertEquals(adminPushDeepLinkValid("business.mingla_update", bad), false, String(bad));
  }
  // Through the real dispatcher: an invalid link stops before anything is written.
  const writes: string[] = [];
  const client = {
    from(table: string) {
      return {
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { key: "mingla_updates", active: true, is_transactional: true, urgency: "normal", default_channels: ["inapp", "push"], reach_mode: "reach_once", section: "Marketing" }, error: null }) }) }),
        insert: () => { writes.push(table); return Promise.resolve({ data: null, error: null }); },
      };
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
  };
  const result = await dispatchV2(client as never, {
    category_key: "mingla_updates",
    user_id: "00000000-0000-4000-8000-000000000001",
    payload: { title: "t", body: "b", campaign_id: "c", push_id: "p" },
    deep_link: "mingla://connections",
    idempotency_key: "k",
  } as never);
  assertEquals(result, { success: false, reason: "deep_link_invalid" });
  assertEquals(writes, []);
});

Deno.test("T21 each category reaches its own app", () => {
  assertEquals(resolveOneSignalApp("mingla_updates"), "consumer");
  assertEquals(resolveOneSignalApp("business.mingla_update"), "business");
});

Deno.test("D the destination table, the migration and the Admin composer agree", async () => {
  const sql = await Deno.readTextFile(MIGRATION);
  // The SQL CASE in issue_4383_push_deep_link.
  const caseRows = [...sql.matchAll(/WHEN p_app = '(explorer|host)' AND p_target = '([a-z]+)' THEN '([^']+)'/g)]
    .map((m) => `${m[1]}:${m[2]}=${m[3]}`).sort();
  assertEquals(caseRows, ADMIN_PUSH_DESTINATIONS.map((r) => `${r.app}:${r.value}=${r.deepLink}`).sort());
  // The CHECK constraints on admin_push_campaigns.
  const check = (column: string) => {
    const m = sql.match(new RegExp(`${column} text NOT NULL DEFAULT '([a-z]+)' CHECK \\(${column} IN \\(([^)]*)\\)\\)`));
    assert(m, `${column} CHECK found`);
    return { def: m[1], values: [...m[2].matchAll(/'([a-z]+)'/g)].map((v) => v[1]) };
  };
  const explorer = check("explorer_target");
  const host = check("host_target");
  const rows = (app: string) => ADMIN_PUSH_DESTINATIONS.filter((r) => r.app === app);
  assertEquals(explorer.values, rows("explorer").map((r) => r.value));
  assertEquals(host.values, rows("host").map((r) => r.value));
  assertEquals(explorer.def, rows("explorer").find((r) => r.isDefault)?.value);
  assertEquals(host.def, rows("host").find((r) => r.isDefault)?.value);
  // The Admin composer offers exactly these values.
  assertEquals(EXPLORER_DESTINATIONS.map((d: { value: string }) => d.value), rows("explorer").map((r) => r.value));
  assertEquals(HOST_DESTINATIONS.map((d: { value: string }) => d.value), rows("host").map((r) => r.value));
  assertEquals(adminPushDeepLink("explorer", "connections"), null);
  assertEquals(adminPushDeepLink("host", "home"), "mingla-business://(tabs)/home");
  // The categories the SQL fans out to are the module's.
  for (const category of Object.values(ADMIN_PUSH_CATEGORY)) assert(sql.includes(`'${category}'`), category);
});
