/**
 * Raw Stripe client for blueprint-mandated endpoints.
 *
 * ORCH-0764A uses direct API v2 HTTP calls because the copied Stripe blueprint
 * requires exact Accounts v2 endpoint paths. Raw /v2 requests must send a
 * Stripe-Version header; the SDK client pin in _shared/stripe.ts is intentionally
 * separate because it governs SDK-backed v1/legacy Stripe surfaces.
 */

import { STRIPE_API_VERSION } from "./stripe.ts";
import { resolveStripeKey, type StripeRole } from "./stripeMode.ts";

/**
 * Map legacy `envVarNames` literals to the canonical role enum used by
 * `_shared/stripeMode.ts`. ORCH-1056 routes blueprint-client key reads
 * through `resolveStripeKey(role)` so they pick up the mode-suffixed
 * env vars (`STRIPE_RAK_{ROLE}_{TEST|LIVE}`) instead of the unsuffixed
 * legacy secrets. The literal `envVarNames: ["STRIPE_RAK_ONBOARD"]` is
 * preserved as a stable handle for the ORCH-0954 strict-grep gate.
 */
const ENV_VAR_TO_ROLE: Record<string, StripeRole> = {
  STRIPE_RAK_ONBOARD: "ONBOARD",
  STRIPE_RAK_WEBHOOK: "WEBHOOK",
  STRIPE_RAK_REFRESH_STATUS: "REFRESH_STATUS",
  STRIPE_RAK_DETACH: "DETACH",
  STRIPE_RAK_BALANCES: "BALANCES",
  STRIPE_RAK_KYC_REMINDER: "KYC_REMINDER",
  STRIPE_RAK_TICKET_CHECKOUT: "TICKET_CHECKOUT",
  STRIPE_RAK_TICKET_REFUND: "TICKET_REFUND",
  STRIPE_RAK_TAX_DASHBOARD: "TAX_DASHBOARD",
};

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

/**
 * ORCH-1056: legacy `envVarNames` literals (e.g. `["STRIPE_RAK_ONBOARD"]`)
 * are translated to the canonical `StripeRole` and resolved through
 * `_shared/stripeMode.ts` so the key is mode-routed
 * (`STRIPE_RAK_{ROLE}_{TEST|LIVE}`). If no entry maps to a known role we
 * fall back to the historic direct-env behavior — preserves operability
 * for any externally-passed env name during migration windows.
 */
function resolveBlueprintStripeKey(envVarNames: readonly string[]): string {
  for (const envVarName of envVarNames) {
    const role = ENV_VAR_TO_ROLE[envVarName];
    if (role !== undefined) {
      return resolveStripeKey(role);
    }
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
  const key = resolveBlueprintStripeKey(options.envVarNames);
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
  /**
   * Issue #3258 — the account's publicly-available website, prefilled by the
   * platform at CREATE time so Stripe never has to ask the seller for one.
   *
   * Stripe fetches this URL to verify the business before it will enable the
   * `card_payments` capability. Sending nothing means the seller is asked for
   * a website inside Connect onboarding and types whatever they have; when
   * that site is unreachable, `card_payments` sits at `pending` forever with
   * `disabled_reason = requirements.pending_verification` and
   * `pending_verification: ["business_profile.url"]`, and the brand cannot
   * take money. Stripe's own hosted-onboarding guidance is explicit: "If you
   * onboard an account and your platform provides it with a URL, prefill the
   * account's business_profile.url."
   * (https://docs.stripe.com/connect/hosted-onboarding)
   *
   * MUST include the scheme — a bare `www.example.com` is rejected with
   * `invalid_url_format`. Optional: omit it and the request body is
   * byte-identical to the pre-#3258 shape.
   */
  businessUrl?: string | null;
  /**
   * Issue #3258 — Stripe's documented fallback when the account genuinely has
   * no public page: "If the business doesn't have a URL, you can prefill its
   * business_profile.product_description instead."
   * (https://docs.stripe.com/connect/hosted-onboarding)
   *
   * Only ever sent when `businessUrl` is absent. Stripe rejects a body that
   * carries the same string as both with `invalid_product_description_url_match`,
   * and `buildRecipientAccountDefaults` below makes that unrepresentable.
   */
  productDescription?: string | null;
}

/**
 * Issue #3258 — build the `defaults` object for `POST /v2/core/accounts`.
 *
 * THIS FUNCTION EXISTS BECAUSE OF A COLLISION, and the collision is the most
 * dangerous line in the whole change. `STRIPE_MANAGED_RISK_CONTROLLER` does
 * not merely contribute `dashboard` — it supplies the ENTIRE `defaults` key
 * (`defaults.responsibilities.{losses_collector,fees_collector}`), and it
 * reaches the request body through a spread. Writing a sibling
 * `defaults: { profile: { business_url } }` next to that spread would silently
 * drop `responsibilities` (or be dropped by it, depending on spread order),
 * which on a LIVE marketplace changes who absorbs losses and who collects
 * fees. So the profile is MERGED onto the controller's own defaults here, in
 * one place, and pinned by regression tests.
 *
 * The v2 field path is `defaults.profile.business_url` — Accounts v2 has no
 * `business_profile` object, and neither `identity.business_details.url` nor
 * `configuration.merchant.business_profile.url` exists.
 * (https://docs.stripe.com/api/v2/core/accounts/create)
 *
 * `business_url` and `product_description` are mutually exclusive by
 * construction: the URL wins whenever there is one, so the body can never
 * carry both, and never the same string twice.
 */
export function buildRecipientAccountDefaults(
  input: Pick<
    CreateRecipientAccountInput,
    "businessUrl" | "productDescription"
  >,
): Record<string, unknown> {
  const controllerDefaults: Record<string, unknown> = {
    ...STRIPE_MANAGED_RISK_CONTROLLER.defaults,
  };
  const businessUrl = typeof input.businessUrl === "string"
    ? input.businessUrl.trim()
    : "";
  if (businessUrl !== "") {
    return {
      ...controllerDefaults,
      profile: { business_url: businessUrl },
    };
  }
  const productDescription = typeof input.productDescription === "string"
    ? input.productDescription.trim()
    : "";
  if (productDescription !== "") {
    return {
      ...controllerDefaults,
      profile: { product_description: productDescription },
    };
  }
  // Neither supplied — byte-identical to the pre-#3258 body.
  return controllerDefaults;
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
      // Issue #3258 — DELIBERATELY AFTER the spread, and deliberately a merge.
      // The spread above supplies `defaults.responsibilities`; this key
      // replaces that whole object, so `buildRecipientAccountDefaults` carries
      // the controller's own defaults forward. Reorder these two lines or drop
      // the merge and the managed-risk responsibilities vanish from the wire.
      defaults: buildRecipientAccountDefaults(input),
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

// ── #1173 (sub-issue D) — event-anchored payout schedule flip ────────────────
export type PayoutScheduleInterval = "manual" | "daily";

/**
 * #1173 (sub-issue D, #1013 initiative) — flip a v2-created connected account's
 * payout schedule between Stripe's default `daily` auto-sweep and `manual`
 * (event-anchored hold), so sale proceeds accrue on the connected account
 * instead of sweeping out daily. This is the Stripe half of event-anchored
 * payouts; the already-live ledger/sweep (B/#1171, C/#1172) counts only
 * post-cutover money.
 *
 * Shape (proven live at implement time on our exact v2 account — S-H1/S-H9 and
 * the #1173 STOP-AND-AMEND test-mode RAK-scope probe: manual & daily both 200):
 *  - `POST /v1/accounts/{id}` — the `/v1/` prefix makes `stripeBlueprintRequest`
 *    form-urlencode the body (`settings[payouts][schedule][interval]=...`);
 *    Stripe rejects JSON on v1.
 *  - `apiVersion: STRIPE_API_VERSION` ("dahlia") — REQUIRED. This is a v1 path,
 *    so we pin the v1 API version exactly as `createAccountSession` does for its
 *    own v1 call; the default blueprint preview version is v2-only.
 *  - `STRIPE_RAK_ONBOARD` — the Connect account-write restricted key. It already
 *    creates v2 accounts; the payout-schedule write falls under the same Connect
 *    account-write scope (probe-confirmed). Do NOT add a new RAK role.
 *
 * Idempotency: setting the same interval again is a Stripe no-op — natural
 * idempotency (I-1013-RETRY-KEEPS-REFERENCE). The caller supplies the key.
 */
export function setPayoutScheduleInterval(
  accountId: string,
  interval: PayoutScheduleInterval,
  idempotencyKey: string,
): Promise<StripeV2Account> {
  return stripeBlueprintRequest<StripeV2Account>({
    method: "POST",
    path: `/v1/accounts/${accountId}`,
    envVarNames: ["STRIPE_RAK_ONBOARD"],
    apiVersion: STRIPE_API_VERSION,
    idempotencyKey,
    body: {
      settings: { payouts: { schedule: { interval } } },
    },
  });
}

/** Flip a connected account to a manual (event-anchored hold) payout schedule. */
export function setManualPayoutSchedule(
  accountId: string,
  idempotencyKey: string,
): Promise<StripeV2Account> {
  return setPayoutScheduleInterval(accountId, "manual", idempotencyKey);
}

/**
 * Restore a connected account to Stripe's default `daily` auto-sweep — the
 * documented per-brand rollback lever (compensation on stamp failure + admin
 * `direction:"rollback"`).
 */
export function restoreDailyPayoutSchedule(
  accountId: string,
  idempotencyKey: string,
): Promise<StripeV2Account> {
  return setPayoutScheduleInterval(accountId, "daily", idempotencyKey);
}
