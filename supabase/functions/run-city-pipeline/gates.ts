// Issue #4276 C9, pure: what stops a run. Each gate is checked before money is spent,
// never after. Anything that can't be measured counts as tripped.

export type GateReason =
  | "spend_limit"
  | "database_limit"
  | "storage_limit"
  | "provider_unhealthy"
  | "failure_rate";

export interface GateTrip {
  reason: GateReason;
  detail: Record<string, unknown>;
}

export interface ProviderCheck {
  status?: string;
  http_status?: number | null;
  detail?: unknown;
  checked_at?: string;
}

export interface GateInputs {
  db_bytes: number;
  settings: {
    db_pause_bytes: number;
    failure_rate_limit: number;
    failure_min_sample: number;
    serper_usd_per_request: number | null;
    storage_ok?: boolean | null;
    storage_total_bytes?: number | null;
    storage_message?: string | null;
    storage_measured_at?: string | null;
  };
  providers: Record<string, ProviderCheck>;
}

/** The probe runs hourly, so two missed runs and a margin means it can't be believed. */
export const PROVIDER_CHECK_MAX_AGE_MS = 3 * 60 * 60 * 1000;

export function providerProblem(
  check: ProviderCheck | undefined,
  now: number,
): "down" | "unknown" | "stale" | null {
  if (!check || !check.status || check.status === "unknown") return "unknown";
  if (check.status === "down") return "down";
  const at = check.checked_at ? Date.parse(check.checked_at) : NaN;
  if (Number.isNaN(at) || now - at > PROVIDER_CHECK_MAX_AGE_MS) return "stale";
  return null; // healthy, or degraded: slow is not the same as refusing
}

/** Every provider a stage needs, so Serper's depleted state shows before any spend. */
export function unhealthyProviders(
  inputs: GateInputs,
  needed: readonly string[],
  now: number,
): Array<{ provider: string; problem: string; http_status: number | null; checked_at: string | null }> {
  const out = [];
  for (const provider of needed) {
    const check = inputs.providers[provider];
    const problem = providerProblem(check, now);
    if (problem) {
      out.push({
        provider,
        problem,
        http_status: check?.http_status ?? null,
        checked_at: check?.checked_at ?? null,
      });
    }
  }
  return out;
}

export function databaseGate(inputs: GateInputs): GateTrip | null {
  if (typeof inputs.db_bytes !== "number" || !Number.isFinite(inputs.db_bytes)) {
    return { reason: "database_limit", detail: { message: "database size could not be read" } };
  }
  if (inputs.db_bytes >= inputs.settings.db_pause_bytes) {
    return {
      reason: "database_limit",
      detail: { db_bytes: inputs.db_bytes, limit_bytes: inputs.settings.db_pause_bytes },
    };
  }
  return null;
}

export function storageGate(storage: { ok: boolean; totalBytes: number | null; message?: string | null }): GateTrip | null {
  if (storage.ok) return null;
  return {
    reason: "storage_limit",
    detail: { total_bytes: storage.totalBytes, message: storage.message ?? "storage could not be measured" },
  };
}

export function spendGate(limitUsd: number, spentUsd: number, nextEstimateUsd: number): GateTrip | null {
  if (spentUsd + nextEstimateUsd > limitUsd) {
    return {
      reason: "spend_limit",
      detail: { limit_usd: limitUsd, spent_usd: spentUsd, next_estimate_usd: nextEstimateUsd },
    };
  }
  return null;
}

export function providerGate(inputs: GateInputs, needed: readonly string[], now: number): GateTrip | null {
  const unhealthy = unhealthyProviders(inputs, needed, now);
  return unhealthy.length > 0 ? { reason: "provider_unhealthy", detail: { providers: unhealthy } } : null;
}

export function failureGate(
  inputs: GateInputs,
  failed: number,
  finished: number,
  what: string,
): GateTrip | null {
  if (finished < inputs.settings.failure_min_sample) return null;
  const rate = failed / finished;
  if (rate > inputs.settings.failure_rate_limit) {
    return {
      reason: "failure_rate",
      detail: { what, failed, finished, rate, limit: inputs.settings.failure_rate_limit },
    };
  }
  return null;
}
