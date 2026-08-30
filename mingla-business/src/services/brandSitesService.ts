import { supabase } from "./supabase";
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

export function provisionBrandSite(brandId: string): Promise<{
  site_id: string;
  status: string;
}> {
  return invoke(`/v1/brands/${brandId}/site`, "POST", {
    operation_id: operationId(),
  });
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
}): Promise<BrandSitePreview> {
  return invoke(`/v1/sites/${input.siteId}/previews`, "POST", {
    operation_id: operationId(),
    expected_revision: input.expectedRevision,
    source_digest: input.sourceDigest,
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
  expectedRevision: string;
  sourceDigest: string;
  argumentsDigest: string;
}): Promise<{ status: string }> {
  return invoke(`/v1/sites/${input.siteId}/publications`, "POST", {
    operation_id: operationId(),
    expected_revision: input.expectedRevision,
    source_digest: input.sourceDigest,
    arguments_digest: input.argumentsDigest,
  });
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
  sourceRevision: string;
  sourceDigest: string;
}): Promise<{ status: string }> {
  return invoke(`/v1/sites/${input.siteId}/rollbacks`, "POST", {
    operation_id: operationId(),
    expected_revision: input.sourceRevision,
    source_digest: input.sourceDigest,
  });
}

export function studioExchangeUrl(exchange: StudioExchange): string {
  const safeCode = encodeURIComponent(exchange.code);
  const safeDestination = encodeURIComponent(exchange.destination);
  const safeSiteId = encodeURIComponent(exchange.site_id);
  return `https://studio.sites.usemingla.com/mingla/exchange?code=${safeCode}&destination=${safeDestination}&site_id=${safeSiteId}`;
}
