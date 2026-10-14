import {
  isSecureStoreAvailable,
  secureDeleteItem,
  secureGetItem,
  secureSetItem,
} from "../lib/secureStoreSafe";
import { supabase } from "../services/supabase";
import { extractFunctionError } from "../utils/edgeFunctionError";

export const NATIVE_CHECKOUT_PENDING_TITLE = "Confirming payment";
export const NATIVE_CHECKOUT_PENDING_BODY =
  "You can leave this screen. We’ll update the booking as soon as the payment provider confirms it.";
export const NATIVE_CHECKOUT_SUCCESS_TITLE = "You’re booked";

const RECOVERY_KEY = "mingla:checkout-recovery:v1";
const RECOVERY_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_TOKEN_LENGTH = 1024;

export type NativeCheckoutRecoveryProvider = "stripe";

export interface NativeCheckoutRecoveryPointer {
  version: 1;
  checkoutSessionId: string;
  buyerStatusToken: string;
  accountId: string;
  eventId: string;
  provider: NativeCheckoutRecoveryProvider;
  createdAt: number;
  expiresAt: number;
}

export type NativeCheckoutOutcome =
  | {
      outcome: "succeeded";
      orderId: string;
      provider?: NativeCheckoutPurchaseProvider;
      title?: string;
      recovered?: boolean;
    }
  | {
      outcome: "pending";
      title: typeof NATIVE_CHECKOUT_PENDING_TITLE;
      message: typeof NATIVE_CHECKOUT_PENDING_BODY;
      recovered?: boolean;
    }
  | { outcome: "canceled"; recovered?: boolean; retryable?: boolean }
  | {
      outcome: "failed";
      message: string;
      token?: string | null;
      recovered?: boolean;
      /** Server-authoritative permission to create a fresh checkout attempt. */
      retryable?: boolean;
    };

type ConfirmationResponse = {
  status?: string;
  order?: {
    orderId?: string;
    tickets?: unknown[];
    totalCents?: number;
    currency?: string;
  } | null;
  error?: string;
};

type ReconcileSource = "payment_completed" | "payment_canceled" | "recovery";

const reportedPurchaseOrders = new Set<string>();
const reportedRecoverySessions = new Set<string>();
const reportedPendingSessions = new Set<string>();

const ANALYTICS_SURFACE = "consumer_app";

const captureNativeCheckoutAnalytics = (
  event: string,
  properties: Record<string, string | boolean | number>,
): void => {
  try {
    // Keep the optional analytics SDK out of the payment flow's eager module
    // graph. This is the same fixed-path lazy rail used by auth cleanup.
    const { postHogService } =
      require("../services/postHogService") as typeof import("../services/postHogService");
    postHogService.capture(event, properties);
  } catch {
    // Analytics must never change payment or recovery truth.
  }
};

const isBoundedString = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max;

export const parseNativeCheckoutRecoveryPointer = (
  raw: string | null,
): NativeCheckoutRecoveryPointer | null => {
  if (raw === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const row = value as Record<string, unknown>;
  const allowedKeys = new Set([
    "version",
    "checkoutSessionId",
    "buyerStatusToken",
    "accountId",
    "eventId",
    "provider",
    "createdAt",
    "expiresAt",
  ]);
  if (Object.keys(row).some((key) => !allowedKeys.has(key))) return null;
  if (
    row.version !== 1 ||
    !isBoundedString(row.checkoutSessionId, 128) ||
    !isBoundedString(row.buyerStatusToken, MAX_TOKEN_LENGTH) ||
    !isBoundedString(row.accountId, 128) ||
    !isBoundedString(row.eventId, 128) ||
    row.provider !== "stripe" ||
    typeof row.createdAt !== "number" ||
    !Number.isFinite(row.createdAt) ||
    typeof row.expiresAt !== "number" ||
    !Number.isFinite(row.expiresAt) ||
    row.expiresAt <= row.createdAt ||
    row.expiresAt - row.createdAt > RECOVERY_TTL_MS
  ) {
    return null;
  }
  return row as unknown as NativeCheckoutRecoveryPointer;
};

export const createNativeCheckoutRecoveryPointer = (input: {
  checkoutSessionId: string;
  buyerStatusToken: string;
  accountId: string;
  eventId: string;
  now?: number;
}): NativeCheckoutRecoveryPointer => {
  const createdAt = input.now ?? Date.now();
  return {
    version: 1,
    checkoutSessionId: input.checkoutSessionId,
    buyerStatusToken: input.buyerStatusToken,
    accountId: input.accountId,
    eventId: input.eventId,
    provider: "stripe",
    createdAt,
    expiresAt: createdAt + RECOVERY_TTL_MS,
  };
};

export const persistNativeCheckoutRecovery = async (
  pointer: NativeCheckoutRecoveryPointer,
): Promise<boolean> => {
  if (!isSecureStoreAvailable()) return false;
  try {
    await secureSetItem(RECOVERY_KEY, JSON.stringify(pointer));
    return true;
  } catch {
    return false;
  }
};

export const isNativeCheckoutRecoveryAvailable = (): boolean =>
  isSecureStoreAvailable();

export const readNativeCheckoutRecovery = async (): Promise<
  NativeCheckoutRecoveryPointer | null
> => {
  try {
    const raw = await secureGetItem(RECOVERY_KEY);
    const parsed = parseNativeCheckoutRecoveryPointer(raw);
    if (
      raw !== null &&
      (parsed === null || parsed.expiresAt <= Date.now())
    ) {
      await secureDeleteItem(RECOVERY_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

export const clearNativeCheckoutRecovery = async (): Promise<void> => {
  try {
    await secureDeleteItem(RECOVERY_KEY);
  } catch {
    // Secure-store failure cannot be allowed to break sign-out or confirmation.
  }
};

export const purgeNativeCheckoutRecovery = async (): Promise<void> => {
  await clearNativeCheckoutRecovery();
  reportedPurchaseOrders.clear();
  reportedRecoverySessions.clear();
  reportedPendingSessions.clear();
};

export type NativePurchaseAnalyticsInput = {
  orderId: string;
  eventId: string;
  provider: NativeCheckoutPurchaseProvider;
  recovered: boolean;
  totalCents?: number;
  currency?: string;
};

export type NativeCheckoutPurchaseProvider = "free" | "stripe" | "paystack";

export const claimNativePurchaseCompleted = (orderId: string): boolean => {
  if (!isBoundedString(orderId, 128) || reportedPurchaseOrders.has(orderId)) {
    return false;
  }
  reportedPurchaseOrders.add(orderId);
  return true;
};

export const nativePurchaseAnalyticsProperties = (
  input: Omit<NativePurchaseAnalyticsInput, "orderId">,
): Record<string, string | boolean | number> => {
  const properties: Record<string, string | boolean | number> = {
    event_id: input.eventId.slice(0, 128),
    provider: input.provider,
    surface: ANALYTICS_SURFACE,
    recovered: input.recovered,
  };
  if (
    typeof input.totalCents === "number" &&
    Number.isFinite(input.totalCents) &&
    input.totalCents >= 0
  ) {
    properties.value = Math.round(input.totalCents) / 100;
  }
  const currency = input.currency?.trim().toUpperCase() ?? "";
  if (/^[A-Z]{3}$/.test(currency)) properties.currency = currency;
  return properties;
};

export const captureNativePurchaseCompleted = (
  input: NativePurchaseAnalyticsInput,
): boolean => {
  if (!claimNativePurchaseCompleted(input.orderId)) return false;
  captureNativeCheckoutAnalytics(
    "purchase_completed",
    nativePurchaseAnalyticsProperties(input),
  );
  return true;
};

const capturePurchaseOnce = (
  pointer: NativeCheckoutRecoveryPointer,
  orderId: string,
  recovered: boolean,
  totalCents?: number,
  currency?: string,
): void => {
  captureNativePurchaseCompleted({
    orderId,
    eventId: pointer.eventId,
    provider: pointer.provider,
    recovered,
    totalCents,
    currency,
  });
};

const captureRecoveryOnce = (
  pointer: NativeCheckoutRecoveryPointer,
  outcome: "succeeded" | "pending" | "failed",
): void => {
  if (reportedRecoverySessions.has(pointer.checkoutSessionId)) return;
  reportedRecoverySessions.add(pointer.checkoutSessionId);
  captureNativeCheckoutAnalytics("checkout_recovered", {
    event_id: pointer.eventId,
    provider: pointer.provider,
    surface: ANALYTICS_SURFACE,
    outcome,
  });
};

const pendingOutcome = (recovered: boolean): NativeCheckoutOutcome => ({
  outcome: "pending",
  title: NATIVE_CHECKOUT_PENDING_TITLE,
  message: NATIVE_CHECKOUT_PENDING_BODY,
  recovered,
});

const capturePendingOnce = (
  pointer: NativeCheckoutRecoveryPointer,
  reason: "confirmation_unavailable" | "order_not_finalized" | "provider_pending",
): void => {
  if (reportedPendingSessions.has(pointer.checkoutSessionId)) return;
  reportedPendingSessions.add(pointer.checkoutSessionId);
  captureNativeCheckoutAnalytics("checkout_pending", {
    event_id: pointer.eventId,
    provider: pointer.provider,
    surface: ANALYTICS_SURFACE,
    outcome: reason,
  });
};

const recoveryAttentionOutcome = (
  recovered: boolean,
  token: string | null,
): NativeCheckoutOutcome => ({
  outcome: "failed",
  message:
    "We can’t securely recover this payment. Contact support before trying again.",
  token,
  recovered,
  retryable: false,
});

export const reconcileNativeCheckout = async (
  pointer: NativeCheckoutRecoveryPointer,
  source: ReconcileSource,
): Promise<NativeCheckoutOutcome> => {
  let data: ConfirmationResponse | null = null;
  let error: unknown = null;
  try {
    ({ data, error } = await supabase.functions.invoke<ConfirmationResponse>(
      "ticket-checkout-confirm",
      {
        body: {
          checkoutSessionId: pointer.checkoutSessionId,
          buyerStatusToken: pointer.buyerStatusToken,
        },
      },
    ));
  } catch {
    error = new Error("confirmation_unavailable");
  }

  const recovered = source === "recovery";
  if (error !== null) {
    const status =
      (error as { context?: { status?: number } })?.context?.status ?? null;
    if (
      typeof status === "number" &&
      status >= 400 &&
      status < 500 &&
      status !== 429
    ) {
      const extracted = await extractFunctionError(error, "");
      const token = extracted.length > 0 && extracted.length <= 128
        ? extracted
        : null;
      if (recovered) captureRecoveryOnce(pointer, "failed");
      await clearNativeCheckoutRecovery();
      if (status === 409 || token === "checkout_unavailable") {
        return {
          outcome: "failed",
          message:
            "This payment needs attention. Don’t try again. Contact support if it does not update.",
          token: token ?? "checkout_unavailable",
          recovered,
          retryable: false,
        };
      }
      return recoveryAttentionOutcome(recovered, token);
    }
    if (recovered) captureRecoveryOnce(pointer, "pending");
    capturePendingOnce(pointer, "confirmation_unavailable");
    return pendingOutcome(recovered);
  }
  if (data === null) {
    if (recovered) captureRecoveryOnce(pointer, "pending");
    capturePendingOnce(pointer, "confirmation_unavailable");
    return pendingOutcome(recovered);
  }

  const orderId = data.order?.orderId;
  const ticketCount = Array.isArray(data.order?.tickets)
    ? data.order.tickets.length
    : 0;
  if (
    data.status === "paid" &&
    typeof orderId === "string" &&
    orderId.length > 0 &&
    ticketCount > 0
  ) {
    if (recovered) {
      capturePurchaseOnce(
        pointer,
        orderId,
        true,
        data.order?.totalCents,
        data.order?.currency,
      );
    }
    if (recovered) captureRecoveryOnce(pointer, "succeeded");
    await clearNativeCheckoutRecovery();
    return {
      outcome: "succeeded",
      orderId,
      provider: pointer.provider,
      title: NATIVE_CHECKOUT_SUCCESS_TITLE,
      recovered,
    };
  }

  if (data.error === "checkout_unavailable") {
    if (recovered) captureRecoveryOnce(pointer, "failed");
    await clearNativeCheckoutRecovery();
    return {
      outcome: "failed",
      message:
        "This payment needs attention. Don’t try again. Contact support if it does not update.",
      token: "checkout_unavailable",
      recovered,
      retryable: false,
    };
  }

  if (data.status === "failed" || data.status === "expired") {
    if (recovered) captureRecoveryOnce(pointer, "failed");
    await clearNativeCheckoutRecovery();
    if (source === "payment_canceled") {
      captureNativeCheckoutAnalytics("checkout_provider_cancelled", {
        event_id: pointer.eventId,
        provider: pointer.provider,
        surface: ANALYTICS_SURFACE,
      });
      return { outcome: "canceled", recovered, retryable: true };
    }
    captureNativeCheckoutAnalytics("checkout_failed", {
      event_id: pointer.eventId,
      provider: pointer.provider,
      surface: ANALYTICS_SURFACE,
      outcome: data.status === "expired" ? "expired" : "payment_not_completed",
    });
    return {
      outcome: "failed",
      message:
        data.status === "expired"
          ? "This payment session expired. Review your booking and try again."
          : "Payment wasn’t completed. Review your booking and try again.",
      token: data.error ?? null,
      recovered,
      retryable: true,
    };
  }

  if (recovered) captureRecoveryOnce(pointer, "pending");
  capturePendingOnce(
    pointer,
    data.status === "paid" ? "order_not_finalized" : "provider_pending",
  );
  return pendingOutcome(recovered);
};

export const recoverNativeCheckout = async (input: {
  accountId: string;
  eventId: string;
}): Promise<NativeCheckoutOutcome | null> => {
  const pointer = await readNativeCheckoutRecovery();
  if (
    pointer === null ||
    pointer.accountId !== input.accountId ||
    pointer.eventId !== input.eventId
  ) {
    return null;
  }
  return reconcileNativeCheckout(pointer, "recovery");
};
