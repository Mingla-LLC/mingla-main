import { supabase } from "../lib/supabase";

function unwrap(result, fallback) {
  if (result.error) throw new Error(result.error.message || fallback);
  return result.data;
}

export function createClientRequestId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// [TRANSITIONAL] #4382 Wave 1 — staff threads are internal support tickets
// now (support_tickets.visibility = 'internal') and arrive with the ticket
// list. Exit: Wave 2 rebuilds the inbox and removes this and its callers.
export async function listInternalSupportThreads() {
  return [];
}

export async function listProductSignals() {
  const [signalsResult, sourcesResult] = await Promise.all([
    supabase
      .from("support_product_signals")
      .select("id, signal_kind, state, title, problem_statement, product_area, user_journey, impact_summary, affected_people, priority, owner_user_id, next_update_at, next_step, customer_reply_draft, duplicate_of_signal_id, created_by, created_at, updated_at, revision")
      .order("updated_at", { ascending: false })
      .limit(300),
    supabase
      .from("support_product_signal_sources")
      .select("signal_id, source_kind, source_id, linked_at")
      .order("linked_at", { ascending: true })
      .limit(1000),
  ]);
  const signals = unwrap(signalsResult, "Couldn't load Product signals") || [];
  const sources = unwrap(sourcesResult, "Couldn't load Product signal sources") || [];
  const bySignal = sources.reduce((map, source) => {
    const list = map.get(source.signal_id) || [];
    list.push(source);
    map.set(source.signal_id, list);
    return map;
  }, new Map());
  return signals.map((signal) => ({ ...signal, sources: bySignal.get(signal.id) || [] }));
}

// #4382 — one staff create for every visibility (internal | person | brand).
// Exact parameters: see issue_4382_create_staff_ticket.
export async function createStaffSupportTicket(input) {
  const result = await supabase.rpc("issue_4382_create_staff_ticket", {
    p_client_request_id: input.clientRequestId,
    p_visibility: input.visibility,
    p_subject: input.subject,
    p_details: input.details,
    p_requester_user_id: input.requesterUserId || null,
    p_brand_id: input.brandId || null,
    p_segment: input.segment || null,
    p_priority: input.priority || "normal",
    p_product_area: input.productArea || null,
    p_assigned_staff_id: input.assignedStaffId || null,
    p_next_update_at: input.nextUpdateAt || null,
    p_next_update_note: input.nextUpdateNote || null,
    p_first_message: input.firstMessage || null,
    p_attachment_ids: input.attachmentIds || [],
  });
  return unwrap(result, "Couldn't create the support ticket");
}

// [TRANSITIONAL] #4382 Wave 1 — the old modal's two calls, mapped onto the one
// staff create. The customer email and brand group context ride in the
// internal note. Exit: Wave 2 replaces InternalTicketModal with the new form.
export async function createInternalSupportThread(input) {
  const extra = [
    input.customerEmail ? `Customer: ${input.customerEmail}` : null,
    input.brandGroupContext ? `Brand group: ${input.brandGroupContext}` : null,
  ].filter(Boolean).join("\n");
  return createStaffSupportTicket({
    clientRequestId: input.clientRequestId,
    visibility: "internal",
    subject: input.subject,
    details: extra ? `${input.details}\n\n${extra}` : input.details,
    brandId: input.brandId,
    priority: input.priority,
    nextUpdateAt: input.nextUpdateAt,
    nextUpdateNote: input.nextUpdateNote,
  });
}

export async function createBrandVisibleSupportTicket(input) {
  return createStaffSupportTicket({
    clientRequestId: input.clientRequestId,
    visibility: "brand",
    subject: input.subject,
    details: input.details,
    brandId: input.brandId,
    priority: input.priority,
    nextUpdateAt: input.nextUpdateAt,
    nextUpdateNote: input.nextUpdateNote,
    firstMessage: input.details,
  });
}

export async function setSupportNextUpdate(input) {
  const result = await supabase.rpc("issue_3720_set_next_update", {
    p_source_kind: input.sourceKind,
    p_source_id: input.sourceId,
    p_expected_revision: input.expectedRevision,
    p_next_update_at: input.nextUpdateAt,
    p_next_update_note: input.nextUpdateNote,
  });
  return unwrap(result, "Couldn't set the next update");
}

// [TRANSITIONAL] #4382 Wave 1 — staff threads no longer exist, so nothing
// reaches these (listInternalSupportThreads returns none). They refuse
// rather than call a removed function. Exit: Wave 2 deletes them.
export async function updateInternalSupportThread() {
  throw new Error("Staff threads are support tickets now. Reload the Support desk.");
}

export async function reassignInternalSupportThread() {
  throw new Error("Staff threads are support tickets now. Reload the Support desk.");
}

export async function reassignProductSignal(input) {
  const result = await supabase.rpc("issue_3988_reassign_product_signal", {
    p_signal_id: input.signalId,
    p_expected_revision: input.expectedRevision,
    p_owner_user_id: input.ownerUserId,
  });
  return unwrap(result, "Couldn't reassign the Product signal");
}

export async function createProductSignal(input) {
  const rpcName = input.sourceKind === "brand_group_message"
    ? "issue_3720_create_brand_message_product_signal"
    : "issue_3720_create_product_signal";
  const params = input.sourceKind === "brand_group_message" ? {
    p_client_request_id: input.clientRequestId,
    p_source_id: input.sourceId,
    p_signal_kind: input.signalKind,
    p_title: input.title,
    p_problem_statement: input.problemStatement,
    p_product_area: input.productArea,
    p_user_journey: input.userJourney,
    p_impact_summary: input.impactSummary,
    p_affected_people: input.affectedPeople,
    p_priority: input.priority,
    p_next_update_at: input.nextUpdateAt,
    p_next_step: input.nextStep,
    p_customer_reply_draft: input.customerReplyDraft,
  } : {
    p_client_request_id: input.clientRequestId,
    p_source_kind: input.sourceKind,
    p_source_id: input.sourceId,
    p_signal_kind: input.signalKind,
    p_title: input.title,
    p_problem_statement: input.problemStatement,
    p_product_area: input.productArea,
    p_user_journey: input.userJourney,
    p_impact_summary: input.impactSummary,
    p_affected_people: input.affectedPeople,
    p_priority: input.priority,
    p_next_update_at: input.nextUpdateAt,
    p_next_step: input.nextStep,
    p_customer_reply_draft: input.customerReplyDraft,
  };
  const result = await supabase.rpc(rpcName, params);
  return unwrap(result, "Couldn't create the Product signal");
}

export async function updateProductSignal(input) {
  const result = await supabase.rpc("issue_3720_update_product_signal", {
    p_signal_id: input.signalId,
    p_expected_revision: input.expectedRevision,
    p_state: input.state,
    p_priority: input.priority,
    p_next_update_at: input.nextUpdateAt,
    p_next_step: input.nextStep,
    p_customer_reply_draft: input.customerReplyDraft,
  });
  return unwrap(result, "Couldn't update the Product signal");
}

export async function linkSourceToProductSignal(input) {
  const brandMessage = input.sourceKind === "brand_group_message";
  const result = await supabase.rpc(
    brandMessage ? "issue_3720_link_brand_message_product_signal" : "issue_3720_link_product_signal_source",
    brandMessage ? {
      p_signal_id: input.signalId,
      p_expected_revision: input.expectedRevision,
      p_source_id: input.sourceId,
    } : {
    p_signal_id: input.signalId,
    p_expected_revision: input.expectedRevision,
    p_source_kind: input.sourceKind,
    p_source_id: input.sourceId,
    },
  );
  return unwrap(result, "Couldn't link the report to the Product signal");
}
