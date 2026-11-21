// Issue #4420 (Host polish pass, part 2 §4.6) — `copy_to_support`: the photo
// a host sent Ari goes with them to their support conversation.
//
// The copy happens here, on the server, between the two private buckets;
// nothing is re-uploaded from the phone. The caller may copy only their own
// finalized Ari image, only into a support conversation they can see, and
// only within the support limits (PNG, JPEG, WebP or HEIC, at most 10 MB).
// The support attachment is registered as the caller (the #4382 RPC fixes
// its path), then the bytes are copied into exactly that path. A refusal
// before registering writes nothing; a failed copy after it leaves an unsent
// registration for the existing purge, never a half-attached message.
//
// Clients are structural types (no supabase-js import) so the unit test can
// drive every branch without a network.

export const SUPPORT_ATTACHMENT_BUCKET = "support-attachments";
export const SUPPORT_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const SUPPORT_IMAGE_MIMES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/heic",
]);

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface QueryResult<T> {
  data: T | null;
  error: unknown;
}

interface SelectChain {
  eq(column: string, value: string): SelectChain;
  maybeSingle(): PromiseLike<QueryResult<unknown>>;
}

interface StorageBucketLike {
  download(path: string): PromiseLike<QueryResult<Blob>>;
  upload(
    path: string,
    body: Uint8Array,
    options: { contentType: string; upsert: boolean },
  ): PromiseLike<QueryResult<unknown>>;
}

export interface CopyToSupportAdmin {
  from(table: "agent_attachments"): {
    select(columns: string): SelectChain;
  };
  rpc(
    fn: "issue_4382_customer_can_view_ticket",
    args: { p_ticket_id: string; p_user_id: string },
  ): PromiseLike<QueryResult<unknown>>;
  storage: { from(bucket: string): StorageBucketLike };
}

export interface CopyToSupportCaller {
  rpc(
    fn: "issue_4382_register_support_attachment",
    args: {
      p_ticket_id: string;
      p_kind: "image";
      p_mime: string;
      p_bytes: number;
    },
  ): PromiseLike<QueryResult<unknown>>;
}

export interface CopyToSupportDeps {
  admin: CopyToSupportAdmin;
  /** A client acting as the caller (their JWT), for the #4382 register RPC. */
  caller: CopyToSupportCaller;
  userId: string;
  ariBucket: string;
  /** The same brand-access check the `open` action applies. */
  canAccessBrand(brandId: string): Promise<boolean>;
}

export interface CopyToSupportResult {
  status: number;
  body: Record<string, unknown>;
}

interface OwnedAriAttachment {
  id: string;
  user_id: string;
  brand_id: string;
  storage_path: string;
  state: string;
  file_type: string | null;
  verified_mime: string | null;
  verified_size_bytes: number | null;
  sha256: string | null;
}

const OWNED_COLUMNS =
  "id,user_id,brand_id,storage_path,state,file_type,verified_mime,verified_size_bytes,sha256";

function refuse(
  status: number,
  code: string,
  message: string,
): CopyToSupportResult {
  return { status, body: { code, message } };
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest).map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function registerRefusal(error: unknown): CopyToSupportResult {
  const message = error && typeof error === "object" && "message" in error
    ? String((error as { message: unknown }).message)
    : "";
  if (message.includes("ticket_closed")) {
    return refuse(
      409,
      "TICKET_CLOSED",
      "This conversation is closed. Start a new one to send a photo.",
    );
  }
  if (message.includes("too_many_pending_uploads")) {
    return refuse(
      429,
      "TOO_MANY_UPLOADS",
      "Too many photos are waiting to send. Send them, then try again.",
    );
  }
  if (message.includes("forbidden")) {
    return refuse(
      403,
      "TICKET_FORBIDDEN",
      "This photo can only go to your own support conversation.",
    );
  }
  if (
    message.includes("attachment_too_large") ||
    message.includes("attachment_type_not_allowed")
  ) {
    return refuse(
      400,
      "UNSUPPORTED_FOR_SUPPORT",
      "Support takes PNG, JPEG, WebP or HEIC photos up to 10 MB.",
    );
  }
  return refuse(
    500,
    "REGISTER_FAILED",
    "The photo could not be added to the conversation. Try again.",
  );
}

/** `copy_to_support` for one Ari attachment into one support conversation. */
export async function copyAriAttachmentToSupport(
  deps: CopyToSupportDeps,
  body: { attachment_id?: unknown; ticket_id?: unknown },
): Promise<CopyToSupportResult> {
  const attachmentId = body.attachment_id;
  const ticketId = body.ticket_id;
  if (
    typeof attachmentId !== "string" || !UUID_PATTERN.test(attachmentId) ||
    typeof ticketId !== "string" || !UUID_PATTERN.test(ticketId)
  ) {
    return refuse(
      400,
      "BAD_REQUEST",
      "attachment_id and ticket_id are required.",
    );
  }

  // 1. The caller's own, finalized Ari attachment.
  const { data: ownedData } = await deps.admin.from("agent_attachments")
    .select(OWNED_COLUMNS)
    .eq("id", attachmentId)
    .eq("user_id", deps.userId)
    .maybeSingle();
  const owned = ownedData as OwnedAriAttachment | null;
  if (
    !owned || owned.user_id !== deps.userId ||
    !owned.storage_path.startsWith(`${deps.userId}/`)
  ) {
    return refuse(404, "NOT_FOUND", "That photo could not be found.");
  }
  if (!(await deps.canAccessBrand(owned.brand_id))) {
    return refuse(403, "FORBIDDEN", "That photo could not be found.");
  }
  if (owned.state !== "ready") {
    return refuse(
      409,
      "ATTACHMENT_NOT_READY",
      "That photo is still being checked.",
    );
  }

  // 2. Within the support limits.
  const mime = (owned.verified_mime ?? "").toLowerCase();
  const bytes = owned.verified_size_bytes;
  if (owned.file_type !== "image" || !SUPPORT_IMAGE_MIMES.has(mime)) {
    return refuse(
      400,
      "UNSUPPORTED_FOR_SUPPORT",
      "Support takes PNG, JPEG, WebP or HEIC photos up to 10 MB.",
    );
  }
  if (
    typeof bytes !== "number" || !Number.isInteger(bytes) || bytes < 1 ||
    bytes > SUPPORT_IMAGE_MAX_BYTES
  ) {
    return refuse(
      400,
      "FILE_TOO_LARGE",
      "Support takes PNG, JPEG, WebP or HEIC photos up to 10 MB.",
    );
  }

  // 3. A conversation the caller can see as its customer.
  const { data: canView, error: viewError } = await deps.admin.rpc(
    "issue_4382_customer_can_view_ticket",
    { p_ticket_id: ticketId, p_user_id: deps.userId },
  );
  if (viewError) {
    return refuse(500, "TICKET_CHECK_FAILED", "Try again in a moment.");
  }
  if (canView !== true) {
    return refuse(
      403,
      "TICKET_FORBIDDEN",
      "This photo can only go to your own support conversation.",
    );
  }

  // 4. Read the bytes Ari verified; they must still be exactly those bytes.
  const { data: source, error: downloadError } = await deps.admin.storage
    .from(deps.ariBucket).download(owned.storage_path);
  if (downloadError || !source) {
    return refuse(
      500,
      "COPY_FAILED",
      "The photo could not be copied. Try again.",
    );
  }
  const content = new Uint8Array(await source.arrayBuffer());
  if (
    content.byteLength !== bytes ||
    content.byteLength > SUPPORT_IMAGE_MAX_BYTES ||
    !owned.sha256 || (await sha256Hex(content)) !== owned.sha256
  ) {
    return refuse(
      409,
      "ATTACHMENT_CHANGED",
      "That photo changed. Add it again.",
    );
  }

  // 5. Register as the caller (the #4382 RPC re-checks the conversation and
  //    the limits, and fixes the path), then copy into exactly that path.
  const { data: registered, error: registerError } = await deps.caller.rpc(
    "issue_4382_register_support_attachment",
    { p_ticket_id: ticketId, p_kind: "image", p_mime: mime, p_bytes: bytes },
  );
  if (registerError) return registerRefusal(registerError);
  const row = registered && typeof registered === "object"
    ? registered as Record<string, unknown>
    : null;
  const supportAttachmentId = row?.attachment_id;
  const supportPath = row?.storage_path;
  if (
    !row || row.draft === true || typeof supportAttachmentId !== "string" ||
    typeof supportPath !== "string" ||
    !supportPath.startsWith(`${ticketId}/`)
  ) {
    return refuse(
      500,
      "REGISTER_FAILED",
      "The photo could not be added. Try again.",
    );
  }
  const { error: uploadError } = await deps.admin.storage
    .from(SUPPORT_ATTACHMENT_BUCKET)
    .upload(supportPath, content, { contentType: mime, upsert: false });
  if (uploadError) {
    return refuse(
      500,
      "COPY_FAILED",
      "The photo could not be copied. Try again.",
    );
  }
  return {
    status: 200,
    body: { support_attachment_id: supportAttachmentId, ticket_id: ticketId },
  };
}
