import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isPaystackRecipientShared } from "../paystackRecipientSharing.ts";

function client(rows: Record<string, Array<Record<string, string>>>) {
  return {
    from(table: string) {
      let excluded: { column: string; value: string } | null = null;
      const query = {
        select() {
          return query;
        },
        eq() {
          return query;
        },
        neq(column: string, value: string) {
          excluded = { column, value };
          return query;
        },
        limit() {
          const data = (rows[table] ?? []).filter((row) =>
            !excluded || row[excluded.column] !== excluded.value
          ).slice(0, 1);
          return Promise.resolve({ data, error: null });
        },
      };
      return query;
    },
  };
}

Deno.test("#3872 shared-recipient guard sees a different payee", async () => {
  const shared = await isPaystackRecipientShared(
    client({
      brand_paystack_recipients: [],
      partner_paystack_accounts: [],
      payee_accounts: [{ user_id: "other-payee" }],
    }),
    "RCP_shared",
    { kind: "payee", userId: "this-payee" },
  );
  assertEquals(shared, true);
});

Deno.test("#3872 shared-recipient guard excludes the disconnecting payee", async () => {
  const shared = await isPaystackRecipientShared(
    client({
      brand_paystack_recipients: [],
      partner_paystack_accounts: [],
      payee_accounts: [{ user_id: "this-payee" }],
    }),
    "RCP_own",
    { kind: "payee", userId: "this-payee" },
  );
  assertEquals(shared, false);
});

Deno.test("#3872 a brand disconnect cannot delete a payee-held recipient", async () => {
  const shared = await isPaystackRecipientShared(
    client({
      brand_paystack_recipients: [{ brand_id: "this-brand" }],
      partner_paystack_accounts: [],
      payee_accounts: [{ user_id: "payee" }],
    }),
    "RCP_cross_surface",
    { kind: "brand", brandId: "this-brand" },
  );
  assertEquals(shared, true);
});

Deno.test("#3872 recipient sharing fails closed when payee lookup fails", async () => {
  const failingClient = {
    from(table: string) {
      const query = {
        select() {
          return query;
        },
        eq() {
          return query;
        },
        neq() {
          return query;
        },
        limit() {
          return Promise.resolve({
            data: [],
            error: table === "payee_accounts"
              ? new Error("payee lookup failed")
              : null,
          });
        },
      };
      return query;
    },
  };
  await assertRejects(
    () =>
      isPaystackRecipientShared(failingClient, "RCP_unknown", {
        kind: "partner",
        accountId: "partner",
      }),
    Error,
    "payee lookup failed",
  );
});
