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
  const [signals, reviews, candidates, links, items, commands, drafts, cards] = await Promise.all([
    supabase.from("support_product_signals")
      .select("id,signal_kind,state,title,problem_statement,product_area,user_journey,impact_summary,affected_people,priority,next_update_at,next_step,customer_reply_draft,updated_at,revision")
      .in("signal_kind", ["bug", "feature"])
      .order("updated_at", { ascending: false }).limit(300),
    supabase.from("product_avengers_reviews").select("*"),
    supabase.from("product_avengers_candidates").select("*").order("issue_number", { ascending: false }),
    supabase.from("product_signal_avengers_links").select("signal_id,item_id,link_kind,linked_at"),
    supabase.from("product_avengers_items").select("*"),
    supabase.from("product_avengers_commands").select("id,signal_id,action,state,error_code,requested_at,completed_at").order("requested_at", { ascending: false }).limit(500),
    supabase.from("product_customer_update_drafts").select("*").order("created_at", { ascending: false }).limit(500),
    supabase.from("community_roadmap_cards").select("id,public_title,public_body,internal_note,lane,status,avengers_item_id,source_signal_id,updated_at"),
  ]);
  for (const result of [signals, reviews, candidates, links, items, commands, drafts, cards]) {
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
