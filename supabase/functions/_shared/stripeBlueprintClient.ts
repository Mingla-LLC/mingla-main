/**
 * Raw Stripe client for blueprint-mandated endpoints.
 *
 * ORCH-0764A uses direct API v2 HTTP calls because the copied Stripe blueprint
 * requires exact Accounts v2 endpoint paths. Raw /v2 requests must send a
 * Stripe-Version header; the SDK client pin in _shared/stripe.ts is intentionally
 * separate because it governs SDK-backed v1/legacy Stripe surfaces.
 */

import { STRIPE_API_VERSION } from "./stripe.ts";

export const STRIPE_BLUEPRINT_API_VERSION = "2026-04-22.preview" as const;

export const STRIPE_MANAGED_RISK_CONTROLLER = {
  defaults: {
    responsibilities: {
      losses_collector: "stripe",
      fees_collector: "stripe",
    },
  },
  dashboard: "none",
} as const;

export interface StripeBlueprintRequestOptions {
  method: "POST";
  path: string;
  body: Record<string, unknown>;
  idempotencyKey?: string;
  envVarNames: readonly string[];
  apiVersion?: string;
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

export interface AccountSessionComponents {
  account_onboarding?: {
    enabled: boolean;
    features?: {
      external_account_collection?: boolean;
      disable_stripe_user_authentication?: boolean;
    };
  };
  account_management?: {
    enabled: boolean;
    features?: {
      external_account_collection?: boolean;
      disable_stripe_user_authentication?: boolean;
    };
  };
  notification_banner?: {
    enabled: boolean;
    features?: {
      external_account_collection?: boolean;
      disable_stripe_user_authentication?: boolean;
    };
  };
}

export interface CreateAccountSessionInput {
  accountId: string;
  components: AccountSessionComponents;
  idempotencyKey: string;
}

export interface StripeAccountSession {
  client_secret: string;
  expires_at: number;
  components: Record<string, unknown>;
  account: string;
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

/**
 * Serialize an arbitrarily-nested body into Stripe v1's bracketed
 * application/x-www-form-urlencoded format.
 *
 *   { components: { account_onboarding: { enabled: true } } }
 *     → components[account_onboarding][enabled]=true
 *
 * Used for /v1/* paths (Stripe rejects JSON there). /v2/* paths still send
 * JSON via the JSON.stringify branch below.
 *
 * ORCH-1052 hotfix: prior helper unconditionally JSON-encoded all bodies,
 * which works for /v2/core/* but blows up at /v1/account_sessions with
 * "Invalid request (check that your POST content type is application/x-www-
 * form-urlencoded)". Affects every consumer that mints AccountSessions
 * (partner-stripe-onboard, partner-stripe-account-session, brand-stripe-
 * onboard, brand-stripe-account-session).
 */
function toStripeFormUrlEncoded(input: unknown, prefix = ""): string {
  if (input === null || input === undefined) return "";
  const pairs: string[] = [];
  const walk = (value: unknown, key: string): void => {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, `${key}[${i}]`));
      return;
    }
    if (typeof value === "object") {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        walk(v, key ? `${key}[${k}]` : k);
      }
      return;
    }
    pairs.push(
      `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
    );
  };
  walk(input, prefix);
  return pairs.join("&");
}

export async function stripeBlueprintRequest<T>(
  options: StripeBlueprintRequestOptions,
): Promise<T> {
  const key = resolveStripeKey(options.envVarNames);
  // ORCH-1052 hotfix — Stripe v1 endpoints require form-urlencoded; v2
  // accept (and prefer) JSON. Branch on path prefix instead of hard-coding
  // JSON for every blueprint call.
  const isV1Path = options.path.startsWith("/v1/");
  const headers = new Headers({
    Authorization: `Bearer ${key}`,
    "Content-Type": isV1Path
      ? "application/x-www-form-urlencoded"
      : "application/json",
  });
  headers.set(
    "Stripe-Version",
    options.apiVersion ?? STRIPE_BLUEPRINT_API_VERSION,
  );
  if (options.idempotencyKey) {
    headers.set("Idempotency-Key", options.idempotencyKey);
  }

  const requestBody = isV1Path
    ? toStripeFormUrlEncoded(options.body)
    : JSON.stringify(options.body);

  const response = await fetch(`https://api.stripe.com${options.path}`, {
    method: options.method,
    headers,
    body: requestBody,
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
      ...STRIPE_MANAGED_RISK_CONTROLLER,
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

export function createAccountSession(
  input: CreateAccountSessionInput,
): Promise<StripeAccountSession> {
  return stripeBlueprintRequest<StripeAccountSession>({
    method: "POST",
    path: "/v1/account_sessions",
    envVarNames: ["STRIPE_RAK_ONBOARD"],
    apiVersion: STRIPE_API_VERSION,
    idempotencyKey: input.idempotencyKey,
    body: {
      account: input.accountId,
      components: input.components,
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
