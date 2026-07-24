import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  type BrandRecipientDeps,
  BrandRecipientError,
  type BrandRecipientRow,
  saveBrandPaystackRecipient,
} from "./recipient.ts";

const BRAND_ID = "22222222-2222-4222-8222-222222222222";

function adversarialHarness(seed: BrandRecipientRow) {
  const calls = {
    creates: [] as Array<Record<string, string>>,
    deletes: [] as string[],
    persisted: [] as BrandRecipientRow[],
  };
  const deps: BrandRecipientDeps = {
    resolveAccount: ({ accountNumber }) =>
      Promise.resolve({
        account_name: "SAME HOLDER",
        account_number: accountNumber,
      }),
    createRecipient: (input) => {
      calls.creates.push(input);
      return Promise.resolve({ recipient_code: "RCP_replacement" });
    },
    deleteRecipient: (recipientCode) => {
      calls.deletes.push(recipientCode);
      return Promise.resolve();
    },
    loadRecipient: () => Promise.resolve(seed),
    persistRecipient: (_brandId, recipient) => {
      calls.persisted.push(recipient);
      return Promise.resolve();
    },
    deactivateRecipient: () => Promise.resolve(),
    audit: () => Promise.resolve(),
    warn: () => undefined,
  };
  return { calls, deps };
}

Deno.test("#1176 tester: a different NUBAN with the same bank, holder, and last4 must not replay the old recipient", async () => {
  const h = adversarialHarness({
    recipient_code: "RCP_old",
    bank_code: "058",
    account_number_masked: "••••6789",
    account_name: "SAME HOLDER",
    is_active: true,
  });

  const result = await saveBrandPaystackRecipient(
    {
      action: "update_recipient",
      brandId: BRAND_ID,
      // Different account from the stored recipient, but the only persisted
      // identity fields (bank, holder, last4) deliberately collide.
      accountNumber: "9876546789",
      bankCode: "058",
    },
    h.deps,
  );

  assertEquals(result.recipient_code, "RCP_replacement");
  assertEquals(h.calls.creates.length, 1);
  assertEquals(h.calls.persisted.length, 1);
  assertEquals(h.calls.deletes, ["RCP_old"]);
});

Deno.test("#1176 tester: an inactive mirror is never reused", async () => {
  const h = adversarialHarness({
    recipient_code: "RCP_inactive",
    bank_code: "058",
    account_number_masked: "••••6789",
    account_name: "SAME HOLDER",
    is_active: false,
  });

  const result = await saveBrandPaystackRecipient(
    {
      action: "create_recipient",
      brandId: BRAND_ID,
      accountNumber: "9876546789",
      bankCode: "058",
    },
    h.deps,
  );

  assertEquals(result.recipient_code, "RCP_replacement");
  assertEquals(h.calls.creates.length, 1);
  assertEquals(h.calls.persisted.length, 1);
});

Deno.test("#1176 tester: an invalid bank fails closed before provider or local mutation", async () => {
  const h = adversarialHarness({
    recipient_code: "RCP_old",
    bank_code: "058",
    account_number_masked: "••••6789",
    account_name: "SAME HOLDER",
    is_active: true,
  });
  h.deps.resolveAccount = () => Promise.reject(new Error("invalid bank code"));

  const error = await assertRejects(
    () =>
      saveBrandPaystackRecipient(
        {
          action: "update_recipient",
          brandId: BRAND_ID,
          accountNumber: "9876546789",
          bankCode: "not-a-bank",
        },
        h.deps,
      ),
    BrandRecipientError,
  );

  assertEquals(error.code, "account_unresolved");
  assertEquals(h.calls.creates.length, 0);
  assertEquals(h.calls.persisted.length, 0);
  assertEquals(h.calls.deletes.length, 0);
});

Deno.test("#1176 tester: local persistence failure rolls back only the newly-created provider recipient", async () => {
  const h = adversarialHarness({
    recipient_code: "RCP_old",
    bank_code: "044",
    account_number_masked: "••••1111",
    account_name: "OLD HOLDER",
    is_active: true,
  });
  h.deps.persistRecipient = () => Promise.reject(new Error("database unavailable"));

  const error = await assertRejects(
    () =>
      saveBrandPaystackRecipient(
        {
          action: "update_recipient",
          brandId: BRAND_ID,
          accountNumber: "9876546789",
          bankCode: "058",
        },
        h.deps,
      ),
    BrandRecipientError,
  );

  assertEquals(error.code, "recipient_store_failed");
  assertEquals(h.calls.deletes, ["RCP_replacement"]);
});
