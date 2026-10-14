// #3859 slice 6 — one private upload-claim rail for anonymous buyer web and
// signed-in Explorer. The client sees a signed URL only in memory; checkout
// submits the opaque accepted claim id, never a path, filename, or credential.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  intakeUploadBytesMatch,
  type IntakeUploadExtension,
  isIntakeUploadUuid,
  validateIntakeUploadCandidate,
} from "../../../packages/offering-rendering/intakeUploadClaim.ts";

const BUCKET = "trip_intake_files";
const CLAIM_TTL_MS = 60 * 60 * 1000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function categoryAllowed(
  mimeType: string,
  question: {
    allow_images?: boolean;
    allow_pdfs?: boolean;
    allow_docs?: boolean;
  },
): boolean {
  if (mimeType.startsWith("image/")) return question.allow_images !== false;
  if (mimeType === "application/pdf") return question.allow_pdfs !== false;
  return question.allow_docs !== false;
}

export async function authenticatedUserId(
  req: Request,
  // deno-lint-ignore no-explicit-any
  supabase: any,
  anonKey: string | undefined,
): Promise<{ bearerProvided: boolean; userId: string | null }> {
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (match === null) {
    return { bearerProvided: header.trim().length > 0, userId: null };
  }
  const token = match[1].trim();
  if (anonKey !== undefined && token === anonKey) {
    return { bearerProvided: false, userId: null };
  }
  const { data, error } = await supabase.auth.getUser(token);
  return {
    bearerProvided: true,
    userId: error === null && isIntakeUploadUuid(data?.user?.id)
      ? data.user.id
      : null,
  };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const payload = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const digest = await crypto.subtle.digest("SHA-256", payload);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

// deno-lint-ignore no-explicit-any
async function rejectClaim(supabase: any, claimId: string, path: string) {
  await supabase.from("trip_intake_upload_claims").update({
    state: "rejected",
    revoked_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", claimId).eq("state", "issued");
  await supabase.storage.from(BUCKET).remove([path]);
}

// Opportunistic and bounded: expired unclaimed objects never become durable
// evidence. Failure is intentionally silent and cannot block a fresh upload.
// deno-lint-ignore no-explicit-any
async function cleanupExpiredClaims(supabase: any): Promise<void> {
  try {
    const { data } = await supabase.from("trip_intake_upload_claims")
      .select("id, object_path")
      .in("state", ["issued", "uploaded", "accepted"])
      .lt("expires_at", new Date().toISOString())
      .limit(20);
    const rows = Array.isArray(data) ? data : [];
    if (rows.length === 0) return;
    const ids = rows.map((row) => row.id).filter(isIntakeUploadUuid);
    const paths = rows.map((row) => row.object_path).filter((path) =>
      typeof path === "string"
    );
    if (ids.length > 0) {
      await supabase.from("trip_intake_upload_claims").update({
        state: "orphaned",
        revoked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).in("id", ids).in("state", ["issued", "uploaded", "accepted"]);
    }
    if (paths.length > 0) await supabase.storage.from(BUCKET).remove(paths);
  } catch {
    // Cleanup is defense-in-depth; claim expiry remains the authorization gate.
  }
}

export function createTripIntakeUploadHandler(): (
  req: Request,
) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }
    if (req.method !== "POST") {
      return jsonResponse({ error: "method_not_allowed" }, 405);
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "invalid_json" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: "upload_service_unavailable" }, 503);
    }
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const auth = await authenticatedUserId(req, supabase, anonKey);
    if (auth.bearerProvided && auth.userId === null) {
      return jsonResponse({ error: "upload_auth_invalid" }, 401);
    }
    const buyerUserId = auth.userId;
    const action = body.action === "accept" || body.action === "revoke"
      ? body.action
      : "mint";
    const uploadSessionId = body.upload_session_id;
    if (!isIntakeUploadUuid(uploadSessionId)) {
      return jsonResponse({ error: "upload_session_invalid" }, 400);
    }

    if (action === "revoke") {
      if (!isIntakeUploadUuid(body.claim_id)) {
        return jsonResponse({ error: "upload_claim_invalid" }, 400);
      }
      const { data: path, error } = await supabase.rpc(
        "issue_3859_revoke_intake_upload_claim",
        {
          p_claim_id: body.claim_id,
          p_upload_session_id: uploadSessionId,
          p_buyer_user_id: buyerUserId,
        },
      );
      if (error !== null || typeof path !== "string") {
        return jsonResponse({ error: "upload_claim_not_removable" }, 409);
      }
      await supabase.storage.from(BUCKET).remove([path]);
      return jsonResponse({ revoked: true });
    }

    if (action === "accept") {
      if (!isIntakeUploadUuid(body.claim_id)) {
        return jsonResponse({ error: "upload_claim_invalid" }, 400);
      }
      const { data: claim, error: claimError } = await supabase
        .from("trip_intake_upload_claims")
        .select(
          "id, upload_session_id, buyer_user_id, object_path, file_extension, declared_mime_type, declared_size_bytes, state, expires_at",
        )
        .eq("id", body.claim_id)
        .maybeSingle();
      if (
        claimError !== null || claim === null ||
        claim.upload_session_id !== uploadSessionId ||
        (claim.buyer_user_id !== null && claim.buyer_user_id !== buyerUserId) ||
        new Date(claim.expires_at).getTime() <= Date.now() ||
        (claim.state !== "issued" && claim.state !== "accepted")
      ) {
        return jsonResponse({ error: "upload_claim_invalid" }, 409);
      }

      const { data: blob, error: downloadError } = await supabase.storage
        .from(BUCKET)
        .download(claim.object_path);
      if (downloadError !== null || blob === null) {
        return jsonResponse({ error: "upload_not_found" }, 409);
      }
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const extension = claim.file_extension as IntakeUploadExtension;
      const contentMatches = blob.size === claim.declared_size_bytes &&
        blob.type === claim.declared_mime_type &&
        intakeUploadBytesMatch(bytes, extension);
      if (!contentMatches) {
        await rejectClaim(supabase, claim.id, claim.object_path);
        return jsonResponse({ error: "upload_content_mismatch" }, 400);
      }

      const { data: accepted, error: acceptError } = await supabase.rpc(
        "issue_3859_accept_intake_upload_claim",
        {
          p_claim_id: claim.id,
          p_upload_session_id: uploadSessionId,
          p_buyer_user_id: buyerUserId,
          p_verified_mime_type: blob.type,
          p_verified_size_bytes: blob.size,
          p_content_sha256: await sha256Hex(bytes),
        },
      );
      if (acceptError !== null || accepted === null) {
        return jsonResponse({ error: "upload_accept_failed" }, 409);
      }
      if (typeof accepted.replaced_path === "string") {
        await supabase.storage.from(BUCKET).remove([accepted.replaced_path]);
      }
      return jsonResponse({
        claim_id: accepted.claim_id,
        mime_type: accepted.mime_type,
        size_bytes: accepted.size_bytes,
        expires_at: accepted.expires_at,
      });
    }

    await cleanupExpiredClaims(supabase);

    const eventId = body.event_id;
    const ticketTypeId = body.ticket_type_id;
    const questionId = body.question_id;
    const schemaVersionId = body.schema_version_id;
    if (
      !isIntakeUploadUuid(eventId) ||
      !isIntakeUploadUuid(ticketTypeId) ||
      !isIntakeUploadUuid(questionId) ||
      !isIntakeUploadUuid(schemaVersionId)
    ) {
      return jsonResponse({ error: "upload_scope_invalid" }, 400);
    }

    const candidate = validateIntakeUploadCandidate({
      filename: body.filename,
      mimeType: body.mime_type,
      sizeBytes: body.size_bytes,
    });
    if (!candidate.ok) {
      return jsonResponse({ error: candidate.reason }, 400);
    }

    const { data: event, error: eventError } = await supabase.from("events")
      .select("id, event_type, status, deleted_at")
      .eq("id", eventId)
      .maybeSingle();
    if (
      eventError !== null || event === null || event.event_type !== "trip" ||
      !["scheduled", "live"].includes(event.status) ||
      event.deleted_at !== null
    ) {
      return jsonResponse({ error: "upload_scope_unavailable" }, 404);
    }

    const { data: schemaRow, error: schemaError } = await supabase
      .from("trip_intake_schemas")
      .select("schema, schema_version_id")
      .eq("event_id", eventId)
      .eq("ticket_type_id", ticketTypeId)
      .maybeSingle();
    const questions = schemaRow?.schema?.questions;
    const question = Array.isArray(questions)
      ? questions.find((entry) => entry?.id === questionId)
      : undefined;
    if (
      schemaError !== null || schemaRow === null ||
      schemaRow.schema_version_id !== schemaVersionId ||
      question?.type !== "file_upload" ||
      !categoryAllowed(candidate.mimeType, question)
    ) {
      return jsonResponse({ error: "upload_scope_unavailable" }, 409);
    }

    const replacementId = isIntakeUploadUuid(body.replace_claim_id)
      ? body.replace_claim_id
      : null;
    const maxFiles = Number.isInteger(question.max_files)
      ? question.max_files
      : 1;

    const claimId = crypto.randomUUID();
    const path =
      `${eventId}/${crypto.randomUUID()}/${crypto.randomUUID()}${candidate.extension}`;
    const expiresAt = new Date(Date.now() + CLAIM_TTL_MS).toISOString();
    const { data: minted, error: mintError } = await supabase.rpc(
      "issue_3859_mint_intake_upload_claim",
      {
        p_claim_id: claimId,
        p_upload_session_id: uploadSessionId,
        p_buyer_user_id: buyerUserId,
        p_event_id: eventId,
        p_ticket_type_id: ticketTypeId,
        p_question_id: questionId,
        p_schema_version_id: schemaVersionId,
        p_object_path: path,
        p_file_extension: candidate.extension,
        p_declared_mime_type: candidate.mimeType,
        p_declared_size_bytes: candidate.sizeBytes,
        p_replaces_claim_id: replacementId,
        p_expires_at: expiresAt,
        p_max_files: maxFiles,
      },
    );
    const orphanedPaths = Array.isArray(minted?.orphaned_paths)
      ? minted.orphaned_paths.filter((value: unknown): value is string =>
        typeof value === "string"
      )
      : [];
    if (orphanedPaths.length > 0) {
      await supabase.storage.from(BUCKET).remove(orphanedPaths);
    }
    if (mintError !== null || minted === null) {
      return jsonResponse({ error: "upload_claim_create_failed" }, 409);
    }
    if (minted.ok !== true) {
      const mintRefusal = minted.error === "upload_limit_reached" ||
          minted.error === "upload_replacement_invalid"
        ? minted.error
        : "upload_claim_create_failed";
      return jsonResponse({ error: mintRefusal }, 409);
    }

    const { data: signed, error: signedError } = await supabase.storage
      .from(BUCKET)
      .createSignedUploadUrl(path);
    if (signedError !== null || signed === null) {
      await rejectClaim(supabase, claimId, path);
      return jsonResponse({ error: "upload_service_unavailable" }, 503);
    }

    return jsonResponse({
      claim_id: claimId,
      signed_url: signed.signedUrl,
      mime_type: candidate.mimeType,
      size_bytes: candidate.sizeBytes,
      expires_at: expiresAt,
    });
  };
}

if (import.meta.main) {
  serve(createTripIntakeUploadHandler());
}
