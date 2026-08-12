import {
  type BindingRow,
  type DimensionEvidence,
  evidence,
  type ReadinessProvider,
  type TargetRow,
} from "../adAppReadiness.ts";
import type { AdConnectionRow } from "../adChannelCore.ts";

export interface ReadinessConnection {
  id: string;
  platform: string;
  lane: string;
  display_name: string;
  external_account_id: string;
  connected: boolean;
  status: string;
  account_status: string | null;
  extra: Record<string, unknown> | null;
  external_org_id?: string | null;
  auth_kind?: "system_user_token" | "refresh_token" | "dev_token_oauth";
  token_env_var?: string;
  currency?: string | null;
  timezone?: string | null;
  min_daily_budget_cents?: number | null;
  token_last_verified_at?: string | null;
}

export interface VerifyContext {
  target: TargetRow;
  binding: BindingRow;
  connection: ReadinessConnection | null;
  identitySafeId?: string;
  identityRecord?: Record<string, unknown>;
  signal: AbortSignal;
  deadlineMs: number;
  checkedAt: string;
}

export interface ProviderEvidence {
  provider: ReadinessProvider;
  reason_code: string;
  dimensions: DimensionEvidence;
}

type AttestationDimension = "native_binding" | "measurement";

function currentAttestation(
  ctx: VerifyContext,
  dimension: AttestationDimension,
) {
  const prefix = dimension === "native_binding"
    ? "native_binding"
    : "measurement";
  const checkedAt = ctx.binding[`${prefix}_attested_at`];
  const expiresAt = ctx.binding[`${prefix}_attestation_expires_at`];
  const safeId = ctx.binding[`${prefix}_attestation_safe_id`];
  const provenance = ctx.binding[`${prefix}_attestation_provenance`];
  const attestedBy = ctx.binding[`${prefix}_attested_by`];
  const expectedId = dimension === "native_binding"
    ? ctx.binding.provider_app_id
    : ctx.binding.provider_measurement_id;
  const expectedProvenance = dimension === "native_binding"
    ? "provider_dashboard"
    : "appsflyer_dashboard";
  if (
    !checkedAt || !expiresAt || !safeId || !attestedBy || !expectedId ||
    provenance !== expectedProvenance || safeId !== expectedId
  ) return null;
  const checkedMs = Date.parse(checkedAt);
  const expiresMs = Date.parse(expiresAt);
  const nowMs = Date.parse(ctx.checkedAt);
  if (
    !Number.isFinite(checkedMs) || !Number.isFinite(expiresMs) ||
    checkedMs > nowMs || expiresMs <= nowMs ||
    expiresMs - checkedMs !== 15 * 60 * 1000
  ) return null;
  return evidence(
    "proven",
    dimension === "native_binding"
      ? `A current provider-dashboard attestation confirms the exact ${ctx.target.display_name} ${ctx.target.os} binding.`
      : "A current AppsFlyer-dashboard attestation confirms the exact partner and install-event mapping.",
    checkedAt,
    "dashboard_attestation",
    safeId,
  );
}

export function currentNativeBindingAttestation(ctx: VerifyContext) {
  return currentAttestation(ctx, "native_binding");
}

export function currentMeasurementAttestation(ctx: VerifyContext) {
  return currentAttestation(ctx, "measurement");
}

export const READ_ONLY_METHODS = ["GET"] as const;
export const META_VALIDATE_ONLY_OPERATION = "meta_exact_identity_validate_only";
export const PROVIDER_READ_OPERATIONS = {
  meta: {
    account: ["GET", "ad_account"],
    page_authorization: ["GET", "me/accounts"],
    page_instagram: ["GET", "page/instagram_business_account"],
    exact_identity_validate_only: [
      "POST",
      "ad_account/adcreatives:validate_only",
    ],
  },
  tiktok: {
    advertiser: ["GET", "advertiser/info/"],
    identities: ["GET", "identity/get/"],
  },
  snapchat: {
    account: ["GET", "adaccounts/{id}"],
    funding: ["GET", "organizations/{id}/fundingsources"],
    mobile_apps: ["GET", "adaccounts/{id}/mobile_apps"],
  },
  google: {},
  reddit: {
    preflight: ["GET", "read_only_preflight"],
  },
} as const;

export function asAdConnectionRow(
  connection: ReadinessConnection,
): AdConnectionRow {
  return {
    id: connection.id,
    platform: connection.platform as AdConnectionRow["platform"],
    lane: connection.lane as AdConnectionRow["lane"],
    display_name: connection.display_name,
    external_account_id: connection.external_account_id,
    external_org_id: connection.external_org_id ?? null,
    auth_kind: connection.auth_kind ?? "system_user_token",
    token_env_var: connection.token_env_var ?? "",
    extra: connection.extra ?? {},
    status: connection.status as AdConnectionRow["status"],
    currency: connection.currency ?? null,
    timezone: connection.timezone ?? null,
    min_daily_budget_cents: connection.min_daily_budget_cents ?? null,
    account_status: connection.account_status,
    token_last_verified_at: connection.token_last_verified_at ?? null,
    connected: connection.connected,
  };
}

export function assertReadOnlyProviderRequest(
  method: string,
  operation?: string,
): void {
  const upper = method.toUpperCase();
  if (upper === "GET") return;
  if (upper === "POST" && operation === META_VALIDATE_ONLY_OPERATION) return;
  throw new Error("provider_write_forbidden");
}

export async function runAllowedProviderOperation<T>(
  provider: ReadinessProvider,
  operation: string,
  method: string,
  path: string,
  read: () => Promise<T>,
): Promise<T> {
  const configured = PROVIDER_READ_OPERATIONS[provider] as Record<
    string,
    readonly [string, string]
  >;
  const expected = configured[operation];
  if (!expected || expected[0] !== method || expected[1] !== path) {
    throw new Error("provider_operation_forbidden");
  }
  assertReadOnlyProviderRequest(
    method,
    provider === "meta" && operation === "exact_identity_validate_only"
      ? META_VALIDATE_ONLY_OPERATION
      : undefined,
  );
  return await read();
}

function notApplicable(checkedAt: string) {
  return evidence(
    "not_applicable",
    "Not applicable — this provider does not show a Mingla social profile.",
    checkedAt,
  );
}

export function verifyCanonicalBinding(
  provider: ReadinessProvider,
  ctx: VerifyContext,
): ProviderEvidence {
  const { binding, connection, target, checkedAt } = ctx;
  const payerOk = Boolean(
    binding.active && connection &&
      binding.payer_connection_id === connection.id &&
      connection.platform === provider && connection.lane === "consumer" &&
      connection.connected && connection.status === "connected",
  );
  const payer = payerOk
    ? evidence(
      "action_required",
      "The exact corporate payer is configured but needs a current provider read.",
      checkedAt,
      "canonical_registry",
      connection?.external_account_id,
    )
    : evidence(
      "action_required",
      "The exact corporate payer is missing or inactive.",
      checkedAt,
    );
  const identity = binding.public_identity_required
    ? ctx.identitySafeId
      ? evidence(
        "action_required",
        "The exact public identity is registered but needs a current provider read.",
        checkedAt,
        "canonical_registry",
        ctx.identitySafeId,
      )
      : evidence(
        "action_required",
        "The exact public identity is not verified.",
        checkedAt,
      )
    : notApplicable(checkedAt);
  const nativeBindingAttestation = currentNativeBindingAttestation(ctx);
  const nativeBinding = nativeBindingAttestation ??
    (binding.provider_app_id
      ? evidence(
        "action_required",
        `A ${provider} app ID is registered for ${target.display_name} ${target.os}, but no current provider-native binding proof is available.`,
        checkedAt,
        "canonical_registry",
        binding.provider_app_id,
      )
      : evidence(
        "action_required",
        `No exact ${provider} binding exists for ${target.display_name} on ${
          target.os === "ios" ? "iOS" : "Android"
        }.`,
        checkedAt,
      ));
  const measurementAttestation = currentMeasurementAttestation(ctx);
  const measurement = measurementAttestation ??
    (binding.provider_measurement_id
      ? evidence(
        "action_required",
        "A measurement ID is registered, but AppsFlyer partner and install-event proof is not current.",
        checkedAt,
        "canonical_registry",
        binding.provider_measurement_id,
      )
      : evidence(
        "action_required",
        "Measurement and required install event mapping are not proven.",
        checkedAt,
      ));
  // Stored connection configuration is never promoted into fresh funding
  // proof. A provider API or current dashboard attestation must replace this
  // gap before any cell can become Ready.
  const billing = false;
  const funding = evidence(
    "action_required",
    "Current provider billing and funding evidence is required.",
    checkedAt,
    "canonical_registry",
  );
  const dimensions = {
    payer,
    identity,
    binding: nativeBinding,
    measurement,
    funding,
  };
  const reason_code = !payerOk
    ? "payer_missing"
    : nativeBinding.status !== "proven"
    ? "native_binding_missing"
    : measurement.status !== "proven"
    ? "measurement_missing"
    : !billing
    ? "funding_missing"
    : "all_required_dimensions_proven";
  return { provider, reason_code, dimensions };
}
