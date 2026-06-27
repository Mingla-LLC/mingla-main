/**
 * Regression test — META-ORCH-1234 Bug A.
 *
 * audit_log.event_id is a uuid column. The Stripe Connect webhook call sites
 * previously passed a Stripe `evt_…` id into it → Postgres rejected the insert →
 * writeAudit threw → the ENTIRE webhook failed (processed=false; Stripe retried
 * forever; downstream notify + AppsFlyer never ran).
 *
 * writeAudit now coerces any NON-uuid event_id to null before the insert, so a
 * Stripe/acct/garbage id can never reach the uuid column or throw again. These
 * tests pin that coercion (and the uuid pass-through) at runtime.
 */
import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { writeAudit } from "./audit.ts";

// Minimal fake Supabase client capturing the row passed to .from("audit_log").insert(...).
function fakeSupabase(): {
  // deno-lint-ignore no-explicit-any
  client: any;
  inserted: () => Record<string, unknown> | null;
} {
  let captured: Record<string, unknown> | null = null;
  const client = {
    from(_table: string) {
      return {
        insert(row: Record<string, unknown>) {
          captured = row;
          return Promise.resolve({ error: null });
        },
      };
    },
  };
  return { client, inserted: () => captured };
}

Deno.test("writeAudit coerces a Stripe evt_ id to null (never reaches the uuid column)", async () => {
  const { client, inserted } = fakeSupabase();
  await writeAudit(client, {
    user_id: null,
    brand_id: "1ce63bf4-1a33-4309-ab0b-ec23343e3569",
    event_id: "evt_1Tml2YI4pBxuXrhh",
    action: "stripe_connect.account_updated",
    target_type: "stripe_connect_account",
    target_id: "acct_1Tml2YI4pBxuXrhh",
  });
  assertEquals(inserted()?.event_id, null);
});

Deno.test("writeAudit coerces an acct_ id to null", async () => {
  const { client, inserted } = fakeSupabase();
  await writeAudit(client, {
    user_id: null,
    brand_id: null,
    event_id: "acct_1Tml2YI4pBxuXrhh",
    action: "stripe_connect.webhook_ip_soft_fail",
    target_type: "stripe_webhook_event",
    target_id: "evt_x",
  });
  assertEquals(inserted()?.event_id, null);
});

Deno.test("writeAudit coerces an arbitrary non-uuid string to null", async () => {
  const { client, inserted } = fakeSupabase();
  await writeAudit(client, {
    user_id: null,
    brand_id: null,
    event_id: "not-a-uuid",
    action: "x",
    target_type: "t",
    target_id: "id",
  });
  assertEquals(inserted()?.event_id, null);
});

Deno.test("writeAudit PRESERVES a real Mingla events.id uuid", async () => {
  const { client, inserted } = fakeSupabase();
  const realUuid = "a0b1c2d3-e4f5-4607-8809-0a1b2c3d4e5f";
  await writeAudit(client, {
    user_id: null,
    brand_id: null,
    event_id: realUuid,
    action: "x",
    target_type: "t",
    target_id: "id",
  });
  assertEquals(inserted()?.event_id, realUuid);
});

Deno.test("writeAudit maps an omitted/undefined event_id to null", async () => {
  const { client, inserted } = fakeSupabase();
  await writeAudit(client, {
    user_id: null,
    brand_id: null,
    action: "x",
    target_type: "t",
    target_id: "id",
  });
  assertEquals(inserted()?.event_id, null);
});
