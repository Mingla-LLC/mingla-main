import { createGuestRosterRequestId } from "./guestRosterService";
import { supabase } from "./supabase";

export type BrandBookExportStatus =
  | "queued"
  | "running"
  | "ready"
  | "failed"
  | "expired";

export interface BrandBookExportResult {
  fileName: string;
  expiresAt: string;
}

export interface BrandBookExportJob {
  jobId: string;
  status: BrandBookExportStatus;
  exportableCount: number | null;
  result: BrandBookExportResult | null;
  safeErrorCode: string | null;
  signedUrl: string | null;
}

export class BrandBookExportError extends Error {
  public readonly code: "unauthorized" | "forbidden" | "request_failed" | "invalid_response";

  public constructor(code: BrandBookExportError["code"]) {
    super(code);
    this.name = "BrandBookExportError";
    this.code = code;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseFunctionsError = async (error: unknown): Promise<BrandBookExportError> => {
  if (!isRecord(error) || !isRecord(error.context)) {
    return new BrandBookExportError("request_failed");
  }
  const context = error.context;
  const status = typeof context.status === "number" ? context.status : null;
  let serverCode: string | null = null;
  const response = typeof context.clone === "function"
    ? (context.clone as () => unknown)()
    : context;
  if (isRecord(response) && typeof response.text === "function") {
    try {
      const rawBody = await (response.text as () => Promise<string>)();
      const body = JSON.parse(rawBody) as unknown;
      if (isRecord(body) && typeof body.error === "string") serverCode = body.error;
    } catch {
      // The HTTP status still safely distinguishes auth failures when the body
      // is unavailable. Never expose the opaque transport message to the UI.
    }
  }
  if (status === 401 || serverCode === "unauthorized") {
    return new BrandBookExportError("unauthorized");
  }
  if (status === 403 || serverCode === "forbidden") {
    return new BrandBookExportError("forbidden");
  }
  return new BrandBookExportError("request_failed");
};

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

const asCount = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

const parseJob = (
  value: unknown,
  options: { requireExportableCount?: boolean; requireReadyUrl?: boolean } = {},
): BrandBookExportJob => {
  if (!isRecord(value)) throw new BrandBookExportError("invalid_response");
  const jobId = asString(value.jobId);
  const status = asString(value.status);
  const exportableCount = asCount(value.exportableCount);
  if (
    jobId === null ||
    status === null ||
    (options.requireExportableCount === true && exportableCount === null) ||
    !["queued", "running", "ready", "failed", "expired"].includes(status)
  ) {
    throw new BrandBookExportError("invalid_response");
  }
  let result: BrandBookExportResult | null = null;
  if (value.result !== null && value.result !== undefined) {
    if (!isRecord(value.result)) throw new BrandBookExportError("invalid_response");
    const fileName = asString(value.result.fileName);
    const expiresAt = asString(value.result.expiresAt);
    if (fileName === null || expiresAt === null) {
      throw new BrandBookExportError("invalid_response");
    }
    result = { fileName, expiresAt };
  }
  // The backend intentionally reports a ready job with no result once its
  // storage object has expired but before the cleanup worker rewrites status.
  // Normalize that transition so the UI never offers a dead Download action.
  const normalizedStatus = status === "ready" && result === null ? "expired" : status;
  const signedUrl = asString(value.signedUrl);
  if (options.requireReadyUrl === true && normalizedStatus === "ready" && signedUrl === null) {
    throw new BrandBookExportError("invalid_response");
  }
  return {
    jobId,
    status: normalizedStatus as BrandBookExportStatus,
    exportableCount,
    result,
    safeErrorCode: asString(value.safeErrorCode),
    signedUrl,
  };
};

export const createBrandBookExportRequestId = createGuestRosterRequestId;

export async function requestBrandBookExport(input: {
  brandId: string;
  clientRequestId: string;
}): Promise<BrandBookExportJob> {
  const { data, error } = await supabase.functions.invoke<unknown>("brand-people-export", {
    body: {
      scope: "brand_book",
      brandId: input.brandId,
      filter: "all",
      search: null,
      sort: "name_asc",
      filterSnapshot: {},
      clientRequestId: input.clientRequestId,
    },
  });
  if (error !== null) throw await parseFunctionsError(error);
  return parseJob(data, { requireExportableCount: true });
}

export async function getBrandBookExport(jobId: string): Promise<BrandBookExportJob> {
  const { data, error } = await supabase.functions.invoke<unknown>("brand-people-export", {
    body: { operation: "status", jobId },
  });
  if (error !== null) throw await parseFunctionsError(error);
  return parseJob(data, { requireReadyUrl: true });
}
