export type BrandRecipientRow = {
  recipient_code: string;
  bank_code: string;
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
  loadRecipient: (brandId: string) => Promise<BrandRecipientRow | null>;
  persistRecipient: (
    brandId: string,
    recipient: BrandRecipientRow,
  ) => Promise<void>;
  deactivateRecipient: (brandId: string) => Promise<void>;
  audit: (
    action: "created" | "updated" | "deactivated",
    recipient: BrandRecipientRow,
  ) => Promise<void>;
  warn: (message: string, error: unknown) => void;
};

function result(row: BrandRecipientRow): BrandRecipientResult {
  return {
    recipient_code: row.recipient_code,
    account_name: row.account_name,
    account_number_masked: row.account_number_masked,
    is_active: true,
  };
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
    previous.account_number_masked === masked &&
    previous.account_name === resolved.account_name
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
    account_number_masked: masked,
    account_name: resolved.account_name,
    is_active: true,
  };
  try {
    await deps.persistRecipient(input.brandId, next);
  } catch (error) {
    try {
      await deps.deleteRecipient(recipientCode);
    } catch (cleanupError) {
      deps.warn("new recipient rollback delete failed", cleanupError);
    }
    throw new BrandRecipientError("recipient_store_failed", 500, error);
  }

  if (
    previous?.recipient_code &&
    previous.recipient_code !== recipientCode
  ) {
    try {
      await deps.deleteRecipient(previous.recipient_code);
    } catch (error) {
      deps.warn("previous recipient delete failed", error);
    }
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
  try {
    await deps.deleteRecipient(previous.recipient_code);
  } catch (error) {
    deps.warn("deactivated recipient provider delete failed", error);
  }
  try {
    await deps.audit("deactivated", {
      ...previous,
      is_active: false,
    });
  } catch (error) {
    deps.warn("recipient audit failed", error);
  }
}
