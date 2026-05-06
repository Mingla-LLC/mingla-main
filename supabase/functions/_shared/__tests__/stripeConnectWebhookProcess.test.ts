/**
 * processConnectEvent — payout + deauthorize + account.updated (mocked Stripe + Supabase).
 *
 * Run: cd repo-root && deno test --allow-all supabase/functions/_shared/__tests__/stripeConnectWebhookProcess.test.ts
 */

import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import Stripe from "npm:stripe@17.4.0";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

import {
  type ConnectEvent,
  connectedAccountId,
  processConnectEvent,
} from "../stripeConnectWebhookProcess.ts";

const TEST_BRAND = "11111111-1111-4111-8111-111111111111";

function createWebhookAdminMock(
  linkByStripeAccount: Map<string, { brand_id: string }>,
): {
  admin: SupabaseClient;
  upserts: Array<{ table: string; row: unknown }>;
  brandUpdates: unknown[];
  deletedConnectBrands: string[];
} {
  const upserts: Array<{ table: string; row: unknown }> = [];
  const brandUpdates: unknown[] = [];
  const deletedConnectBrands: string[] = [];

  const admin = {
    from(table: string) {
      return {
        select(_cols?: string) {
          return {
            eq(col: string, val: string) {
              return {
                maybeSingle: async () => {
                  if (table === "stripe_connect_accounts" && col === "stripe_account_id") {
                    const row = linkByStripeAccount.get(val);
                    return { data: row ?? null, error: null };
                  }
                  return { data: null, error: null };
                },
              };
            },
          };
        },
        upsert(row: unknown, _opts?: unknown) {
          upserts.push({ table, row });
          return Promise.resolve({ error: null });
        },
        delete() {
          return {
            eq(col: string, val: string) {
              if (table === "stripe_connect_accounts" && col === "brand_id") {
                deletedConnectBrands.push(val);
              }
              return Promise.resolve({ error: null });
            },
          };
        },
        update(row: unknown) {
          return {
            eq(_col: string, _val: string) {
              if (table === "brands") brandUpdates.push(row);
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;

  return { admin, upserts, brandUpdates, deletedConnectBrands };
}

Deno.test("connectedAccountId prefers event.account", () => {
  const e = { type: "payout.paid", account: "acct_from_header" } as ConnectEvent;
  assertEquals(connectedAccountId(e), "acct_from_header");
});

Deno.test("processConnectEvent — payout.paid upserts payouts row", async () => {
  const { admin, upserts } = createWebhookAdminMock(
    new Map([["acct_1", { brand_id: TEST_BRAND }]]),
  );
  const stripe = new Stripe("sk_test_x", { apiVersion: "2024-11-20.acacia", typescript: true });
  const payout = {
    id: "po_smoke_1",
    object: "payout",
    amount: 4200,
    currency: "gbp",
    status: "paid",
    arrival_date: "2026-05-01",
  } as Stripe.Payout;
  const event = {
    id: "evt_payout_1",
    object: "event",
    type: "payout.paid",
    account: "acct_1",
    data: { object: payout },
  } as ConnectEvent;

  await processConnectEvent(admin, stripe, event);

  const payoutUpsert = upserts.find((u) => u.table === "payouts");
  if (payoutUpsert === undefined) throw new Error("expected payouts upsert");
  assertEquals((payoutUpsert.row as Record<string, unknown>).brand_id, TEST_BRAND);
  assertEquals((payoutUpsert.row as Record<string, unknown>).stripe_payout_id, "po_smoke_1");
  assertEquals((payoutUpsert.row as Record<string, unknown>).status, "paid");
});

Deno.test("processConnectEvent — account.application.deauthorized clears link", async () => {
  const { admin, deletedConnectBrands, brandUpdates } = createWebhookAdminMock(
    new Map([["acct_da", { brand_id: TEST_BRAND }]]),
  );
  const stripe = new Stripe("sk_test_x", { apiVersion: "2024-11-20.acacia", typescript: true });
  const event = {
    id: "evt_da_1",
    object: "event",
    type: "account.application.deauthorized",
    account: "acct_da",
    data: { object: {} },
  } as ConnectEvent;

  await processConnectEvent(admin, stripe, event);

  assertEquals(deletedConnectBrands, [TEST_BRAND]);
  assertEquals(brandUpdates.length, 1);
  const u = brandUpdates[0] as Record<string, unknown>;
  assertEquals(u.stripe_connect_id, null);
  assertEquals(u.stripe_charges_enabled, false);
});

Deno.test("processConnectEvent — account.updated sets kyc_stall_reminder_sent_at null when charges on", async () => {
  const { admin, upserts } = createWebhookAdminMock(
    new Map([["acct_upd", { brand_id: TEST_BRAND }]]),
  );
  const stripe = {
    accounts: {
      retrieve: async (id: string) =>
        ({
          id,
          object: "account",
          type: "express",
          charges_enabled: true,
          payouts_enabled: true,
          requirements: { currently_due: [] },
          metadata: {},
        }) as Stripe.Account,
    },
  } as unknown as Stripe;

  const event = {
    id: "evt_au_1",
    object: "event",
    type: "account.updated",
    data: {
      object: { id: "acct_upd" } as Stripe.Account,
    },
  } as ConnectEvent;

  await processConnectEvent(admin, stripe, event);

  const connectUpsert = upserts.find((u) => u.table === "stripe_connect_accounts");
  if (connectUpsert === undefined) throw new Error("expected stripe_connect_accounts upsert");
  assertEquals((connectUpsert.row as Record<string, unknown>).kyc_stall_reminder_sent_at, null);
});
