import {
  assertMatch,
  assertStringIncludes,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

const FUNCTION_SOURCE = await Deno.readTextFile(
  new URL("../index.ts", import.meta.url),
);
const TEMPLATE_SOURCE = await Deno.readTextFile(
  new URL("../../_shared/email/installmentReminderEmail.ts", import.meta.url),
);
const MIGRATION_SOURCE = await Deno.readTextFile(
  new URL("../../../migrations/20260723000000_orch_0914_manual_buyer_reminders.sql", import.meta.url),
);

Deno.test("ORCH-0914 reminder calls rate-limit RPC before delivery", () => {
  const rpcIdx = FUNCTION_SOURCE.indexOf("biz_send_installment_reminder");
  const emailIdx = FUNCTION_SOURCE.indexOf("sendEmail({");
  if (rpcIdx < 0 || emailIdx < 0 || rpcIdx > emailIdx) {
    throw new Error("send-installment-reminder must call RPC before email delivery");
  }
});

Deno.test("ORCH-0914 reminder maps rate limit to user-facing error", () => {
  assertStringIncludes(FUNCTION_SOURCE, "Rate limited: 1 reminder per buyer per 24h.");
  assertStringIncludes(FUNCTION_SOURCE, 'reason === "rate_limited"');
  assertStringIncludes(MIGRATION_SOURCE, "sent_at > now() - interval '24 hours'");
  assertStringIncludes(MIGRATION_SOURCE, "pg_advisory_xact_lock");
});

Deno.test("ORCH-0914 reminder persists delivery results and uses dedicated template", () => {
  assertStringIncludes(FUNCTION_SOURCE, "delivery_results");
  assertStringIncludes(FUNCTION_SOURCE, "renderInstallmentReminderEmail");
  assertMatch(TEMPLATE_SOURCE, /Heads up/);
  assertStringIncludes(TEMPLATE_SOURCE, "Update your card if needed");
});
