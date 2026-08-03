/**
 * googleConversionUpload.ts — ISSUE-1267 · Google Ads, the 5th server-side
 * conversion lane of the Full Rooms ad engine.
 *
 * Google is a CLICK-conversion UPLOAD (uploadClickConversions / Enhanced
 * Conversions), NOT an event POST like the 4 CAPI senders (Meta/TikTok/Snap/
 * Reddit) — but it rides the SAME fireAdConversion fan-out (adConversionFire.ts),
 * with the SAME sender signature and the SAME fail-open discipline.
 *
 * WIRE: POST customers/{customerId}:uploadClickConversions
 *   { conversions: [{ gclid, conversionAction, conversionDateTime,
 *     conversionValue, currencyCode, orderId, userIdentifiers[], consent? }],
 *     partialFailure: true, validateOnly? }
 *   via _shared/google.ts::googleAdsRequest. Auth is resolveGoogleClient — the
 *   dev token + refresh token + customer id already provisioned for the consumer
 *   lane, and the `adwords` OAuth scope already covers uploads. NO new secret: the
 *   only Google-specific config is the conversion-action resource id, which lives
 *   in ad_connections.extra (config, not a credential).
 *
 * FAIL-OPEN (mirrors redditCapi's pending_config, SC-12): a Google failure must
 * NEVER block a purchase/reservation nor the other 4 senders. This sender NEVER
 * throws upward. Soft-skips:
 *   • no conversion_action_resource on the connection → { skipped, pending_config }
 *   • no google gclid on the attributed touch          → { skipped, no_gclid }
 *   • resolveGoogleClient throws (lane unprovisioned)  → { skipped, pending_config }
 *   • a platform 4xx/5xx / network / timeout           → { failed, ... }
 *
 * ENHANCED CONVERSIONS: hashed email/phone (already SHA-256'd by adConversionFire,
 * SC-9) ride as userIdentifiers so a gclid whose cookie match is imperfect still
 * resolves to a user.
 *
 * TWO-TIER VALUE: conversionValue = input.valueCents / 100. The fire helper
 * already derives the two tiers (a PAID reservation carries the fee value; a FREE
 * RSVP carries 0), so a free RSVP uploads a 0-value conversion — a driven
 * customer, never revenue.
 *
 * VALIDATE-ONLY: deps.validateOnly=true sends validateOnly:true so the
 * orchestrator can live-validate the lane at deploy with ZERO real conversion
 * objects (Google offers this on the upload endpoint).
 *
 * CONSENT-MODE (founder 2026-07-28): config-driven from ad_connections.extra —
 * present only when configured; absent → Google treats it as UNSPECIFIED (the
 * neutral default). This is a signal carrier, never a hardcoded assertion.
 */

import type {
  ConversionSendInput,
  Lane,
  SenderConnection,
  SenderDeps,
  SenderResult,
} from "./adConversionFire.ts";
import type { AdConnectionRow } from "./adChannel.ts";
// TYPE-ONLY: google.ts and adChannel.ts form an initialization cycle (adChannel's
// adapter registry references google.ts's googleAdapter). A STATIC value import of
// google.ts here would drag it — google-FIRST — into adConversionFire's load graph
// and hit a temporal-dead-zone on googleAdapter, crashing every finalize edge fn on
// import. So the real-path helpers below load google.ts LAZILY at call time,
// adChannel FIRST (the proven-safe order — google.test.ts imports adChannel before
// google). The hermetic suites inject resolveClient/requestImpl and never load it.
import type { GoogleClient } from "./google.ts";

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_ATTRIBUTION_WINDOW_DAYS = 30;

let googleModule: typeof import("./google.ts") | null = null;
/** Load google.ts safely (adChannel-registry cycle initialized FIRST), then cache. */
async function loadGoogleModule(): Promise<typeof import("./google.ts")> {
  if (googleModule) return googleModule;
  await import("./adChannel.ts"); // initialize the adapter registry in the safe order
  googleModule = await import("./google.ts");
  return googleModule;
}

/** Real default: resolve a lane-only Google client (used by the sender). */
async function realResolveClient(lane: Lane): Promise<GoogleClient> {
  const { resolveGoogleClient } = await loadGoogleModule();
  return resolveGoogleClient(null, lane);
}

/** Real default: resolve a Google client from a connection row (used by provisioning). */
async function realResolveClientForConn(
  conn: AdConnectionRow | null,
  lane?: Lane,
): Promise<GoogleClient> {
  const { resolveGoogleClient } = await loadGoogleModule();
  return resolveGoogleClient(conn ?? null, lane);
}

/** Real default: the googleAdsRequest REST call. */
async function realRequest(
  client: GoogleClient,
  path: string,
  body: Record<string, unknown>,
  opts?: { timeoutMs?: number },
): Promise<{ payload: Record<string, unknown>; requestId: string | null }> {
  const { googleAdsRequest } = await loadGoogleModule();
  return googleAdsRequest(client, path, body, opts);
}

/** The googleAdsRequest shape — injectable so the sender is hermetically testable. */
export type GoogleUploadRequestFn = (
  client: GoogleClient,
  path: string,
  body: Record<string, unknown>,
  opts?: { timeoutMs?: number },
) => Promise<{ payload: Record<string, unknown>; requestId: string | null }>;

/**
 * Google-only sender seams. All OPTIONAL, so a base SenderDeps (what the fan-out
 * passes) satisfies `SenderDeps & GoogleConversionUploadDeps` and the sender stays
 * assignable to the shared SenderFn type. In production these default to the real
 * google.ts helpers; tests inject fakes so NO global fetch is ever reached.
 */
export interface GoogleConversionUploadDeps {
  /** Resolve the Google client (default: resolveGoogleClient(null, lane)). */
  resolveClient?: (lane: Lane) => Promise<GoogleClient>;
  /** The REST call (default: googleAdsRequest). */
  requestImpl?: GoogleUploadRequestFn;
  /** Deploy-time live validation: send validateOnly:true (zero real objects). */
  validateOnly?: boolean;
}

/** Two-tier conversionValue: valueCents/100 (0 for a free RSVP, undefined if unset). */
function googleConversionValue(valueCents: number | null): number | undefined {
  if (
    typeof valueCents !== "number" || !Number.isFinite(valueCents) ||
    valueCents < 0
  ) {
    return undefined;
  }
  return Math.round(valueCents) / 100;
}

/** Google conversionDateTime: "yyyy-mm-dd hh:mm:ss+|-hh:mm" — emitted in UTC. */
export function formatGoogleConversionDateTime(eventTimeMs: number): string {
  const iso = new Date(eventTimeMs).toISOString(); // 2027-01-18T10:30:00.000Z
  return `${iso.slice(0, 19).replace("T", " ")}+00:00`; // 2027-01-18 10:30:00+00:00
}

/** Enhanced-Conversions identifiers from the already-hashed PII (SC-9). */
function buildUserIdentifiers(
  input: ConversionSendInput,
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  if (input.hashedEmail) {
    out.push({
      hashedEmail: input.hashedEmail,
      userIdentifierSource: "FIRST_PARTY",
    });
  }
  if (input.hashedPhone) {
    out.push({
      hashedPhoneNumber: input.hashedPhone,
      userIdentifierSource: "FIRST_PARTY",
    });
  }
  return out;
}

/** Consent-mode block from the connection config — null when nothing is configured. */
function buildConsent(conn: SenderConnection): Record<string, unknown> | null {
  const c = conn.consent;
  if (!c) return null;
  const out: Record<string, unknown> = {};
  if (c.adUserData) out.adUserData = c.adUserData;
  if (c.adPersonalization) out.adPersonalization = c.adPersonalization;
  return Object.keys(out).length > 0 ? out : null;
}

/** Pure builder for one ClickConversion — testable without any network. */
export function buildGoogleClickConversion(
  input: ConversionSendInput,
  conversionAction: string,
  conn: SenderConnection,
): Record<string, unknown> {
  const conversion: Record<string, unknown> = {
    gclid: input.externalClickId?.trim(),
    conversionAction,
    conversionDateTime: formatGoogleConversionDateTime(input.eventTimeMs),
    orderId: input.eventId, // Mingla order/reservation id — the cross-side dedup key.
  };
  const value = googleConversionValue(input.valueCents);
  if (value !== undefined) {
    conversion.conversionValue = value;
    if (input.currency) conversion.currencyCode = input.currency;
  }
  const userIdentifiers = buildUserIdentifiers(input);
  if (userIdentifiers.length > 0) conversion.userIdentifiers = userIdentifiers;
  const consent = buildConsent(conn);
  if (consent) conversion.consent = consent;
  return conversion;
}

/**
 * The Google conversion sender — same signature as the 4 CAPI senders. FAIL-OPEN,
 * never throws; auth via resolveGoogleClient (OAuth), NOT an env-var token. The
 * getToken/fetchImpl on SenderDeps are unused (Google has its own auth); the
 * validateOnly / resolveClient / requestImpl seams live on GoogleConversionUploadDeps.
 */
export async function sendGoogleConversion(
  input: ConversionSendInput,
  conn: SenderConnection,
  deps: SenderDeps & GoogleConversionUploadDeps = {},
): Promise<SenderResult> {
  const channel = "google" as const;

  const conversionAction = conn.conversionActionResource?.trim();
  if (!conversionAction) {
    // PENDING-CONFIG (mirror reddit SC-12): the conversion action has not been
    // provisioned yet (the admin one-shot) — skip softly, NEVER error, so the
    // lane stays green until admin-ad-google-provision-conversion has run.
    return { channel, status: "skipped", reason: "pending_config" };
  }

  const gclid = input.externalClickId?.trim();
  if (!gclid) {
    // Fail-open: no google click id on the attributed touch → nothing to anchor
    // the click conversion on. The userIdentifiers ride ALONGSIDE the gclid to
    // improve matching; a truly gclid-less conversion is skipped per contract.
    return { channel, status: "skipped", reason: "no_gclid" };
  }

  const lane: Lane = conn.lane ?? "consumer";
  let client: GoogleClient;
  try {
    const resolveClient = deps.resolveClient ?? realResolveClient;
    client = await resolveClient(lane);
  } catch {
    // resolveGoogleClient fail-closes (AdNotConnectedError) when the lane's
    // Google secrets are unset. For THIS post-paid, off-critical-path send that
    // is a soft skip — the connect flow owns the hard 409/424, never this sender.
    return { channel, status: "skipped", reason: "pending_config" };
  }

  const request = deps.requestImpl ?? realRequest;
  const body: Record<string, unknown> = {
    conversions: [buildGoogleClickConversion(input, conversionAction, conn)],
    // ConversionUploadService REQUIRES partialFailure:true — per-conversion errors
    // surface in partialFailureError instead of failing the whole request.
    partialFailure: true,
  };
  if (deps.validateOnly === true) body.validateOnly = true;

  try {
    const { payload } = await request(
      client,
      `customers/${client.customerId}:uploadClickConversions`,
      body,
      { timeoutMs: deps.timeoutMs ?? DEFAULT_TIMEOUT_MS },
    );
    // A 200 with a populated partialFailureError means the single conversion was
    // rejected — treat it as a soft failure (recorded, never thrown).
    const partialErr = (payload as Record<string, unknown>)
      ?.partialFailureError;
    if (
      partialErr && typeof partialErr === "object" &&
      Object.keys(partialErr as Record<string, unknown>).length > 0
    ) {
      return { channel, status: "failed", reason: "partial_failure" };
    }
    return { channel, status: "sent" };
  } catch (err) {
    // googleAdsRequest throws AdApiError on non-2xx / network — absorbed here as
    // 'failed', never propagated (fail-open, RT-1).
    const reason = err instanceof Error && err.name === "AbortError"
      ? "timeout"
      : "api_error";
    return { channel, status: "failed", reason };
  }
}

// ── Conversion-action provisioning (admin one-shot, run once at deploy) ────────

export interface GoogleConversionActionProvisionResult {
  /** The created (or validated) conversion-action resource name, or null. */
  resourceName: string | null;
  /** true when the mutate ran validateOnly (nothing was created). */
  validated: boolean;
  /** Google request id — what Google support asks for; audit-bound. */
  requestId: string | null;
}

/** Clamp the click-through lookback to Google's supported 1..90 day range. */
function clampAttributionWindow(days?: number): number {
  if (typeof days !== "number" || !Number.isFinite(days)) {
    return DEFAULT_ATTRIBUTION_WINDOW_DAYS;
  }
  return Math.min(90, Math.max(1, Math.round(days)));
}

/** Pure builder for the conversionActions:mutate create operation — testable. */
export function buildConversionActionCreateOperation(
  opts: { name?: string; attributionWindowDays?: number } = {},
): Record<string, unknown> {
  const name = opts.name?.trim() || "Mingla Purchase (server upload)";
  return {
    create: {
      name,
      category: "PURCHASE",
      type: "UPLOAD_CLICKS",
      status: "ENABLED",
      countingType: "ONE_PER_CLICK",
      clickThroughLookbackWindowDays: clampAttributionWindow(
        opts.attributionWindowDays,
      ),
      valueSettings: {
        // Each upload carries its own conversionValue; the default is a fallback.
        defaultValue: 0,
        alwaysUseDefaultValue: false,
      },
    },
  };
}

/** Pull the first resourceName out of a conversionActions:mutate response. */
export function parseConversionActionResourceName(
  payload: unknown,
): string | null {
  const results =
    Array.isArray((payload as Record<string, unknown> | null)?.results)
      ? (payload as Record<string, unknown>).results as Record<
        string,
        unknown
      >[]
      : [];
  for (const r of results) {
    if (typeof r.resourceName === "string" && r.resourceName) {
      return r.resourceName;
    }
  }
  return null;
}

/**
 * Create (or validateOnly) a Google conversion action and return its resource
 * name. Category PURCHASE, type UPLOAD_CLICKS, ONE_PER_CLICK, a click-through
 * lookback window. The caller persists the resource name into
 * ad_connections.extra.conversion_action_resource (config, not a secret).
 * resolveClient/requestImpl are injectable so the edge fn is hermetically testable.
 */
export async function provisionGoogleConversionAction(
  conn: AdConnectionRow | null,
  opts: {
    lane?: Lane;
    validateOnly?: boolean;
    name?: string;
    attributionWindowDays?: number;
    resolveClient?: (
      conn: AdConnectionRow | null,
      lane?: Lane,
    ) => Promise<GoogleClient>;
    requestImpl?: GoogleUploadRequestFn;
  } = {},
): Promise<GoogleConversionActionProvisionResult> {
  const lane: Lane = conn?.lane ?? opts.lane ?? "consumer";
  const resolveClient = opts.resolveClient ?? realResolveClientForConn;
  const request = opts.requestImpl ?? realRequest;
  const client = await resolveClient(conn ?? null, lane);
  const body = {
    operations: [
      buildConversionActionCreateOperation({
        name: opts.name,
        attributionWindowDays: opts.attributionWindowDays,
      }),
    ],
    partialFailure: false,
    validateOnly: opts.validateOnly === true,
  };
  const { payload, requestId } = await request(
    client,
    `customers/${client.customerId}/conversionActions:mutate`,
    body,
  );
  return {
    resourceName: parseConversionActionResourceName(payload),
    validated: opts.validateOnly === true,
    requestId,
  };
}
