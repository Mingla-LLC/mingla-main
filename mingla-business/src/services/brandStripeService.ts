/**
 * brandStripeService — frontend wrapper for B2a Stripe Connect edge functions.
 * Per SPEC_BIZ_CYCLE_B2A_STRIPE_CONNECT_ONBOARDING.md §4.3.1.
 *
 * Calls:
 *  - brand-stripe-onboard (initiates onboarding session)
 *  - brand-stripe-refresh-status (refresh from Stripe API; safety-net poll)
 *
 * Error contract per Const #3: throws on Postgrest/edge-fn error; never returns null.
 * Hook layer (useStartBrandStripeOnboarding + useBrandStripeStatus) maps to UI.
 */

import { supabase } from "./supabase";
// ORCH-0808 — organizer-funnel instrumentation.
import { logAppsFlyerEvent } from "./appsFlyerService";
import { businessWebOriginOverrideBody } from "./businessWebOriginOverride";
// #1863 — 403 classification. A permission denial must reach the hook layer as
// a typed, recognisable error instead of being flattened into a generic Error.
import { EdgeFunctionPermissionDeniedError } from "../utils/edgeFunctionErrors";

declare const __DEV__: boolean | undefined;

export type BrandStripeStatus =
  | "not_connected"
  | "onboarding"
  | "active"
  | "restricted";

export interface StartOnboardingResult {
  client_secret: string;
  account_id: string;
  onboarding_url: string;
}

export interface RefreshStatusResult {
  status: BrandStripeStatus;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  requirements: Record<string, unknown>;
  detached_at: string | null;
  stripe_account_id?: string | null;
  country?: string | null;
  default_currency?: string | null;
  details_submitted?: boolean;
}

export class BrandStripeCountryLockedError extends Error {
  readonly code = "country_locked";
  readonly existingCountry: string | null;
  readonly requestedCountry: string | null;
  readonly reason: string | null;

  constructor(input: {
    existingCountry?: string | null;
    requestedCountry?: string | null;
    reason?: string | null;
  }) {
    super(
      `Stripe is connected for ${
        input.existingCountry ?? "this country"
      }. To use a different country or currency, create a new brand.`,
    );
    this.name = "BrandStripeCountryLockedError";
    this.existingCountry = input.existingCountry ?? null;
    this.requestedCountry = input.requestedCountry ?? null;
    this.reason = input.reason ?? null;
  }
}

type SupabaseFunctionError = Error & {
  context?: {
    clone?: () => {
      json?: () => Promise<unknown>;
      text?: () => Promise<string>;
    };
    status?: number;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function formatFunctionErrorPayload(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  const error = typeof payload.error === "string" ? payload.error : null;
  const detail = typeof payload.detail === "string" ? payload.detail : null;
  if (error && detail) return `${error}: ${detail}`;
  return detail ?? error;
}

/** The exact `detail` `requirePaymentsManager` returns with its 403. */
const PERMISSION_DENIED_DETAIL = "permission_denied";

/**
 * #1863 §4.6 — is this edge-function response a ROLE denial?
 *
 * Keyed on `requirePaymentsManager`'s actual signature
 * (`supabase/functions/_shared/stripeEdgeAuth.ts`), which is
 * `403 {error:"forbidden", detail:"permission_denied"}`.
 *
 * NOT "any 403", and this narrowing is load-bearing. `brand-stripe-onboard`
 * returns `403 {error:"forbidden", detail:"mingla_tos_not_accepted"}` from its
 * Mingla-ToS gate (`brand-stripe-onboard/index.ts:337`) — same status, same
 * `error` field, entirely different rule, and one the caller CAN act on by
 * accepting the terms. Classifying it as a role denial would tell someone whose
 * role is fine to "ask the brand owner to change your role", which is the exact
 * class of lie this issue exists to remove, pointed the other way. So a 403 that
 * names a MORE SPECIFIC business rule in `detail` keeps its own message and its
 * own UI, exactly as before.
 *
 * The bare-403 case (no readable body) still counts: a proxy or a transport
 * that drops the body must not downgrade a denial into a retryable error.
 */
function isPermissionDeniedResponse(
  status: number | undefined,
  payload: unknown,
): boolean {
  const detail = isRecord(payload) && typeof payload.detail === "string"
    ? payload.detail
    : null;
  if (detail !== null && detail !== PERMISSION_DENIED_DETAIL) return false;
  if (status === 403) return true;
  return isRecord(payload) &&
    payload.error === "forbidden" &&
    detail === PERMISSION_DENIED_DETAIL;
}

/**
 * ORDER IS LOAD-BEARING (#1863 §4.6): country_locked → permission_denied →
 * generic.
 *
 * `country_locked` keeps precedence because it is a 400-class business rule
 * with its own dedicated UI (`BrandOnboardView.tsx` failed-stripe branch) and
 * must not be swallowed by the new permission branch.
 */
function mapFunctionErrorPayload(
  functionName: string,
  status: number | undefined,
  payload: unknown,
): Error | null {
  if (isRecord(payload) && payload.error === "country_locked") {
    return new BrandStripeCountryLockedError({
      existingCountry: typeof payload.existing_country === "string"
        ? payload.existing_country
        : null,
      requestedCountry: typeof payload.requested_country === "string"
        ? payload.requested_country
        : null,
      reason: typeof payload.reason === "string" ? payload.reason : null,
    });
  }
  if (isPermissionDeniedResponse(status, payload)) {
    const detail = isRecord(payload) && typeof payload.detail === "string"
      ? payload.detail
      : null;
    return new EdgeFunctionPermissionDeniedError(functionName, detail);
  }
  if (!isRecord(payload)) return null;
  const formatted = formatFunctionErrorPayload(payload);
  return formatted ? new Error(formatted) : null;
}

function shouldLogDiagnostics(): boolean {
  return typeof __DEV__ !== "undefined" && __DEV__ === true;
}

/**
 * #1863 §4.9 — DEV-ONLY diagnostic, split by whether the failure is expected.
 *
 * This is TESTING NOISE ONLY. `shouldLogDiagnostics()` is `__DEV__`, and React
 * Native's LogBox does not exist in a release build, so no production user has
 * ever seen this line. It is reclassified because a `console.error` on a
 * HANDLED permission boundary raised a red LogBox notification three times
 * every thirty seconds during testing — which is what got #1863 filed as a
 * toast covering a bank field, against the wrong subsystem entirely.
 *
 * `console.log` for a 403 because it raises NO LogBox notification.
 * `console.warn` is NOT an acceptable substitute — it raises a yellow one, so
 * the obvious "just downgrade it to warn" produces the same artefact in a
 * different colour. Every other status keeps `console.error`: a 500 or a
 * malformed payload IS a program error and must stay loud.
 */
function logEdgeFunctionDiagnostic(
  functionName: string,
  status: number | undefined,
  detail: Record<string, unknown>,
): void {
  if (!shouldLogDiagnostics()) return;
  if (status === 403) {
    console.log(`[${functionName}] permission denied (expected)`, {
      status,
      ...detail,
    });
    return;
  }
  console.error(`[${functionName}] edge function failed`, {
    status,
    ...detail,
  });
}

/**
 * Turns a Supabase `FunctionsHttpError` into the app's typed error.
 *
 * #1863 §4.8 — EXPORTED so `brandStripeBalancesService` routes its failures
 * through the identical classification instead of `throw error` (raw), which
 * bypassed every branch below and is why the balances twin kept 403-storming
 * after the primary was understood.
 */
export async function unwrapFunctionError(
  functionName: string,
  error: Error,
): Promise<Error> {
  const functionError = error as SupabaseFunctionError;
  const status = functionError.context?.status;
  const response = functionError.context?.clone?.();
  if (!response) {
    // No body to read. The status alone still classifies a denial — otherwise a
    // transport that omits `clone` would hand back a retryable generic Error.
    if (isPermissionDeniedResponse(status, null)) {
      return new EdgeFunctionPermissionDeniedError(functionName, null);
    }
    return error;
  }

  try {
    const payload = response.json ? await response.json() : null;
    logEdgeFunctionDiagnostic(functionName, status, { payload });
    const mapped = mapFunctionErrorPayload(functionName, status, payload);
    if (mapped) return mapped;
  } catch {
    try {
      const text = response.text ? await response.text() : "";
      logEdgeFunctionDiagnostic(functionName, status, { body: text });
      if (isPermissionDeniedResponse(status, null)) {
        return new EdgeFunctionPermissionDeniedError(functionName, null);
      }
      if (text.trim().length > 0) return new Error(text.trim());
    } catch {
      // Fall through to the original Supabase error.
    }
  }
  if (isPermissionDeniedResponse(status, null)) {
    return new EdgeFunctionPermissionDeniedError(functionName, null);
  }
  return error;
}

/**
 * Initiates Stripe Connect Express onboarding for a brand.
 *
 * @param brandId — UUID of the brand initiating onboarding
 * @param returnUrl — Deep link or web URL to return to after onboarding
 *   Must start with "mingla-business://" or the configured Mingla Business URL.
 * @throws on edge fn error, validation error, or permission denial
 */
export async function startBrandStripeOnboarding(
  brandId: string,
  returnUrl: string,
  country = "GB",
): Promise<StartOnboardingResult> {
  const { data, error } = await supabase.functions.invoke<
    StartOnboardingResult
  >(
    "brand-stripe-onboard",
    {
      body: {
        brand_id: brandId,
        return_url: returnUrl,
        country,
        ...businessWebOriginOverrideBody(),
      },
    },
  );
  if (error) throw await unwrapFunctionError("brand-stripe-onboard", error);
  if (data === null) {
    throw new Error("startBrandStripeOnboarding: edge fn returned null");
  }

  // ORCH-0808 — organizer-funnel: fires when the hosted-onboarding URL is
  // produced (i.e. the user committed to starting Stripe Connect). May fire
  // multiple times for the same brand if the user re-enters onboarding — the
  // "first activated" milestone gates the activation event server-side, not
  // here. Fire-and-forget; no-op when AppsFlyer env is missing.
  logAppsFlyerEvent("mingla_stripe_connect_started", { brand_id: brandId });

  return data;
}

/**
 * Refreshes brand Stripe Connect status from Stripe API.
 * Used as the 30s poll-fallback safety net per D-B2-11.
 *
 * @param brandId — UUID of the brand to refresh
 * @throws on edge fn error or permission denial
 */
export async function refreshBrandStripeStatus(
  brandId: string,
): Promise<RefreshStatusResult> {
  // No custom Authorization header: let supabase.functions.invoke use the
  // client's CURRENT (auto-refreshed) session token. META-ORCH-1073 Sub-A5:
  // passing useAuth()'s `session.access_token` here sent a STALE token (the
  // Supabase client refreshes silently but the React session snapshot lags),
  // which the edge fn's `auth.getUser` rejected with 401 — surfacing as
  // "Couldn't reach Stripe" on the onboarding shell's first load.
  const { data, error } = await supabase.functions.invoke<RefreshStatusResult>(
    "brand-stripe-refresh-status",
    {
      body: { brand_id: brandId },
    },
  );
  if (error) {
    throw await unwrapFunctionError("brand-stripe-refresh-status", error);
  }
  if (data === null) {
    throw new Error("refreshBrandStripeStatus: edge fn returned null");
  }
  return data;
}
