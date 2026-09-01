import { supabase } from "./supabase";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type {
  BrandSiteOperation,
  BrandSiteOverview,
  BrandSiteAnalytics,
  BrandSiteDraftValidation,
  BrandSitePreview,
  BrandSiteVersion,
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

async function invoke<T>(
  route: string,
  method: "GET" | "POST",
  payload: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await supabase.functions.invoke<SitesEnvelope<T>>(
    "brand-site-control",
    { body: { route, method, ...payload } },
  );
  if (error !== null) {
    throw new BrandSitesError(
      "SERVICE_TEMPORARILY_UNAVAILABLE",
      "Website tools are temporarily unavailable.",
      true,
    );
  }
  if (!data || data.ok !== true) {
    const failure = data as SitesFailure | null;
    throw new BrandSitesError(
      failure?.error.code ?? "SERVICE_TEMPORARILY_UNAVAILABLE",
      failure?.error.message ?? "Website tools are temporarily unavailable.",
      failure?.error.retryable === true,
    );
  }
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

export function studioExchangeUrl(
  exchange: StudioExchange,
  returnSurface: "web" | "native",
  brandId: string,
): string {
  const safeCode = encodeURIComponent(exchange.code);
  const safeDestination = encodeURIComponent(exchange.destination);
  const safeSiteId = encodeURIComponent(exchange.site_id);
  const safeBrandId = encodeURIComponent(brandId);
  return `https://studio.sites.usemingla.com/mingla/exchange?code=${safeCode}&destination=${safeDestination}&site_id=${safeSiteId}&brand_id=${safeBrandId}&return_surface=${returnSurface}`;
}
