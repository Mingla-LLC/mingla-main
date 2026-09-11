export type BrandRecipientRow = {
  recipient_code: string;
  bank_code: string;
  account_fingerprint: string;
  account_number_masked: string;
  account_name: string;
  is_active: boolean;
};

export type BrandRecipientResult = {
  recipient_code: string;
  account_name: string;
  account_number_masked: string;
  is_active: true;
};

export class BrandRecipientError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    cause?: unknown,
  ) {
    super(
      cause instanceof Error && cause.message.length > 0 ? cause.message : code,
    );
    this.name = "BrandRecipientError";
  }
}

export type BrandRecipientDeps = {
  resolveAccount: (input: {
    accountNumber: string;
    bankCode: string;
  }) => Promise<{ account_name: string; account_number: string }>;
  createRecipient: (input: {
    name: string;
    accountNumber: string;
    bankCode: string;
  }) => Promise<{ recipient_code: string }>;
  deleteRecipient: (recipientCode: string) => Promise<void>;
  fingerprintAccount: (input: {
    accountNumber: string;
    bankCode: string;
  }) => Promise<string>;
  loadRecipient: (brandId: string) => Promise<BrandRecipientRow | null>;
  persistRecipient: (
    brandId: string,
    recipient: BrandRecipientRow,
  ) => Promise<void>;
  deactivateRecipient: (brandId: string) => Promise<void>;
  /**
   * #3192 — is `recipientCode` held by any brand OTHER than `brandId`?
   *
   * Paystack de-duplicates transfer recipients per integration: creating one
   * for a bank account that already exists returns the EXISTING recipient_code
   * with a success status, and nothing in the response distinguishes that from
   * a fresh mint. Proven against our own test integration on 2026-09-11 — two
   * creates on one account returned the same `RCP_…`.
   *
   * Every provider-side delete in this module must therefore ask this first.
   * Deleting a shared code destroys another brand's live payout destination
   * while their database row still points at it, so their payouts fail later
   * with nothing to explain why.
   */
  isRecipientCodeSharedElsewhere: (
    recipientCode: string,
    brandId: string,
  ) => Promise<boolean>;
  audit: (
    action: "created" | "updated" | "deactivated",
    recipient: BrandRecipientRow,
  ) => Promise<void>;
  warn: (message: string, error: unknown) => void;
};

/**
 * #3192 — delete a recipient at Paystack ONLY when no other brand depends on
 * it. Never throws: a cleanup that cannot be proven safe is skipped and warned
 * about, because losing a stray provider object is always cheaper than
 * breaking a live brand's payouts.
 */
async function deleteRecipientIfUnshared(
  recipientCode: string,
  brandId: string,
  deps: BrandRecipientDeps,
  context: string,
): Promise<void> {
  try {
    if (await deps.isRecipientCodeSharedElsewhere(recipientCode, brandId)) {
      deps.warn(
        `${context}: skipped provider delete — recipient is shared with another brand`,
        new Error(`shared recipient_code retained for ${recipientCode}`),
      );
      return;
    }
  } catch (error) {
    // Could not establish safety → do not delete. Fail closed.
    deps.warn(
      `${context}: shared-recipient check failed, delete skipped`,
      error,
    );
    return;
  }
  try {
    await deps.deleteRecipient(recipientCode);
  } catch (error) {
    deps.warn(`${context}: provider delete failed`, error);
  }
}

function result(row: BrandRecipientRow): BrandRecipientResult {
  return {
    recipient_code: row.recipient_code,
    account_name: row.account_name,
    account_number_masked: row.account_number_masked,
    is_active: true,
  };
}

export async function hmacPaystackAccountFingerprint(
  secret: string,
  input: { accountNumber: string; bankCode: string },
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${input.bankCode}:${input.accountNumber}`),
  );
  const hex = Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `hmac-sha256:${hex}`;
}

export async function saveBrandPaystackRecipient(
  input: {
    action: "create_recipient" | "update_recipient";
    brandId: string;
    accountNumber: string;
    bankCode: string;
  },
  deps: BrandRecipientDeps,
): Promise<BrandRecipientResult> {
  let resolved: { account_name: string; account_number: string };
  try {
    resolved = await deps.resolveAccount({
      accountNumber: input.accountNumber,
      bankCode: input.bankCode,
    });
  } catch (error) {
    throw new BrandRecipientError("account_unresolved", 422, error);
  }
  if (resolved.account_number !== input.accountNumber) {
    throw new BrandRecipientError("resolved_account_mismatch", 422);
  }

  let accountFingerprint: string;
  try {
    accountFingerprint = await deps.fingerprintAccount({
      accountNumber: input.accountNumber,
      bankCode: input.bankCode,
    });
  } catch (error) {
    throw new BrandRecipientError("recipient_fingerprint_failed", 500, error);
  }

  let previous: BrandRecipientRow | null;
  try {
    previous = await deps.loadRecipient(input.brandId);
  } catch (error) {
    throw new BrandRecipientError("recipient_read_failed", 500, error);
  }

  const masked = `••••${input.accountNumber.slice(-4)}`;
  if (
    previous?.is_active === true &&
    previous.bank_code === input.bankCode &&
    previous.account_fingerprint === accountFingerprint
  ) {
    return result(previous);
  }

  let recipientCode: string;
  try {
    const created = await deps.createRecipient({
      name: resolved.account_name,
      accountNumber: input.accountNumber,
      bankCode: input.bankCode,
    });
    recipientCode = created.recipient_code;
  } catch (error) {
    throw new BrandRecipientError("recipient_create_failed", 502, error);
  }
  if (!recipientCode.startsWith("RCP_")) {
    throw new BrandRecipientError("recipient_code_invalid", 502);
  }

  const next: BrandRecipientRow = {
    recipient_code: recipientCode,
    bank_code: input.bankCode,
    account_fingerprint: accountFingerprint,
    account_number_masked: masked,
    account_name: resolved.account_name,
    is_active: true,
  };
  try {
    await deps.persistRecipient(input.brandId, next);
  } catch (error) {
    // #3192 — `recipientCode` may be another brand's, handed back by Paystack's
    // de-duplication rather than minted for us. Rolling it back unconditionally
    // is what deleted a live brand's payout recipient in production.
    await deleteRecipientIfUnshared(
      recipientCode,
      input.brandId,
      deps,
      "new recipient rollback",
    );
    throw new BrandRecipientError("recipient_store_failed", 500, error);
  }

  if (
    previous?.recipient_code &&
    previous.recipient_code !== recipientCode
  ) {
    // #3192 — the brand switched banks. The code it is leaving behind may be
    // shared with another brand that is still using it.
    await deleteRecipientIfUnshared(
      previous.recipient_code,
      input.brandId,
      deps,
      "previous recipient delete",
    );
  }
  try {
    await deps.audit(
      previous === null ? "created" : "updated",
      next,
    );
  } catch (error) {
    deps.warn("recipient audit failed", error);
  }
  return result(next);
}

export async function deactivateBrandPaystackRecipient(
  brandId: string,
  deps: BrandRecipientDeps,
): Promise<void> {
  let previous: BrandRecipientRow | null;
  try {
    previous = await deps.loadRecipient(brandId);
  } catch (error) {
    throw new BrandRecipientError("recipient_read_failed", 500, error);
  }
  if (previous === null || previous.is_active === false) return;

  try {
    await deps.deactivateRecipient(brandId);
  } catch (error) {
    throw new BrandRecipientError("recipient_store_failed", 500, error);
  }
  // #3192 — this brand is disconnecting, but another brand may settle to the
  // same bank account and therefore share this recipient code.
  await deleteRecipientIfUnshared(
    previous.recipient_code,
    brandId,
    deps,
    "deactivated recipient",
  );
  try {
    await deps.audit("deactivated", {
      ...previous,
      is_active: false,
    });
  } catch (error) {
    deps.warn("recipient audit failed", error);
  }
}
