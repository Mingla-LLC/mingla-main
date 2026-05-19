/**
 * ORCH-0880 [Tr5 Traveler Intake Forms] — per-tier intake schema service layer.
 *
 * Per SPEC_ORCH-0880 §6 + §15.5. Per-tier API mirroring ORCH-0875
 * refundPolicyService 5-pattern error discrimination + ORCH-0876 V2 published-
 * edit RPC routing.
 *
 * Reads: anon + planner SELECT from `trip_intake_schemas` table directly per
 * the §4.1.E RLS policies (`trip_intake_schemas_anon_select` for buyer-fill
 * page, `trip_intake_schemas_planner_all` for schema-builder + EditPublished).
 *
 * Writes:
 *   - DRAFT trips (`events.status NOT IN ('scheduled','live')`): direct
 *     supabase upsert against `trip_intake_schemas` (the planner is iterating
 *     during wizard composition; no audit trail needed pre-publish; RLS
 *     policy `trip_intake_schemas_planner_all` gates ownership).
 *   - PUBLISHED trips (`events.status IN ('scheduled','live')`): route through
 *     `biz_update_live_trip` RPC `intake_schemas` patch key per SPEC §15.3.
 *     RPC handles validation + audit + ChangeSummaryModal + re-answer
 *     notification trigger. Reason text required (10-200 chars).
 *
 * Per I-PROPOSED-I (MUTATION-ROWCOUNT-VERIFIED): every direct `.update()` /
 * `.upsert()` chains `.select("id").maybeSingle()` and throws `not_found` on
 * null. Per I-PROPOSED-TR2-EVENTS-TYPE-FILTER: every `.from("events")` query
 * scoped to `event_type='trip'`. Per I-PROPOSED-TR5-INTAKE-SCHEMA-EDIT-
 * PERSISTS-TO-DB: published-trip schema edits ONLY go through the RPC, never
 * Zustand-only.
 *
 * File upload: `uploadIntakeFile` mints a signed URL via the new
 * `trip-intake-upload-signed-url` edge function (Phase 2 — currently throws
 * `feature_not_yet_implemented` until that edge function ships).
 */

import { supabase } from "./supabase";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type IntakeQuestionType =
  | "short_text"
  | "long_text"
  | "single_choice"
  | "multi_choice"
  | "date"
  | "number"
  | "file_upload";

export interface IntakeQuestion {
  /** UUID, unique within schema. */
  id: string;
  type: IntakeQuestionType;
  /** Question label shown to buyer, 1-200 chars. */
  label: string;
  required: boolean;
  /** Display order, 0-based, unique within schema. */
  position: number;
  /** Optional planner-side description / helper hint shown above the input. */
  helper?: string;
  /** Optional placeholder shown inside the input. */
  placeholder?: string;
  /** single_choice / multi_choice: 2-10 options. */
  options?: string[];
  /** file_upload: max files per question, 1-5; default 1. */
  max_files?: number;
  /** file_upload: allowed MIME-type categories. */
  allow_images?: boolean;
  allow_pdfs?: boolean;
  allow_docs?: boolean;
  /** number: optional limits. */
  min?: number;
  max?: number;
  /** number: integer-only flag. */
  integer_only?: boolean;
}

export interface IntakeSchema {
  /** UUID — bumped on every save; orders snapshot this for staleness check. */
  schema_version_id: string;
  /** 0-20 questions, ordered by position ascending. */
  questions: IntakeQuestion[];
}

/**
 * Per-tier intake answer container persisted at `orders.intake_form_data`.
 * Shape per SPEC §15.2.
 */
export interface IntakeFormData {
  ticket_type_id: string;
  schema_version_id: string;
  answers: Record<string, IntakeAnswerValue>;
}

export type IntakeAnswerValue =
  | string // short_text, long_text, date (ISO 8601 yyyy-mm-dd), single_choice (option value), number (stringified)
  | string[] // multi_choice
  | IntakeFileAnswer[] // file_upload
  | null;

export interface IntakeFileAnswer {
  path: string; // trip_intake_files/{event_id}/{order_id}/{question_id}/{filename}
  filename: string;
  mime_type: string;
  size_bytes: number;
}

// ---------------------------------------------------------------------------
// Error contract
// ---------------------------------------------------------------------------

export type IntakeSchemaErrorCode =
  | "schema_invalid"
  | "schema_duplicate_question_id"
  | "schema_duplicate_position"
  | "schema_question_count_invalid"
  | "schema_label_invalid"
  | "schema_choice_options_invalid"
  | "schema_file_upload_max_files_invalid"
  | "schema_type_invalid"
  | "unauthorized"
  | "not_found"
  | "trip_not_editable_status"
  | "edit_reason_required"
  | "edit_reason_invalid_length"
  | "ticket_type_unknown"
  | "rpc_rejected"
  | "network_error"
  | "feature_not_yet_implemented"
  | "internal_error";

export interface IntakeSchemaServiceError extends Error {
  code: IntakeSchemaErrorCode;
  /** Lower-level technical detail for logs; not user-facing. */
  detail?: string;
  /** When `code === 'rpc_rejected'`, the RPC's reason string. */
  rpc_reason?: string;
}

const makeError = (
  code: IntakeSchemaErrorCode,
  message: string,
  detail?: string,
  rpc_reason?: string,
): IntakeSchemaServiceError => {
  const err = new Error(message) as IntakeSchemaServiceError;
  err.code = code;
  if (detail !== undefined) err.detail = detail;
  if (rpc_reason !== undefined) err.rpc_reason = rpc_reason;
  return err;
};

/**
 * Map PostgREST / Postgres errors raised by validate_trip_intake_schema CHECK
 * constraint to a typed IntakeSchemaServiceError. The validator RAISEs with
 * `I-PROPOSED-TR5-INTAKE-SCHEMA-VALID-AT-WRITE:` prefix per migration §2.
 */
function mapPgError(error: unknown): IntakeSchemaServiceError {
  const message =
    error instanceof Error ? error.message : String(error ?? "unknown_error");
  const lower = message.toLowerCase();

  if (lower.includes("i-proposed-tr5-intake-schema-valid-at-write")) {
    if (lower.includes("duplicate question id")) {
      return makeError("schema_duplicate_question_id", "Each question must have a unique ID.", message);
    }
    if (lower.includes("duplicate question position")) {
      return makeError("schema_duplicate_position", "Each question position must be unique.", message);
    }
    if (lower.includes("max 20 questions")) {
      return makeError("schema_question_count_invalid", "Maximum 20 questions per intake form.", message);
    }
    if (lower.includes("question label must be 1-200 chars")) {
      return makeError("schema_label_invalid", "Question label must be 1-200 characters.", message);
    }
    if (lower.includes("choice questions must have 2-10 options")) {
      return makeError("schema_choice_options_invalid", "Choice questions must have 2-10 options.", message);
    }
    if (lower.includes("file_upload max_files must be 1-5")) {
      return makeError("schema_file_upload_max_files_invalid", "File-upload questions allow 1-5 files max.", message);
    }
    if (lower.includes("question type must be one of")) {
      return makeError("schema_type_invalid", "Unsupported question type.", message);
    }
    return makeError("schema_invalid", "Intake form schema is invalid.", message);
  }
  if (lower.includes("permission") || lower.includes("rls") || lower.includes("not_authorized")) {
    return makeError("unauthorized", "You don't have permission to update this trip's intake form.", message);
  }
  if (lower.includes("not found")) {
    return makeError("not_found", "Trip or tier not found.", message);
  }
  return makeError("internal_error", "Couldn't save intake form. Try again.", message);
}

function mapRpcResponse(
  ok: boolean,
  reason: string | undefined,
  detail?: unknown,
): IntakeSchemaServiceError | null {
  if (ok) return null;
  switch (reason) {
    case "missing_edit_reason":
      return makeError("edit_reason_required", "Reason for change is required (10-200 characters).");
    case "invalid_edit_reason":
      return makeError("edit_reason_invalid_length", "Reason must be 10-200 characters.");
    case "trip_not_found":
      return makeError("not_found", "Trip not found.");
    case "trip_not_editable_status":
      return makeError("trip_not_editable_status", "This trip's status doesn't allow edits.");
    case "intake_schema_unknown_ticket_type":
      return makeError("ticket_type_unknown", "That tier doesn't exist on this trip.");
    case "intake_schema_missing_ticket_type_id":
      return makeError(
        "ticket_type_unknown",
        "Tier ID missing from intake form payload.",
      );
    case "invalid_intake_schema":
    case "invalid_intake_schemas_payload":
      return makeError("schema_invalid", "Intake form schema failed validation.", undefined, reason);
    default:
      return makeError(
        "rpc_rejected",
        "Couldn't save intake form. Trip is being edited elsewhere or the patch was rejected.",
        typeof detail === "string" ? detail : undefined,
        reason,
      );
  }
}

// ---------------------------------------------------------------------------
// Read API
// ---------------------------------------------------------------------------

/**
 * Fetch all intake schemas for a trip, keyed by ticket_type_id.
 * Used by planner schema-builder (wizard Step 6 + EditPublishedTripScreen
 * accordion) and Travelers tab.
 */
export async function getTripIntakeSchemasByEvent(
  eventId: string,
): Promise<Map<string, IntakeSchema>> {
  if (!eventId) throw makeError("not_found", "Trip not found.");

  const { data, error } = await supabase
    .from("trip_intake_schemas")
    .select("ticket_type_id, schema, schema_version_id")
    .eq("event_id", eventId);

  if (error) throw mapPgError(error);

  const map = new Map<string, IntakeSchema>();
  for (const row of data ?? []) {
    const schema = row.schema as IntakeSchema | null;
    if (schema !== null) {
      // Ensure schema_version_id from row wins over any value embedded in
      // schema jsonb (DB column is authoritative).
      map.set(row.ticket_type_id as string, {
        ...schema,
        schema_version_id: row.schema_version_id as string,
      });
    }
  }
  return map;
}

/**
 * Fetch a single tier's intake schema. Used by buyer-fill page when buyer is
 * purchasing a single tier (avoids fetching all tiers' schemas).
 */
export async function getTripIntakeSchemaByTier(
  eventId: string,
  ticketTypeId: string,
): Promise<IntakeSchema | null> {
  if (!eventId || !ticketTypeId) {
    throw makeError("not_found", "Trip or tier not found.");
  }

  const { data, error } = await supabase
    .from("trip_intake_schemas")
    .select("schema, schema_version_id")
    .eq("event_id", eventId)
    .eq("ticket_type_id", ticketTypeId)
    .maybeSingle();

  if (error) throw mapPgError(error);
  if (data === null) return null;

  const schema = data.schema as IntakeSchema | null;
  if (schema === null) return null;
  return {
    ...schema,
    schema_version_id: data.schema_version_id as string,
  };
}

// ---------------------------------------------------------------------------
// Write API
// ---------------------------------------------------------------------------

/**
 * Upsert OR clear (when schema=null) a tier's intake form schema.
 *
 * Behavior depends on trip status:
 *   - DRAFT (scheduled IS NULL OR status='draft'): direct supabase upsert per
 *     RLS policy `trip_intake_schemas_planner_all`. No reason text needed.
 *   - PUBLISHED ('scheduled' OR 'live'): MUST route through `biz_update_live_trip`
 *     RPC with `intake_schemas` patch key. Reason text required (10-200 chars)
 *     for the ChangeSummaryModal + re-answer notification flow.
 *
 * Per I-PROPOSED-TR5-INTAKE-SCHEMA-EDIT-PERSISTS-TO-DB.
 */
export async function upsertTripIntakeSchema(args: {
  eventId: string;
  ticketTypeId: string;
  schema: IntakeSchema | null;
  /** Required when trip is published; ignored on draft. */
  reason?: string;
  /** Caller's hint to skip the status probe; only set true when caller already
   * knows the trip is in draft state. */
  skipStatusProbe?: boolean;
}): Promise<void> {
  const { eventId, ticketTypeId, schema, reason, skipStatusProbe } = args;
  if (!eventId || !ticketTypeId) {
    throw makeError("not_found", "Trip or tier not found.");
  }

  // Light client-side validation before round-trip (DB CHECK is authoritative).
  if (schema !== null) {
    const validationError = validateIntakeSchemaClient(schema);
    if (validationError !== null) throw validationError;
  }

  // Status probe: decide direct-write vs RPC route.
  let isPublished = false;
  if (!skipStatusProbe) {
    const { data: statusRow, error: statusErr } = await supabase
      .from("events")
      .select("status")
      .eq("id", eventId)
      .eq("event_type", "trip")
      .maybeSingle();

    if (statusErr) throw mapPgError(statusErr);
    if (statusRow === null) {
      throw makeError("not_found", "Trip not found.");
    }
    isPublished = statusRow.status === "scheduled" || statusRow.status === "live";
  }

  if (isPublished) {
    // Route through biz_update_live_trip RPC per SPEC §15.3.
    const trimmedReason = (reason ?? "").trim();
    if (trimmedReason.length < 10 || trimmedReason.length > 200) {
      throw makeError(
        "edit_reason_invalid_length",
        "Reason for change must be 10-200 characters.",
      );
    }

    const { data: rpcResult, error: rpcErr } = await supabase.rpc(
      "biz_update_live_trip",
      {
        p_event_id: eventId,
        p_patch: {
          intake_schemas: [
            { ticket_type_id: ticketTypeId, schema },
          ],
        },
        p_reason: trimmedReason,
      },
    );

    if (rpcErr) throw mapPgError(rpcErr);

    const ok = (rpcResult as { ok?: boolean } | null)?.ok === true;
    const rpcReason = (rpcResult as { reason?: string } | null)?.reason;
    const rpcError = mapRpcResponse(ok, rpcReason, rpcResult);
    if (rpcError !== null) throw rpcError;
    return;
  }

  // Draft path: direct upsert per RLS policy.
  // I-PROPOSED-I MUTATION-ROWCOUNT-VERIFIED: chain .select("id").maybeSingle()
  // — but use .upsert() return rows directly since onConflict requires no
  // separate .select.
  if (schema === null) {
    // Clear the tier's schema = DELETE the row.
    const { data, error } = await supabase
      .from("trip_intake_schemas")
      .delete()
      .eq("event_id", eventId)
      .eq("ticket_type_id", ticketTypeId)
      .select("id")
      .maybeSingle();

    if (error) throw mapPgError(error);
    // Delete with no row is fine (idempotent — already cleared). Don't throw
    // not_found here; that would noisy the planner if they delete twice.
    void data;
    return;
  }

  // Upsert with schema_version_id from the schema payload (planner mints new
  // UUIDs client-side on every "Save question" tap for cache-busting).
  const { data, error } = await supabase
    .from("trip_intake_schemas")
    .upsert(
      {
        event_id: eventId,
        ticket_type_id: ticketTypeId,
        schema,
        schema_version_id: schema.schema_version_id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "event_id,ticket_type_id" },
    )
    .select("id")
    .maybeSingle();

  if (error) throw mapPgError(error);
  if (data === null) {
    throw makeError(
      "unauthorized",
      "Couldn't save intake form — permission denied.",
    );
  }
}

// ---------------------------------------------------------------------------
// Client-side validation (mirrors validate_trip_intake_schema DB function)
// ---------------------------------------------------------------------------

export function validateIntakeSchemaClient(
  schema: IntakeSchema,
): IntakeSchemaServiceError | null {
  if (
    typeof schema !== "object" ||
    schema === null ||
    typeof schema.schema_version_id !== "string" ||
    schema.schema_version_id.length !== 36 ||
    !Array.isArray(schema.questions)
  ) {
    return makeError("schema_invalid", "Intake form schema is invalid.");
  }
  if (schema.questions.length > 20) {
    return makeError(
      "schema_question_count_invalid",
      "Maximum 20 questions per intake form.",
    );
  }

  const seenIds = new Set<string>();
  const seenPositions = new Set<number>();
  for (const q of schema.questions) {
    if (typeof q.id !== "string" || q.id.length !== 36) {
      return makeError("schema_invalid", "Each question must have a valid ID.");
    }
    if (seenIds.has(q.id)) {
      return makeError("schema_duplicate_question_id", "Each question must have a unique ID.");
    }
    seenIds.add(q.id);

    if (!Number.isInteger(q.position) || q.position < 0) {
      return makeError("schema_invalid", "Question position must be a non-negative integer.");
    }
    if (seenPositions.has(q.position)) {
      return makeError("schema_duplicate_position", "Each question position must be unique.");
    }
    seenPositions.add(q.position);

    if (
      ![
        "short_text",
        "long_text",
        "single_choice",
        "multi_choice",
        "date",
        "number",
        "file_upload",
      ].includes(q.type)
    ) {
      return makeError("schema_type_invalid", "Unsupported question type.");
    }
    if (
      typeof q.label !== "string" ||
      q.label.length === 0 ||
      q.label.length > 200
    ) {
      return makeError("schema_label_invalid", "Question label must be 1-200 characters.");
    }
    if (typeof q.required !== "boolean") {
      return makeError("schema_invalid", "Question 'required' flag must be true or false.");
    }

    if (q.type === "single_choice" || q.type === "multi_choice") {
      if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 10) {
        return makeError("schema_choice_options_invalid", "Choice questions must have 2-10 options.");
      }
    }
    if (q.type === "file_upload") {
      if (
        q.max_files !== undefined &&
        (!Number.isInteger(q.max_files) || q.max_files < 1 || q.max_files > 5)
      ) {
        return makeError(
          "schema_file_upload_max_files_invalid",
          "File-upload questions allow 1-5 files max.",
        );
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Answer validation
// ---------------------------------------------------------------------------

/**
 * Returns true if a buyer's answer for a question is considered empty (missing
 * data for a required-question gate). Mirror in supabase/functions/ticket-
 * checkout-create/index.ts when wiring the 400 gate (Phase 2).
 */
export function isAnswerEmpty(
  type: IntakeQuestionType,
  answer: IntakeAnswerValue | undefined,
): boolean {
  if (answer === undefined || answer === null) return true;
  switch (type) {
    case "short_text":
    case "long_text":
    case "single_choice":
    case "date":
      return typeof answer !== "string" || answer.trim().length === 0;
    case "number":
      // Stored as stringified to preserve user input fidelity; empty = empty.
      return typeof answer !== "string" || answer.trim().length === 0;
    case "multi_choice":
      return !Array.isArray(answer) || answer.length === 0;
    case "file_upload":
      return !Array.isArray(answer) || answer.length === 0;
    default: {
      // Exhaustive check
      const _never: never = type;
      void _never;
      return true;
    }
  }
}

/**
 * Validate a complete IntakeFormData.answers object against a schema. Returns
 * a per-question error map (empty when valid). Called by IntakeFormRenderer
 * on Continue tap (buyer-fill) and used by orchestrator-level pre-flight check.
 */
export function validateAnswerAgainstSchema(
  schema: IntakeSchema,
  answers: Record<string, IntakeAnswerValue>,
): Array<{ question_id: string; error: string }> {
  const errors: Array<{ question_id: string; error: string }> = [];
  for (const q of schema.questions) {
    const answer = answers[q.id];
    if (q.required && isAnswerEmpty(q.type, answer)) {
      errors.push({ question_id: q.id, error: "This question is required." });
      continue;
    }
    if (answer === undefined || answer === null) continue;
    // Type-specific shape checks
    if (q.type === "number") {
      if (typeof answer !== "string") {
        errors.push({ question_id: q.id, error: "Enter a number." });
        continue;
      }
      const parsed = q.integer_only ? parseInt(answer, 10) : parseFloat(answer);
      if (Number.isNaN(parsed)) {
        errors.push({ question_id: q.id, error: "Enter a valid number." });
        continue;
      }
      if (q.min !== undefined && parsed < q.min) {
        errors.push({ question_id: q.id, error: `Must be at least ${q.min}.` });
        continue;
      }
      if (q.max !== undefined && parsed > q.max) {
        errors.push({ question_id: q.id, error: `Must be at most ${q.max}.` });
        continue;
      }
    }
    if (q.type === "single_choice" && typeof answer === "string") {
      if (!q.options?.includes(answer)) {
        errors.push({ question_id: q.id, error: "Pick one of the listed options." });
      }
    }
    if (q.type === "multi_choice" && Array.isArray(answer)) {
      const allowed = new Set(q.options ?? []);
      for (const v of answer) {
        if (typeof v !== "string" || !allowed.has(v)) {
          errors.push({ question_id: q.id, error: "One or more selections aren't in the options list." });
          break;
        }
      }
    }
    if (q.type === "file_upload" && Array.isArray(answer)) {
      const max = q.max_files ?? 1;
      if (answer.length > max) {
        errors.push({ question_id: q.id, error: `Maximum ${max} file${max === 1 ? "" : "s"} per question.` });
      }
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// File upload (Phase 2 — placeholder for now)
// ---------------------------------------------------------------------------

export interface UploadIntakeFileArgs {
  eventId: string;
  orderId: string;
  questionId: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  /** Raw file body (RN: from expo-image-picker / expo-document-picker; Web: File / Blob). */
  body: Blob | ArrayBuffer | Uint8Array;
}

/**
 * Upload a buyer-provided file to the `trip_intake_files` storage bucket via
 * the `trip-intake-upload-signed-url` edge function (anon-tolerant; deployed
 * Phase 2). Two-step:
 *   1. Invoke edge fn → returns `{ signed_url, file_path, expires_at }`.
 *   2. PUT raw body to the signed URL.
 *
 * Then returns the `IntakeFileAnswer` payload to embed in the question's
 * answers array.
 *
 * Edge fn errors surface as `IntakeSchemaServiceError`:
 *   - `feature_not_yet_implemented` → if the edge fn unexpectedly 404s
 *     (deploy gap; shouldn't happen on live)
 *   - `unauthorized` → RLS rejection at the storage layer
 *   - `schema_invalid` → MIME not in question allowlist OR file >10MB
 *   - `not_found` → trip/schema/question lookup failed
 *   - `network_error` → fetch threw (offline; signed URL expired)
 *   - `internal_error` → fallback
 */
export async function uploadIntakeFile(
  args: UploadIntakeFileArgs,
): Promise<IntakeFileAnswer> {
  if (!args.eventId || !args.orderId || !args.questionId) {
    throw makeError("not_found", "Trip, order, or question not found.");
  }
  if (!args.filename || args.filename.length === 0) {
    throw makeError("schema_invalid", "Filename is required.");
  }
  if (args.size_bytes > 10 * 1024 * 1024) {
    throw makeError(
      "schema_invalid",
      "File is too large. Each file must be 10 MB or less.",
    );
  }

  // Step 1 — mint signed upload URL via anon-tolerant edge fn.
  let signResponse: {
    signed_url?: string;
    file_path?: string;
    expires_at?: string;
    error?: string;
    detail?: string;
  };
  try {
    const { data, error } = await supabase.functions.invoke(
      "trip-intake-upload-signed-url",
      {
        body: {
          event_id: args.eventId,
          order_id: args.orderId,
          question_id: args.questionId,
          filename: args.filename,
          mime_type: args.mime_type,
          size_bytes: args.size_bytes,
        },
      },
    );
    if (error !== null) {
      throw makeError(
        "network_error",
        "Couldn't reach the upload service. Check your connection and try again.",
        error.message,
      );
    }
    signResponse = data as typeof signResponse;
  } catch (e) {
    if (e instanceof Error && (e as IntakeSchemaServiceError).code !== undefined) {
      throw e;
    }
    throw makeError(
      "network_error",
      "Couldn't reach the upload service. Check your connection and try again.",
      e instanceof Error ? e.message : String(e),
    );
  }

  if (signResponse.error !== undefined) {
    // Edge fn returned an error envelope; map known codes to typed errors.
    const code = signResponse.error;
    const detail = signResponse.detail;
    if (code === "trip_not_found" || code === "schema_not_found" || code === "question_not_found") {
      throw makeError("not_found", "Trip, schema, or question not found.", detail);
    }
    if (code === "mime_not_allowed" || code === "file_too_large" || code === "filename_invalid") {
      throw makeError("schema_invalid", "File type or size is not allowed.", `${code}: ${detail ?? ""}`);
    }
    if (code === "unauthorized") {
      throw makeError("unauthorized", "You don't have permission to upload to this trip.", detail);
    }
    throw makeError("internal_error", "Couldn't get an upload URL. Try again.", `${code}: ${detail ?? ""}`);
  }

  const signedUrl = signResponse.signed_url;
  const filePath = signResponse.file_path;
  if (typeof signedUrl !== "string" || typeof filePath !== "string") {
    throw makeError(
      "internal_error",
      "Couldn't get an upload URL. Try again.",
      "signed_url or file_path missing from response",
    );
  }

  // Step 2 — PUT the raw body to the signed URL.
  let uploadBody: BodyInit;
  if (args.body instanceof Blob) {
    uploadBody = args.body;
  } else if (args.body instanceof ArrayBuffer) {
    uploadBody = args.body;
  } else {
    // Uint8Array — wrap in Blob via the underlying ArrayBuffer slice.
    // (Blob() expects BlobPart[]; Uint8Array.buffer is ArrayBufferLike which
    // the DOM lib types as not assignable in some TS configs.)
    const bytes = args.body;
    const ab = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    uploadBody = new Blob([ab], { type: args.mime_type });
  }

  try {
    const res = await fetch(signedUrl, {
      method: "PUT",
      headers: {
        "Content-Type": args.mime_type,
      },
      body: uploadBody,
    });
    if (!res.ok) {
      throw makeError(
        "internal_error",
        "Couldn't upload your file. Please try again.",
        `HTTP ${res.status} ${res.statusText}`,
      );
    }
  } catch (e) {
    if (e instanceof Error && (e as IntakeSchemaServiceError).code !== undefined) {
      throw e;
    }
    throw makeError(
      "network_error",
      "Couldn't upload your file. Check your connection and try again.",
      e instanceof Error ? e.message : String(e),
    );
  }

  return {
    path: filePath,
    filename: args.filename,
    mime_type: args.mime_type,
    size_bytes: args.size_bytes,
  };
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Create a new empty intake schema with a fresh schema_version_id. Used by the
 * schema-builder when planner first adds an intake form to a tier.
 */
export function createEmptyIntakeSchema(): IntakeSchema {
  return {
    schema_version_id: cryptoRandomUuidV4(),
    questions: [],
  };
}

/**
 * Bump schema_version_id — call after every mutation that changes question
 * shape so orders snapshot the new version + the re-answer trigger fires.
 */
export function bumpSchemaVersion(schema: IntakeSchema): IntakeSchema {
  return {
    ...schema,
    schema_version_id: cryptoRandomUuidV4(),
  };
}

/**
 * Create a new blank question of the given type. Position is auto-assigned by
 * caller (next available integer).
 */
export function createBlankQuestion(
  type: IntakeQuestionType,
  position: number,
): IntakeQuestion {
  const base: IntakeQuestion = {
    id: cryptoRandomUuidV4(),
    type,
    label: "",
    required: false,
    position,
  };
  if (type === "single_choice" || type === "multi_choice") {
    return { ...base, options: ["", ""] };
  }
  if (type === "file_upload") {
    return {
      ...base,
      max_files: 1,
      allow_images: true,
      allow_pdfs: true,
      allow_docs: true,
    };
  }
  return base;
}

/**
 * Generate a v4 UUID. RN doesn't have `crypto.randomUUID()` everywhere; this
 * fallback uses `Math.random` only when crypto is unavailable. Adequate for
 * client-side IDs that get DB-validated.
 */
function cryptoRandomUuidV4(): string {
  // Prefer native crypto.randomUUID when available (RN 0.81+ / modern Web)
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) {
    return g.crypto.randomUUID();
  }
  // Fallback: RFC4122 v4 from Math.random (sufficient for client-mint IDs;
  // DB checks length only and trusts client-uniqueness within a small schema)
  const rand = (n: number): string =>
    Math.floor(Math.random() * (1 << n))
      .toString(16)
      .padStart(Math.ceil(n / 4), "0");
  return `${rand(16)}${rand(16)}-${rand(16)}-4${rand(12)}-${["8", "9", "a", "b"][Math.floor(Math.random() * 4)]}${rand(12)}-${rand(16)}${rand(16)}${rand(16)}`;
}
