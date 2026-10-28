import { supabase } from "./supabase";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type {
  BrandSiteAvailability,
  BrandSiteExport,
  BrandSiteLabelProposal,
  BrandSiteOperation,
  BrandSiteOverview,
  BrandSiteAnalytics,
  BrandSiteDraftValidation,
  BrandSitePreview,
  BrandSiteVersion,
  BrandSiteDomains,
  StudioExchange,
} from "../sites/contracts";

interface SitesSuccess<T> {
  ok: true;
  data: T;
}

interface SitesFailure {
  ok: false;
  error: {
    code: string;
    message?: string;
    retryable?: boolean;
    operation_id?: string | null;
  };
}

type SitesEnvelope<T> = SitesSuccess<T> | SitesFailure;

export class BrandSitesError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "BrandSitesError";
  }
}

function operationId(): string {
  const maybeCrypto = (globalThis as { crypto?: Crypto }).crypto;
  if (typeof maybeCrypto?.randomUUID === "function") {
    return maybeCrypto.randomUUID();
  }
  // UUID v4 shape for the Core idempotency contract on older Hermes.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (token) => {
    const random = Math.floor(Math.random() * 16);
    const value = token === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

export const PROVISION_POLL_WINDOW_MS = 30_000;
const PROVISION_OPERATION_PREFIX = "mingla:brand-site-provision:v1:";
export const PUBLICATION_POLL_WINDOW_MS = 30_000;
const PUBLICATION_OPERATION_PREFIX = "mingla:brand-site-publication:v1:";

export interface PersistedProvisionOperation {
  operationId: string;
  startedAt: number;
}

export interface PersistedPublicationOperation {
  accountId: string;
  brandId: string;
  siteId: string;
  operationId: string;
  kind: "publish" | "rollback";
  startedAt: number;
  expectedRevision: string;
  sourceDigest: string;
  rollbackSourcePublicationId: string | null;
}

export function canResetFailedPublicationOperation(
  operation: PersistedPublicationOperation | null,
  receipt: BrandSiteOperation | null,
): operation is PersistedPublicationOperation {
  return Boolean(
    operation &&
      receipt?.operation_id === operation.operationId &&
      receipt.site_id === operation.siteId &&
      receipt.status === "failed",
  );
}

/**
 * #3583 — THE PERMANENTLY STUCK FIRST PUBLISH.
 *
 * `brand_site_authorize_operation` writes the operation receipt in the SAME
 * transaction that authorizes the operation. When the first-publish readiness
 * gate refuses (`RAISE EXCEPTION 'sites_readiness_blocked'`), that exception
 * rolls the whole function back, so NO receipt row is ever written and the
 * receipt route answers NOT_FOUND forever.
 *
 * The workspace had already persisted the operation to AsyncStorage before
 * making the call, so it sat on state "Publishing your website" permanently:
 * the receipt never resolved, "Check the same operation" re-sent the identical
 * doomed id, and `canResetFailedPublicationOperation` refused because it wants
 * a receipt whose status is "failed" — a receipt that was never written.
 * Clearing app storage was the only escape, and this is the exact path a newly
 * onboarded second brand takes.
 *
 * Two halves fix it. The route no longer persists an operation Core has not
 * accepted (see `startPublication`), and THIS predicate recovers every install
 * already carrying a poisoned pointer: a persisted operation whose receipt
 * 404s after React Query's retries is provably an operation Core never
 * created, so the local pointer is the only thing claiming it exists and it is
 * safe — and required — to drop.
 *
 * `receiptErrorCode` is the `BrandSitesError.code` from the receipt query, or
 * null when the query has not failed. Only NOT_FOUND qualifies: an unavailable
 * service or a conflict says nothing about whether the receipt exists.
 */
export function isOrphanedPublicationOperation(
  operation: PersistedPublicationOperation | null,
  receiptErrorCode: string | null,
): operation is PersistedPublicationOperation {
  return operation !== null && receiptErrorCode === "NOT_FOUND";
}

export function failedRollbackReviewVersion(
  operation: PersistedPublicationOperation,
  versions: BrandSiteVersion[],
): BrandSiteVersion | null {
  if (operation.kind !== "rollback") return null;
  return versions.find((version) =>
    (operation.rollbackSourcePublicationId !== null &&
      version.id === operation.rollbackSourcePublicationId) ||
    (version.source_revision_id === operation.expectedRevision &&
      version.source_digest === operation.sourceDigest)
  ) ?? null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;

function publicationOperationKey(
  accountId: string,
  brandId: string,
  siteId: string,
): string {
  return `${PUBLICATION_OPERATION_PREFIX}${accountId}:${brandId}:${siteId}`;
}

export async function loadPublicationOperation(input: {
  accountId: string;
  brandId: string;
  siteId: string;
}): Promise<PersistedPublicationOperation | null> {
  try {
    const raw = await AsyncStorage.getItem(
      publicationOperationKey(input.accountId, input.brandId, input.siteId),
    );
    const value = JSON.parse(raw ?? "null") as
      | Partial<PersistedPublicationOperation>
      | null;
    if (
      !value ||
      value.accountId !== input.accountId ||
      value.brandId !== input.brandId ||
      value.siteId !== input.siteId ||
      !UUID.test(String(value.accountId)) ||
      !UUID.test(String(value.brandId)) ||
      !UUID.test(String(value.siteId)) ||
      !UUID.test(String(value.operationId)) ||
      (value.kind !== "publish" && value.kind !== "rollback") ||
      typeof value.startedAt !== "number" ||
      !Number.isFinite(value.startedAt) ||
      typeof value.expectedRevision !== "string" ||
      value.expectedRevision.length < 1 ||
      !SHA256.test(String(value.sourceDigest)) ||
      (value.rollbackSourcePublicationId !== null &&
        !UUID.test(String(value.rollbackSourcePublicationId)))
    ) return null;
    return value as PersistedPublicationOperation;
  } catch {
    return null;
  }
}

export async function persistPublicationOperation(
  operation: PersistedPublicationOperation,
): Promise<void> {
  try {
    await AsyncStorage.setItem(
      publicationOperationKey(
        operation.accountId,
        operation.brandId,
        operation.siteId,
      ),
      JSON.stringify(operation),
    );
  } catch {
    // The Core receipt remains authoritative; local persistence is resume-only.
  }
}

export async function clearPublicationOperation(input: {
  accountId: string;
  brandId: string;
  siteId: string;
}): Promise<void> {
  try {
    await AsyncStorage.removeItem(
      publicationOperationKey(input.accountId, input.brandId, input.siteId),
    );
  } catch {
    // A stale local pointer has no server authority and cannot publish by itself.
  }
}

export function authoritativeProvisionOperation(
  site: BrandSiteOverview | null | undefined,
): PersistedProvisionOperation | null {
  const receipt = site?.latest_provision_operation;
  const startedAt = receipt ? Date.parse(receipt.authorized_at) : NaN;
  return site?.status === "provisioning" &&
      receipt !== null &&
      receipt !== undefined &&
      Number.isFinite(startedAt)
    ? { operationId: receipt.operation_id, startedAt }
    : null;
}

export function resolveProvisionOperation(
  cached: PersistedProvisionOperation | null,
  site: BrandSiteOverview | null | undefined,
): PersistedProvisionOperation | null {
  return cached ?? authoritativeProvisionOperation(site);
}

export function createBrandSiteOperationId(): string {
  return operationId();
}

export async function loadProvisionOperation(
  brandId: string,
): Promise<PersistedProvisionOperation | null> {
  try {
    const value = JSON.parse(
      (await AsyncStorage.getItem(`${PROVISION_OPERATION_PREFIX}${brandId}`)) ??
        "null",
    ) as Partial<PersistedProvisionOperation> | null;
    return value &&
        typeof value.operationId === "string" &&
        /^[0-9a-f-]{36}$/i.test(value.operationId) &&
        typeof value.startedAt === "number"
      ? { operationId: value.operationId, startedAt: value.startedAt }
      : null;
  } catch {
    return null;
  }
}

export async function persistProvisionOperation(
  brandId: string,
  operation: PersistedProvisionOperation,
): Promise<void> {
  try {
    await AsyncStorage.setItem(
      `${PROVISION_OPERATION_PREFIX}${brandId}`,
      JSON.stringify(operation),
    );
  } catch {
    // The Core receipt remains authoritative; storage recovery is best effort.
  }
}

export async function clearProvisionOperation(brandId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(`${PROVISION_OPERATION_PREFIX}${brandId}`);
  } catch {
    // A stale local receipt cannot authorize or repeat a different operation.
  }
}

/*
 * #2829 (A5) — TELL THE OWNER WHAT ACTUALLY HAPPENED.
 *
 * `supabase.functions.invoke` turns every non-2xx answer into an `error` and
 * drops the body, so a 403 "only brand admins can publish" used to reach the
 * owner as "Website tools are temporarily unavailable" — untrue, and it sends
 * them to retry something that will never work. The body Core sent is read
 * back from the error's response, and each known code gets its own plain
 * sentence. Only an unknown code, a 5xx or a transport fault says
 * "temporarily unavailable".
 */
const UNAVAILABLE_MESSAGE = "Website tools are temporarily unavailable.";

export const SITES_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  FORBIDDEN: "Only brand admins and owners can do this.",
  NOT_FOUND: "Mingla couldn\u2019t find this website.",
  INVALID_STATE: "Your website isn\u2019t ready for that step yet.",
  VALIDATION_FAILED: "Something in your website draft needs fixing first.",
  REVISION_CONFLICT: "Your draft changed since you opened it. Check it again first.",
  SESSION_EXPIRED: "Your secure session ended. Open it again from this screen.",
  OPERATION_IN_PROGRESS: "Another website change is still running.",
  PUBLISH_FAILED_LAST_GOOD_PRESERVED:
    "Publishing didn\u2019t finish. Your last website is still live.",
  MEDIA_REJECTED: "That file couldn\u2019t be accepted.",
  MEDIA_PROCESSING: "That image is still being prepared.",
  IDEMPOTENCY_CONFLICT: "That request was already used for something else.",
  PATH_COLLISION:
    "Two parts of your website use the same address. Change one page\u2019s address, then publish again.",
  PAGE_LIMIT_EXCEEDED: "Your website has more than 100 pages. Remove some, then publish again.",
  SERVICE_TEMPORARILY_UNAVAILABLE: UNAVAILABLE_MESSAGE,
  // #2829 W8 — your own domain.
  DOMAIN_INVALID: "Enter a domain you own, like yourbrand.com or www.yourbrand.com.",
  DOMAIN_TAKEN: "That address is already connected to a Mingla website.",
  DOMAIN_LIMIT: "A website can have up to 4 of your own addresses. Disconnect one first.",
  DOMAIN_IN_USE:
    "That address is connected to another website service. Remove it there, then add it here again.",
  CHECK_UNAVAILABLE: "Mingla couldn\u2019t check your address right now. Try again in a few minutes.",
  // #2829 W9a — the website plan.
  NOT_ENTITLED: "Websites are opening brand by brand, and this brand doesn\u2019t have one yet.",
  PLAN_LOCKED: "Someone else on your team is working on your website right now.",
  PLAN_NOT_READY: "Finish the earlier parts of your website plan first.",
  PLAN_PAUSED: "Your website is paused by Mingla, so the plan is paused too.",
  NO_ADMIN: "This brand has no admin to ask yet.",
};

/** A typed Website failure from an HTTP status and whatever body Core sent. */
export function brandSitesErrorFrom(
  status: number | null,
  body: unknown,
): BrandSitesError {
  const failure = (body && typeof body === "object"
    ? (body as Partial<SitesFailure>).error
    : undefined) as SitesFailure["error"] | undefined;
  // #2829 W2 — Core passes an owner-fixable refusal (two pages at one
  // address, too many pages) as VALIDATION_FAILED + reason_code; the reason is
  // the more useful code to show and act on.
  const reason = (failure as { reason_code?: unknown } | undefined)?.reason_code;
  if ((reason === "PATH_COLLISION" || reason === "PAGE_LIMIT_EXCEEDED") &&
    (status === null || status < 500)) {
    return new BrandSitesError(reason, SITES_ERROR_MESSAGES[reason]!, false);
  }
  const code = typeof failure?.code === "string" ? failure.code : null;
  if (code !== null && SITES_ERROR_MESSAGES[code] !== undefined &&
    // #2829 W8 — "couldn't check right now" is a 503 with its own sentence.
    (status === null || status < 500 || code === "CHECK_UNAVAILABLE")) {
    // Core writes a customer-safe sentence for each code it emits; keep it,
    // except for FORBIDDEN, whose answer is always who CAN do this.
    const coreMessage = typeof failure?.message === "string" && failure.message.trim()
      ? failure.message.trim().slice(0, 300)
      : null;
    return new BrandSitesError(
      code,
      code === "FORBIDDEN" ? SITES_ERROR_MESSAGES.FORBIDDEN! : coreMessage ?? SITES_ERROR_MESSAGES[code]!,
      failure?.retryable === true,
    );
  }
  if (code === null && status === 403) {
    return new BrandSitesError("FORBIDDEN", SITES_ERROR_MESSAGES.FORBIDDEN!, false);
  }
  return new BrandSitesError("SERVICE_TEMPORARILY_UNAVAILABLE", UNAVAILABLE_MESSAGE, true);
}

async function failureFromInvokeError(error: unknown): Promise<BrandSitesError> {
  const context = (error as { context?: unknown } | null)?.context as
    | { status?: unknown; json?: () => Promise<unknown>; clone?: () => { json: () => Promise<unknown> } }
    | undefined;
  if (!context || typeof context.json !== "function") {
    return brandSitesErrorFrom(null, null);
  }
  const status = typeof context.status === "number" ? context.status : null;
  try {
    const body = typeof context.clone === "function"
      ? await context.clone().json()
      : await context.json();
    return brandSitesErrorFrom(status, body);
  } catch {
    return brandSitesErrorFrom(status, null);
  }
}

async function invoke<T>(
  route: string,
  method: "GET" | "POST" | "DELETE",
  payload: Record<string, unknown> = {},
  functionName: "brand-site-control" | "brand-site-domains" = "brand-site-control",
): Promise<T> {
  const { data, error } = await supabase.functions.invoke<SitesEnvelope<T>>(
    functionName,
    { body: { route, method, ...payload } },
  );
  if (error !== null) throw await failureFromInvokeError(error);
  if (!data || data.ok !== true) throw brandSitesErrorFrom(null, data);
  return data.data;
}

export async function getBrandSite(
  brandId: string,
): Promise<BrandSiteOverview | null> {
  try {
    return await invoke<BrandSiteOverview>(`/v1/brands/${brandId}/site`, "GET");
  } catch (error) {
    if (error instanceof BrandSitesError && error.code === "NOT_FOUND")
      return null;
    throw error;
  }
}

export async function provisionBrandSite(
  brandId: string,
  requestedOperationId: string,
): Promise<{ operation_id: string }> {
  await invoke(`/v1/brands/${brandId}/site`, "POST", {
    operation_id: requestedOperationId,
  });
  return { operation_id: requestedOperationId };
}

/**
 * #2829 (A5) — what THIS member may do with the brand's website, from Core
 * (entitlement + role checked server-side). The workspace gates on these
 * flags, never on a client-side copy of the role.
 */
export async function getBrandSiteAvailability(
  brandId: string,
): Promise<BrandSiteAvailability> {
  const data = await invoke<Partial<BrandSiteAvailability>>(
    `/v1/brands/${brandId}/site-availability`,
    "GET",
  );
  return {
    available: data?.available === true,
    can_create: data?.can_create === true,
    can_publish: data?.can_publish === true,
    can_edit: data?.can_edit === true,
  };
}

/** #2829 — the address Core proposes (or the existing one), before setup. */
export function proposeBrandSiteLabel(
  brandId: string,
): Promise<BrandSiteLabelProposal> {
  return invoke(`/v1/brands/${brandId}/site-label`, "GET");
}

/** #2829 — take the site offline or bring it back (rank 50, re-checked in Core). */
export function setBrandSiteOffline(input: {
  siteId: string;
  offline: boolean;
  operationId: string;
  reason?: string | null;
}): Promise<{ site_id: string; status: string; offline: boolean }> {
  return invoke(
    `/v1/sites/${input.siteId}/${input.offline ? "offline" : "online"}`,
    "POST",
    {
      operation_id: input.operationId,
      ...(input.reason ? { reason: input.reason.slice(0, 200) } : {}),
    },
  );
}

function exportFrom(
  operationIdValue: string,
  value: Record<string, unknown> | null | undefined,
): BrandSiteExport {
  const summary = (value?.result_summary ?? value ?? {}) as Record<string, unknown>;
  const status = String(value?.status ?? summary.status ?? "executing");
  return {
    operation_id: operationIdValue,
    status: (["authorized", "executing", "succeeded", "failed", "ambiguous"]
      .includes(status) ? status : "executing") as BrandSiteExport["status"],
    download_url: typeof summary.download_url === "string" ? summary.download_url : null,
    expires_at: typeof summary.expires_at === "string" ? summary.expires_at : null,
    bytes: typeof summary.bytes === "number" ? summary.bytes : null,
  };
}

/** #2829 — "Download everything" (rank 50, re-checked in Core). */
export async function requestBrandSiteExport(
  siteId: string,
  requestedOperationId: string,
): Promise<BrandSiteExport> {
  const data = await invoke<Record<string, unknown>>(
    `/v1/sites/${siteId}/exports`,
    "POST",
    { operation_id: requestedOperationId },
  );
  return exportFrom(requestedOperationId, data);
}

export async function getBrandSiteExport(
  siteId: string,
  exportOperationId: string,
): Promise<BrandSiteExport> {
  const data = await invoke<Record<string, unknown>>(
    `/v1/sites/${siteId}/exports/${exportOperationId}`,
    "GET",
  );
  return exportFrom(exportOperationId, data);
}

export function createStudioExchange(
  brandId: string,
): Promise<StudioExchange> {
  return invoke(`/v1/brands/${brandId}/editor-session`, "POST", {
    operation_id: operationId(),
    destination: "studio",
  });
}

export function createBrandSitePreview(input: {
  siteId: string;
  expectedRevision: string;
  sourceDigest: string;
  returnSurface: "web" | "native";
}): Promise<BrandSitePreview> {
  return invoke(`/v1/sites/${input.siteId}/previews`, "POST", {
    operation_id: operationId(),
    expected_revision: input.expectedRevision,
    source_digest: input.sourceDigest,
    return_surface: input.returnSurface,
  });
}

export function getBrandSiteOperation(
  siteId: string,
  receiptId: string,
): Promise<BrandSiteOperation> {
  return invoke(`/v1/sites/${siteId}/operations/${receiptId}`, "GET");
}

export function publishBrandSite(input: {
  siteId: string;
  operationId: string;
  expectedRevision: string;
  sourceDigest: string;
}): Promise<{ operation_id: string; status: string }> {
  return invoke(`/v1/sites/${input.siteId}/publications`, "POST", {
    operation_id: input.operationId,
    expected_revision: input.expectedRevision,
    source_digest: input.sourceDigest,
  }).then((result) => ({
    operation_id: input.operationId,
    status:
      result && typeof result === "object" && "status" in result
        ? String((result as { status?: unknown }).status ?? "executing")
        : "executing",
  }));
}

export function validateBrandSiteDraft(input: {
  brandId: string;
  siteId: string;
}): Promise<BrandSiteDraftValidation> {
  return invoke(`/v1/sites/${input.siteId}/ari`, "POST", {
    operation_id: operationId(),
    action: "validate_site_draft",
    brand_id: input.brandId,
    args: { brand_id: input.brandId, site_id: input.siteId },
  });
}

/** #2829 W10 — one private share-preview link (never its token). */
export type BrandSiteShareLink = {
  id: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  last_viewed_at: string | null;
  view_count: number;
  created_by_name: string | null;
  state: "active" | "expired" | "revoked";
};

/** The link as made: its address is shown once (Mingla keeps only a digest). */
export type BrandSiteShareLinkCreated = {
  id: string;
  created_at: string;
  expires_at: string;
  url: string;
  preview_ready: boolean;
};

export function listBrandSiteShareLinks(siteId: string): Promise<BrandSiteShareLink[]> {
  return invoke<{ links: BrandSiteShareLink[] }>(`/v1/sites/${siteId}/share-links`, "GET")
    .then((data) => (Array.isArray(data?.links) ? data.links : []));
}

/**
 * #2829 W10 — share the draft as it is now: the same draft check the preview
 * uses (revision + digest) travels with the request, so Core builds a fresh
 * preview of exactly this draft for the link.
 */
export async function createBrandSiteShareLink(input: {
  brandId: string;
  siteId: string;
  ttlDays: 1 | 7 | 14;
}): Promise<BrandSiteShareLinkCreated> {
  const draft = await validateBrandSiteDraft({ brandId: input.brandId, siteId: input.siteId });
  return invoke(`/v1/sites/${input.siteId}/share-links`, "POST", {
    ttl_days: input.ttlDays,
    operation_id: operationId(),
    expected_revision: draft.home_revision,
    source_digest: draft.draft_digest,
  });
}

export function revokeBrandSiteShareLink(input: { siteId: string; linkId: string }): Promise<unknown> {
  return invoke(`/v1/sites/${input.siteId}/share-links/${input.linkId}/revoke`, "POST");
}

/** #2829 W3 — the site's look as Studio stores it (design, tokens, fonts, revision). */
export interface BrandSiteLook {
  design: string | null;
  tokens: unknown;
  fonts: unknown;
  revision: string;
}

export async function getBrandSiteLook(input: { brandId: string; siteId: string }): Promise<BrandSiteLook> {
  const data = await invoke<{ settings?: Record<string, unknown> | null }>(`/v1/sites/${input.siteId}/ari`, "POST", {
    operation_id: operationId(),
    action: "get_brand_site",
    brand_id: input.brandId,
    args: { brand_id: input.brandId, site_id: input.siteId },
  });
  const settings = data?.settings ?? null;
  if (!settings || typeof settings.updatedAt !== "string") {
    throw new BrandSitesError("NOT_FOUND", SITES_ERROR_MESSAGES.NOT_FOUND!, false);
  }
  return {
    design: typeof settings.design === "string" ? settings.design : null,
    tokens: settings.tokens ?? null,
    fonts: settings.fonts ?? null,
    revision: settings.updatedAt,
  };
}

/** #2829 W3 — saves the owner's exact colours and fonts to the draft (never published here). */
export async function saveBrandSiteLook(input: {
  brandId: string;
  siteId: string;
  revision: string;
  tokens: unknown;
  fonts: unknown;
  /** #2829 W9a — the design, when the owner switched it. */
  design?: string;
}): Promise<{ revision: string }> {
  const data = await invoke<{ revision?: unknown }>(`/v1/sites/${input.siteId}/ari`, "POST", {
    operation_id: operationId(),
    action: "propose_site_settings_update",
    brand_id: input.brandId,
    args: {
      brand_id: input.brandId,
      site_id: input.siteId,
      expected_revision: input.revision,
      changes: {
        tokens: input.tokens,
        fonts: input.fonts,
        ...(input.design ? { design: input.design } : {}),
      },
    },
  });
  return { revision: typeof data?.revision === "string" ? data.revision : input.revision };
}

export interface SiteFontResult {
  family: string;
  category: string;
  weights: number[];
}

/** #2829 W3 — searches the Google Fonts catalogue Studio holds (the app never bundles it). */
export function searchBrandSiteFonts(input: { brandId: string; siteId: string; query: string }): Promise<SiteFontResult[]> {
  return invoke(`/v1/sites/${input.siteId}/ari`, "POST", {
    operation_id: operationId(),
    action: "search_fonts",
    brand_id: input.brandId,
    args: { brand_id: input.brandId, site_id: input.siteId, query: input.query.slice(0, 64) },
  });
}

export function getBrandSiteVersions(
  siteId: string,
): Promise<BrandSiteVersion[]> {
  return invoke(`/v1/sites/${siteId}/versions`, "GET");
}

export function getBrandSiteAnalytics(
  siteId: string,
): Promise<BrandSiteAnalytics> {
  return invoke(`/v1/sites/${siteId}/analytics`, "GET");
}

export function rollbackBrandSite(input: {
  siteId: string;
  operationId: string;
  sourceRevision: string;
  sourceDigest: string;
}): Promise<{ operation_id: string; status: string }> {
  return invoke(`/v1/sites/${input.siteId}/rollbacks`, "POST", {
    operation_id: input.operationId,
    expected_revision: input.sourceRevision,
    source_digest: input.sourceDigest,
  }).then((result) => ({
    operation_id: input.operationId,
    status:
      result && typeof result === "object" && "status" in result
        ? String((result as { status?: unknown }).status ?? "executing")
        : "executing",
  }));
}

export const PRODUCTION_STUDIO_ORIGIN = "https://studio.sites.usemingla.com";

/**
 * #2829 — the Studio origin the "Edit website" handoff opens. Production is
 * fixed. A developer running the local Sites stack sets
 * EXPO_PUBLIC_SITES_LOCAL_STUDIO_ORIGIN (scripts/sites/local/run-business-web.sh);
 * only a plain http loopback origin is honoured, anything else falls back to
 * production, and app.config.js fails every EAS/Vercel build that carries it.
 */
export function resolveStudioOrigin(
  raw: string | undefined = process.env.EXPO_PUBLIC_SITES_LOCAL_STUDIO_ORIGIN,
): string {
  if (!raw) return PRODUCTION_STUDIO_ORIGIN;
  let url: URL;
  try {
    url = new URL(raw);
  } catch (_error) {
    return PRODUCTION_STUDIO_ORIGIN;
  }
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  const bare = url.pathname === "/" && url.search === "" && url.hash === "" && url.username === "" && url.password === "";
  return url.protocol === "http:" && loopback && bare ? url.origin : PRODUCTION_STUDIO_ORIGIN;
}

export function studioExchangeUrl(
  exchange: StudioExchange,
  returnSurface: "web" | "native",
  brandId: string,
  /** #2829 W9r — open the editor of this page (Website › Pages › Edit). */
  pageId?: string | null,
): string {
  const safeCode = encodeURIComponent(exchange.code);
  const safeDestination = encodeURIComponent(exchange.destination);
  const safeSiteId = encodeURIComponent(exchange.site_id);
  const safeBrandId = encodeURIComponent(brandId);
  const page = pageId && /^[A-Za-z0-9-]{1,64}$/.test(pageId) ? `&page=${encodeURIComponent(pageId)}` : "";
  return `${resolveStudioOrigin()}/mingla/exchange?code=${safeCode}&destination=${safeDestination}&site_id=${safeSiteId}&brand_id=${safeBrandId}&return_surface=${returnSurface}${page}`;
}


/*
 * #2829 W8 — the brand's own domain (brand-site-domains). Core rank-checks
 * every call: rank 20 reads, brand admins and owners change addresses.
 */
export function getBrandSiteDomains(siteId: string): Promise<BrandSiteDomains> {
  return invoke(`/v1/sites/${siteId}/domains`, "GET", {}, "brand-site-domains");
}

export function attachBrandSiteDomain(input: {
  siteId: string;
  hostname: string;
  operationId?: string;
}): Promise<{ host_id: string; hostname: string; checked: boolean; domains: BrandSiteDomains | null }> {
  return invoke(`/v1/sites/${input.siteId}/domains`, "POST", {
    hostname: input.hostname,
    operation_id: input.operationId ?? operationId(),
  }, "brand-site-domains");
}

export function checkBrandSiteDomain(input: { siteId: string; hostId: string }): Promise<Record<string, unknown>> {
  return invoke(`/v1/sites/${input.siteId}/domains/${input.hostId}/check`, "POST", {}, "brand-site-domains");
}

export function setPrimaryBrandSiteDomain(input: {
  siteId: string;
  hostId: string;
  operationId?: string;
}): Promise<Record<string, unknown>> {
  return invoke(`/v1/sites/${input.siteId}/domains/${input.hostId}/primary`, "POST", {
    operation_id: input.operationId ?? operationId(),
  }, "brand-site-domains");
}

export function detachBrandSiteDomain(input: {
  siteId: string;
  hostId: string;
  operationId?: string;
}): Promise<{ status: string; release_now: boolean }> {
  return invoke(`/v1/sites/${input.siteId}/domains/${input.hostId}`, "DELETE", {
    operation_id: input.operationId ?? operationId(),
  }, "brand-site-domains");
}

/** #2829 W9a — the envelope call and error reader, for the plan module (src/sites/planApi.ts). */
export { invoke as invokeBrandSiteControl, failureFromInvokeError };
