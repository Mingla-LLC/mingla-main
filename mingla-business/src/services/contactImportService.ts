import { supabase } from "./supabase";
import { CONTACT_IMPORT_MAPPING_VERSION } from "../constants/contactImportAttestation";

export type ContactImportTarget =
  "full_name" | "first_name" | "last_name" | "email" | "phone" | "ignore";
export type ContactImportMapping = Record<string, ContactImportTarget>;
export type ContactImportCounts = {
  rowCount: number;
  addedCount: number;
  updatedCount: number;
  reviewCount: number;
  invalidCount: number;
  duplicateCount: number;
  unchangedCount: number;
  alreadySuppressedCount: number;
};
export type ContactImportFile = {
  uri: string;
  name: string;
  mimeType: string | null;
  size: number;
  webFile?: File;
};
export type ContactImportInspection = {
  inspectionId: string;
  inspectionToken: string;
  expiresAt: string;
  file: {
    name: string;
    sizeBytes: number;
    sha256: string;
    rowCount: number;
    detectedProvider: "eventbrite" | "mailchimp" | "generic";
    dialect: string;
    headers: string[];
  };
  samples: Array<{ header: string; values: string[] }>;
  suggestedMapping: ContactImportMapping;
};
export type ContactImportPreview = {
  batchId: string;
  previewToken: string;
  expiresAt: string;
  file: ContactImportInspection["file"];
  mapping: ContactImportMapping;
  attestation: { version: string; text: string; brandName: string };
  counts: ContactImportCounts;
  rows: Array<{
    rowNumber: number;
    outcome: string;
    reasonCode: string | null;
    emailSuppressed: boolean;
    smsSuppressed: boolean;
    maskedName?: string;
  }>;
};
export type ContactImportResult = {
  batchId: string;
  state: string;
  counts: ContactImportCounts;
  resultRows: Array<{
    rowNumber: number;
    outcome: string;
    reasonCode: string | null;
    personId?: string | null;
    conflictId?: string | null;
    emailSuppressed: boolean;
    smsSuppressed: boolean;
  }>;
  resultPage: { page: number; pageSize: number; total: number };
  reviewHref?: string;
  failureCode?: string | null;
};

export class ContactImportError extends Error {
  constructor(
    public code: string,
    message: string,
    public retryable: boolean,
    public requestId?: string,
  ) {
    super(message);
    this.name = "ContactImportError";
  }
}
const unwrap = <T>(payload: unknown): T => {
  const p = payload as {
    ok?: boolean;
    requestId?: string;
    data?: T;
    error?: { code?: string; message?: string; retryable?: boolean };
  };
  if (p?.ok === true && p.data) return p.data;
  throw new ContactImportError(
    p?.error?.code ?? "IMPORT_FAILED",
    p?.error?.message ?? "We couldn't finish the import.",
    p?.error?.retryable === true,
    p?.requestId,
  );
};
const filePart = (
  file: ContactImportFile,
): Blob | { uri: string; name: string; type: string } =>
  file.webFile ??
  ({
    uri: file.uri,
    name: file.name,
    type: file.mimeType ?? "text/csv",
  } as const);
const invokeFailure = async (error: unknown): Promise<never> => {
  const context =
    error && typeof error === "object"
      ? (error as { context?: unknown }).context
      : undefined;
  if (
    context &&
    typeof context === "object" &&
    typeof (context as { status?: unknown }).status === "number" &&
    typeof (context as { json?: unknown }).json === "function"
  ) {
    try {
      const response = context as {
        clone?: () => { json: () => Promise<unknown> };
        json: () => Promise<unknown>;
      };
      const payload = (await (response.clone?.() ?? response).json()) as {
        requestId?: string;
        error?: { code?: string; message?: string; retryable?: boolean };
      };
      throw new ContactImportError(
        payload.error?.code ?? "IMPORT_FAILED",
        payload.error?.message ?? "We couldn't finish the import.",
        payload.error?.retryable === true,
        payload.requestId,
      );
    } catch (parsed) {
      if (parsed instanceof ContactImportError) throw parsed;
    }
  }
  throw new ContactImportError(
    "TEMPORARILY_UNAVAILABLE",
    "We couldn't reach Mingla. Try again.",
    true,
  );
};
const invokeForm = async <T>(
  form: FormData,
  action: "inspect" | "preview",
  brandId: string,
): Promise<T> => {
  const { data, error } = await supabase.functions.invoke("contact-import", {
    body: form,
    headers: {
      "x-mingla-import-action": action,
      "x-mingla-brand-id": brandId,
    },
  });
  if (error) return invokeFailure(error);
  return unwrap<T>(data);
};
const invokeJson = async <T>(body: Record<string, unknown>): Promise<T> => {
  const { data, error } = await supabase.functions.invoke("contact-import", {
    body,
  });
  if (error) return invokeFailure(error);
  return unwrap<T>(data);
};
export async function inspectContactImport(
  brandId: string,
  file: ContactImportFile,
): Promise<ContactImportInspection> {
  const f = new FormData();
  f.append("action", "inspect");
  f.append("brandId", brandId);
  f.append("file", filePart(file) as Blob);
  return invokeForm(f, "inspect", brandId);
}
export async function previewContactImport(input: {
  brandId: string;
  file: ContactImportFile;
  inspection: ContactImportInspection;
  mapping: ContactImportMapping;
}): Promise<ContactImportPreview> {
  const f = new FormData();
  f.append("action", "preview");
  f.append("brandId", input.brandId);
  f.append("inspectionId", input.inspection.inspectionId);
  f.append("inspectionToken", input.inspection.inspectionToken);
  f.append("mappingVersion", CONTACT_IMPORT_MAPPING_VERSION);
  f.append("normalizedMapping", JSON.stringify(input.mapping));
  f.append("file", filePart(input.file) as Blob);
  return invokeForm(f, "preview", input.brandId);
}
export const executeContactImport = (input: {
  brandId: string;
  preview: ContactImportPreview;
  mapping: ContactImportMapping;
  idempotencyKey: string;
}): Promise<ContactImportResult> =>
  invokeJson({
    action: "execute",
    brandId: input.brandId,
    batchId: input.preview.batchId,
    previewToken: input.preview.previewToken,
    fileSha256: input.preview.file.sha256,
    normalizedMapping: input.mapping,
    mappingVersion: CONTACT_IMPORT_MAPPING_VERSION,
    attestationVersion: input.preview.attestation.version,
    attestationText: input.preview.attestation.text,
    accepted: true,
    idempotencyKey: input.idempotencyKey,
  });
export const getContactImportStatus = (
  brandId: string,
  batchId: string,
  page = 0,
  pageSize = 200,
): Promise<ContactImportResult> =>
  invokeJson({ action: "status", brandId, batchId, page, pageSize });
export const cancelContactImport = (
  brandId: string,
  batchId: string,
): Promise<{ batchId: string; state: string }> =>
  invokeJson({ action: "cancel", brandId, batchId });
