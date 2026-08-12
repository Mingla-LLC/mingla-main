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

export const READ_ONLY_METHODS = ["GET"] as const;
export const META_VALIDATE_ONLY_OPERATION = "meta_exact_identity_validate_only";

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
      "proven",
      "Exact corporate payer configuration is active.",
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
        "proven",
        "Exact registered public identity is selected.",
        checkedAt,
        "provider_api",
        ctx.identitySafeId,
      )
      : evidence(
        "action_required",
        "The exact public identity is not verified.",
        checkedAt,
      )
    : notApplicable(checkedAt);
  const nativeBinding = binding.provider_app_id
    ? evidence(
      "proven",
      `Exact ${target.display_name} ${target.os} app binding is registered.`,
      checkedAt,
      "provider_api",
      binding.provider_app_id,
    )
    : evidence(
      "action_required",
      `No exact ${provider} binding exists for ${target.display_name} on ${
        target.os === "ios" ? "iOS" : "Android"
      }.`,
      checkedAt,
    );
  const measurement = binding.provider_measurement_id
    ? evidence(
      "proven",
      "AppsFlyer and provider measurement mapping is registered.",
      checkedAt,
      "appsflyer_api",
      binding.provider_measurement_id,
    )
    : evidence(
      "action_required",
      "Measurement and required install event mapping are not proven.",
      checkedAt,
    );
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
    : !binding.provider_app_id
    ? "native_binding_missing"
    : !binding.provider_measurement_id
    ? "measurement_missing"
    : !billing
    ? "funding_missing"
    : "all_required_dimensions_proven";
  return { provider, reason_code, dimensions };
}
