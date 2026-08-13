import {
  APP_KEYS,
  type AppKey,
  type BindingRow,
  deriveFreshVerdict,
  type DimensionEvidence,
  evidence,
  normalizeDimensions,
  OPERATING_SYSTEMS,
  type OperatingSystem,
  READINESS_PROVIDERS,
  type ReadinessProvider,
  type TargetRow,
} from "../_shared/adAppReadiness.ts";
import type {
  ReadinessConnection,
  VerifyContext,
} from "../_shared/adAppReadinessProviders/common.ts";
import { verify as verifyMeta } from "../_shared/adAppReadinessProviders/meta.ts";
import { verify as verifyTikTok } from "../_shared/adAppReadinessProviders/tiktok.ts";
import { verify as verifySnapchat } from "../_shared/adAppReadinessProviders/snapchat.ts";
import { verify as verifyGoogle } from "../_shared/adAppReadinessProviders/google.ts";
import { verify as verifyReddit } from "../_shared/adAppReadinessProviders/reddit.ts";
import { verifyAppsflyer } from "../_shared/adAppReadinessProviders/appsflyer.ts";

const PROVIDER_TIMEOUT_MS = 8_000;
const OVERALL_TIMEOUT_MS = 30_000;
export const ADAPTERS = {
  meta: verifyMeta,
  tiktok: verifyTikTok,
  snapchat: verifySnapchat,
  google: verifyGoogle,
  reddit: verifyReddit,
};

const CANONICAL_TARGETS: Record<string, TargetRow> = {
  "explorer:ios": {
    app_key: "explorer",
    os: "ios",
    display_name: "Mingla Explorer",
    store_identifier: "6760440898",
    appsflyer_app_id: "id6760440898",
    onelink_url: "https://go.usemingla.com/w36m",
    active: false,
  },
  "explorer:android": {
    app_key: "explorer",
    os: "android",
    display_name: "Mingla Explorer",
    store_identifier: "com.mingla.app.v2",
    appsflyer_app_id: "com.mingla.app.v2",
    onelink_url: "https://go.usemingla.com/w36m",
    active: false,
  },
  "business:ios": {
    app_key: "business",
    os: "ios",
    display_name: "Mingla Business",
    store_identifier: "6768737367",
    appsflyer_app_id: "id6768737367",
    onelink_url: "https://biz.usemingla.com/ZSCW",
    active: false,
  },
  "business:android": {
    app_key: "business",
    os: "android",
    display_name: "Mingla Business",
    store_identifier: "com.sethogieva.minglabusiness",
    appsflyer_app_id: "com.sethogieva.minglabusiness",
    onelink_url: "https://biz.usemingla.com/ZSCW",
    active: false,
  },
};

export const responseHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

const MUTATION_ORIGINS = new Set([
  "https://admin.usemingla.com",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);

type ReadinessRequest = {
  action: "load" | "check";
  appKey: AppKey;
  os: OperatingSystem;
} | {
  action: "set_safe_binding";
  appKey: AppKey;
  os: OperatingSystem;
  provider: ReadinessProvider;
  providerContractKind: "mobile_asset" | "app_link" | "campaign_store_binding";
  providerAppId: string | null;
  providerMeasurementId: string | null;
  expectedCurrentVersion: number;
  idempotencyKey: string;
  reason: string;
} | {
  action: "record_canary_evidence";
  appKey: AppKey;
  os: OperatingSystem;
};

export function parseReadinessRequest(body: unknown): ReadinessRequest | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const row = body as Record<string, unknown>;
  if (!APP_KEYS.includes(row.app_key as AppKey)) return null;
  if (!OPERATING_SYSTEMS.includes(row.os as OperatingSystem)) return null;
  if (row.action === "load" || row.action === "check") {
    if (Object.keys(row).sort().join(",") !== "action,app_key,os") return null;
    return {
      action: row.action,
      appKey: row.app_key as AppKey,
      os: row.os as OperatingSystem,
    };
  }
  if (row.action === "record_canary_evidence") {
    if (Object.keys(row).sort().join(",") !== "action,app_key,os") return null;
    return {
      action: row.action,
      appKey: row.app_key as AppKey,
      os: row.os as OperatingSystem,
    };
  }
  if (row.action !== "set_safe_binding") return null;
  if (
    Object.keys(row).sort().join(",") !==
      "action,app_key,expected_current_version,idempotency_key,os,provider,provider_app_id,provider_contract_kind,provider_measurement_id,reason"
  ) return null;
  if (!READINESS_PROVIDERS.includes(row.provider as ReadinessProvider)) {
    return null;
  }
  if (
    !["mobile_asset", "app_link", "campaign_store_binding"].includes(
      String(row.provider_contract_kind),
    )
  ) return null;
  if (
    !Number.isSafeInteger(row.expected_current_version) ||
    Number(row.expected_current_version) < 1
  ) return null;
  if (
    typeof row.idempotency_key !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(row.idempotency_key)
  ) return null;
  if (
    typeof row.reason !== "string" || row.reason.trim().length < 8 ||
    row.reason.length > 240
  ) return null;
  for (const value of [row.provider_app_id, row.provider_measurement_id]) {
    if (
      value !== null &&
      (typeof value !== "string" || !/^[A-Za-z0-9._:@/-]{1,160}$/.test(value))
    ) return null;
  }
  return {
    action: "set_safe_binding",
    appKey: row.app_key as AppKey,
    os: row.os as OperatingSystem,
    provider: row.provider as ReadinessProvider,
    providerContractKind: row.provider_contract_kind as
      | "mobile_asset"
      | "app_link"
      | "campaign_store_binding",
    providerAppId: row.provider_app_id as string | null,
    providerMeasurementId: row.provider_measurement_id as string | null,
    expectedCurrentVersion: row.expected_current_version as number,
    idempotencyKey: row.idempotency_key as string,
    reason: row.reason.trim(),
  };
}

export interface ReadinessDb {
  loadRegistry(): Promise<{
    targets: TargetRow[];
    bindings: BindingRow[];
    connections: ReadinessConnection[];
    identities: Array<Record<string, unknown>>;
  }>;
  loadLatest(): Promise<Array<Record<string, unknown>>>;
  persist(
    input: Record<string, unknown>,
    results: unknown[],
  ): Promise<Record<string, unknown>>;
  setSafeBinding?(
    input: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders,
  });
}

function timeout<T>(
  promise: Promise<T>,
  ms: number,
  controller: AbortController,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => {
      controller.abort();
      reject(new Error("provider_timeout"));
    }, ms);
    promise.then((value) => {
      clearTimeout(id);
      resolve(value);
    }, (error) => {
      clearTimeout(id);
      reject(error);
    });
  });
}

function selectedIdentitySafeId(
  identities: Array<Record<string, unknown>>,
  appKey: AppKey,
  provider: ReadinessProvider,
): string | undefined {
  const matches = identities.filter((row) =>
    row.app_key === appKey && row.provider === provider && row.active === true
  );
  if (matches.length !== 1) return undefined;
  if (provider === "meta") {
    return typeof matches[0].meta_instagram_user_id === "string"
      ? matches[0].meta_instagram_user_id
      : undefined;
  }
  if (provider === "tiktok") {
    return typeof matches[0].tiktok_identity_id === "string"
      ? matches[0].tiktok_identity_id
      : undefined;
  }
  return undefined;
}

function selectedIdentityRecord(
  identities: Array<Record<string, unknown>>,
  appKey: AppKey,
  provider: ReadinessProvider,
): Record<string, unknown> | undefined {
  const matches = identities.filter((row) =>
    row.app_key === appKey && row.provider === provider && row.active === true
  );
  return matches.length === 1 ? matches[0] : undefined;
}

function normalizeLatest(latest: Array<Record<string, unknown>>, now: string) {
  return latest.map((target) => {
    const run = target.latest as Record<string, unknown> | null;
    if (!run) return target;
    const staleAt = String(run.stale_at ?? "");
    const results = Array.isArray(run.results) ? run.results : [];
    return {
      ...target,
      latest: {
        ...run,
        results: results.map((row) => {
          const result = row as Record<string, unknown>;
          return {
            ...result,
            verdict: deriveFreshVerdict(
              result.verdict as "ready" | "action_required" | "blocked",
              staleAt,
              now,
            ),
          };
        }),
      },
    };
  });
}

function failClosedDimensions(
  provider: ReadinessProvider,
  checkedAt: string,
  status: "action_required" | "blocked",
  summary: string,
  sourceClass: "canonical_registry" | "provider_api" | "appsflyer_api" =
    "canonical_registry",
): DimensionEvidence {
  const item = evidence(status, summary, checkedAt, sourceClass);
  return {
    payer: item,
    identity: provider === "meta" || provider === "tiktok" ? item : evidence(
      "not_applicable",
      "Not applicable — this provider does not show a Mingla social profile.",
      checkedAt,
    ),
    binding: item,
    measurement: item,
    funding: item,
  };
}

function safeProviderResult(
  provider: ReadinessProvider,
  reasonCode: string,
  dimensions: unknown,
  checkedAt: string,
) {
  const safe = normalizeDimensions(dimensions);
  if (safe) return { provider, reason_code: reasonCode, ...safe };
  return {
    provider,
    reason_code: "provider_response_invalid",
    ...failClosedDimensions(
      provider,
      checkedAt,
      "blocked",
      "Provider verification returned an invalid result.",
      "provider_api",
    ),
  };
}

export async function runSelectedCheck(
  db: ReadinessDb,
  actor: string,
  appKey: AppKey,
  os: OperatingSystem,
  checks: {
    verifyAppsflyer: (
      target: TargetRow,
      signal: AbortSignal,
      checkedAt: string,
      bindings: BindingRow[],
    ) => ReturnType<typeof verifyAppsflyer>;
    adapters: typeof ADAPTERS;
  } = {
    verifyAppsflyer: (target, signal, checkedAt, bindings) =>
      verifyAppsflyer(target, signal, checkedAt, undefined, bindings),
    adapters: ADAPTERS,
  },
): Promise<Record<string, unknown>> {
  const started = Date.now();
  const checkedAt = new Date().toISOString();
  const registry = await db.loadRegistry();
  const storedTarget = registry.targets.find((row) =>
    row.app_key === appKey && row.os === os
  );
  const target = storedTarget ?? CANONICAL_TARGETS[`${appKey}:${os}`];
  if (!target) throw new Error("target_contract_missing");
  const appsFlyerController = new AbortController();
  let appsFlyerMeasurements;
  try {
    appsFlyerMeasurements = await timeout(
      checks.verifyAppsflyer(
        target,
        appsFlyerController.signal,
        checkedAt,
        registry.bindings,
      ),
      PROVIDER_TIMEOUT_MS,
      appsFlyerController,
    );
  } catch (error) {
    const blocked = evidence(
      "blocked",
      error instanceof Error && error.message === "provider_timeout"
        ? "AppsFlyer verification timed out."
        : "AppsFlyer verification was unavailable.",
      checkedAt,
      "appsflyer_api",
    );
    appsFlyerMeasurements = Object.fromEntries(
      READINESS_PROVIDERS.map((provider) => [provider, blocked]),
    ) as Record<ReadinessProvider, typeof blocked>;
  }
  const jobs = READINESS_PROVIDERS.map(async (provider) => {
    if (!storedTarget?.active) {
      return safeProviderResult(
        provider,
        "target_missing_or_inactive",
        failClosedDimensions(
          provider,
          checkedAt,
          "blocked",
          "The selected app target is missing or inactive.",
        ),
        checkedAt,
      );
    }
    const binding = registry.bindings.find((row) =>
      row.app_key === appKey && row.os === os && row.provider === provider
    ) as BindingRow | undefined;
    if (!binding?.active) {
      return safeProviderResult(
        provider,
        "binding_missing",
        failClosedDimensions(
          provider,
          checkedAt,
          "action_required",
          "The exact provider binding is missing or inactive.",
        ),
        checkedAt,
      );
    }
    const connection = registry.connections.find((row) =>
      row.id === binding.payer_connection_id
    ) ?? null;
    if (
      !connection || !connection.connected || connection.status !== "connected"
    ) {
      return safeProviderResult(
        provider,
        "payer_missing",
        failClosedDimensions(
          provider,
          checkedAt,
          "action_required",
          "The exact corporate payer is missing or inactive.",
        ),
        checkedAt,
      );
    }
    const controller = new AbortController();
    const context: VerifyContext = {
      target,
      binding: binding as never,
      connection,
      identitySafeId: selectedIdentitySafeId(
        registry.identities,
        appKey,
        provider,
      ),
      identityRecord: selectedIdentityRecord(
        registry.identities,
        appKey,
        provider,
      ),
      signal: controller.signal,
      deadlineMs: PROVIDER_TIMEOUT_MS,
      checkedAt,
    };
    try {
      const result = await timeout(
        checks.adapters[provider](context),
        PROVIDER_TIMEOUT_MS,
        controller,
      );
      const liveMeasurement = appsFlyerMeasurements[provider];
      const measurement = result.dimensions.measurement.status === "proven" &&
          result.dimensions.measurement.source_class ===
            "dashboard_attestation"
        ? result.dimensions.measurement
        : liveMeasurement;
      const dimensions = {
        ...result.dimensions,
        measurement,
      };
      const reasonCode = measurement.status === "blocked"
        ? "provider_unreachable"
        : measurement.status !== "proven" &&
            result.reason_code === "all_required_dimensions_proven"
        ? "measurement_missing"
        : result.reason_code;
      return safeProviderResult(provider, reasonCode, dimensions, checkedAt);
    } catch (error) {
      const summary =
        error instanceof Error && error.message === "provider_timeout"
          ? "Provider verification timed out."
          : "Provider verification was unavailable.";
      const blocked = {
        status: "blocked",
        summary,
        source_class: "provider_api",
        source_checked_at: checkedAt,
      };
      return {
        provider,
        reason_code:
          error instanceof Error && error.message === "provider_timeout"
            ? "provider_timeout"
            : "provider_unreachable",
        payer: blocked,
        identity: provider === "meta" || provider === "tiktok"
          ? blocked
          : { ...blocked, status: "not_applicable" },
        binding: blocked,
        measurement: blocked,
        funding: blocked,
      };
    }
  });
  const overall = new AbortController();
  const results = await timeout(Promise.all(jobs), OVERALL_TIMEOUT_MS, overall);
  if (results.length !== 5) throw new Error("incomplete_provider_results");
  return await db.persist({
    app_key: appKey,
    os,
    requested_by: actor,
    duration_ms: Math.min(60_000, Date.now() - started),
  }, results);
}

export async function handleAppReadinessRequest(
  request: Request,
  dependencies: {
    authorize(
      header: string,
    ): Promise<
      | { status: "authorized"; actor: string }
      | { status: "unauthorized" }
      | { status: "forbidden" }
    >;
    createDb(): ReadinessDb;
    now(): string;
    checks?: {
      verifyAppsflyer: (
        target: TargetRow,
        signal: AbortSignal,
        checkedAt: string,
        bindings: BindingRow[],
      ) => ReturnType<typeof verifyAppsflyer>;
      adapters: typeof ADAPTERS;
    };
  },
): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: responseHeaders });
  }
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }
  const authorization = request.headers.get("Authorization");
  if (!authorization) return json({ error: "unauthorized" }, 401);
  const auth = await dependencies.authorize(authorization);
  if (auth.status === "unauthorized") {
    return json({ error: "unauthorized" }, 401);
  }
  if (auth.status === "forbidden") return json({ error: "forbidden" }, 403);
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > 4096) {
    return json({ error: "invalid_request" }, 400);
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: "invalid_request" }, 400);
  }
  const parsed = parseReadinessRequest(body);
  if (!parsed) return json({ error: "invalid_request" }, 400);
  if (
    parsed.action === "set_safe_binding" ||
    parsed.action === "record_canary_evidence"
  ) {
    const origin = request.headers.get("Origin");
    if (!origin || !MUTATION_ORIGINS.has(origin)) {
      return json({ error: "origin_forbidden" }, 403);
    }
  }
  const db = dependencies.createDb();
  try {
    if (parsed.action === "record_canary_evidence") {
      return json({ error: "founder_approval_required" }, 409);
    }
    if (parsed.action === "set_safe_binding") {
      if (!db.setSafeBinding) {
        return json({ error: "readiness_unavailable" }, 503);
      }
      const changed = await db.setSafeBinding({
        app_key: parsed.appKey,
        os: parsed.os,
        provider: parsed.provider,
        provider_contract_kind: parsed.providerContractKind,
        provider_app_id: parsed.providerAppId,
        provider_measurement_id: parsed.providerMeasurementId,
        actor: auth.actor,
        reason: parsed.reason,
        expected_current_version: parsed.expectedCurrentVersion,
        idempotency_key: parsed.idempotencyKey,
      });
      return json({ contract_version: 2, changed });
    }
    if (parsed.action === "check") {
      await runSelectedCheck(
        db,
        auth.actor,
        parsed.appKey,
        parsed.os,
        dependencies.checks,
      );
    }
    const now = dependencies.now();
    const targets = normalizeLatest(await db.loadLatest(), now);
    const selected = targets.find((row) =>
      row.app_key === parsed.appKey && row.os === parsed.os
    ) ?? null;
    return json({ contract_version: 1, server_now: now, targets, selected });
  } catch (error) {
    if (
      error instanceof Error &&
      ["binding_version_conflict", "idempotency_key_conflict"].includes(
        error.message,
      )
    ) {
      return json({ error: error.message }, 409);
    }
    return json({ error: "readiness_unavailable" }, 500);
  }
}
