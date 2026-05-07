/**
 * Append-only audit_log writer.
 * Per SPEC_BIZ_CYCLE_B2A_STRIPE_CONNECT_ONBOARDING.md §4.2.1 + BUSINESS_PROJECT_PLAN §B.7.
 *
 * The audit_log table has trg_audit_log_block_update trigger preventing
 * non-service-role UPDATE/DELETE. Only service-role INSERT is the supported
 * mutation. Edge functions running with service role can call this freely.
 *
 * Throws on insert failure per Const #3 (no silent failures). Caller
 * (typically an edge function) maps to user-facing error response.
 *
 * Use sites in B2a:
 *  - brand-stripe-onboard: action="stripe_connect.onboard_initiated"
 *  - stripe-webhook: action="stripe_connect.account_updated" or "*.kyc_complete"
 */

// @ts-ignore — Deno ESM import; types resolved at runtime
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface AuditWriteInput {
  user_id: string | null;
  brand_id: string | null;
  event_id?: string | null;
  action: string; // e.g., "stripe_connect.onboard_initiated"
  target_type: string; // e.g., "stripe_connect_account"
  target_id: string;
  before?: object | null;
  after?: object | null;
  ip?: string | null;
  user_agent?: string | null;
}

export async function writeAudit(
  supabase: SupabaseClient,
  input: AuditWriteInput,
): Promise<void> {
  const { error } = await supabase.from("audit_log").insert({
    user_id: input.user_id,
    brand_id: input.brand_id,
    event_id: input.event_id ?? null,
    action: input.action,
    target_type: input.target_type,
    target_id: input.target_id,
    before: input.before ?? null,
    after: input.after ?? null,
    ip: input.ip ?? null,
    user_agent: input.user_agent ?? null,
  });
  if (error) {
    throw new Error(
      `writeAudit failed for action=${input.action} target=${input.target_id}: ${error.message}`,
    );
  }
}
