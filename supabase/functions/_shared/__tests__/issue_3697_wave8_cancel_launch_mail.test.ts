/**
 * toward #3697 Wave 8 — Cancel-before-spend, End-after-spend, launch-attempt mail.
 */
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.test("Wave 8: host-ad-campaign cancel refuses spend; end refuses zero spend", async () => {
  const host = await Deno.readTextFile(
    new URL("../../host-ad-campaign/index.ts", import.meta.url),
  );
  assert(host.includes('action === "cancel"'));
  assert(host.includes("campaign_has_spend_use_end"));
  assert(host.includes("campaign_no_spend_use_cancel"));
  assert(host.includes('status: "DELETED"'));
  assert(host.includes("cancel_return:host:"));
  assert(host.includes("notifyAdLaunchAttempt"));
});

Deno.test("Wave 8: Admin + Host launch attempts notify ops alert helper", async () => {
  const admin = await Deno.readTextFile(
    new URL("../../admin-ad-campaign-action/index.ts", import.meta.url),
  );
  assert(admin.includes("notifyAdLaunchAttempt"));
  assert(admin.includes('source: "admin"'));
  const helper = await Deno.readTextFile(
    new URL("../adLaunchAttemptOpsAlert.ts", import.meta.url),
  );
  assert(helper.includes("STRIPE_DISPUTE_ALERT_EMAILS"));
  assert(helper.includes("sendOpsAlertEmail"));
  assertEquals(helper.includes("OPS_ALERT_EMAILS"), false);
});

Deno.test("Wave 8: secret contract optional Resend + alert recipients", async () => {
  const contract = JSON.parse(
    await Deno.readTextFile(
      new URL("../../../function-env.contract.json", import.meta.url),
    ),
  ) as {
    functions: Record<string, { optional_top_level?: string[] }>;
  };
  for (const name of ["host-ad-campaign", "admin-ad-campaign-action"]) {
    const optional = contract.functions[name]?.optional_top_level ?? [];
    assert(optional.includes("RESEND_API_KEY"), `${name} RESEND`);
    assert(
      optional.includes("STRIPE_DISPUTE_ALERT_EMAILS"),
      `${name} dispute emails`,
    );
    assert(
      optional.includes("MINGLA_ALERT_RECIPIENTS_JSON"),
      `${name} alert bundle`,
    );
  }
});
