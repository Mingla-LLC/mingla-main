// Issue #3872 — the one browser caller for the Programs pages (Creators, Gigs,
// Mingla Locals, Disputes). Every call returns data or throws;
// a write that answers {ok:false, error} is thrown as a failure so a page can
// never show a success for it.

import { invokeWithRefresh, supabase } from "../lib/supabase";

export class ProgramWriteError extends Error {
  constructor(result) {
    super(typeof result?.error === "string" ? result.error : "write_failed");
    this.error = result?.error ?? "write_failed";
    this.field = result?.field ?? null;
    this.result = result;
  }
}

async function read(name, params = {}) {
  const { data, error } = await supabase.rpc(name, params);
  if (error) throw error;
  return data;
}

async function write(name, params) {
  const { data, error } = await supabase.rpc(name, params);
  if (error) throw error;
  if (data && typeof data === "object" && data.ok === false) throw new ProgramWriteError(data);
  return data;
}

// ── Creators ────────────────────────────────────────────────────────────────

export async function listCreatorQueue(status = "needs_person") {
  const rows = await read("admin_creator_queue", { p_status: status });
  return Array.isArray(rows) ? rows : [];
}

export function decideCreator(creatorId, decision, note) {
  return write("admin_creator_decide", {
    p_creator_id: creatorId,
    p_decision: decision,
    p_note: note && note.trim() ? note.trim() : null,
  });
}

// ── Program conversations (#4187) ─────────────────────────────────────────

export async function listLocalProgramPeople() {
  const rows = await read("admin_program_local_people");
  return Array.isArray(rows) ? rows : [];
}

export function getProgramConversation(programKind, targetUserId) {
  return write("admin_program_conversation_thread", {
    p_program_kind: programKind,
    p_target_user_id: targetUserId,
  });
}

const PROGRAM_MEDIA_BUCKET = "message-attachments";
const PROGRAM_MEDIA_MAX_BYTES = 25 * 1024 * 1024;
const PROGRAM_MEDIA_MIME = new Map([
  ["image/jpeg", { kind: "image", extension: "jpg" }],
  ["image/png", { kind: "image", extension: "png" }],
  ["image/gif", { kind: "image", extension: "gif" }],
  ["image/webp", { kind: "image", extension: "webp" }],
  ["image/heic", { kind: "image", extension: "heic" }],
  ["image/heif", { kind: "image", extension: "heif" }],
  ["video/mp4", { kind: "video", extension: "mp4" }],
  ["video/quicktime", { kind: "video", extension: "mov" }],
  ["video/x-m4v", { kind: "video", extension: "m4v" }],
  ["video/3gpp", { kind: "video", extension: "3gp" }],
  ["video/webm", { kind: "video", extension: "webm" }],
]);

export function validateProgramMedia(file) {
  const media = file ? PROGRAM_MEDIA_MIME.get(String(file.type || "").toLowerCase()) : null;
  if (!media) throw new ProgramWriteError({ error: "media_type_unsupported" });
  if (!Number.isFinite(file.size) || file.size < 1 || file.size > PROGRAM_MEDIA_MAX_BYTES) {
    throw new ProgramWriteError({ error: "media_size_invalid" });
  }
  return media;
}

export function prepareProgramMediaConversation(programKind, targetUserId) {
  return write("admin_program_media_prepare", {
    p_program_kind: programKind,
    p_target_user_id: targetUserId,
  });
}

export async function uploadProgramMedia({ conversationId, clientId, file }) {
  const media = validateProgramMedia(file);
  const path = `${conversationId}/${clientId}.${media.extension}`;
  const bucket = supabase.storage.from(PROGRAM_MEDIA_BUCKET);
  const { error } = await bucket.upload(path, file, {
    cacheControl: "3600",
    contentType: file.type,
    upsert: false,
  });
  if (error) {
    // A response can be lost after Storage commits the bytes. A retry keeps
    // the same client id/path; only an actual duplicate is treated as landed.
    if (!/already exists|duplicate/i.test(String(error.message || ""))) throw error;
    const { data: proof, error: proofError } = await bucket.createSignedUrl(path, 60);
    if (proofError || !proof?.signedUrl) throw error;
  }
  return {
    path,
    kind: media.kind,
    fileName: String(file.name || `${media.kind}.${media.extension}`).slice(0, 255),
    fileSize: file.size,
  };
}

export async function getProgramMediaUrl(path) {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  const { data, error } = await supabase.storage.from(PROGRAM_MEDIA_BUCKET).createSignedUrl(path, 600);
  if (error) throw error;
  return data?.signedUrl ?? null;
}

export async function downloadProgramMedia(path, fileName) {
  if (!path) throw new ProgramWriteError({ error: "message_media_unavailable" });
  let blob;
  if (/^https?:\/\//i.test(path)) {
    const response = await fetch(path);
    if (!response.ok) throw new ProgramWriteError({ error: "message_media_unavailable" });
    blob = await response.blob();
  } else {
    const { data, error } = await supabase.storage.from(PROGRAM_MEDIA_BUCKET).download(path);
    if (error) throw error;
    blob = data;
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName || "mingla-message-media";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function sendProgramMessage({
  programKind,
  targetUserId,
  content,
  clientId,
  messageType = "text",
  fileUrl = null,
  fileName = null,
  fileSize = null,
  mediaWidth = null,
  mediaHeight = null,
  mediaDurationMs = null,
}) {
  const result = await write("admin_program_message_send", {
    p_program_kind: programKind,
    p_target_user_id: targetUserId,
    p_content: content,
    p_client_id: clientId,
    p_message_type: messageType,
    p_file_url: fileUrl,
    p_file_name: fileName,
    p_file_size: fileSize,
    p_media_width: mediaWidth,
    p_media_height: mediaHeight,
    p_media_duration_ms: mediaDurationMs,
  });

  // The message row is already durable at this point. Push is deliberately a
  // follow-on through the one canonical notification rail, keyed by message id
  // so retrying the same client id cannot create a second notification.
  const { data: { user } } = await supabase.auth.getUser();
  if (user?.id && result?.conversation_id && result?.message?.id) {
    const notification = await invokeWithRefresh("notify-message", {
      body: {
        type: "message",
        senderId: user.id,
        conversationId: result.conversation_id,
        messageId: result.message.id,
        messagePreview: result.message.content || (result.message.message_type === "image" ? "Photo" : "Video"),
      },
    });
    if (notification.error) {
      console.warn("[program-messages] Message saved but push notification was not confirmed", notification.error);
    }
  }

  return result;
}

// ── Gigs ────────────────────────────────────────────────────────────────────

// Not in the #3872 walkthrough contract: the read-only gigs list needs an
// admin-wide list of contracts. Until the server ships it the page says so.
export async function listGigContracts() {
  const rows = await read("admin_gig_list");
  return Array.isArray(rows) ? rows : Array.isArray(rows?.rows) ? rows.rows : [];
}

export function getContractWorkspace(contractId) {
  return read("gig_contract_workspace", { p_contract_id: contractId });
}

export async function getGigQueue() {
  const data = await read("admin_gig_queue");
  return { disputes: data?.disputes ?? [], creator_reviews: data?.creator_reviews ?? [] };
}

/**
 * Decide an escalated dispute. The edge function records the decision through
 * gig_dispute_admin_decide and then moves the money (release or refund).
 */
export async function decideDispute({ disputeId, outcome, refundBps, note }) {
  const { data, error } = await supabase.functions.invoke("gig-dispute-resolve", {
    body: {
      dispute_id: disputeId,
      outcome,
      refund_bps: outcome === "partial_refund" ? refundBps : null,
      note: note && note.trim() ? note.trim() : null,
    },
  });
  if (error) {
    let body = null;
    try { body = await error.context?.json?.(); } catch { body = null; }
    throw new ProgramWriteError({ error: body?.detail ?? body?.error ?? "write_failed" });
  }
  if (data && data.ok === false) throw new ProgramWriteError(data);
  return data;
}

// ── Mingla Locals ───────────────────────────────────────────────────────────

export async function getLocalQueue() {
  const data = await read("admin_local_queue");
  return {
    agreement: data?.agreement ?? null,
    cities: data?.cities ?? [],
    programs: data?.programs ?? [],
    applications: data?.applications ?? [],
    picks: data?.picks ?? [],
    reviews: data?.reviews ?? [],
    payouts: data?.payouts ?? [],
  };
}

export function saveCityProgram({ cityId, seats, isOpen, monthlyRateMinor, payoutCurrency }) {
  return write("local_city_program_save", {
    p_city_id: cityId,
    p_seats: Number(seats),
    p_is_open: Boolean(isOpen),
    p_monthly_rate_minor: monthlyRateMinor,
    p_payout_currency: payoutCurrency,
  });
}

export function decideLocalApplication(applicationId, status) {
  return write("local_application_decide", {
    p_application_id: applicationId,
    p_status: status,
    p_agreement_version: null,
  });
}

export function decideLocalReview(localMonthId, decision, reasons) {
  return write("local_review_decide", {
    p_local_month_id: localMonthId,
    p_decision: decision,
    p_reasons: decision === "changes_requested" ? reasons : [],
  });
}

export function confirmLocalSocialPost(localMonthId, checks) {
  return write("local_social_check_admin_confirm", {
    p_local_month_id: localMonthId,
    p_video_matches: Boolean(checks.videoMatches),
    p_account_matches: Boolean(checks.accountMatches),
    p_has_disclosure: Boolean(checks.hasDisclosure),
    p_has_mingla_collab: Boolean(checks.hasMinglaCollab),
  });
}

export async function getCreatorMediaPlayback(jobId) {
  const { data, error } = await invokeWithRefresh("creator-media-status", {
    body: { jobId },
  });
  if (error) throw new ProgramWriteError({ error: "media_unavailable" });
  if (typeof data?.playback?.url !== "string") {
    throw new ProgramWriteError({ error: "media_unavailable" });
  }
  return {
    status: data.status ?? null,
    url: data.playback.url,
    expiresAt: data.playback.expiresAt ?? null,
  };
}

export function voidLocalMonth(localMonthId, reason) {
  return write("local_month_void", { p_local_month_id: localMonthId, p_reason: reason.trim() });
}

export async function prepareLocalPayout(localMonthId) {
  const { data, error } = await invokeWithRefresh("local-payout", { body: { local_month_id: localMonthId } });
  if (error) throw new ProgramWriteError({ error: "write_failed" });
  if (data && data.ok === false) throw new ProgramWriteError(data);
  return data;
}
