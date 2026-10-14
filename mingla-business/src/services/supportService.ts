/**
 * supportService — META-ORCH-1104 Phase 1 (business requester).
 *
 * The requester-side data access for support tickets. A support ticket OWNS a
 * `conversations` row (SPEC §2.1/§2.10); reads reuse `groupChatService.listMessages`,
 * and sends go through `support-send` (#3720) so audit + push fire.
 *
 * Identity spine = `auth.uid()` end-to-end (SPEC D1). RLS lets a requester read
 * ONLY their own tickets (`support_tickets_requester_read`, SPEC §2.7) and mint a
 * ticket via the live `create_support_ticket(p_subject, p_brand_id)` SECURITY
 * DEFINER RPC (SPEC §2.8). This service NEVER returns a fallback on error — it
 * throws so the React Query hook surfaces the failure (Prime Directive #5).
 *
 * Per SPEC §5.1 (Lane C Finding 2.3).
 */

import { supabase } from "./supabase";

/** A support ticket as the requester sees it (their own rows only, via RLS). */
export interface SupportTicket {
  id: string;
  subject: string;
  /** new | open | pending | resolved | closed (support_tickets.status CHECK). */
  status: string;
  /** low | normal | high | urgent (support_tickets.priority CHECK). */
  priority: string;
  conversation_id: string;
  brand_id: string | null;
  created_at: string;
  last_message_at: string;
  resolved_at: string | null;
}

/**
 * List the signed-in user's OWN support tickets, newest activity first.
 * RLS (`support_tickets_requester_read`) restricts the result to the caller's
 * own rows — a foreign ticket id is simply absent, never an error.
 */
export async function listOwnSupportTickets(): Promise<SupportTicket[]> {
  const { data, error } = await supabase
    .from("support_tickets")
    .select(
      "id, subject, status, priority, conversation_id, brand_id, created_at, last_message_at, resolved_at",
    )
    .order("last_message_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as SupportTicket[];
}

/**
 * Read a single ticket the caller owns (used by the thread route to resolve the
 * ticket's `conversation_id`). Returns null when the row is absent OR RLS hides
 * it (a foreign / deep-linked ticket id) — the caller renders a not-found state,
 * never a crash (SPEC T-1.7 adversarial).
 */
export async function getOwnSupportTicket(
  ticketId: string,
): Promise<SupportTicket | null> {
  const { data, error } = await supabase
    .from("support_tickets")
    .select(
      "id, subject, status, priority, conversation_id, brand_id, created_at, last_message_at, resolved_at",
    )
    .eq("id", ticketId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as SupportTicket | null) ?? null;
}

/**
 * Mint a new support ticket via the LIVE `create_support_ticket` RPC. The RPC
 * creates the conversation, seeds the requester as a participant, and returns
 * the new ticket id (SPEC §2.8). The subject is validated server-side (the RPC
 * RAISEs on an empty/blank subject) and clamped to 200 chars.
 */
export async function createSupportTicket(
  subject: string,
  brandId?: string | null,
): Promise<string> {
  const trimmed = subject.trim();
  if (trimmed.length === 0) {
    throw new Error("Add a short subject so we know what you need help with.");
  }
  const { data, error } = await supabase.rpc("create_support_ticket", {
    p_subject: trimmed,
    p_brand_id: brandId ?? null,
  });
  if (error) throw new Error(error.message);
  if (typeof data !== "string" || data.length === 0) {
    throw new Error("Couldn't start the chat. Tap to try again.");
  }
  return data;
}

/**
 * @deprecated #3720 — new-ticket staff push is server-side
 * (`tg_support_ticket_notify_staff` → notify-support with the service-role
 * bearer). Kept as a no-op so older callers / tests that still invoke it do not
 * hit the service-role-only edge with a user JWT (which returned 401).
 */
export async function notifyNewSupportTicket(_ticketId: string): Promise<void> {
  return;
}

/**
 * Send a support thread message via `support-send` so timestamps, audit and
 * push all happen server-side (#3720 Phase 0 bugs 2–3). Never insert into
 * `messages` directly from the Host app for support tickets.
 */
export async function sendSupportMessage(
  ticketId: string,
  content: string,
): Promise<void> {
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    throw new Error("Write a message before sending.");
  }
  const { data, error } = await supabase.functions.invoke("support-send", {
    body: { ticketId, content: trimmed },
  });
  if (error) {
    throw new Error(error.message || "Couldn't send your message. Try again.");
  }
  if (data && typeof data === "object" && "error" in data) {
    const errVal = (data as { error?: unknown }).error;
    const msg = typeof errVal === "string" ? errVal : "Couldn't send your message.";
    throw new Error(msg);
  }
}
