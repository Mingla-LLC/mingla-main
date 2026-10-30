import { supabase } from "../lib/supabase";

function unwrap(result) {
  if (result.error) throw result.error;
  return result.data;
}

export async function loadAriImprovementWorkspace(limit = 50) {
  return unwrap(await supabase.rpc("ari_admin_improvement_workspace", {
    p_limit: limit,
  }));
}

export async function loadAriQualityCase(caseId, reason) {
  return unwrap(await supabase.rpc("ari_admin_quality_case", {
    p_case_id: caseId,
    p_reason: reason,
  }));
}

export async function updateAriQualityCase(caseId, patch, reason) {
  return unwrap(await supabase.rpc("ari_admin_update_quality_case", {
    p_case_id: caseId,
    p_status: patch.status ?? null,
    p_severity: patch.severity ?? null,
    p_root_cause: patch.root_cause ?? null,
    p_capability_id: patch.capability_id ?? null,
    p_linked_issue_number: patch.linked_issue_number ?? null,
    p_reason: reason,
  }));
}

export async function createAriImprovementProposal(input, reason) {
  return unwrap(await supabase.rpc("ari_admin_create_improvement_proposal", {
    p_case_id: input.case_id ?? null,
    p_capability_gap_id: input.capability_gap_id ?? null,
    p_proposal_type: input.proposal_type,
    p_title: input.title,
    p_hypothesis: input.hypothesis ?? "",
    p_change_spec: input.change_spec ?? {},
    p_expected_outcome: input.expected_outcome ?? "",
    p_risk_level: input.risk_level ?? "medium",
    p_evaluation_gate: input.evaluation_gate ?? {},
    p_reason: reason,
  }));
}

export async function transitionAriImprovementProposal(proposalId, status, reason) {
  return unwrap(await supabase.rpc("ari_admin_transition_improvement_proposal", {
    p_proposal_id: proposalId,
    p_status: status,
    p_reason: reason,
  }));
}

export async function createAriRuntimeVersion(input, reason) {
  return unwrap(await supabase.rpc("ari_admin_create_runtime_version", {
    p_proposal_id: input.proposal_id,
    p_version_key: input.version_key,
    p_kind: input.kind,
    p_parent_version_id: input.parent_version_id ?? null,
    p_config: input.config ?? {},
    p_config_digest: input.config_digest,
    p_reason: reason,
  }));
}

export async function startAriEvaluation(input, reason) {
  return unwrap(await supabase.rpc("ari_admin_start_evaluation", {
    p_mode: input.mode,
    p_candidate_version_id: input.candidate_version_id ?? null,
    p_proposal_id: input.proposal_id ?? null,
    p_reason: reason,
  }));
}

export async function finishAriEvaluation(runId, results, reason) {
  return unwrap(await supabase.rpc("ari_admin_finish_evaluation", {
    p_run_id: runId,
    p_results: results,
    p_reason: reason,
  }));
}

export async function cancelAriEvaluation(runId, reason) {
  return unwrap(await supabase.rpc("ari_admin_cancel_evaluation", {
    p_run_id: runId,
    p_reason: reason,
  }));
}

export async function controlAriRollout(input, reason) {
  return unwrap(await supabase.rpc("ari_admin_control_rollout", {
    p_action: input.action,
    p_rollout_id: input.rollout_id ?? null,
    p_runtime_version_id: input.runtime_version_id ?? null,
    p_rollout_percent: input.rollout_percent ?? null,
    p_audience: input.audience ?? {},
    p_guardrails: input.guardrails ?? {},
    p_rollback_version_id: input.rollback_version_id ?? null,
    p_reason: reason,
  }));
}
