import { invokeWithRefresh, supabase } from "../lib/supabase";
import { createClientRequestId } from "./supportProductWorkflowService";

function unwrap(result, fallback) {
  if (result.error) throw new Error(result.error.message || fallback);
  return result.data;
}

function oneBy(rows, key) {
  return new Map((rows || []).map((row) => [row[key], row]));
}

export async function listProductAvengersWorkspace() {
  // #4382 Wave 3: every Product item is on the board (questions too), with
  // its reporters (linked tickets and Community ideas).
  const [signals, reviews, candidates, links, items, commands, drafts, cards, sources] = await Promise.all([
    supabase.from("support_product_signals")
      .select("id,signal_kind,state,title,problem_statement,product_area,user_journey,impact_summary,affected_people,priority,owner_user_id,next_update_at,next_step,customer_reply_draft,wont_do_reason,told_at,told_ticket_count,created_at,updated_at,revision")
      .order("updated_at", { ascending: false }).limit(300),
    supabase.from("product_avengers_reviews").select("*"),
    supabase.from("product_avengers_candidates").select("*").order("issue_number", { ascending: false }),
    supabase.from("product_signal_avengers_links").select("signal_id,item_id,link_kind,linked_at"),
    supabase.from("product_avengers_items").select("*"),
    supabase.from("product_avengers_commands").select("id,signal_id,action,state,error_code,requested_at,completed_at").order("requested_at", { ascending: false }).limit(500),
    supabase.from("product_customer_update_drafts").select("*").order("created_at", { ascending: false }).limit(500),
    supabase.from("community_roadmap_cards").select("id,public_title,public_body,lane,status,avengers_item_id,source_signal_id,updated_at"),
    supabase.from("support_product_signal_sources").select("signal_id,source_kind,source_id,linked_at").order("linked_at", { ascending: true }).limit(2000),
  ]);
  for (const result of [signals, reviews, candidates, links, items, commands, drafts, cards, sources]) {
    if (result.error) throw new Error(result.error.message || "Couldn't load Product Inbox");
  }
  const reviewBySignal = oneBy(reviews.data, "signal_id");
  const linkBySignal = oneBy(links.data, "signal_id");
  const itemById = oneBy(items.data, "id");
  const cardByItem = oneBy(cards.data, "avengers_item_id");
  return (signals.data || []).map((signal) => {
    const link = linkBySignal.get(signal.id) || null;
    const item = link ? itemById.get(link.item_id) || null : null;
    return {
      ...signal,
      review: reviewBySignal.get(signal.id) || null,
      candidates: (candidates.data || []).filter((row) => row.signal_id === signal.id),
      link,
      item,
      commands: (commands.data || []).filter((row) => row.signal_id === signal.id),
      drafts: (drafts.data || []).filter((row) => row.signal_id === signal.id),
      roadmap: item ? cardByItem.get(item.id) || null : null,
      sources: (sources.data || []).filter((row) => row.signal_id === signal.id),
    };
  });
}

export async function savePublicProductReview(signalId, form, expectedRevision) {
  return unwrap(await supabase.rpc("issue_3720_save_product_avengers_review", {
    p_signal_id: signalId,
    p_expected_revision: expectedRevision,
    p_public_title: form.publicTitle,
    p_public_problem_statement: form.publicProblem,
    p_public_outcome: form.publicOutcome,
    p_public_acceptance_criteria: form.acceptanceCriteria
      .split("\n").map((line) => line.replace(/^[-*]\s*/, "").trim()).filter(Boolean),
    p_board_product: form.product,
    p_board_theme: form.theme,
    p_board_priority: form.priority,
    p_board_estimate: form.estimate,
    p_board_horizon: form.horizon,
    p_board_quarter: form.quarter,
  }), "Couldn't save the public-safe review");
}

export async function recordCandidateDecision(signalId, issueNumber, decision, reason = null) {
  return unwrap(await supabase.rpc("issue_3720_record_product_avengers_candidate", {
    p_signal_id: signalId,
    p_issue_number: issueNumber,
    p_decision: decision,
    p_reason: reason,
  }), "Couldn't record the issue decision");
}

export async function saveNoFitReason(signalId, reason) {
  return unwrap(await supabase.rpc("issue_3720_set_product_avengers_no_fit", {
    p_signal_id: signalId,
    p_reason: reason,
  }), "Couldn't confirm the search result");
}

export async function runProductAvengersCommand(signalId, action, payload = {}) {
  const commandId = unwrap(await supabase.rpc("issue_3720_queue_product_avengers_command", {
    p_signal_id: signalId,
    p_action: action,
    p_payload: payload,
    p_request_key: createClientRequestId(),
  }), "Couldn't queue the Avengers action");
  const result = await invokeWithRefresh("product-avengers-sync", {
    body: { mode: "command", command_id: commandId },
  });
  if (result.error) throw new Error(result.error.message || "The Avengers action did not complete");
  if (!result.data?.ok) throw new Error(result.data?.code || "The Avengers action did not complete");
  return result.data;
}

export async function saveRoadmapWording(signalId, publicTitle, publicBody) {
  return unwrap(await supabase.rpc("issue_3720_save_product_roadmap_wording", {
    p_signal_id: signalId,
    p_public_title: publicTitle,
    p_public_body: publicBody,
  }), "Couldn't save the Roadmap draft");
}

export async function approveCustomerDraft(draftId, body) {
  return unwrap(await supabase.rpc("issue_3720_approve_product_customer_draft", {
    p_draft_id: draftId,
    p_body: body,
  }), "Couldn't approve the customer-safe draft");
}

export async function verifyProductRelease(signalId, evidenceUrl) {
  return unwrap(await supabase.rpc("issue_3720_verify_product_release", {
    p_signal_id: signalId,
    p_release_evidence_url: evidenceUrl,
  }), "Couldn't verify the release record");
}

// #4382 Wave 3 — the tickets behind the board's reporters, by id.
export async function listReporterTickets(ticketIds) {
  const ids = [...new Set((ticketIds || []).filter(Boolean))];
  if (ids.length === 0) return {};
  const rows = unwrap(await supabase.from("support_tickets")
    .select("id,ticket_number,subject,status,visibility,origin,requester_user_id,requester_segment,brand_id")
    .in("id", ids), "Couldn't load the reporters' tickets") || [];
  const userIds = [...new Set(rows.map((row) => row.requester_user_id).filter(Boolean))];
  const brandIds = [...new Set(rows.map((row) => row.brand_id).filter(Boolean))];
  const [profiles, brands] = await Promise.all([
    userIds.length ? supabase.from("profiles_with_segment").select("id,display_name,username,email").in("id", userIds) : Promise.resolve({ data: [], error: null }),
    brandIds.length ? supabase.from("brands").select("id,name").in("id", brandIds) : Promise.resolve({ data: [], error: null }),
  ]);
  const profileById = oneBy(unwrap(profiles, "Couldn't load reporters"), "id");
  const brandById = oneBy(unwrap(brands, "Couldn't load brands"), "id");
  return Object.fromEntries(rows.map((row) => {
    const person = profileById.get(row.requester_user_id);
    return [row.id, {
      ...row,
      person_name: person?.display_name || person?.username || person?.email || null,
      brand_name: brandById.get(row.brand_id)?.name || null,
    }];
  }));
}

// #4382 Wave 3 — Won't do, with a reason written for reporters.
export async function setProductWontDo(signalId, expectedRevision, reason) {
  return unwrap(await supabase.rpc("issue_4382_set_wont_do", {
    p_signal_id: signalId,
    p_expected_revision: expectedRevision,
    p_reason: reason,
  }), "Couldn't mark this Won't do");
}

// #4382 Wave 3 (D2) — Tell reporters, once. The server posts the approved
// wording into every linked customer-visible ticket, resolves them and marks
// the item Told; a second call is refused (already_told).
export async function tellProductReporters(signalId, draftId) {
  return unwrap(await supabase.rpc("issue_4382_tell_reporters", {
    p_signal_id: signalId,
    p_draft_id: draftId,
  }), "Couldn't tell the reporters");
}
