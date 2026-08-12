import {
  evidence,
  READINESS_PROVIDERS,
  type ReadinessProvider,
  type SafeEvidence,
  type TargetRow,
} from "../adAppReadiness.ts";

export interface AppsFlyerPartnerState {
  partnerActive: boolean;
  installEventMapped: boolean;
}

export type AppsFlyerMeasurementSnapshot = Partial<
  Record<ReadinessProvider, AppsFlyerPartnerState>
>;

export type AppsFlyerMeasurementReader = (
  target: TargetRow,
  signal: AbortSignal,
) => Promise<AppsFlyerMeasurementSnapshot | null>;

const PARTNER_IDS: Record<ReadinessProvider, readonly string[]> = {
  meta: ["facebook_int"],
  tiktok: ["tiktokglobal_int"],
  snapchat: ["snapchat_int"],
  google: ["googleadwords_int"],
  reddit: ["reddit_int"],
};

const noConfiguredReadApi: AppsFlyerMeasurementReader = () =>
  Promise.resolve(null);

function rowsFromPayload(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) {
    return payload.filter((row) => row && typeof row === "object") as Array<
      Record<string, unknown>
    >;
  }
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  for (const key of ["data", "integrations", "items"]) {
    if (Array.isArray(record[key])) return rowsFromPayload(record[key]);
  }
  return [];
}

function partnerId(row: Record<string, unknown>): string | null {
  for (const key of ["pid", "partner_id", "media_source"]) {
    if (typeof row[key] === "string" && row[key]) return row[key];
  }
  return null;
}

function explicitInstallMapping(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(explicitInstallMapping);
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  const event = [row.event_name, row.af_event_name, row.event].find((item) =>
    typeof item === "string"
  );
  const enabled = row.enabled === true || row.active === true ||
    row.postback_enabled === true || row.status === "active";
  if (
    typeof event === "string" &&
    ["install", "af_install"].includes(event.toLowerCase()) && enabled
  ) return true;
  return Object.values(row).some(explicitInstallMapping);
}

export function parseAppsFlyerIntegrationSnapshot(
  payload: unknown,
): AppsFlyerMeasurementSnapshot {
  const rows = rowsFromPayload(payload);
  return Object.fromEntries(READINESS_PROVIDERS.map((provider) => {
    const row = rows.find((item) => {
      const id = partnerId(item);
      return id !== null && PARTNER_IDS[provider].includes(id);
    });
    return [provider, {
      // The endpoint is explicitly the list of active integrations. Presence
      // is therefore current partner-activation authority for this exact app.
      partnerActive: Boolean(row),
      // Do not infer event mapping from partner presence. It must be explicit
      // in the returned integration parameters or supplied by a current
      // separately-authorized dashboard attestation.
      installEventMapped: row
        ? explicitInstallMapping(row.in_app_postbacks_params) ||
          explicitInstallMapping(row.general_params)
        : false,
    }];
  })) as AppsFlyerMeasurementSnapshot;
}

export function createAppsFlyerMeasurementReader(
  getToken: () => string | undefined,
  fetcher: typeof fetch = fetch,
): AppsFlyerMeasurementReader {
  return async (target, signal) => {
    const token = getToken()?.trim();
    if (!token) return null;
    const appId = encodeURIComponent(target.appsflyer_app_id);
    const response = await fetcher(
      `https://hq1.appsflyer.com/api/app-integrations/v1/integrations/${appId}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        signal,
      },
    );
    if (!response.ok) throw new Error("appsflyer_read_unavailable");
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (declaredLength > 1_000_000) {
      throw new Error("appsflyer_response_invalid");
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new Error("appsflyer_response_invalid");
    }
    return parseAppsFlyerIntegrationSnapshot(payload);
  };
}

export async function verifyAppsflyer(
  target: TargetRow,
  signal: AbortSignal,
  checkedAt: string,
  readMeasurement: AppsFlyerMeasurementReader = noConfiguredReadApi,
): Promise<Record<ReadinessProvider, SafeEvidence>> {
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  const result = await readMeasurement(target, signal);
  return Object.fromEntries(READINESS_PROVIDERS.map((provider) => {
    const state = result?.[provider];
    if (!state) {
      return [
        provider,
        evidence(
          "action_required",
          "AppsFlyer partner activation and install-event mapping are not verifiable through a configured read API.",
          checkedAt,
          "canonical_registry",
          target.appsflyer_app_id,
        ),
      ];
    }
    return [
      provider,
      state.partnerActive && state.installEventMapped
        ? evidence(
          "proven",
          `AppsFlyer confirms the ${provider} integration and install-event mapping for the exact app target.`,
          checkedAt,
          "appsflyer_api",
          target.appsflyer_app_id,
        )
        : evidence(
          "action_required",
          state.partnerActive
            ? `AppsFlyer confirms the ${provider} integration, but install-event mapping is not proven.`
            : `AppsFlyer does not return an active ${provider} integration for the exact app target.`,
          checkedAt,
          "appsflyer_api",
          target.appsflyer_app_id,
        ),
    ];
  })) as Record<ReadinessProvider, SafeEvidence>;
}
