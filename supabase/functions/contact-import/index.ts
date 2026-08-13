import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveUserPhoneE164 } from "../../../packages/card-identity/phone.mjs";
import { corsHeaders as sharedCorsHeaders } from "../_shared/cors.ts";
import {
  CONTACT_IMPORT_ATTESTATION_VERSION,
  CONTACT_IMPORT_MAPPING_VERSION,
  CONTACT_IMPORT_MAX_BYTES,
  CONTACT_IMPORT_MAX_ROWS,
  type ContactImportTarget,
  normalizeContactImportHeader,
  renderContactImportAttestation,
  suggestContactImportMapping,
} from "./importContract.ts";

type Provider = "eventbrite" | "mailchimp" | "generic";
type Dialect = "comma" | "semicolon" | "tab";
type Mapping = Record<string, ContactImportTarget>;
type ParsedCsv = { headers: string[]; rows: string[][]; dialect: Dialect };
type ServiceClient = Pick<
  ReturnType<typeof createClient>,
  "rpc" | "from"
>;
const contactImportCorsHeaders = {
  ...sharedCorsHeaders,
  "Access-Control-Allow-Headers": `${
    sharedCorsHeaders["Access-Control-Allow-Headers"]
  }, x-mingla-import-action, x-mingla-brand-id`,
};

class ImportError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public retryable = false,
  ) {
    super(message);
  }
}

const json = (requestId: string, data: unknown, status = 200): Response =>
  new Response(
    JSON.stringify(
      status < 400
        ? { ok: true, requestId, data }
        : { ok: false, requestId, error: data },
    ),
    {
      status,
      headers: {
        ...contactImportCorsHeaders,
        "Content-Type": "application/json",
      },
    },
  );

export async function sha256Hex(value: Uint8Array | string): Promise<string> {
  const bytes = typeof value === "string"
    ? new TextEncoder().encode(value)
    : value;
  const stable = Uint8Array.from(bytes);
  return [
    ...new Uint8Array(await crypto.subtle.digest("SHA-256", stable.buffer)),
  ].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const token = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll(
    "/",
    "_",
  ).replaceAll("=", "");
};
const mask = (value: string): string => {
  const v = value.trim();
  if (!v) return "";
  if (v.includes("@")) {
    const [l, d] = v.split("@");
    return `${l.slice(0, 1)}•••@${d}`;
  }
  const digits = v.replace(/\D/g, "");
  return digits.length > 4 ? `••••${digits.slice(-4)}` : "••••";
};

function parseWithDelimiter(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field.length === 0) quoted = true;
    else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (quoted) {
    throw new ImportError(
      "INVALID_CSV",
      "The CSV has an unterminated quoted field.",
    );
  }
  row.push(field.replace(/\r$/, ""));
  rows.push(row);
  while (rows.length && rows[rows.length - 1].every((x) => x.trim() === "")) {
    rows.pop();
  }
  return rows;
}

export function parseCsvBytes(bytes: Uint8Array, name: string): ParsedCsv {
  if (!name.toLowerCase().endsWith(".csv")) {
    throw new ImportError("INVALID_FILE_TYPE", "Choose a CSV file.");
  }
  if (bytes.length === 0) {
    throw new ImportError("EMPTY_FILE", "Choose a non-empty file.");
  }
  if (bytes.length > CONTACT_IMPORT_MAX_BYTES) {
    throw new ImportError("FILE_TOO_LARGE", "Choose a CSV smaller than 10 MB.");
  }
  if (bytes.includes(0)) {
    throw new ImportError(
      "INVALID_ENCODING",
      "Save this file as UTF-8 CSV and try again.",
    );
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ImportError(
      "INVALID_ENCODING",
      "Save this file as UTF-8 CSV and try again.",
    );
  }
  text = text.replace(/^\uFEFF/, "");
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(text)) {
    throw new ImportError(
      "INVALID_ENCODING",
      "Save this file as UTF-8 CSV and try again.",
    );
  }
  const candidates = [[",", "comma"], [";", "semicolon"], [
    "\t",
    "tab",
  ]] as const;
  let chosen: { rows: string[][]; dialect: Dialect } | null = null;
  for (const [delimiter, dialect] of candidates) {
    const rows = parseWithDelimiter(text, delimiter);
    const width = rows[0]?.length ?? 0;
    if (width > 1 && rows.every((r) => r.length === width)) {
      chosen = { rows, dialect };
      break;
    }
  }
  if (!chosen) {
    throw new ImportError("INVALID_CSV", "The CSV columns are inconsistent.");
  }
  const [headers, ...rows] = chosen.rows;
  if (!headers || rows.length === 0) {
    throw new ImportError(
      "EMPTY_FILE",
      "The CSV needs a header and at least one contact row.",
    );
  }
  if (
    headers.length > 200 || headers.some((h) => !h.trim()) ||
    new Set(headers).size !== headers.length
  ) {
    throw new ImportError(
      "INVALID_CSV",
      "The CSV headers are invalid or duplicated.",
    );
  }
  if (rows.length > CONTACT_IMPORT_MAX_ROWS) {
    throw new ImportError(
      "ROW_LIMIT_EXCEEDED",
      "Choose a CSV with 10,000 rows or fewer.",
    );
  }
  return { headers, rows, dialect: chosen.dialect };
}

const detectProvider = (headers: readonly string[]): Provider => {
  const h = new Set(headers.map(normalizeContactImportHeader));
  if (h.has("attendee name") && (h.has("email") || h.has("cell phone"))) {
    return "eventbrite";
  }
  if (
    (h.has("email") || h.has("email address")) &&
    ["first name", "last name", "phone", "phone number"].some((x) => h.has(x))
  ) return "mailchimp";
  return "generic";
};
function canonicalMapping(raw: unknown, headers: readonly string[]): Mapping {
  if (!raw || typeof raw !== "object") {
    throw new ImportError(
      "INVALID_MAPPING",
      "Choose columns before continuing.",
    );
  }
  const allowed = new Set([
    "full_name",
    "first_name",
    "last_name",
    "email",
    "phone",
    "ignore",
  ]);
  const out: Mapping = {};
  headers.forEach((h) => {
    const v = (raw as Record<string, unknown>)[h];
    if (typeof v !== "string" || !allowed.has(v)) {
      throw new ImportError("INVALID_MAPPING", "Map every CSV column.");
    }
    out[h] = v as ContactImportTarget;
  });
  const values = Object.values(out).filter((x) => x !== "ignore");
  if (!values.includes("email") && !values.includes("phone")) {
    throw new ImportError(
      "NO_CONTACT_COLUMN",
      "Choose an email or phone column.",
    );
  }
  if (
    new Set(values).size !== values.length ||
    (values.includes("full_name") &&
      (values.includes("first_name") || values.includes("last_name")))
  ) {
    throw new ImportError(
      "INVALID_MAPPING",
      "Choose only one of each field and do not mix Full name with First/Last name.",
    );
  }
  return Object.fromEntries(
    Object.entries(out).sort(([a], [b]) => a.localeCompare(b)),
  );
}
function parseMapping(mappingJson: string): unknown {
  try {
    return JSON.parse(mappingJson);
  } catch {
    throw new ImportError(
      "INVALID_MAPPING",
      "The column mapping is invalid.",
      400,
    );
  }
}

async function actor(req: Request) {
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) {
    throw new ImportError("AUTH_REQUIRED", "Sign in again.", 401);
  }
  const url = Deno.env.get("SUPABASE_URL") ?? "",
    anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const caller = createClient(url, anon, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const { data, error } = await caller.auth.getUser();
  if (error || !data.user) {
    throw new ImportError("AUTH_REQUIRED", "Sign in again.", 401);
  }
  return {
    userId: data.user.id,
    service: createClient(url, serviceKey, { auth: { persistSession: false } }),
  };
}
async function authorize(
  service: ServiceClient,
  brandId: string,
  userId: string,
  requireEnabled: boolean,
) {
  const { data, error } = await service.rpc(
    requireEnabled
      ? "issue_1775_import_authorized"
      : "issue_1775_import_access_authorized",
    {
      p_brand_id: brandId,
      p_actor: userId,
    } as never,
  );
  if (error || data !== true) {
    throw new ImportError(
      "FORBIDDEN",
      "You do not have access to contact import.",
      403,
    );
  }
}

const IMPORT_REQUEST_OVERHEAD_BYTES = 256 * 1024;
async function authorizedMultipart(req: Request): Promise<FormData> {
  const limit = CONTACT_IMPORT_MAX_BYTES + IMPORT_REQUEST_OVERHEAD_BYTES;
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > limit) {
    throw new ImportError(
      "FILE_TOO_LARGE",
      "Choose a CSV smaller than 10 MB.",
      413,
    );
  }
  if (!req.body) throw new ImportError("INVALID_REQUEST", "Choose a CSV file.");
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new ImportError(
        "FILE_TOO_LARGE",
        "Choose a CSV smaller than 10 MB.",
        413,
      );
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return await new Request("http://contact-import.local", {
    method: "POST",
    headers: { "content-type": req.headers.get("content-type") ?? "" },
    body: bytes,
  }).formData();
}

const resultRows = async (
  service: ServiceClient,
  batchId: unknown,
  pageRaw: unknown = 0,
  pageSizeRaw: unknown = 200,
) => {
  const page = Math.max(0, Number(pageRaw) || 0);
  const pageSize = Math.min(200, Math.max(1, Number(pageSizeRaw) || 200));
  const from = page * pageSize;
  const { data, error, count } = await service.from("brand_contact_import_rows")
    .select(
      "row_number,outcome,reason_code,canonical_person_id,conflict_id,email_suppressed,sms_suppressed",
      { count: "exact" },
    ).eq("batch_id", String(batchId)).order("row_number").range(
      from,
      from + pageSize - 1,
    );
  if (error) throw error;
  return {
    resultRows: (data ?? []).map((row: Record<string, unknown>) => ({
      rowNumber: row.row_number,
      outcome: row.outcome,
      reasonCode: row.reason_code,
      personId: row.canonical_person_id,
      conflictId: row.conflict_id,
      emailSuppressed: row.email_suppressed,
      smsSuppressed: row.sms_suppressed,
    })),
    resultPage: { page, pageSize, total: count ?? 0 },
    reviewHref: `/people/review?batchId=${encodeURIComponent(String(batchId))}`,
  };
};
const countRows = (rows: Array<Record<string, unknown>>) => ({
  rowCount: rows.length,
  addedCount: rows.filter((r) => r.outcome === "added").length,
  updatedCount: rows.filter((r) => r.outcome === "updated").length,
  reviewCount: rows.filter((r) => r.outcome === "review").length,
  invalidCount: rows.filter((r) => r.outcome === "invalid").length,
  duplicateCount: rows.filter((r) => r.outcome === "duplicate").length,
  unchangedCount: rows.filter((r) => r.outcome === "unchanged").length,
  alreadySuppressedCount:
    rows.filter((r) => r.emailSuppressed || r.smsSuppressed).length,
});

export async function handler(req: Request): Promise<Response> {
  const requestId = crypto.randomUUID();
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: contactImportCorsHeaders });
  }
  if (req.method !== "POST") {
    return json(requestId, {
      code: "INVALID_REQUEST",
      message: "POST required.",
      retryable: false,
    }, 405);
  }
  try {
    const { userId, service } = await actor(req);
    const contentType = req.headers.get("content-type") ?? "";
    const headerAction = req.headers.get("x-mingla-import-action") ?? "";
    const headerBrandId = req.headers.get("x-mingla-brand-id") ?? "";
    let action = headerAction,
      body: Record<string, unknown> = {},
      form: FormData | null = null;
    if (contentType.includes("multipart/form-data")) {
      if (!action || !headerBrandId) {
        throw new ImportError(
          "INVALID_REQUEST",
          "Import request headers are missing.",
        );
      }
    } else {
      body = await req.json();
      action = action || String(body.action ?? "");
    }
    const brandId = headerBrandId || String(body.brandId ?? "");
    const newWork = ["inspect", "preview", "execute"].includes(action);
    await authorize(service, brandId, userId, newWork);
    if (contentType.includes("multipart/form-data")) {
      form = await authorizedMultipart(req);
    }
    if (action === "inspect" || action === "preview") {
      const file = form?.get("file");
      if (!(file instanceof File)) {
        throw new ImportError("INVALID_REQUEST", "Choose a CSV file.");
      }
      if (file.size > CONTACT_IMPORT_MAX_BYTES) {
        throw new ImportError(
          "FILE_TOO_LARGE",
          "Choose a CSV smaller than 10 MB.",
          413,
        );
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const parsed = parseCsvBytes(bytes, file.name);
      const digest = await sha256Hex(bytes);
      if (action === "inspect") {
        const inspectionToken = token(),
          tokenHash = await sha256Hex(inspectionToken),
          provider = detectProvider(parsed.headers);
        const { data, error } = await service.rpc(
          "issue_1775_store_inspection",
          {
            p_brand: brandId,
            p_actor: userId,
            p_digest: digest,
            p_name: file.name.split(/[\\/]/).pop(),
            p_size: bytes.length,
            p_rows: parsed.rows.length,
            p_headers: parsed.headers,
            p_provider: provider,
            p_dialect: parsed.dialect,
            p_token_hash: tokenHash,
          },
        );
        if (error) throw error;
        return json(requestId, {
          inspectionId: data,
          inspectionToken,
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
          file: {
            name: file.name,
            sizeBytes: bytes.length,
            sha256: digest,
            rowCount: parsed.rows.length,
            detectedProvider: provider,
            dialect: parsed.dialect,
            headers: parsed.headers,
          },
          samples: parsed.headers.map((header, i) => ({
            header,
            values: parsed.rows.slice(0, 3).map((r) => mask(r[i] ?? "")),
          })),
          suggestedMapping: suggestContactImportMapping(parsed.headers),
        });
      }
      const inspectionId = String(form?.get("inspectionId") ?? ""),
        inspectionToken = String(form?.get("inspectionToken") ?? "");
      if (form?.get("mappingVersion") !== CONTACT_IMPORT_MAPPING_VERSION) {
        throw new ImportError(
          "INVALID_MAPPING",
          "This column mapping is out of date.",
          409,
        );
      }
      const mapping = canonicalMapping(
        parseMapping(String(form?.get("normalizedMapping") ?? "{}")),
        parsed.headers,
      );
      const mappingJson = JSON.stringify(mapping),
        mappingDigest = await sha256Hex(mappingJson);
      const { data: brand } = await service.from("brands").select("name").eq(
        "id",
        brandId,
      ).maybeSingle();
      if (!brand) {
        throw new ImportError("BATCH_NOT_FOUND", "Import not found.", 404);
      }
      const idx = Object.fromEntries(parsed.headers.map((h, i) => [h, i]));
      const seen = new Map<string, number>();
      const rows = [] as Array<Record<string, unknown>>;
      for (let i = 0; i < parsed.rows.length; i += 1) {
        const cells = parsed.rows[i];
        const val = (target: ContactImportTarget) => {
          const h = Object.keys(mapping).find((x) => mapping[x] === target);
          return h ? String(cells[idx[h]] ?? "").trim() : "";
        };
        const name = val("full_name") ||
          [val("first_name"), val("last_name")].filter(Boolean).join(" ");
        const emailRaw = val("email").toLowerCase();
        const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)
          ? emailRaw
          : null;
        const phoneRaw = val("phone");
        const phone = resolveUserPhoneE164(phoneRaw, "");
        const keys = [email ? `e:${email}` : null, phone ? `p:${phone}` : null]
          .filter(Boolean) as string[];
        const bridge = keys.map((k) => seen.get(k)).filter((x): x is number =>
          x !== undefined
        );
        let outcome: string = "added", reasonCode: string | null = null;
        if (!email && !phone) {
          outcome = "invalid";
          reasonCode = phoneRaw ? "phone_country_required" : "no_contact";
        } else if (new Set(bridge).size > 1) {
          outcome = "review";
          reasonCode = "ambiguous_identity";
        } else if (bridge.length) {
          outcome = "duplicate";
          reasonCode = "within_file_duplicate";
        } else keys.forEach((k) => seen.set(k, i + 2));
        rows.push({
          rowNumber: i + 2,
          rowFingerprint: await sha256Hex(
            JSON.stringify([name, email, phone, i + 2]),
          ),
          duplicateKey: keys[0] ?? null,
          name,
          email,
          phoneE164: phone,
          phoneCountry: null,
          outcome,
          reasonCode,
          emailSuppressed: false,
          smsSuppressed: false,
        });
      }
      if (
        !rows.some((row) =>
          ["added", "updated", "unchanged"].includes(String(row.outcome))
        )
      ) {
        throw new ImportError(
          "NO_IMPORTABLE_ROWS",
          "No contacts can be imported.",
          422,
        );
      }
      const previewToken = token(),
        previewHash = await sha256Hex(previewToken),
        attestation = renderContactImportAttestation(brand.name);
      const { data: counts, error } = await service.rpc(
        "issue_1775_store_preview",
        {
          p_batch: inspectionId,
          p_brand: brandId,
          p_actor: userId,
          p_inspection_hash: await sha256Hex(inspectionToken),
          p_digest: digest,
          p_mapping_version: CONTACT_IMPORT_MAPPING_VERSION,
          p_mapping: mapping,
          p_mapping_digest: mappingDigest,
          p_preview_hash: previewHash,
          p_attestation_version: CONTACT_IMPORT_ATTESTATION_VERSION,
          p_attestation: attestation,
          p_brand_name: brand.name,
          p_rows: rows,
        },
      );
      if (error) {
        if (/inspection_stale_or_tampered/.test(String(error.message ?? ""))) {
          await service.rpc("issue_1775_expire_import", {
            p_batch: inspectionId,
            p_brand: brandId,
            p_actor: userId,
            p_token_hash: await sha256Hex(inspectionToken),
            p_expected_state: "inspected",
          });
        }
        throw error;
      }
      const { data: storedRows, error: storedRowsError } = await service.from(
        "brand_contact_import_rows",
      ).select(
        "row_number,name,outcome,reason_code,email_suppressed,sms_suppressed",
      ).eq("batch_id", inspectionId).order("row_number");
      if (storedRowsError) throw storedRowsError;
      return json(requestId, {
        batchId: inspectionId,
        previewToken,
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        file: {
          name: file.name,
          sizeBytes: bytes.length,
          sha256: digest,
          rowCount: parsed.rows.length,
          detectedProvider: detectProvider(parsed.headers),
          dialect: parsed.dialect,
          headers: parsed.headers,
        },
        mapping,
        attestation: {
          version: CONTACT_IMPORT_ATTESTATION_VERSION,
          text: attestation,
          brandName: brand.name,
        },
        counts: counts ?? countRows(rows),
        rows: (storedRows ?? []).map((r: Record<string, unknown>) => ({
          rowNumber: r.row_number,
          outcome: r.outcome,
          reasonCode: r.reason_code,
          emailSuppressed: r.email_suppressed,
          smsSuppressed: r.sms_suppressed,
          maskedName: r.name,
        })),
      });
    }
    if (action === "execute") {
      if (body.accepted !== true) {
        throw new ImportError(
          "INVALID_REQUEST",
          "Confirm permission before importing.",
        );
      }
      const { data: brand } = await service.from("brands").select("name").eq(
        "id",
        brandId,
      ).maybeSingle();
      if (!brand) {
        throw new ImportError("BATCH_NOT_FOUND", "Import not found.", 404);
      }
      const expected = renderContactImportAttestation(brand.name);
      if (
        body.mappingVersion !== CONTACT_IMPORT_MAPPING_VERSION ||
        body.attestationText !== expected ||
        body.attestationVersion !== CONTACT_IMPORT_ATTESTATION_VERSION
      ) {
        throw new ImportError(
          "PREVIEW_STALE_OR_TAMPERED",
          "This preview is out of date.",
          409,
        );
      }
      const requestHash = await sha256Hex(JSON.stringify({
        brandId,
        batchId: body.batchId,
        fileSha256: body.fileSha256,
        normalizedMapping: body.normalizedMapping,
        mappingVersion: body.mappingVersion,
        attestationVersion: body.attestationVersion,
        attestationText: body.attestationText,
      }));
      const mappingDigest = await sha256Hex(
        JSON.stringify(body.normalizedMapping),
      );
      const { data, error } = await service.rpc("issue_1775_execute_import", {
        p_batch: body.batchId,
        p_brand: brandId,
        p_actor: userId,
        p_preview_hash: await sha256Hex(String(body.previewToken ?? "")),
        p_digest: body.fileSha256,
        p_mapping_digest: mappingDigest,
        p_attestation_version: body.attestationVersion,
        p_attestation: body.attestationText,
        p_idempotency: body.idempotencyKey,
        p_request_hash: requestHash,
      });
      if (error) {
        const raw = String(error.message ?? "");
        if (/preview_stale_or_tampered/.test(raw)) {
          await service.rpc("issue_1775_expire_import", {
            p_batch: body.batchId,
            p_brand: brandId,
            p_actor: userId,
            p_token_hash: await sha256Hex(String(body.previewToken ?? "")),
            p_expected_state: "previewed",
          });
        }
        if (!/(stale|tampered|idempotency|not_found|forbidden)/i.test(raw)) {
          await service.rpc("issue_1775_mark_failed", {
            p_batch: body.batchId,
            p_brand: brandId,
            p_actor: userId,
            p_idempotency: body.idempotencyKey,
            p_request_hash: requestHash,
            p_failure_code: "EXECUTION_FAILED",
          });
        }
        throw error;
      }
      return json(requestId, {
        batchId: body.batchId,
        ...data,
        ...await resultRows(service, body.batchId),
      });
    }
    if (action === "status") {
      const { data, error } = await service.from("brand_contact_import_batches")
        .select(
          "id,state,row_count,added_count,updated_count,review_count,invalid_count,duplicate_count,unchanged_count,already_suppressed_count,failure_code",
        ).eq("id", body.batchId).eq("brand_id", brandId).eq(
          "actor_user_id",
          userId,
        ).maybeSingle();
      if (error || !data) {
        throw new ImportError("BATCH_NOT_FOUND", "Import not found.", 404);
      }
      return json(requestId, {
        batchId: data.id,
        state: data.state,
        counts: {
          rowCount: data.row_count,
          addedCount: data.added_count,
          updatedCount: data.updated_count,
          reviewCount: data.review_count,
          invalidCount: data.invalid_count,
          duplicateCount: data.duplicate_count,
          unchangedCount: data.unchanged_count,
          alreadySuppressedCount: data.already_suppressed_count,
        },
        failureCode: data.failure_code,
        ...await resultRows(service, body.batchId, body.page, body.pageSize),
      });
    }
    if (action === "cancel") {
      const { data, error } = await service.rpc("issue_1775_cancel_import", {
        p_batch: body.batchId,
        p_brand: brandId,
        p_actor: userId,
      });
      if (error) throw error;
      return json(requestId, { batchId: body.batchId, state: data });
    }
    throw new ImportError("INVALID_REQUEST", "Unknown import action.");
  } catch (error) {
    const known = error instanceof ImportError ? error : null;
    const rawMessage = error instanceof Error
      ? error.message
      : typeof (error as { message?: unknown })?.message === "string"
      ? String((error as { message: string }).message)
      : "";
    const sqlPublic = [
      [
        "idempotency_conflict",
        "IDEMPOTENCY_CONFLICT",
        409,
        "This import request conflicts with an earlier attempt.",
      ],
      [
        "cannot_cancel_execution",
        "CANNOT_CANCEL_EXECUTION",
        409,
        "This import can no longer be cancelled.",
      ],
      ["contact_import_not_found", "BATCH_NOT_FOUND", 404, "Import not found."],
    ] as const;
    const mapped = sqlPublic.find(([sqlCode]) => rawMessage.includes(sqlCode));
    const message = known?.message ?? mapped?.[3] ??
      (/inspection_stale/.test(rawMessage)
        ? "This inspection is out of date."
        : /preview_stale/.test(rawMessage)
        ? "This preview is out of date."
        : "We couldn't finish the import.");
    const code = known?.code ?? mapped?.[1] ??
      (/inspection_stale/.test(rawMessage)
        ? "INSPECTION_STALE_OR_TAMPERED"
        : /preview_stale/.test(rawMessage)
        ? "PREVIEW_STALE_OR_TAMPERED"
        : "IMPORT_FAILED");
    return json(requestId, {
      code,
      message,
      retryable: known?.retryable ?? false,
    }, known?.status ?? mapped?.[2] ?? (code.includes("STALE") ? 409 : 500));
  }
}

if (import.meta.main) serve(handler);
