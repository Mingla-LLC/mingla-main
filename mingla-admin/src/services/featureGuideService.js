import { supabase } from "../lib/supabase";

function unwrap(result, fallback) {
  if (result.error) throw new Error(result.error.message || fallback);
  return result.data;
}

function lines(value) {
  return String(value || "")
    .split("\n")
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean);
}

export async function listFeatureGuide(query = "") {
  return unwrap(
    await supabase.rpc("issue_3720_list_feature_guide", {
      p_query: query.trim() || null,
    }),
    "Could not load the Feature Guide",
  );
}

export async function getFeatureGuideFreshness() {
  return unwrap(
    await supabase.rpc("issue_4179_feature_guide_freshness"),
    "Could not verify Feature Guide merge coverage",
  );
}

export async function saveFeatureCapability(form) {
  return unwrap(
    await supabase.rpc("issue_3720_save_feature_capability", {
      p_capability_key: form.capabilityKey.trim(),
      p_expected_revision: form.revision || 0,
      p_title: form.title.trim(),
      p_outcome_summary: form.outcomeSummary.trim(),
      p_who_can_use: lines(form.whoCanUse),
      p_surfaces: lines(form.surfaces),
      p_how_to: form.howTo.trim(),
      p_limitations: form.limitations.trim(),
      p_support_wording: form.supportWording.trim(),
      p_claimed_status: form.claimedStatus,
      p_required_evidence_kinds: lines(form.requiredEvidenceKinds),
      p_verification_due_at: form.verificationDueAt
        ? new Date(form.verificationDueAt).toISOString()
        : null,
    }),
    "Could not save the capability",
  );
}

export async function recordFeatureEvidence(capabilityId, revision, form) {
  return unwrap(
    await supabase.rpc("issue_3720_record_feature_evidence", {
      p_capability_id: capabilityId,
      p_expected_revision: revision,
      p_evidence_kind: form.kind,
      p_evidence_url: form.url.trim(),
      p_verdict: form.verdict,
      p_details: form.details.trim(),
      p_observed_at: new Date(form.observedAt).toISOString(),
      p_expires_at: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
    }),
    "Could not record the evidence",
  );
}
