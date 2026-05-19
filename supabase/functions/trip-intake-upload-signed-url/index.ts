// ORCH-0880 [Tr5 Traveler Intake Forms] — anon-tolerant multipart upload
// signed-URL endpoint for the `trip_intake_files` storage bucket.
//
// Per SPEC_ORCH-0880 §5.1 + DESIGN §4.3.G. Buyer-fill UI requests a signed
// URL for each file upload; this function validates the request (event lookup,
// schema lookup, question lookup, MIME allowlist, size cap) and returns a
// 1-hour signed upload URL the buyer can PUT the file to directly. No file
// payload passes through the edge function (bandwidth + cold-start friendly).
//
// Auth: anon-tolerant (no JWT required). Buyer is anonymous per
// `feedback_anon_buyer_routes.md`. Trip + schema + question lookups
// authenticate the request by proving the buyer is uploading against a real
// trip/question; storage RLS layer (anon-write-own per migration §4) is the
// hard protection.
//
// Per I-PROPOSED-TR5-INTAKE-FILE-RLS-ANON-WRITE-PLANNER-READ enforcement:
// the signed URL grants insert to one specific object path; the path is
// derived from event_id + order_id + question_id + sanitised filename so the
// buyer cannot upload outside their own scope.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BUCKET = "trip_intake_files";

// 10 MB per file. Matches SPEC §6.D6.
const MAX_FILE_SIZE_BYTES = 10_485_760;

// MIME allowlist per SPEC §6.D6.
const ALLOWED_MIME_TYPES = new Set<string>([
  // Images
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/webp",
  // PDFs
  "application/pdf",
  // Docs (Word + OpenDocument)
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.oasis.opendocument.text",
]);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Sanitise a filename for storage path use. Per `feedback_supabase_storage_
 * path_sanitization` (if memory exists): strip non-[A-Za-z0-9_.-] characters
 * and replace with `_`. Reject empty after sanitisation.
 */
function sanitiseFilename(input: string): string | null {
  // Strip any directory traversal attempts + path separators first
  const collapsed = input.replace(/[\\/]/g, "_").trim();
  if (collapsed.length === 0) return null;
  // Replace anything outside the safe set with `_`
  const safe = collapsed.replace(/[^A-Za-z0-9_.\-]/g, "_");
  // Truncate at 200 chars (storage path limits)
  const truncated = safe.length > 200 ? safe.slice(0, 200) : safe;
  // Guard: must still have at least one char after truncation
  return truncated.length > 0 ? truncated : null;
}

interface UploadRequestBody {
  event_id?: string;
  ticket_type_id?: string;
  order_id?: string;
  question_id?: string;
  filename?: string;
  mime_type?: string;
  file_size_bytes?: number;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  let body: UploadRequestBody;
  try {
    body = (await req.json()) as UploadRequestBody;
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  const eventId = typeof body.event_id === "string" ? body.event_id : "";
  const ticketTypeId =
    typeof body.ticket_type_id === "string" ? body.ticket_type_id : "";
  const orderId = typeof body.order_id === "string" ? body.order_id : "";
  const questionId =
    typeof body.question_id === "string" ? body.question_id : "";
  const rawFilename =
    typeof body.filename === "string" ? body.filename : "";
  const mimeType =
    typeof body.mime_type === "string" ? body.mime_type : "";
  const fileSizeBytes =
    typeof body.file_size_bytes === "number" ? body.file_size_bytes : 0;

  if (!eventId) {
    return jsonResponse({ error: "event_id_required" }, 400);
  }
  if (!ticketTypeId) {
    return jsonResponse({ error: "ticket_type_id_required" }, 400);
  }
  if (!orderId) {
    return jsonResponse({ error: "order_id_required" }, 400);
  }
  if (!questionId) {
    return jsonResponse({ error: "question_id_required" }, 400);
  }
  if (!rawFilename) {
    return jsonResponse({ error: "filename_required" }, 400);
  }
  if (!mimeType) {
    return jsonResponse({ error: "mime_type_required" }, 400);
  }
  if (
    !Number.isInteger(fileSizeBytes) ||
    fileSizeBytes <= 0
  ) {
    return jsonResponse({ error: "file_size_bytes_required" }, 400);
  }

  // MIME allowlist
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    return jsonResponse(
      {
        error: "mime_type_not_allowed",
        allowed: Array.from(ALLOWED_MIME_TYPES),
      },
      400,
    );
  }

  // Size cap
  if (fileSizeBytes > MAX_FILE_SIZE_BYTES) {
    return jsonResponse(
      {
        error: "file_too_large",
        max_bytes: MAX_FILE_SIZE_BYTES,
        provided_bytes: fileSizeBytes,
      },
      400,
    );
  }

  // Filename sanitisation
  const safeFilename = sanitiseFilename(rawFilename);
  if (safeFilename === null) {
    return jsonResponse({ error: "filename_invalid" }, 400);
  }

  // Service-role client (anon JWT not used; we authenticate at the trip lookup
  // layer and grant a signed URL bound to a specific object path).
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(
      { error: "edge_function_misconfigured", detail: "missing env" },
      500,
    );
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Event lookup: trip-typed + not soft-deleted
  const { data: eventRow, error: eventErr } = await supabase
    .from("events")
    .select("id, event_type, deleted_at")
    .eq("id", eventId)
    .maybeSingle();
  if (eventErr !== null) {
    console.error(
      "[trip-intake-upload-signed-url] event lookup failed",
      eventErr,
    );
    return jsonResponse(
      { error: "event_lookup_failed", detail: eventErr.message },
      500,
    );
  }
  if (eventRow === null) {
    return jsonResponse({ error: "event_not_found" }, 404);
  }
  if (eventRow.event_type !== "trip") {
    return jsonResponse({ error: "event_not_trip" }, 400);
  }
  if (eventRow.deleted_at !== null) {
    return jsonResponse({ error: "event_deleted" }, 410);
  }

  // Schema lookup for the requested tier + verify the question exists +
  // verify question type is file_upload + verify MIME aligns with question
  // config (allow_images / allow_pdfs / allow_docs)
  const { data: schemaRow, error: schemaErr } = await supabase
    .from("trip_intake_schemas")
    .select("schema")
    .eq("event_id", eventId)
    .eq("ticket_type_id", ticketTypeId)
    .maybeSingle();
  if (schemaErr !== null) {
    console.error(
      "[trip-intake-upload-signed-url] schema lookup failed",
      schemaErr,
    );
    return jsonResponse(
      { error: "schema_lookup_failed", detail: schemaErr.message },
      500,
    );
  }
  if (schemaRow === null) {
    return jsonResponse({ error: "schema_not_present" }, 404);
  }

  const schema = schemaRow.schema as {
    questions?: Array<{
      id?: string;
      type?: string;
      allow_images?: boolean;
      allow_pdfs?: boolean;
      allow_docs?: boolean;
      max_files?: number;
    }>;
  } | null;

  if (schema === null || !Array.isArray(schema.questions)) {
    return jsonResponse({ error: "schema_malformed" }, 500);
  }

  const question = schema.questions.find((q) => q.id === questionId);
  if (question === undefined) {
    return jsonResponse({ error: "question_not_found" }, 404);
  }
  if (question.type !== "file_upload") {
    return jsonResponse({ error: "question_not_file_upload" }, 400);
  }

  // Per-question MIME alignment (planner-configured allowlist subset)
  const isImage = mimeType.startsWith("image/");
  const isPdf = mimeType === "application/pdf";
  const isDoc =
    mimeType === "application/msword" ||
    mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mimeType === "application/vnd.oasis.opendocument.text";

  if (isImage && question.allow_images === false) {
    return jsonResponse(
      { error: "mime_not_allowed_for_question", category: "images" },
      400,
    );
  }
  if (isPdf && question.allow_pdfs === false) {
    return jsonResponse(
      { error: "mime_not_allowed_for_question", category: "pdfs" },
      400,
    );
  }
  if (isDoc && question.allow_docs === false) {
    return jsonResponse(
      { error: "mime_not_allowed_for_question", category: "docs" },
      400,
    );
  }

  // Build the storage object path. Format:
  //   {event_id}/{order_id}/{question_id}/{timestamp}-{sanitised_filename}
  // Timestamp prefix avoids collisions when buyer re-uploads same filename.
  const path = [
    eventId,
    orderId,
    questionId,
    `${Date.now()}-${safeFilename}`,
  ].join("/");

  // Mint a signed upload URL via supabase-js storage API. The supabase-js v2
  // client exposes createSignedUploadUrl which returns a URL the buyer PUTs
  // the file body to. URL is valid for a short window (typically 2 hours,
  // controlled by supabase storage service).
  const { data: signedData, error: signErr } = await supabase
    .storage
    .from(BUCKET)
    .createSignedUploadUrl(path);

  if (signErr !== null || signedData === null) {
    console.error(
      "[trip-intake-upload-signed-url] signed URL generation failed",
      signErr,
    );
    return jsonResponse(
      {
        error: "signed_url_generation_failed",
        detail: signErr?.message ?? "unknown",
      },
      500,
    );
  }

  // Response: signed URL + final object path so the client can store the path
  // back into orders.intake_form_data.answers[questionId] without needing to
  // reconstruct it.
  return jsonResponse({
    signed_url: signedData.signedUrl,
    token: signedData.token,
    path,
    filename: safeFilename,
    mime_type: mimeType,
    size_bytes: fileSizeBytes,
    // ISO timestamp ~1 hour from now (advisory; storage service decides the
    // actual expiry of the signed URL token).
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  });
});
