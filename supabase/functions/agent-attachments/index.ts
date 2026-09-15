// Issue #3429 — authenticated private Ari attachment lifecycle.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders } from "../_shared/cors.ts";
import {
  ARI_ATTACHMENT_BUCKET,
  ARI_ATTACHMENT_MAX_FILE_BYTES,
  ARI_ATTACHMENT_MAX_FILES,
  ARI_ATTACHMENT_MAX_TURN_BYTES,
  AriAttachmentError,
  fileTypeForDeclaredMime,
  verifyAriAttachment,
} from "../_shared/agentAttachments.ts";
import {
  requireAccessibleAgentBrand,
  resolveAccessibleAgentBrands,
} from "../_shared/agentTenantScope.ts";

type AttachmentAction = "prepare" | "finalize" | "open" | "discard";

interface PrepareFile {
  filename: string;
  mime_type: string;
  size_bytes: number;
  display_order: number;
}

interface RequestBody {
  action?: AttachmentAction;
  brand_id?: string;
  conversation_id?: string | null;
  files?: PrepareFile[];
  attachment_ids?: string[];
  attachment_id?: string;
}

interface AttachmentAuthorityRow {
  id: string;
  user_id: string;
  brand_id: string;
  conversation_id: string | null;
  storage_path: string;
  derived_storage_path: string | null;
  original_filename: string;
  declared_mime: string;
  declared_size_bytes: number;
  state: string;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function response(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function safeFilename(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 240) ||
    "attachment";
}

function stableFailureMessage(code: string, filename: string): string {
  switch (code) {
    case "CONTEXT_LIMIT_EXCEEDED":
      return "Ari couldn’t use this file because it contains too much information for one message. Remove it and attach a shorter version.";
    case "UNSUPPORTED_TYPE":
    case "MIME_MISMATCH":
      return "That file isn’t supported. Add a JPG, PNG, WebP, HEIC, PDF, DOCX, TXT, or CSV file up to 10 MB.";
    case "FILE_TOO_LARGE":
      return "That file is larger than 10 MB. Choose a smaller file.";
    case "DUPLICATE_FILE":
      return `${filename} is already attached.`;
    case "ENCRYPTED_FILE":
    case "CORRUPT_FILE":
    case "UNREADABLE_FILE":
    case "DECOMPRESSION_BOMB":
    case "UPLOAD_INCOMPLETE":
    case "SIZE_MISMATCH":
    default:
      return `Ari couldn’t read ${filename}. Remove password protection or choose a different file.`;
  }
}

function serviceClient() {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !key) throw new Error("server_config_missing");
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return response(405, { code: "METHOD_NOT_ALLOWED" });
  }

  let body: RequestBody;
  try {
    body = await request.json() as RequestBody;
  } catch {
    return response(400, { code: "BAD_REQUEST" });
  }
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return response(401, { code: "UNAUTHENTICATED" });
  }
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!url || !anonKey) return response(500, { code: "INTERNAL" });
  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const jwt = authHeader.slice("Bearer ".length);
  const { data: userData, error: userError } = await userClient.auth.getUser(
    jwt,
  );
  if (userError || !userData.user) {
    return response(401, { code: "UNAUTHENTICATED" });
  }
  const userId = userData.user.id;
  let admin;
  try {
    admin = serviceClient();
  } catch {
    return response(500, { code: "INTERNAL" });
  }

  if (!body.action) return response(400, { code: "BAD_REQUEST" });

  if (body.action === "prepare") {
    if (
      !body.brand_id || !UUID_PATTERN.test(body.brand_id) ||
      !Array.isArray(body.files)
    ) {
      return response(400, { code: "BAD_REQUEST" });
    }
    try {
      const brands = await resolveAccessibleAgentBrands(userClient, userId);
      requireAccessibleAgentBrand(brands, body.brand_id);
    } catch {
      return response(403, { code: "FORBIDDEN" });
    }
    if (body.conversation_id) {
      const { data: conversation } = await userClient.from(
        "agent_conversations",
      )
        .select("id, brand_id")
        .eq("id", body.conversation_id)
        .eq("brand_id", body.brand_id)
        .maybeSingle();
      if (!conversation) return response(403, { code: "FORBIDDEN" });
    }
    const requestedBytes = body.files.reduce(
      (sum, file) =>
        sum + (Number.isFinite(file.size_bytes) ? file.size_bytes : 0),
      0,
    );
    if (
      body.files.length === 0 ||
      body.files.length > ARI_ATTACHMENT_MAX_FILES ||
      requestedBytes > ARI_ATTACHMENT_MAX_TURN_BYTES
    ) {
      return response(400, {
        code: "ATTACHMENT_LIMIT_EXCEEDED",
        message: "You can attach up to 5 files and 25 MB in one message.",
      });
    }

    const outcomes: Record<string, unknown>[] = [];
    for (const file of body.files) {
      const filename = safeFilename(
        typeof file.filename === "string" ? file.filename : "attachment",
      );
      const fileType = typeof file.mime_type === "string"
        ? fileTypeForDeclaredMime(file.mime_type)
        : null;
      if (
        !fileType || !Number.isInteger(file.size_bytes) ||
        file.size_bytes < 1 ||
        file.size_bytes > ARI_ATTACHMENT_MAX_FILE_BYTES ||
        !Number.isInteger(file.display_order) || file.display_order < 0 ||
        file.display_order > 4
      ) {
        const code = file.size_bytes > ARI_ATTACHMENT_MAX_FILE_BYTES
          ? "FILE_TOO_LARGE"
          : "UNSUPPORTED_TYPE";
        outcomes.push({
          filename,
          state: "failed",
          code,
          message: stableFailureMessage(code, filename),
        });
        continue;
      }
      const attachmentId = crypto.randomUUID();
      const storagePath = `${userId}/${body.brand_id}/${attachmentId}/source`;
      const { error: insertError } = await admin.from("agent_attachments")
        .insert({
          id: attachmentId,
          user_id: userId,
          brand_id: body.brand_id,
          storage_path: storagePath,
          original_filename: filename,
          declared_mime: file.mime_type.toLowerCase().split(";", 1)[0],
          file_type: fileType,
          declared_size_bytes: file.size_bytes,
          display_order: file.display_order,
          state: "prepared",
        });
      if (insertError) {
        outcomes.push({ filename, state: "failed", code: "PREPARE_FAILED" });
        continue;
      }
      const { data: signed, error: signedError } = await admin.storage
        .from(ARI_ATTACHMENT_BUCKET).createSignedUploadUrl(storagePath);
      if (signedError || !signed?.token) {
        await admin.from("agent_attachments").delete().eq("id", attachmentId)
          .eq("user_id", userId);
        outcomes.push({ filename, state: "failed", code: "PREPARE_FAILED" });
        continue;
      }
      outcomes.push({
        attachment_id: attachmentId,
        filename,
        state: "prepared",
        upload_token: signed.token,
      });
    }
    return response(200, { outcomes });
  }

  if (body.action === "finalize") {
    const attachmentIds = Array.isArray(body.attachment_ids)
      ? body.attachment_ids.filter((id): id is string =>
        typeof id === "string" && UUID_PATTERN.test(id)
      )
      : [];
    if (
      attachmentIds.length === 0 ||
      attachmentIds.length > ARI_ATTACHMENT_MAX_FILES
    ) {
      return response(400, { code: "BAD_REQUEST" });
    }
    const outcomes: Record<string, unknown>[] = [];
    for (const attachmentId of attachmentIds) {
      const { data: rowData } = await admin.from("agent_attachments")
        .select(
          "id,user_id,brand_id,conversation_id,storage_path,derived_storage_path,original_filename,declared_mime,declared_size_bytes,state",
        )
        .eq("id", attachmentId)
        .eq("user_id", userId)
        .maybeSingle();
      const row = rowData as AttachmentAuthorityRow | null;
      if (
        !row || row.conversation_id !== null ||
        !["prepared", "failed"].includes(row.state)
      ) {
        outcomes.push({
          attachment_id: attachmentId,
          state: "failed",
          code: "ATTACHMENT_SCOPE_DENIED",
        });
        continue;
      }
      let derivedStoragePath: string | null = null;
      try {
        await admin.from("agent_attachments").update({
          state: "uploaded",
          updated_at: new Date().toISOString(),
        })
          .eq("id", attachmentId).eq("user_id", userId);
        await admin.from("agent_attachments").update({
          state: "processing",
          failure_code: null,
          updated_at: new Date().toISOString(),
        })
          .eq("id", attachmentId).eq("user_id", userId).eq("state", "uploaded");
        const { data: source, error: sourceError } = await admin.storage
          .from(ARI_ATTACHMENT_BUCKET).download(row.storage_path);
        if (sourceError || !source) {
          throw new AriAttachmentError("UPLOAD_INCOMPLETE");
        }
        const bytes = new Uint8Array(await source.arrayBuffer());
        const verified = await verifyAriAttachment(
          bytes,
          row.declared_mime,
          row.declared_size_bytes,
        );
        const { data: duplicate } = await admin.from("agent_attachments")
          .select("id")
          .eq("user_id", userId)
          .eq("brand_id", row.brand_id)
          .eq("sha256", verified.sha256)
          .eq("state", "ready")
          .is("client_turn_id", null)
          .neq("id", attachmentId)
          .limit(1)
          .maybeSingle();
        if (duplicate) throw new AriAttachmentError("DUPLICATE_FILE");
        let derivedSizeBytes: number | null = null;
        let derivedSha256: string | null = null;
        if (verified.derivativeText !== null) {
          derivedStoragePath =
            `${userId}/${row.brand_id}/${attachmentId}/derived`;
          const derivative = new TextEncoder().encode(verified.derivativeText);
          derivedSizeBytes = derivative.byteLength;
          const derivativeDigest = new Uint8Array(
            await crypto.subtle.digest("SHA-256", derivative),
          );
          derivedSha256 = Array.from(derivativeDigest)
            .map((value) => value.toString(16).padStart(2, "0")).join("");
          const { error: derivativeError } = await admin.storage
            .from(ARI_ATTACHMENT_BUCKET).upload(
              derivedStoragePath,
              derivative,
              {
                contentType: "text/plain; charset=utf-8",
                upsert: true,
              },
            );
          if (derivativeError) throw new AriAttachmentError("UNREADABLE_FILE");
        }
        const { data: readyRow, error: readyError } = await admin.from(
          "agent_attachments",
        )
          .update({
            state: "ready",
            failure_code: null,
            verified_mime: verified.verifiedMime,
            verified_size_bytes: verified.sizeBytes,
            sha256: verified.sha256,
            file_type: verified.fileType,
            derived_storage_path: derivedStoragePath,
            derived_size_bytes: derivedSizeBytes,
            derived_sha256: derivedSha256,
            processing_metadata: verified.processingMetadata,
            ready_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }).eq("id", attachmentId).eq("user_id", userId).eq(
            "state",
            "processing",
          ).select("id").maybeSingle();
        if (readyError || !readyRow) {
          throw new AriAttachmentError("UNREADABLE_FILE");
        }
        outcomes.push({
          attachment_id: attachmentId,
          filename: row.original_filename,
          state: "ready",
          verified_mime: verified.verifiedMime,
          file_type: verified.fileType,
          size_bytes: verified.sizeBytes,
        });
      } catch (error: unknown) {
        const code = error instanceof AriAttachmentError
          ? error.code
          : "UNREADABLE_FILE";
        if (derivedStoragePath !== null) {
          const { error: cleanupError } = await admin.storage
            .from(ARI_ATTACHMENT_BUCKET).remove([derivedStoragePath]);
          if (cleanupError) {
            console.error("ari_attachment_derivative_cleanup_failed", {
              attachmentId,
              code: cleanupError.message,
            });
          }
        }
        await admin.from("agent_attachments").update({
          state: "failed",
          failure_code: code,
          updated_at: new Date().toISOString(),
        }).eq("id", attachmentId).eq("user_id", userId);
        outcomes.push({
          attachment_id: attachmentId,
          filename: row.original_filename,
          state: "failed",
          code,
          message: stableFailureMessage(code, row.original_filename),
        });
      }
    }
    return response(200, { outcomes });
  }

  if (!body.attachment_id || !UUID_PATTERN.test(body.attachment_id)) {
    return response(400, { code: "BAD_REQUEST" });
  }
  const { data: ownedData } = await admin.from("agent_attachments")
    .select(
      "id,user_id,brand_id,conversation_id,storage_path,derived_storage_path,original_filename,declared_mime,declared_size_bytes,state",
    )
    .eq("id", body.attachment_id)
    .eq("user_id", userId)
    .maybeSingle();
  const owned = ownedData as AttachmentAuthorityRow | null;
  if (!owned) return response(404, { code: "NOT_FOUND" });
  try {
    const brands = await resolveAccessibleAgentBrands(userClient, userId);
    requireAccessibleAgentBrand(brands, owned.brand_id);
  } catch {
    return response(403, { code: "FORBIDDEN" });
  }

  if (body.action === "discard") {
    if (owned.conversation_id !== null) {
      return response(409, { code: "ALREADY_SENT" });
    }
    const { data: deleted, error } = await admin.from("agent_attachments")
      .delete().eq("id", owned.id).eq("user_id", userId).is(
        "conversation_id",
        null,
      ).select("id");
    if (error || !deleted?.length) {
      return response(409, { code: "DISCARD_CONFLICT" });
    }
    return response(200, { attachment_id: owned.id, state: "discarded" });
  }

  if (body.action === "open") {
    if (owned.state !== "ready") {
      return response(409, { code: "ATTACHMENT_NOT_READY" });
    }
    if (owned.conversation_id) {
      const { data: conversation } = await userClient.from(
        "agent_conversations",
      )
        .select("id")
        .eq("id", owned.conversation_id)
        .eq("brand_id", owned.brand_id)
        .maybeSingle();
      if (!conversation) return response(403, { code: "FORBIDDEN" });
    }
    const { data: signed, error } = await admin.storage
      .from(ARI_ATTACHMENT_BUCKET).createSignedUrl(owned.storage_path, 60);
    if (error || !signed?.signedUrl) {
      return response(500, { code: "OPEN_FAILED" });
    }
    return response(200, {
      attachment_id: owned.id,
      filename: owned.original_filename,
      expires_in_seconds: 60,
      signed_url: signed.signedUrl,
    });
  }

  return response(400, { code: "BAD_REQUEST" });
});
