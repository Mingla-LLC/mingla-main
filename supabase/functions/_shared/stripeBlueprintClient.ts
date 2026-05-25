/**
 * Raw Stripe client for blueprint-mandated endpoints.
 *
 * ORCH-0764A uses direct API v2 HTTP calls because the copied Stripe blueprint
 * requires exact Accounts v2 endpoint paths. Raw /v2 requests must send a
 * Stripe-Version header; the SDK client pin in _shared/stripe.ts is intentionally
 * separate because it governs SDK-backed v1/legacy Stripe surfaces.
 */

export const STRIPE_BLUEPRINT_API_VERSION = "2026-04-22.preview" as const;

export interface StripeBlueprintRequestOptions {
  method: "POST";
  path: string;
  body: Record<string, unknown>;
  idempotencyKey?: string;
  envVarNames: readonly string[];
}

export interface StripeV2Account {
  id: string;
  [key: string]: unknown;
}

export interface StripeV2AccountLink {
  id?: string;
  url: string;
  [key: string]: unknown;
}

function resolveStripeKey(envVarNames: readonly string[]): string {
  for (const envVarName of envVarNames) {
    const value = Deno.env.get(envVarName);
    if (value && value.trim().length > 0) {
      return value;
    }
  }
  throw new Error(
    `${
      envVarNames.join(" or ")
    } environment variable is not set. Configure Stripe credentials in Supabase Edge Function secrets.`,
  );
}

function safeStripeErrorMessage(payload: unknown, fallback: string): string {
  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    payload.error &&
    typeof payload.error === "object" &&
    "message" in payload.error &&
    typeof payload.error.message === "string"
  ) {
    return payload.error.message;
  }
  return fallback;
}

export async function stripeBlueprintRequest<T>(
  options: StripeBlueprintRequestOptions,
): Promise<T> {
  const key = resolveStripeKey(options.envVarNames);
  const headers = new Headers({
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  });
  headers.set("Stripe-Version", STRIPE_BLUEPRINT_API_VERSION);
  if (options.idempotencyKey) {
    headers.set("Idempotency-Key", options.idempotencyKey);
  }

  const response = await fetch(`https://api.stripe.com${options.path}`, {
    method: options.method,
    headers,
    body: JSON.stringify(options.body),
  });

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // Leave payload null; response status will still produce a safe error.
  }

  if (!response.ok) {
    const detail = safeStripeErrorMessage(
      payload,
      `Stripe request failed with status ${response.status}`,
    );
    throw new Error(detail);
  }

  return payload as T;
}

export interface CreateRecipientAccountInput {
  displayName: string;
  contactEmail: string;
  country: string;
  idempotencyKey: string;
}

export function createRecipientAccount(
  input: CreateRecipientAccountInput,
): Promise<StripeV2Account> {
  return stripeBlueprintRequest<StripeV2Account>({
    method: "POST",
    path: "/v2/core/accounts",
    envVarNames: ["STRIPE_RAK_ONBOARD"],
    idempotencyKey: input.idempotencyKey,
    body: {
      configuration: {
        recipient: {
          capabilities: {
            stripe_balance: {
              stripe_transfers: {
                requested: true,
              },
            },
          },
        },
        merchant: {
          capabilities: {
            card_payments: {
              requested: true,
            },
          },
        },
      },
      display_name: input.displayName,
      contact_email: input.contactEmail,
      defaults: {
        responsibilities: {
          losses_collector: "application",
          fees_collector: "application",
        },
      },
      dashboard: "express",
      include: [
        "configuration.merchant",
        "configuration.recipient",
        "identity",
        "defaults",
        "configuration.customer",
      ],
      identity: {
        country: input.country,
      },
    },
  });
}

export interface CreateRecipientAccountLinkInput {
  accountId: string;
  refreshUrl: string;
  returnUrl: string;
  idempotencyKey: string;
}

export function createRecipientAccountLink(
  input: CreateRecipientAccountLinkInput,
): Promise<StripeV2AccountLink> {
  return stripeBlueprintRequest<StripeV2AccountLink>({
    method: "POST",
    path: "/v2/core/account_links",
    envVarNames: ["STRIPE_RAK_ONBOARD"],
    idempotencyKey: input.idempotencyKey,
    body: {
      account: input.accountId,
      use_case: {
        type: "account_onboarding",
        account_onboarding: {
          configurations: ["recipient", "merchant"],
          refresh_url: input.refreshUrl,
          return_url: input.returnUrl,
        },
      },
    },
  });
}
