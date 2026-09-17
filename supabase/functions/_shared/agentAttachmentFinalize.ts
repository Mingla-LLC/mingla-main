/**
 * Issue #3429 REWORK-1 — one-file Ari attachment finalize and status core.
 *
 * Extracted from `agent-attachments/index.ts` so the lease, the terminal-write
 * guard, and the copy table can be proven with an injected admin client.
 *
 * Contract (SPEC AMENDMENT REWORK-1 sections 3.2.3-3.2.9):
 * - finalize takes exactly one `attachment_id`; any `attachment_ids` is refused.
 * - a row is claimed by one conditional update (prepared/failed, unbound,
 *   fewer than two prior claims) that stamps a fresh processing token;
 * - every ready/failed write is conditional on that exact token, so a late
 *   write after a sweep changes nothing and the canonical row is returned;
 * - `status` sweeps a processing row older than 60 seconds to
 *   failed/PROCESSING_INTERRUPTED, and a ready unbound row stays idempotent.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  ARI_ATTACHMENT_BUCKET,
  AriAttachmentError,
  verifyAriAttachment,
} from "./agentAttachments.ts";

export const ARI_ATTACHMENT_PROCESSING_LEASE_SECONDS = 60;
export const ARI_ATTACHMENT_MAX_PROCESSING_CLAIMS = 2;
export const ARI_ATTACHMENT_IO_TIMEOUT_MS = 15_000;

/**
 * The one server copy table. `mingla-business/src/services/ariAttachmentService.ts`
 * exports the identical table; a Deno test pins this one and a Jest test pins
 * the client one against the same committed JSON snapshot. Only ENCRYPTED_FILE
 * may mention password protection.
 */
export const ARI_ATTACHMENT_FAILURE_COPY: Readonly<Record<string, string>> =
  Object.freeze({
    UNSUPPORTED_TYPE:
      "That file isn’t supported. Add a JPG, PNG, WebP, HEIC, PDF, DOCX, TXT, or CSV file up to 10 MB.",
    MIME_MISMATCH:
      "That file isn’t supported. Add a JPG, PNG, WebP, HEIC, PDF, DOCX, TXT, or CSV file up to 10 MB.",
    FILE_TOO_LARGE: "That file is larger than 10 MB. Choose a smaller file.",
    DUPLICATE_FILE: "{filename} is already attached.",
    CONTEXT_LIMIT_EXCEEDED:
      "Ari couldn’t use this file because it contains too much information for one message. Remove it and attach a shorter version.",
    ENCRYPTED_FILE:
      "Ari couldn’t read {filename}. Remove password protection or choose a different file.",
    CORRUPT_FILE: "Ari couldn’t read {filename}. Choose a different file.",
    UNREADABLE_FILE: "Ari couldn’t read {filename}. Choose a different file.",
    DECOMPRESSION_BOMB: "Ari couldn’t read {filename}. Choose a different file.",
    IMAGE_UNREADABLE: "Ari couldn’t read {filename}. Choose a different file.",
    UPLOAD_INCOMPLETE: "{filename} couldn’t upload. Nothing was sent to Ari.",
    SIZE_MISMATCH: "{filename} couldn’t upload. Nothing was sent to Ari.",
    STORAGE_REJECTED: "Ari couldn’t save {filename}. Try again.",
    PREPARE_FAILED: "Ari couldn’t save {filename}. Try again.",
    PROCESSING_INTERRUPTED:
      "Ari couldn’t finish preparing {filename}. Try again.",
    IMAGE_DIMENSIONS_EXCEEDED:
      "{filename} is too large for Ari to prepare. Choose a smaller image.",
    IMAGE_SOURCE_TOO_LARGE:
      "{filename} is too large for Ari to prepare. Choose a smaller image.",
    HEIC_NOT_SUPPORTED_IN_BROWSER:
      "This browser can’t open HEIC photos. Save {filename} as a JPG, or attach it from the Mingla Business app on your phone.",
    ATTACHMENT_SCOPE_DENIED:
      "Ari couldn’t use {filename}. Remove it and attach it again.",
  });

/** Unknown codes are infrastructure outcomes, never the user's file. */
const FALLBACK_FAILURE_CODE = "PROCESSING_INTERRUPTED";

export function stableFailureMessage(code: string, filename: string): string {
  const template = ARI_ATTACHMENT_FAILURE_COPY[code] ??
    ARI_ATTACHMENT_FAILURE_COPY[FALLBACK_FAILURE_CODE];
  return template.replaceAll("{filename}", filename);
}

export type AriAttachmentOutcome =
  | {
    attachment_id: string;
    filename: string;
    state: "ready";
    verified_mime: string;
    file_type: string;
    size_bytes: number;
  }
  | {
    attachment_id: string;
    filename: string;
    state: "failed";
    code: string;
    message: string;
  }
  | {
    attachment_id: string;
    filename: string;
    state: "prepared" | "uploaded" | "processing";
  };

export interface AriAttachmentLifecycleResult {
  status: number;
  body: Record<string, unknown>;
}

interface LifecycleRow {
  id: string;
  user_id: string;
  brand_id: string;
  conversation_id: string | null;
  storage_path: string;
  original_filename: string;
  declared_mime: string;
  declared_size_bytes: number;
  state: string;
  failure_code: string | null;
  verified_mime: string | null;
  verified_size_bytes: number | null;
  file_type: string;
  processing_token: string | null;
  processing_started_at: string | null;
  processing_attempts: number;
}

const LIFECYCLE_COLUMNS =
  "id,user_id,brand_id,conversation_id,storage_path,original_filename,declared_mime,declared_size_bytes,state,failure_code,verified_mime,verified_size_bytes,file_type,processing_token,processing_started_at,processing_attempts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface AriAttachmentLifecycleDeps {
  admin: SupabaseClient;
  userId: string;
  /** Milliseconds since epoch; injectable so the 60-second lease is testable. */
  now?: () => number;
  verify?: typeof verifyAriAttachment;
  newToken?: () => string;
  ioTimeoutMs?: number;
}

function failedOutcome(
  attachmentId: string,
  filename: string,
  code: string,
): AriAttachmentOutcome {
  return {
    attachment_id: attachmentId,
    filename,
    state: "failed",
    code,
    message: stableFailureMessage(code, filename),
  };
}

function outcomeForRow(row: LifecycleRow): AriAttachmentOutcome {
  if (row.state === "ready") {
    return {
      attachment_id: row.id,
      filename: row.original_filename,
      state: "ready",
      verified_mime: row.verified_mime ?? row.declared_mime,
      file_type: row.file_type,
      size_bytes: row.verified_size_bytes ?? row.declared_size_bytes,
    };
  }
  if (row.state === "failed" || row.state === "discarded") {
    return failedOutcome(
      row.id,
      row.original_filename,
      row.failure_code ?? FALLBACK_FAILURE_CODE,
    );
  }
  return {
    attachment_id: row.id,
    filename: row.original_filename,
    state: row.state as "prepared" | "uploaded" | "processing",
  };
}

async function withTimeout<T>(
  work: Promise<T>,
  timeoutMs: number,
  code: "UPLOAD_INCOMPLETE" | "STORAGE_REJECTED",
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new AriAttachmentError(code)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function readOwnedRow(
  deps: AriAttachmentLifecycleDeps,
  attachmentId: string,
): Promise<LifecycleRow | null> {
  const { data, error } = await deps.admin.from("agent_attachments")
    .select(LIFECYCLE_COLUMNS)
    .eq("id", attachmentId)
    .eq("user_id", deps.userId)
    .maybeSingle();
  if (error) throw new Error("attachment_read_failed");
  return data as LifecycleRow | null;
}

/**
 * Sets a processing row whose lease is older than 60 seconds to
 * failed/PROCESSING_INTERRUPTED. Scoped to one owned row when `attachmentId`
 * is given (status) and to every stale row otherwise (the hourly backstop).
 * Returns the number of rows it terminalized.
 */
export async function sweepStaleAriAttachmentProcessing(args: {
  admin: SupabaseClient;
  nowMs: number;
  userId?: string;
  attachmentId?: string;
  processingToken?: string;
}): Promise<number> {
  const cutoff = new Date(
    args.nowMs - ARI_ATTACHMENT_PROCESSING_LEASE_SECONDS * 1_000,
  ).toISOString();
  let query = args.admin.from("agent_attachments").update({
    state: "failed",
    failure_code: "PROCESSING_INTERRUPTED",
    updated_at: new Date(args.nowMs).toISOString(),
  })
    .eq("state", "processing")
    .lt("processing_started_at", cutoff);
  if (args.attachmentId) query = query.eq("id", args.attachmentId);
  if (args.userId) query = query.eq("user_id", args.userId);
  if (args.processingToken) {
    query = query.eq("processing_token", args.processingToken);
  }
  const { data, error } = await query.select("id");
  if (error) throw new Error("attachment_sweep_failed");
  return (data as unknown[] | null)?.length ?? 0;
}

/** `status` for one owned attachment id (section 3.2.7). */
export async function ariAttachmentStatus(
  deps: AriAttachmentLifecycleDeps,
  attachmentId: string,
): Promise<AriAttachmentOutcome> {
  const nowMs = (deps.now ?? Date.now)();
  const row = await readOwnedRow(deps, attachmentId);
  if (!row || row.conversation_id !== null) {
    return failedOutcome(
      attachmentId,
      row?.original_filename ?? "attachment",
      "ATTACHMENT_SCOPE_DENIED",
    );
  }
  if (
    row.state === "processing" && row.processing_started_at !== null &&
    Date.parse(row.processing_started_at) <
      nowMs - ARI_ATTACHMENT_PROCESSING_LEASE_SECONDS * 1_000
  ) {
    await sweepStaleAriAttachmentProcessing({
      admin: deps.admin,
      nowMs,
      userId: deps.userId,
      attachmentId,
      processingToken: row.processing_token ?? undefined,
    });
    const canonical = await readOwnedRow(deps, attachmentId);
    if (!canonical) {
      return failedOutcome(
        attachmentId,
        row.original_filename,
        "ATTACHMENT_SCOPE_DENIED",
      );
    }
    return outcomeForRow(canonical);
  }
  return outcomeForRow(row);
}

async function writeTerminal(
  deps: AriAttachmentLifecycleDeps,
  attachmentId: string,
  token: string,
  patch: Record<string, unknown>,
): Promise<boolean> {
  const { data, error } = await deps.admin.from("agent_attachments")
    .update(patch)
    .eq("id", attachmentId)
    .eq("user_id", deps.userId)
    .eq("state", "processing")
    .eq("processing_token", token)
    .select("id")
    .maybeSingle();
  return !error && !!data;
}

/** `finalize` for exactly one owned attachment id (sections 3.2.3-3.2.6). */
export async function finalizeAriAttachment(
  deps: AriAttachmentLifecycleDeps,
  attachmentId: string,
): Promise<AriAttachmentOutcome> {
  const now = deps.now ?? Date.now;
  const verify = deps.verify ?? verifyAriAttachment;
  const ioTimeoutMs = deps.ioTimeoutMs ?? ARI_ATTACHMENT_IO_TIMEOUT_MS;
  const row = await readOwnedRow(deps, attachmentId);
  if (!row || row.conversation_id !== null) {
    return failedOutcome(
      attachmentId,
      row?.original_filename ?? "attachment",
      "ATTACHMENT_SCOPE_DENIED",
    );
  }
  if (
    ["prepared", "failed"].includes(row.state) &&
    row.processing_attempts >= ARI_ATTACHMENT_MAX_PROCESSING_CLAIMS
  ) {
    await deps.admin.from("agent_attachments").update({
      state: "failed",
      failure_code: "PROCESSING_INTERRUPTED",
      updated_at: new Date(now()).toISOString(),
    })
      .eq("id", attachmentId)
      .eq("user_id", deps.userId)
      .in("state", ["prepared", "failed"])
      .gte("processing_attempts", ARI_ATTACHMENT_MAX_PROCESSING_CLAIMS);
    return failedOutcome(
      attachmentId,
      row.original_filename,
      "PROCESSING_INTERRUPTED",
    );
  }

  // One conditional claim. The attempt counter doubles as the compare-and-set
  // version, so two concurrent finalizes cannot both win the same row.
  const token = (deps.newToken ?? (() => crypto.randomUUID()))();
  const claimedAt = new Date(now()).toISOString();
  const { data: claimed, error: claimError } = await deps.admin
    .from("agent_attachments")
    .update({
      state: "processing",
      failure_code: null,
      processing_token: token,
      processing_started_at: claimedAt,
      processing_attempts: row.processing_attempts + 1,
      updated_at: claimedAt,
    })
    .eq("id", attachmentId)
    .eq("user_id", deps.userId)
    .is("conversation_id", null)
    .in("state", ["prepared", "failed"])
    .eq("processing_attempts", row.processing_attempts)
    .lt("processing_attempts", ARI_ATTACHMENT_MAX_PROCESSING_CLAIMS)
    .select(LIFECYCLE_COLUMNS)
    .maybeSingle();
  if (claimError || !claimed) {
    // Not ours to decode: report the canonical state instead.
    return ariAttachmentStatus(deps, attachmentId);
  }

  let derivedStoragePath: string | null = null;
  try {
    const { data: source, error: sourceError } = await withTimeout(
      deps.admin.storage.from(ARI_ATTACHMENT_BUCKET).download(row.storage_path),
      ioTimeoutMs,
      "UPLOAD_INCOMPLETE",
    );
    if (sourceError || !source) {
      throw new AriAttachmentError("UPLOAD_INCOMPLETE");
    }
    const bytes = new Uint8Array(
      await withTimeout(source.arrayBuffer(), ioTimeoutMs, "UPLOAD_INCOMPLETE"),
    );
    const verified = await verify(
      bytes,
      row.declared_mime,
      row.declared_size_bytes,
    );
    const { data: duplicate } = await deps.admin.from("agent_attachments")
      .select("id")
      .eq("user_id", deps.userId)
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
        `${deps.userId}/${row.brand_id}/${attachmentId}/derived`;
      const derivative = new TextEncoder().encode(verified.derivativeText);
      derivedSizeBytes = derivative.byteLength;
      const derivativeDigest = new Uint8Array(
        await crypto.subtle.digest("SHA-256", derivative),
      );
      derivedSha256 = Array.from(derivativeDigest)
        .map((value) => value.toString(16).padStart(2, "0")).join("");
      // D-4: the bucket allowlist names `text/plain` exactly; a charset
      // parameter is rejected by every storage-api release before v1.77.3.
      const { error: derivativeError } = await withTimeout(
        deps.admin.storage.from(ARI_ATTACHMENT_BUCKET).upload(
          derivedStoragePath,
          derivative,
          { contentType: "text/plain", upsert: true },
        ),
        ioTimeoutMs,
        "STORAGE_REJECTED",
      );
      if (derivativeError) throw new AriAttachmentError("STORAGE_REJECTED");
    }
    const readyAt = new Date(now()).toISOString();
    const wrote = await writeTerminal(deps, attachmentId, token, {
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
      ready_at: readyAt,
      updated_at: readyAt,
    });
    if (!wrote) {
      // The lease was swept (or re-claimed) while this request worked. The
      // row's canonical state wins; this late result changes nothing.
      return ariAttachmentStatus(deps, attachmentId);
    }
    return {
      attachment_id: attachmentId,
      filename: row.original_filename,
      state: "ready",
      verified_mime: verified.verifiedMime,
      file_type: verified.fileType,
      size_bytes: verified.sizeBytes,
    };
  } catch (error: unknown) {
    const code = error instanceof AriAttachmentError
      ? error.code
      : "PROCESSING_INTERRUPTED";
    if (!(error instanceof AriAttachmentError)) {
      console.error("ari_attachment_finalize_interrupted", {
        attachmentId,
        category: error instanceof Error ? error.name : "unknown",
      });
    }
    if (derivedStoragePath !== null) {
      const { error: cleanupError } = await deps.admin.storage
        .from(ARI_ATTACHMENT_BUCKET).remove([derivedStoragePath]);
      if (cleanupError) {
        const { error: queueError } = await deps.admin
          .from("agent_attachment_cleanup_jobs")
          .upsert({ storage_path: derivedStoragePath }, {
            onConflict: "storage_path",
            ignoreDuplicates: true,
          });
        console.error("ari_attachment_derivative_cleanup_failed", {
          attachmentId,
          code: cleanupError.message,
          cleanupQueued: queueError === null,
        });
      }
    }
    const wrote = await writeTerminal(deps, attachmentId, token, {
      state: "failed",
      failure_code: code,
      updated_at: new Date(now()).toISOString(),
    });
    if (!wrote) return ariAttachmentStatus(deps, attachmentId);
    return failedOutcome(attachmentId, row.original_filename, code);
  }
}

/**
 * Routes `finalize` and `status` request bodies. A finalize that carries
 * `attachment_ids`, or anything other than one well-formed id, is a 400.
 */
export async function handleAriAttachmentLifecycle(
  deps: AriAttachmentLifecycleDeps,
  body: { action?: unknown; attachment_id?: unknown; attachment_ids?: unknown },
): Promise<AriAttachmentLifecycleResult> {
  if (body.action !== "finalize" && body.action !== "status") {
    return { status: 400, body: { code: "BAD_REQUEST" } };
  }
  if (
    body.attachment_ids !== undefined ||
    typeof body.attachment_id !== "string" ||
    !UUID_PATTERN.test(body.attachment_id)
  ) {
    return { status: 400, body: { code: "BAD_REQUEST" } };
  }
  try {
    const outcome = body.action === "finalize"
      ? await finalizeAriAttachment(deps, body.attachment_id)
      : await ariAttachmentStatus(deps, body.attachment_id);
    return { status: 200, body: { outcome } };
  } catch {
    return { status: 500, body: { code: "ATTACHMENT_STATUS_UNAVAILABLE" } };
  }
}
