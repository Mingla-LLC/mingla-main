import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  type BrandRecipientDeps,
  BrandRecipientError,
  type BrandRecipientRow,
  deactivateBrandPaystackRecipient,
  hmacPaystackAccountFingerprint,
  saveBrandPaystackRecipient,
} from "./recipient.ts";

const BRAND_ID = "11111111-1111-4111-8111-111111111111";

Deno.test("#1176 exact identity fingerprint is deterministic, keyed, and does not expose the NUBAN", async () => {
  const input = { accountNumber: "0123456789", bankCode: "058" };
  const first = await hmacPaystackAccountFingerprint("secret-a", input);
  const replay = await hmacPaystackAccountFingerprint("secret-a", input);
  const otherKey = await hmacPaystackAccountFingerprint("secret-b", input);

  assertEquals(first, replay);
  assertEquals(first.startsWith("hmac-sha256:"), true);
  assertEquals(first.includes(input.accountNumber), false);
  assertEquals(first === otherKey, false);
});

function harness(seed: BrandRecipientRow | null = null) {
  let stored = seed;
  const calls = {
    creates: [] as Array<Record<string, string>>,
    deletes: [] as string[],
    audits: [] as string[],
    persisted: [] as BrandRecipientRow[],
    warnings: [] as string[],
  };
  const deps: BrandRecipientDeps = {
    resolveAccount: ({ accountNumber }) =>
      Promise.resolve({
        account_name: "ADA ORGANISER",
        account_number: accountNumber,
      }),
    createRecipient: (input) => {
      calls.creates.push(input);
      return Promise.resolve({ recipient_code: "RCP_issue1176" });
    },
    deleteRecipient: (code) => {
      calls.deletes.push(code);
      return Promise.resolve();
    },
    fingerprintAccount: ({ accountNumber, bankCode }) =>
      Promise.resolve(
        `fingerprint:${bankCode}:${
          accountNumber === "0123456789" ? "account-a" : "account-b"
        }`,
      ),
    loadRecipient: () => Promise.resolve(stored),
    persistRecipient: (_brandId, row) => {
      stored = row;
      calls.persisted.push(row);
      return Promise.resolve();
    },
    deactivateRecipient: () => {
      if (stored) stored = { ...stored, is_active: false };
      return Promise.resolve();
    },
    audit: (action) => {
      calls.audits.push(action);
      return Promise.resolve();
    },
    warn: (message) => calls.warnings.push(message),
  };
  return { calls, deps, getStored: () => stored };
}

Deno.test("#1176 create stores one RCP_ with masked account truth and preserves raw NUBAN outside persistence", async () => {
  const h = harness();
  const result = await saveBrandPaystackRecipient(
    {
      action: "create_recipient",
      brandId: BRAND_ID,
      accountNumber: "0123456789",
      bankCode: "058",
    },
    h.deps,
  );

  assertEquals(result, {
    recipient_code: "RCP_issue1176",
    account_name: "ADA ORGANISER",
    account_number_masked: "••••6789",
    is_active: true,
  });
  assertEquals(h.calls.creates, [{
    name: "ADA ORGANISER",
    accountNumber: "0123456789",
    bankCode: "058",
  }]);
  assertEquals(h.calls.persisted, [{
    recipient_code: "RCP_issue1176",
    bank_code: "058",
    account_fingerprint: "fingerprint:058:account-a",
    account_number_masked: "••••6789",
    account_name: "ADA ORGANISER",
    is_active: true,
  }]);
  assertEquals(JSON.stringify(h.calls.persisted).includes("0123456789"), false);
  assertEquals(h.calls.audits, ["created"]);
});

Deno.test("#1176 same-input replay reuses the active mirror without another Paystack recipient", async () => {
  const h = harness({
    recipient_code: "RCP_existing",
    bank_code: "058",
    account_fingerprint: "fingerprint:058:account-a",
    account_number_masked: "••••6789",
    account_name: "ADA ORGANISER",
    is_active: true,
  });
  const result = await saveBrandPaystackRecipient(
    {
      action: "update_recipient",
      brandId: BRAND_ID,
      accountNumber: "0123456789",
      bankCode: "058",
    },
    h.deps,
  );
  assertEquals(result.recipient_code, "RCP_existing");
  assertEquals(h.calls.creates.length, 0);
  assertEquals(h.calls.deletes.length, 0);
  assertEquals(h.calls.persisted.length, 0);
});

Deno.test("#1176 replacement persists the new recipient before deleting the old provider object", async () => {
  const h = harness({
    recipient_code: "RCP_old",
    bank_code: "044",
    account_fingerprint: "fingerprint:044:account-b",
    account_number_masked: "••••1111",
    account_name: "OLD HOLDER",
    is_active: true,
  });
  const sequence: string[] = [];
  h.deps.persistRecipient = async (brandId, row) => {
    sequence.push(`persist:${brandId}:${row.recipient_code}`);
  };
  h.deps.deleteRecipient = async (code) => {
    sequence.push(`delete:${code}`);
  };
  await saveBrandPaystackRecipient(
    {
      action: "update_recipient",
      brandId: BRAND_ID,
      accountNumber: "0123456789",
      bankCode: "058",
    },
    h.deps,
  );
  assertEquals(sequence, [
    `persist:${BRAND_ID}:RCP_issue1176`,
    "delete:RCP_old",
  ]);
});

Deno.test("#1176 mismatched Paystack resolve response fails before recipient creation", async () => {
  const h = harness();
  h.deps.resolveAccount = () =>
    Promise.resolve({
      account_name: "WRONG ACCOUNT",
      account_number: "0000000000",
    });
  const error = await assertRejects(
    () =>
      saveBrandPaystackRecipient(
        {
          action: "create_recipient",
          brandId: BRAND_ID,
          accountNumber: "0123456789",
          bankCode: "058",
        },
        h.deps,
      ),
    BrandRecipientError,
  );
  assertEquals(error.code, "resolved_account_mismatch");
  assertEquals(h.calls.creates.length, 0);
});

Deno.test("#1176 deactivate turns off the local target before best-effort provider deletion", async () => {
  const h = harness({
    recipient_code: "RCP_existing",
    bank_code: "058",
    account_fingerprint: "fingerprint:058:account-a",
    account_number_masked: "••••6789",
    account_name: "ADA ORGANISER",
    is_active: true,
  });
  await deactivateBrandPaystackRecipient(BRAND_ID, h.deps);
  assertEquals(h.getStored()?.is_active, false);
  assertEquals(h.calls.deletes, ["RCP_existing"]);
  assertEquals(h.calls.audits, ["deactivated"]);
});
