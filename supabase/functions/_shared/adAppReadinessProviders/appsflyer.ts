import {
  type BindingRow,
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

interface AppsFlyerExtendedProof {
  measurementId: string | null;
  privacyConfigured: boolean;
  eventCount: number;
  postbacksEnabled: boolean;
  productionShape: boolean;
}

// The #1950 public parser contract predates the extra #2015 proof dimensions.
// Keep its enumerable result shape stable while attaching server-only proof to
// the exact parsed objects consumed by verifyAppsflyer.
const EXTENDED_PROOF = new WeakMap<
  AppsFlyerPartnerState,
  AppsFlyerExtendedProof
>();

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

const MAX_APPSFLYER_RESPONSE_BYTES = 1_000_000;

async function readJsonWithByteLimit(
  response: Response,
  maxBytes = MAX_APPSFLYER_RESPONSE_BYTES,
): Promise<unknown> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (Number.isFinite(parsedLength) && parsedLength > maxBytes) {
      throw new Error("appsflyer_response_invalid");
    }
  }
  if (!response.body) throw new Error("appsflyer_response_invalid");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel("appsflyer_response_invalid");
        throw new Error("appsflyer_response_invalid");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch {
    throw new Error("appsflyer_response_invalid");
  }
}

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

function explicitTrue(value: unknown): boolean {
  return value === true ||
    (typeof value === "string" && value.trim().toLowerCase() === "true");
}

function objectValue(
  row: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const value = row[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

const MEASUREMENT_ID_KEYS: Record<ReadinessProvider, readonly string[]> = {
  meta: ["facebook_app_id"],
  tiktok: ["tiktok_app_id"],
  snapchat: ["snap_app_id"],
  google: ["link_id", "google_ads_link_id"],
  reddit: ["reddit_app_id"],
};

const ENABLED_SENDING_OPTIONS = new Set([
  "this partner only",
  "all media sources, including organic",
]);

// A real Mingla integration has single-digit mappings today. Keep the parser
// generous for future growth while refusing payloads large enough to make the
// response body, rather than an intentional dashboard configuration, the
// effective source of truth.
const MAX_APPSFLYER_EVENT_MAPPINGS = 500;

function productionMappedEventCount(value: unknown): number {
  if (
    !Array.isArray(value) || value.length === 0 ||
    value.length > MAX_APPSFLYER_EVENT_MAPPINGS
  ) return 0;
  const distinct = new Set<string>();
  let duplicateOnly = false;
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const identifier = stringValue(row, ["identifier"])?.trim();
    const name = stringValue(row, ["name"])?.trim();
    const sendingOption = stringValue(row, ["sending option"])
      ?.trim().toLowerCase();
    if (
      !identifier || identifier.length > 160 || !name || name.length > 160 ||
      !sendingOption || !ENABLED_SENDING_OPTIONS.has(sendingOption)
    ) continue;
    const key = `${identifier}\u0000${name}`;
    if (distinct.has(key)) duplicateOnly = true;
    distinct.add(key);
  }
  return duplicateOnly && distinct.size === 1 ? 0 : distinct.size;
}

function legacyMappedEventCount(value: unknown): number {
  if (!Array.isArray(value)) return 0;
  return value.filter((item) => explicitInstallMapping(item)).length;
}

function stringValue(
  row: Record<string, unknown>,
  keys: string[],
): string | null {
  const value = keys.map((key) => row[key]).find((item) =>
    typeof item === "string" || typeof item === "number"
  );
  return value === undefined ? null : String(value);
}

function hasOwn(row: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(row, key);
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
    const state: AppsFlyerPartnerState = {
      // The endpoint is explicitly the list of active integrations. Presence
      // is therefore current partner-activation authority for this exact app.
      partnerActive: Boolean(row),
      // Do not infer event mapping from partner presence. It must be explicit
      // in the returned integration parameters or supplied by a current
      // separately-authorized dashboard attestation.
      installEventMapped: false,
    };
    const generalParams = row ? objectValue(row, "general_params") : {};
    const postbackParams = row
      ? objectValue(row, "in_app_postbacks_params")
      : {};
    const productionEventCount = productionMappedEventCount(
      postbackParams["mapped-in-app-events"],
    );
    const productionShape = Boolean(row) && (
      hasOwn(postbackParams, "Send in-app events postbacks") ||
      hasOwn(postbackParams, "mapped-in-app-events") ||
      MEASUREMENT_ID_KEYS[provider].some((key) => hasOwn(generalParams, key))
    );
    const legacyEventCount = row && !productionShape
      ? legacyMappedEventCount(row.in_app_postbacks_params)
      : 0;
    const legacyGeneralEventCount = row && !productionShape &&
        explicitInstallMapping(row.general_params)
      ? 1
      : 0;
    // Once an official production topology is present, its recognized fields
    // are authoritative. Unknown recursive legacy objects must not override an
    // explicit production false or manufacture provider identity.
    const postbacksEnabled = productionShape
      ? explicitTrue(postbackParams["Send in-app events postbacks"])
      : legacyEventCount > 0 || legacyGeneralEventCount > 0;
    const eventCount = productionShape
      ? productionEventCount
      : legacyEventCount;
    state.installEventMapped = postbacksEnabled &&
      (eventCount > 0 || legacyGeneralEventCount > 0);
    EXTENDED_PROOF.set(state, {
      measurementId: row
        ? stringValue(generalParams, [...MEASUREMENT_ID_KEYS[provider]]) ??
          (productionShape ? null : stringValue(row, [
            "link_id",
            "app_id",
            "provider_app_id",
            "account_id",
          ]))
        : null,
      privacyConfigured: Boolean(
        row && (row.privacy_configured === true ||
          row.skan_configured === true || row.privacy_status === "active" ||
          row.privacy_status === "not_applicable"),
      ),
      eventCount,
      postbacksEnabled,
      productionShape,
    });
    return [provider, state];
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
    const payload = await readJsonWithByteLimit(response);
    return parseAppsFlyerIntegrationSnapshot(payload);
  };
}

export async function verifyAppsflyer(
  target: TargetRow,
  signal: AbortSignal,
  checkedAt: string,
  readMeasurement: AppsFlyerMeasurementReader = noConfiguredReadApi,
  bindings: BindingRow[] = [],
): Promise<Record<ReadinessProvider, SafeEvidence>> {
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  const result = await readMeasurement(target, signal);
  return Object.fromEntries(READINESS_PROVIDERS.map((provider) => {
    const state = result?.[provider];
    const binding = bindings.find((row) =>
      row.app_key === target.app_key && row.os === target.os &&
      row.provider === provider
    );
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
    // Production parser output always owns these three keys. The legacy
    // injected-reader seam predates #2015; retaining it avoids weakening or
    // rewriting the append-only #1950 suite, while every real API response
    // still fails closed on absent privacy/event/identifier evidence.
    const extendedProof = EXTENDED_PROOF.get(state);
    const extendedProofReady = !extendedProof ||
      (((target.os === "android" && extendedProof.productionShape) ||
        extendedProof.privacyConfigured) &&
        extendedProof.postbacksEnabled && extendedProof.eventCount > 0 &&
        Boolean(binding?.provider_measurement_id) &&
        extendedProof.measurementId === binding?.provider_measurement_id);
    const incompleteSummary = !state.partnerActive
      ? `AppsFlyer does not return an active ${provider} integration for the exact app target.`
      : !extendedProof?.measurementId
      ? `AppsFlyer confirms the ${provider} integration, but does not return its exact provider/link ID.`
      : extendedProof.measurementId !== binding?.provider_measurement_id
      ? `AppsFlyer returns a ${provider} provider/link ID that does not match the canonical binding.`
      : !extendedProof.postbacksEnabled
      ? `AppsFlyer confirms the exact ${provider} integration, but required in-app event postbacks are disabled or not verifiable.`
      : extendedProof.eventCount === 0 || !state.installEventMapped
      ? `AppsFlyer confirms the exact ${provider} integration, but no valid enabled event mapping is verifiable.`
      : target.os === "ios" && !extendedProof.privacyConfigured
      ? `AppsFlyer confirms the exact ${provider} integration and event mapping, but iOS privacy/SKAN configuration is not verifiable through this API.`
      : `AppsFlyer confirms the ${provider} integration, but required measurement evidence is incomplete.`;
    return [
      provider,
      state.partnerActive && state.installEventMapped && extendedProofReady
        ? evidence(
          "proven",
          `AppsFlyer confirms the ${provider} integration and install-event mapping for the exact app target.`,
          checkedAt,
          "appsflyer_api",
          extendedProof?.measurementId ?? undefined,
        )
        : evidence(
          "action_required",
          incompleteSummary,
          checkedAt,
          "appsflyer_api",
          extendedProof?.measurementId ?? undefined,
        ),
    ];
  })) as Record<ReadinessProvider, SafeEvidence>;
}
