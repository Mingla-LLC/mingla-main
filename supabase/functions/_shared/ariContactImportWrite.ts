/**
 * Issue #3355 — the confirmed write behind Ari's contact-list import
 * (`manage_brand_people` action "import"). It runs the EXISTING contact
 * import's execute (#1775, `supabase/functions/contact-import`) as the
 * caller, on the list Ari's flow already checked (staged) with the same
 * import. That one path keeps the role check, the feature flag, matching
 * against existing contacts, suppressions, the audit trail and the owner's
 * recorded permission (the attestation), exactly as the Host's own import.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  CONTACT_IMPORT_ATTESTATION_VERSION,
  CONTACT_IMPORT_MAPPING_VERSION,
  renderContactImportAttestation,
} from "./contactImportContract.ts";
import { ToolError } from "./agentToolHelpers.ts";

/** The fixed column mapping of the CSV Ari builds (Name, Email, Phone). */
export const ARI_CONTACT_CSV_MAPPING: Readonly<Record<string, string>> = Object
  .freeze({ Email: "email", Name: "full_name", Phone: "phone" });

const SHA256 = /^[0-9a-f]{64}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The staged import's execute body (#1775 contract). */
export function contactImportExecuteBody(args: {
  brandId: string;
  brandName: string;
  batchId: string;
  previewToken: string;
  fileSha256: string;
  idempotencyKey: string;
}): Record<string, unknown> {
  return {
    action: "execute",
    brandId: args.brandId,
    batchId: args.batchId,
    previewToken: args.previewToken,
    fileSha256: args.fileSha256,
    normalizedMapping: ARI_CONTACT_CSV_MAPPING,
    mappingVersion: CONTACT_IMPORT_MAPPING_VERSION,
    attestationVersion: CONTACT_IMPORT_ATTESTATION_VERSION,
    attestationText: renderContactImportAttestation(args.brandName),
    accepted: true,
    idempotencyKey: args.idempotencyKey,
  };
}

/** Plain words for the import's own refusal codes (nothing was saved). */
export function contactImportRefusalWords(code: string): string {
  switch (code) {
    case "FORBIDDEN":
      return "Only the owner, a brand admin or a marketing manager can import contacts for this brand.";
    case "PREVIEW_STALE_OR_TAMPERED":
    case "BATCH_NOT_FOUND":
      return "the checked list is more than a day old or was changed. Send the list again and I'll check it fresh.";
    case "IDEMPOTENCY_CONFLICT":
      return "this list was already imported once.";
    default:
      return "the import couldn't finish just now. Try again in a moment.";
  }
}

/** Read the import's JSON error body from a non-2xx `functions.invoke`. */
export async function contactImportErrorCode(error: unknown): Promise<string> {
  const context = (error as { context?: unknown } | null)?.context;
  if (
    context && typeof context === "object" &&
    typeof (context as { json?: unknown }).json === "function"
  ) {
    try {
      const body = await (context as { json(): Promise<unknown> }).json();
      const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
      if (typeof code === "string" && /^[A-Z_]{2,60}$/.test(code)) return code;
    } catch {
      // Not the import's JSON: an outage, reported as such below.
    }
  }
  return "IMPORT_FAILED";
}

/**
 * Execute the staged import as the caller. Returns the counts the import
 * saved (the same counts its status read returns), keyed so the flow can
 * read the import back by its id.
 */
export async function executeAriContactImport(args: {
  client: SupabaseClient;
  brandId: string;
  batchId: unknown;
  previewToken: unknown;
  fileSha256: unknown;
  operationId: string;
}): Promise<Record<string, unknown>> {
  if (
    typeof args.batchId !== "string" || !UUID.test(args.batchId) ||
    typeof args.previewToken !== "string" || args.previewToken.length < 20 ||
    args.previewToken.length > 200 ||
    typeof args.fileSha256 !== "string" || !SHA256.test(args.fileSha256)
  ) {
    throw new ToolError(
      "INVALID_ARGS",
      "An import needs a list Ari has checked first. Nothing was saved.",
    );
  }
  const { data: brand, error: brandError } = await args.client.from("brands")
    .select("name").eq("id", args.brandId).maybeSingle();
  const brandName = (brand as { name?: unknown } | null)?.name;
  if (brandError || typeof brandName !== "string") {
    throw new ToolError(
      "IMPORT_FAILED",
      "I couldn't read your brand just now, so nothing was imported.",
    );
  }
  const { data, error } = await args.client.functions.invoke("contact-import", {
    body: contactImportExecuteBody({
      brandId: args.brandId,
      brandName,
      batchId: args.batchId,
      previewToken: args.previewToken,
      fileSha256: args.fileSha256,
      idempotencyKey: args.operationId,
    }),
  });
  if (error) {
    const code = await contactImportErrorCode(error);
    throw new ToolError(code, contactImportRefusalWords(code));
  }
  const payload = (data as { data?: Record<string, unknown> } | null)?.data;
  const counts = payload?.counts;
  if (!payload || payload.state !== "completed" || !counts) {
    throw new ToolError(
      "IMPORT_FAILED",
      contactImportRefusalWords("IMPORT_FAILED"),
    );
  }
  return {
    id: args.batchId,
    import_batch_id: args.batchId,
    state: "completed",
    counts,
  };
}
