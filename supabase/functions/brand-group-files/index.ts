// #3720 Completion Wave 3 — private Brand-group files backed by Shared Drive.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { GoogleDriveClient, parseDriveCredentialBundle } from "./drive.ts";
import { verifySafeFileMime } from "./fileSafety.ts";

type JsonObject = Record<string, unknown>;
type AdminClient = ReturnType<typeof createClient>;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, range",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Expose-Headers": "accept-ranges, content-length, content-range, content-type",
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(status: number, body: JsonObject): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function serverClients(request: Request): { admin: AdminClient; user: AdminClient; serviceRoleKey: string } {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const authorization = request.headers.get("Authorization") ?? "";
  if (!url || !anon || !serviceRoleKey) throw new Error("SERVER_CONFIG_MISSING");
  return {
    admin: createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } }),
    user: createClient(url, anon, {
      global: { headers: { Authorization: authorization } },
      auth: { autoRefreshToken: false, persistSession: false },
    }),
    serviceRoleKey,
  };
}

function driveClient(): GoogleDriveClient {
  const config = parseDriveCredentialBundle(Deno.env.get("GOOGLE_CALENDAR_KEYS") ?? "");
  return new GoogleDriveClient(config, config.shared_drive_id, config.host_details_folder_id);
}

function safeError(error: unknown): string {
  const code = error instanceof Error ? error.message : "INTERNAL";
  return /^[A-Z][A-Z0-9_]{2,79}$/.test(code) ? code : "INTERNAL";
}

async function provisionPending(admin: AdminClient, drive: GoogleDriveClient): Promise<Response> {
  let completed = 0;
  let failed = 0;
  let discarded = 0;
  for (let index = 0; index < 20; index += 1) {
    const claimed = await admin.rpc("issue_3720_claim_stale_brand_group_file");
    if (claimed.error) throw new Error("STAGING_SWEEP_CLAIM_FAILED");
    if (!claimed.data) break;
    const stale = claimed.data as { file_id: string; storage_path: string };
    const removed = await admin.storage.from("brand-group-file-staging").remove([stale.storage_path]);
    if (removed.error) {
      await admin.rpc("issue_3720_fail_brand_group_file", {
        p_file_id: stale.file_id,
        p_error_code: "STAGING_SWEEP_FAILED",
      });
      failed += 1;
      continue;
    }
    const finished = await admin.rpc("issue_3720_complete_stale_brand_group_file", {
      p_file_id: stale.file_id,
    });
    if (finished.error) throw new Error("STAGING_SWEEP_COMPLETE_FAILED");
    discarded += 1;
  }
  for (let index = 0; index < 8; index += 1) {
    const { data, error } = await admin.rpc("issue_3720_claim_drive_binding");
    if (error) throw new Error("BINDING_CLAIM_FAILED");
    if (!data) break;
    const binding = data as {
      conversation_id: string;
      brand_id: string;
      canonical_host_folder_name: string;
      host_folder_id?: string | null;
      media_packet_folder_id?: string | null;
      host_uploads_folder_id?: string | null;
      staff_sharing_folder_id?: string | null;
    };
    try {
      const folders = await drive.ensureBinding({
        brandId: binding.brand_id,
        canonicalName: binding.canonical_host_folder_name,
        hostFolderId: binding.host_folder_id,
        mediaPacketFolderId: binding.media_packet_folder_id,
        hostUploadsFolderId: binding.host_uploads_folder_id,
        staffSharingFolderId: binding.staff_sharing_folder_id,
      });
      const result = await admin.rpc("issue_3720_complete_drive_binding", {
        p_conversation_id: binding.conversation_id,
        p_shared_drive_id: drive.sharedDriveId,
        p_host_folder_id: folders.hostFolderId,
        p_media_packet_folder_id: folders.mediaPacketFolderId,
        p_host_uploads_folder_id: folders.hostUploadsFolderId,
        p_staff_sharing_folder_id: folders.staffSharingFolderId,
      });
      if (result.error) throw new Error("BINDING_COMPLETE_FAILED");
      completed += 1;
    } catch (error) {
      const code = safeError(error);
      await admin.rpc("issue_3720_fail_drive_binding", {
        p_conversation_id: binding.conversation_id,
        p_error_code: code,
      });
      failed += 1;
    }
  }
  return json(200, { ok: true, completed, failed, discarded });
}

async function userIdFor(request: Request, user: AdminClient): Promise<string | null> {
  const authorization = request.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return null;
  const { data, error } = await user.auth.getUser(authorization.slice(7));
  return error || !data.user ? null : data.user.id;
}

export async function finalize(
  admin: AdminClient,
  drive: GoogleDriveClient,
  fileId: string,
  userId: string,
): Promise<Response> {
  const { data, error } = await admin.rpc("issue_3720_claim_brand_group_file", {
    p_file_id: fileId,
    p_user_id: userId,
  });
  if (error) {
    const message = String(error.message ?? "");
    if (message.includes("drive_not_ready")) return json(409, { code: "DRIVE_NOT_READY", retryable: true });
    if (message.includes("upload_incomplete")) return json(409, { code: "UPLOAD_INCOMPLETE", retryable: true });
    return json(403, { code: "FILE_UNAVAILABLE" });
  }
  const claim = data as {
    state: string;
    file_id: string;
    message_id?: string | null;
    name?: string;
    mime_type?: string;
    size_bytes?: number;
    storage_path?: string;
    target_folder_id?: string;
  };
  if (claim.state === "ready") return json(200, { ok: true, file_id: fileId, message_id: claim.message_id });
  if (claim.state !== "transferring" || !claim.storage_path || !claim.target_folder_id || !claim.name || !claim.mime_type) {
    return json(202, { ok: true, file_id: fileId, state: "transferring" });
  }

  let providerFileId: string | null = null;
  try {
    const downloaded = await admin.storage.from("brand-group-file-staging").download(claim.storage_path);
    if (downloaded.error || !downloaded.data) throw new Error("STAGING_READ_FAILED");
    if (downloaded.data.size !== Number(claim.size_bytes)) throw new Error("UPLOAD_SIZE_MISMATCH");
    const verifiedMime = await verifySafeFileMime(downloaded.data, claim.mime_type);
    const uploaded = await drive.upload({
      folderId: claim.target_folder_id,
      minglaUploadId: fileId,
      name: claim.name,
      mimeType: verifiedMime,
      body: downloaded.data,
    });
    providerFileId = uploaded.id;
    if (!uploaded.id || Number(uploaded.size) !== Number(claim.size_bytes)) {
      throw new Error("DRIVE_VERIFY_FAILED");
    }
    const completed = await admin.rpc("issue_3720_complete_brand_group_file", {
      p_file_id: fileId,
      p_provider_file_id: uploaded.id,
      p_verified_mime: uploaded.mimeType || verifiedMime,
      p_verified_size: Number(uploaded.size),
    });
    if (completed.error) {
      if (String(completed.error.message).includes("file_access_removed")) {
        await drive.remove(uploaded.id);
        providerFileId = null;
        throw new Error("FILE_ACCESS_REMOVED");
      }
      throw new Error("FILE_COMMIT_FAILED");
    }
    const completedMime = uploaded.mimeType || verifiedMime;
    try {
      if (completedMime.startsWith("image/") || completedMime.startsWith("video/")) {
        const media = await drive.mediaInfo(uploaded.id);
        const updated = await admin.rpc("issue_3988_set_brand_group_file_media", {
          p_file_id: fileId,
          p_width: media.width,
          p_height: media.height,
          p_duration_ms: media.durationMs,
          p_thumb_state: media.hasThumbnail && media.thumbnailLink ? "ready" : "pending",
        });
        if (updated.error) throw new Error("MEDIA_METADATA_WRITE_FAILED");
      } else {
        const updated = await admin.rpc("issue_3988_set_brand_group_file_media", {
          p_file_id: fileId,
          p_width: null,
          p_height: null,
          p_duration_ms: null,
          p_thumb_state: "none",
        });
        if (updated.error) throw new Error("MEDIA_METADATA_WRITE_FAILED");
      }
    } catch (mediaError) {
      console.warn("#3988 Brand-group media metadata remains pending", safeError(mediaError));
    }
    await admin.storage.from("brand-group-file-staging").remove([claim.storage_path]);
    return json(200, { ok: true, file_id: fileId, message_id: completed.data });
  } catch (cause) {
    const code = safeError(cause);
    await admin.rpc("issue_3720_fail_brand_group_file", { p_file_id: fileId, p_error_code: code });
    return json(code === "FILE_ACCESS_REMOVED" ? 403 : 503, {
      code,
      retryable: code !== "FILE_ACCESS_REMOVED",
      provider_object_committed: providerFileId !== null,
    });
  }
}

export async function openThumbnail(
  admin: AdminClient,
  drive: GoogleDriveClient,
  userId: string,
  fileId: string,
): Promise<Response> {
  const authorized = await admin.rpc("issue_3720_authorize_brand_group_file", {
    p_file_id: fileId,
    p_user_id: userId,
  });
  if (authorized.error || !authorized.data) return json(404, { code: "FILE_UNAVAILABLE" });
  const file = authorized.data as {
    provider_file_id: string;
    mime_type: string;
  };
  if (!file.mime_type?.startsWith("image/") && !file.mime_type?.startsWith("video/")) {
    return json(404, { code: "THUMB_UNAVAILABLE" });
  }

  const currentResult = await admin.rpc("issue_3988_file_thumb_state", { p_file_id: fileId });
  const current = !currentResult.error && currentResult.data
    ? currentResult.data as {
      thumbState?: unknown;
      thumbCheckedAt?: unknown;
      width?: unknown;
      height?: unknown;
      durationMs?: unknown;
    }
    : null;
  const media = await drive.mediaInfo(file.provider_file_id);
  const nextThumbState = media.hasThumbnail && media.thumbnailLink ? "ready" : "pending";
  const lastChecked = typeof current?.thumbCheckedAt === "string"
    ? Date.parse(current.thumbCheckedAt)
    : Number.NaN;
  const setterAllowed = !Number.isFinite(lastChecked) || Date.now() - lastChecked >= 60_000;
  const metadataChanged = current?.thumbState !== nextThumbState ||
    current?.width !== media.width ||
    current?.height !== media.height ||
    current?.durationMs !== media.durationMs;
  // A pending-to-ready transition is terminal progress and must not leave the
  // gallery stuck. Already-ready rows still honor the 60-second setter limit,
  // including requests whose Drive response is unchanged.
  const shouldPersistMetadata =
    (current?.thumbState === "pending" && nextThumbState === "ready") ||
    (setterAllowed && (current?.thumbState === "pending" || metadataChanged));
  if (shouldPersistMetadata) {
    const updated = await admin.rpc("issue_3988_set_brand_group_file_media", {
      p_file_id: fileId,
      p_width: media.width,
      p_height: media.height,
      p_duration_ms: media.durationMs,
      p_thumb_state: nextThumbState,
    });
    if (updated.error) {
      console.warn("#3988 Brand-group thumbnail metadata write skipped", "MEDIA_METADATA_WRITE_FAILED");
    }
  }
  if (!media.hasThumbnail || !media.thumbnailLink) {
    return json(404, { code: "THUMB_UNAVAILABLE" });
  }

  const upstream = await drive.thumbnail(media.thumbnailLink);
  if (!upstream.ok) {
    await upstream.arrayBuffer().catch(() => null);
    return json(upstream.status === 404 ? 404 : 503, { code: "THUMB_UNAVAILABLE" });
  }
  const headers = new Headers(cors);
  headers.set("Cache-Control", "private, max-age=86400");
  headers.set("Content-Type", upstream.headers.get("content-type") || "image/jpeg");
  const contentLength = upstream.headers.get("content-length");
  if (contentLength) headers.set("Content-Length", contentLength);
  return new Response(upstream.body, { status: 200, headers });
}

async function openFile(
  request: Request,
  admin: AdminClient,
  drive: GoogleDriveClient,
  userId: string,
  fileId: string,
): Promise<Response> {
  const { data, error } = await admin.rpc("issue_3720_authorize_brand_group_file", {
    p_file_id: fileId,
    p_user_id: userId,
  });
  if (error || !data) return json(404, { code: "FILE_UNAVAILABLE" });
  const file = data as { provider_file_id: string; name: string; mime_type: string; size_bytes: number };
  const upstream = await drive.media(file.provider_file_id, request.headers.get("Range"));
  if (!upstream.ok && upstream.status !== 206) {
    await upstream.arrayBuffer().catch(() => null);
    return json(upstream.status === 404 ? 404 : 503, { code: "FILE_UNAVAILABLE" });
  }
  const headers = new Headers(cors);
  headers.set("Cache-Control", "private, no-store");
  headers.set("Content-Type", file.mime_type || upstream.headers.get("content-type") || "application/octet-stream");
  headers.set("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`);
  for (const name of ["accept-ranges", "content-length", "content-range"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}

export async function handleBrandGroupFiles(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  let clients: ReturnType<typeof serverClients>;
  let drive: GoogleDriveClient;
  try {
    clients = serverClients(request);
    drive = driveClient();
  } catch {
    return json(503, { code: "SERVICE_NOT_READY" });
  }
  try {
    if (request.method === "POST") {
      const body = await request.json().catch(() => null) as { action?: unknown; file_id?: unknown } | null;
      if (body?.action === "provision_pending") {
        const authorization = request.headers.get("Authorization") ?? "";
        if (authorization !== `Bearer ${clients.serviceRoleKey}`) return json(403, { code: "FORBIDDEN" });
        return await provisionPending(clients.admin, drive);
      }
      if (body?.action !== "finalize" || typeof body.file_id !== "string" || !UUID.test(body.file_id)) {
        return json(400, { code: "BAD_REQUEST" });
      }
      const userId = await userIdFor(request, clients.user);
      if (!userId) return json(401, { code: "UNAUTHENTICATED" });
      return await finalize(clients.admin, drive, body.file_id, userId);
    }
    if (request.method === "GET") {
      const requestUrl = new URL(request.url);
      const fileId = requestUrl.searchParams.get("file_id") ?? "";
      if (!UUID.test(fileId)) return json(400, { code: "BAD_REQUEST" });
      const variant = requestUrl.searchParams.get("variant");
      if (variant !== null && variant !== "thumb") return json(400, { code: "BAD_VARIANT" });
      const userId = await userIdFor(request, clients.user);
      if (!userId) return json(401, { code: "UNAUTHENTICATED" });
      if (variant === "thumb") return await openThumbnail(clients.admin, drive, userId, fileId);
      return await openFile(request, clients.admin, drive, userId, fileId);
    }
    return json(405, { code: "METHOD_NOT_ALLOWED" });
  } catch (error) {
    const code = safeError(error);
    return json(code === "DRIVE_FORBIDDEN" ? 503 : 500, { code: code === "INTERNAL" ? "INTERNAL" : code });
  }
}

if (import.meta.main) Deno.serve(handleBrandGroupFiles);
