// #4382 Wave 2 — the Support desk's reads and writes.
//
// Reads go straight to the tables under RLS (staff read every ticket, message
// and attachment). Every write is a gated RPC or the support-send edge
// function; nothing here inserts or updates a table from the browser.
// Attachments live in the PRIVATE support-attachments bucket and are only ever
// shown through signed links that last one hour.

import {
  invokeWithRefresh,
  isSessionExpiredError,
  SESSION_EXPIRED_MESSAGE,
  supabase,
} from "../lib/supabase";
import { extractFunctionError } from "../lib/edgeFunctionError";
import { escapeLike } from "../lib/formatters";

export const SUPPORT_ATTACHMENT_BUCKET = "support-attachments";
export const SIGNED_URL_SECONDS = 60 * 60;

const TICKET_COLUMNS = [
  "id", "ticket_number", "requester_user_id", "requester_segment", "subject",
  "status", "priority", "assigned_staff_id", "conversation_id", "brand_id",
  "visibility", "origin", "topic", "product_area", "client_meta",
  "imported_from", "last_sender_kind", "created_by", "created_at",
  "first_response_at", "resolved_at", "last_message_at", "next_update_at",
  "next_update_note", "support_workflow_revision",
].join(", ");

function unwrap(result, fallback) {
  if (result.error) throw new Error(result.error.message || fallback);
  return result.data;
}

/** The newest 300 tickets, plus counts of their images and voice notes. */
export async function listSupportTickets() {
  const tickets = unwrap(
    await supabase
      .from("support_tickets")
      .select(TICKET_COLUMNS)
      .order("last_message_at", { ascending: false })
      .limit(300),
    "Couldn't load the support inbox",
  ) || [];
  if (tickets.length === 0) return [];
  const attachments = unwrap(
    await supabase
      .from("support_attachments")
      .select("ticket_id, kind, duration_ms, message_id")
      .in("ticket_id", tickets.map((ticket) => ticket.id))
      .not("message_id", "is", null)
      .limit(3000),
    "Couldn't load ticket attachments",
  ) || [];
  const byTicket = new Map();
  for (const row of attachments) {
    const entry = byTicket.get(row.ticket_id) || { image_count: 0, voice_ms: 0 };
    if (row.kind === "image") entry.image_count += 1;
    if (row.kind === "audio") entry.voice_ms += Number(row.duration_ms || 0);
    byTicket.set(row.ticket_id, entry);
  }
  return tickets.map((ticket) => ({
    ...ticket,
    image_count: byTicket.get(ticket.id)?.image_count || 0,
    voice_ms: byTicket.get(ticket.id)?.voice_ms || 0,
  }));
}

/** Profiles (with segment) and every brand name, for the rows and filters. */
export async function loadInboxLookups(userIds) {
  const [profiles, brands] = await Promise.all([
    userIds.length
      ? supabase
          .from("profiles_with_segment")
          .select("id, display_name, username, email, avatar_url, segment")
          .in("id", userIds)
      : Promise.resolve({ data: [], error: null }),
    supabase.from("brands").select("id, name").is("deleted_at", null).order("name", { ascending: true }).limit(2000),
  ]);
  const profileRows = unwrap(profiles, "Couldn't load people") || [];
  const brandRows = unwrap(brands, "Couldn't load brands") || [];
  return {
    profilesById: Object.fromEntries(profileRows.map((row) => [row.id, row])),
    brandsById: Object.fromEntries(brandRows.map((row) => [row.id, row])),
  };
}

/** A ticket's thread with each message's attachments. */
export async function listTicketThread(ticket) {
  if (!ticket?.conversation_id) return [];
  const [messages, attachments] = await Promise.all([
    supabase
      .from("messages")
      .select("id, conversation_id, sender_id, content, message_type, created_at, deleted_at, is_internal, sender_display_name_snapshot, sender_role_snapshot")
      .eq("conversation_id", ticket.conversation_id)
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .limit(500),
    supabase
      .from("support_attachments")
      .select("id, message_id, storage_path, kind, mime, bytes, width, height, duration_ms, is_internal, import_copied_at, import_source_path, created_at")
      .eq("ticket_id", ticket.id)
      .not("message_id", "is", null)
      .order("created_at", { ascending: true })
      .limit(500),
  ]);
  const messageRows = unwrap(messages, "Couldn't load the conversation") || [];
  const attachmentRows = unwrap(attachments, "Couldn't load the attachments") || [];
  const byMessage = new Map();
  for (const row of attachmentRows) {
    const list = byMessage.get(row.message_id) || [];
    list.push(row);
    byMessage.set(row.message_id, list);
  }
  return messageRows.map((message) => ({ ...message, attachments: byMessage.get(message.id) || [] }));
}

/**
 * One-hour signed links for these storage paths: { [path]: url }. A path the
 * store refuses (for example a beta feedback file not copied yet) is left out.
 */
export async function signAttachmentUrls(paths) {
  const unique = [...new Set((paths || []).filter(Boolean))];
  if (unique.length === 0) return {};
  const { data, error } = await supabase.storage
    .from(SUPPORT_ATTACHMENT_BUCKET)
    .createSignedUrls(unique, SIGNED_URL_SECONDS);
  if (error) throw new Error(error.message || "Couldn't open the attachments");
  return Object.fromEntries((data || []).filter((row) => row.signedUrl && !row.error).map((row) => [row.path, row.signedUrl]));
}

/**
 * Register one prepared image for a ticket (or a ticket still being written,
 * by its client request id), then upload it to the exact path the server
 * chose. Returns the attachment id.
 */
export async function uploadSupportImage({ ticketId, blob, mime, width, height, isInternal, onProgress }) {
  const registered = unwrap(
    await supabase.rpc("issue_4382_register_support_attachment", {
      p_ticket_id: ticketId,
      p_kind: "image",
      p_mime: mime,
      p_bytes: blob.size,
      p_width: width,
      p_height: height,
      p_duration_ms: null,
      p_is_internal: Boolean(isInternal),
    }),
    "Couldn't start the upload",
  );
  onProgress?.(0.15);
  const { error } = await supabase.storage
    .from(registered.bucket || SUPPORT_ATTACHMENT_BUCKET)
    .upload(registered.storage_path, blob, { contentType: mime, upsert: false, cacheControl: "3600" });
  if (error) throw new Error(error.message || "The upload didn't finish");
  onProgress?.(1);
  return registered.attachment_id;
}

/** A support-* function that is not deployed yet: say so, never crash. */
function notDeployed(name) {
  return `Support actions aren't live yet. "${name}" isn't deployed, so this can't be saved until the support functions ship.`;
}

const SEND_ERRORS = {
  ticket_closed: "This ticket is closed, so it can't take new messages.",
  content_required: "Write a message or add an image first.",
  attachment_not_available: "One of the images isn't available any more. Remove it and add it again.",
  attachment_not_uploaded: "An image didn't finish uploading. Remove it, add it again and send.",
  next_update_must_be_future: "Pick a time in the future for the next update.",
  next_update_note_required: "Say what you'll do before then.",
  too_many_attachments: "Up to 10 images per message.",
};

/**
 * Call support-send. Returns { ok, data } or { ok:false, error, sessionExpired }.
 * Never throws.
 */
export async function sendSupportMessage(body) {
  try {
    const { data, error } = await invokeWithRefresh("support-send", { body });
    if (error) {
      const status = error?.context?.status ?? error?.status;
      if (status === 404) return { ok: false, error: notDeployed("support-send") };
      if (isSessionExpiredError(error) || status === 401) {
        return { ok: false, sessionExpired: true, error: SESSION_EXPIRED_MESSAGE };
      }
      const raw = await extractFunctionError(error, "Couldn't send");
      const key = Object.keys(SEND_ERRORS).find((code) => String(raw).includes(code));
      return { ok: false, error: key ? SEND_ERRORS[key] : raw };
    }
    return { ok: true, data };
  } catch (err) {
    if (isSessionExpiredError(err)) return { ok: false, sessionExpired: true, error: SESSION_EXPIRED_MESSAGE };
    return { ok: false, error: err?.message || "Couldn't send" };
  }
}

/** Invoke another support-* function (claim, status) with the same shape. */
export async function invokeSupportFunction(name, body) {
  try {
    const { data, error } = await invokeWithRefresh(name, { body });
    if (error) {
      const status = error?.context?.status ?? error?.status;
      if (status === 404) return { ok: false, error: notDeployed(name) };
      if (isSessionExpiredError(error) || status === 401) {
        return { ok: false, sessionExpired: true, error: SESSION_EXPIRED_MESSAGE };
      }
      return { ok: false, error: await extractFunctionError(error, `${name} failed`) };
    }
    return { ok: true, data };
  } catch (err) {
    if (isSessionExpiredError(err)) return { ok: false, sessionExpired: true, error: SESSION_EXPIRED_MESSAGE };
    return { ok: false, error: err?.message || `${name} failed` };
  }
}

/** People for the New ticket form: name, username or email contains `query`. */
export async function searchPeople(query) {
  const text = String(query || "").trim();
  if (text.length < 2) return [];
  const like = `%${escapeLike(text)}%`;
  return unwrap(
    await supabase
      .from("profiles_with_segment")
      .select("id, display_name, username, email, avatar_url, segment")
      .or(`display_name.ilike.${like},username.ilike.${like},email.ilike.${like}`)
      .limit(8),
    "Couldn't search people",
  ) || [];
}

/** One person's support tickets, newest first (People drawer). */
export async function listPersonSupportTickets(userId) {
  if (!userId) return [];
  return unwrap(
    await supabase
      .from("support_tickets")
      .select("id, ticket_number, subject, status, visibility, origin, requester_segment, last_message_at, created_at")
      .eq("requester_user_id", userId)
      .order("last_message_at", { ascending: false })
      .limit(50),
    "Couldn't load this person's support tickets",
  ) || [];
}
