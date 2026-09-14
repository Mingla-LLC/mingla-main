/**
 * ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] — refund policy +
 * booking deadline service layer.
 *
 * Both updates are operator-only (RLS gates by brand membership via the
 * existing biz_is_brand_member_for_caller policies on public.events).
 * Service writes directly via supabase-js (no edge function needed) because the
 * CHECK constraint events_refund_policy_valid (calling validate_refund_policy)
 * enforces I-PROPOSED-TR4-REFUND-CASCADE-MONOTONICITY at DB-write time. Bad
 * policy JSONB raises 23514 (check_violation) which we map to a user-friendly
 * error. Both writes verify rowcount via select+maybeSingle (I-PROPOSED-I) and
 * scope to event_type='trip' (I-PROPOSED-TR2-EVENTS-TYPE-FILTER).
 *
 * Per SPEC_ORCH-0875 §3.3.2.
 */

import { supabase } from "./supabase";
import type {
  OfferingRefundPolicyFailureReason,
  RefundPolicy,
  RefundPolicyServiceError,
  SetOfferingRefundPolicyResult,
} from "./refundPolicyModel";

// issue #3284 [bundle budget] — this module holds ONLY the network writers. The
// types and presets live in refundPolicyModel.ts (re-exported below as TYPES only,
// which the build erases), and the pre-fill tier rule lives in
// utils/refundPolicyPrefill.ts. App code reaches these writers only through the
// lazy services/refundPolicyWrites.ts; a static value import of this file from
// app code puts the writers back in the boot payload (ORCH-1083).
export type {
  OfferingRefundPolicyFailureReason,
  RefundPolicy,
  RefundPolicyKind,
  RefundPolicyServiceError,
  RefundPolicyTier,
  SetOfferingRefundPolicyResult,
} from "./refundPolicyModel";

const makeError = (
  code: RefundPolicyServiceError["code"],
  message: string,
  detail?: string,
): RefundPolicyServiceError => {
  const err = new Error(message) as RefundPolicyServiceError;
  err.code = code;
  if (detail !== undefined) err.detail = detail;
  return err;
};

/**
 * Map PostgREST/Postgres errors to typed RefundPolicyServiceError. The
 * validate_refund_policy IMMUTABLE function (per migration 20260612000000
 * §3.1.I) RAISEs with specific messages we discriminate on.
 */
function mapPgError(error: unknown): RefundPolicyServiceError {
  const message =
    error instanceof Error ? error.message : String(error ?? "unknown_error");
  const lower = message.toLowerCase();
  if (lower.includes("i-proposed-tr4-refund-cascade-monotonicity")) {
    return makeError(
      "monotonicity_violation",
      "Each refund % must be the same or lower than the tier above it.",
      message,
    );
  }
  if (lower.includes("must be strictly descending")) {
    return makeError(
      "days_not_descending",
      "Tiers must count down — e.g., 60 days, then 30 days, then 0 days.",
      message,
    );
  }
  if (lower.includes("refund_pct must be int 0-100")) {
    return makeError(
      "tier_pct_out_of_range",
      "Refund % must be between 0 and 100.",
      message,
    );
  }
  if (lower.includes("days_before_start must be int >= 0")) {
    return makeError(
      "tier_pct_out_of_range",
      "Days before start must be 0 or higher.",
      message,
    );
  }
  if (lower.includes("max 8 tiers") || lower.includes("at least 1 tier")) {
    return makeError(
      "tier_count_invalid",
      "Policy must have 1–8 tiers.",
      message,
    );
  }
  if (lower.includes("kind must be flexible")) {
    return makeError("kind_invalid", "Pick Flexible, Standard, Strict, or Custom.", message);
  }
  if (lower.includes("permission") || lower.includes("rls")) {
    return makeError("unauthorized", "You don't have permission to update this trip.", message);
  }
  return makeError("internal_error", "Couldn't save policy. Try again.", message);
}

/**
 * Update events.refund_policy. Pass `null` to clear the policy (no refund tier
 * applies; cancellations return 0% per spec §10 Q1 default).
 */
export async function updateRefundPolicy(
  eventId: string,
  policy: RefundPolicy | null,
): Promise<void> {
  if (!eventId) throw makeError("not_found", "Trip not found.");

  // Light client-side validation to avoid round-tripping obviously bad input.
  // The DB CHECK constraint is the authoritative validator; this is just an
  // early-exit UX optimisation.
  if (policy !== null) {
    if (!["flexible", "standard", "strict", "custom"].includes(policy.kind)) {
      throw makeError("kind_invalid", "Pick Flexible, Standard, Strict, or Custom.");
    }
    if (policy.tiers.length === 0 || policy.tiers.length > 8) {
      throw makeError("tier_count_invalid", "Policy must have 1–8 tiers.");
    }
    let prevDays = -1;
    let prevPct = 101;
    for (const tier of policy.tiers) {
      if (
        !Number.isInteger(tier.days_before_start) ||
        tier.days_before_start < 0 ||
        !Number.isInteger(tier.refund_pct) ||
        tier.refund_pct < 0 ||
        tier.refund_pct > 100
      ) {
        throw makeError(
          "tier_pct_out_of_range",
          "Each tier needs days ≥ 0 and refund % between 0 and 100.",
        );
      }
      if (prevDays >= 0 && tier.days_before_start >= prevDays) {
        throw makeError(
          "days_not_descending",
          "Tiers must count down — e.g., 60 days, then 30 days, then 0 days.",
        );
      }
      if (tier.refund_pct > prevPct) {
        throw makeError(
          "monotonicity_violation",
          "Each refund % must be the same or lower than the tier above it.",
        );
      }
      prevDays = tier.days_before_start;
      prevPct = tier.refund_pct;
    }
  }

  // I-PROPOSED-I + I-PROPOSED-TR2-EVENTS-TYPE-FILTER: chain .select("id") +
  // .maybeSingle() to verify rowcount, and scope to event_type='trip' so the
  // gate confirms refund_policy writes only land on trip rows (Tr4 scope).
  const { data, error } = await supabase
    .from("events")
    .update({ refund_policy: policy })
    .eq("id", eventId)
    .eq("event_type", "trip")
    .select("id")
    .maybeSingle();
  if (error) {
    throw mapPgError(error);
  }
  if (data === null) {
    throw makeError(
      "not_found",
      "Trip not found or you don't have permission to update it.",
    );
  }
}

/**
 * Update events.booking_deadline. Pass `null` to clear (no auto-close cron).
 * Caller-side timezone is operator's brand TZ per design §4 (DECISION C).
 * Service stores as ISO timestamptz (UTC under the hood).
 */
export async function updateBookingDeadline(
  eventId: string,
  deadlineIso: string | null,
): Promise<void> {
  if (!eventId) throw makeError("not_found", "Trip not found.");
  if (deadlineIso !== null) {
    const parsed = Date.parse(deadlineIso);
    if (!Number.isFinite(parsed)) {
      throw makeError("internal_error", "Invalid deadline timestamp.");
    }
    if (parsed <= Date.now()) {
      throw makeError("internal_error", "Deadline must be in the future.");
    }
  }
  // I-PROPOSED-I + I-PROPOSED-TR2-EVENTS-TYPE-FILTER: chain .select("id") +
  // .maybeSingle() to verify rowcount, and scope to event_type='trip'.
  const { data, error } = await supabase
    .from("events")
    .update({
      booking_deadline: deadlineIso,
      // When clearing the deadline, also clear the auto-closed flag so the
      // operator can re-open bookings without separate plumbing.
      ...(deadlineIso === null
        ? { bookings_closed: false, bookings_closed_at: null }
        : {}),
    })
    .eq("id", eventId)
    .eq("event_type", "trip")
    .select("id")
    .maybeSingle();
  if (error) {
    throw mapPgError(error);
  }
  if (data === null) {
    throw makeError(
      "not_found",
      "Trip not found or you don't have permission to update it.",
    );
  }
}

// ---------------------------------------------------------------------------
// Issue #3284 — refund terms on events and experiences.
// ---------------------------------------------------------------------------

const SERVER_RETURN_REASONS: ReadonlySet<string> = new Set<
  OfferingRefundPolicyFailureReason
>([
  "refund_policy_downgrade_with_sales",
  "missing_edit_reason",
  "invalid_edit_reason",
  "offering_not_found",
  "offering_type_not_supported",
  "offering_not_editable_status",
]);

const isServerReturnReason = (
  value: string,
): value is OfferingRefundPolicyFailureReason => SERVER_RETURN_REASONS.has(value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isRefundPolicyShape = (value: unknown): value is RefundPolicy => {
  if (!isRecord(value) || !Array.isArray(value.tiers)) return false;
  if (!["flexible", "standard", "strict", "custom"].includes(String(value.kind))) {
    return false;
  }
  return value.tiers.every(
    (tier: unknown) =>
      isRecord(tier) &&
      typeof tier.days_before_start === "number" &&
      typeof tier.refund_pct === "number",
  );
};

/** Map a PostgREST error from the writer's RPC call to a typed failure. */
function offeringRefundRpcFailure(error: {
  code?: string | null;
  message?: string | null;
}): SetOfferingRefundPolicyResult {
  const code = error.code ?? "";
  const message = error.message ?? "";
  const lower = message.toLowerCase();
  if (code === "PGRST202") {
    return { ok: false, reason: "unavailable", detail: message };
  }
  // A signed-out caller reaches the function as `anon`, whose EXECUTE is revoked
  // (42501); a signed-in caller with no session identity gets the RAISE.
  if (code === "42501" || lower.includes("authentication_required")) {
    return { ok: false, reason: "authentication_required", detail: message };
  }
  if (lower.includes("insufficient_event_permission")) {
    return { ok: false, reason: "insufficient_event_permission", detail: message };
  }
  // The shape validator RAISEs with `refund_policy.` / `tier ` / monotonicity
  // messages; the CHECK constraint is 23514. Either way the terms were refused.
  // (Match `refund_policy.` WITH the dot: the function's own name contains
  // `refund_policy` and must never make an unrelated error read as bad terms.)
  if (
    code === "23514" ||
    lower.includes("refund_policy.") ||
    lower.includes("events_refund_policy_valid") ||
    lower.includes("i-proposed-tr4-refund-cascade-monotonicity") ||
    lower.startsWith("tier ")
  ) {
    return { ok: false, reason: "policy_invalid", detail: message };
  }
  return { ok: false, reason: "internal_error", detail: `${code} ${message}`.trim() };
}

/**
 * Issue #3284 — write refund terms on an EVENT or EXPERIENCE through the one gated
 * server owner, `business_patch_offering_refund_policy`.
 *
 * - Drafts: pass `reason: null`; the server writes with no gate.
 * - Scheduled or live: pass the organiser's 10–200 character edit reason. Once a
 *   paid order exists the server refuses any change that is worse for buyers and
 *   returns `refund_policy_downgrade_with_sales` with `affectedOrderCount`.
 * - `policy: null` clears the terms.
 *
 * Never throws for a server or network failure — every outcome is a typed result,
 * and on `ok: false` nothing was written. Trips do NOT use this: they keep
 * `updateRefundPolicy` and their own live-edit owner.
 */
export async function setOfferingRefundPolicy(
  eventId: string,
  policy: RefundPolicy | null,
  reason: string | null,
): Promise<SetOfferingRefundPolicyResult> {
  if (!eventId) {
    return { ok: false, reason: "offering_not_found", detail: "missing event id" };
  }

  let data: unknown;
  let error: { code?: string | null; message?: string | null } | null;
  try {
    const response = await supabase.rpc("business_patch_offering_refund_policy", {
      p_event_id: eventId,
      p_policy: policy,
      p_reason: reason,
    });
    data = response.data;
    error = response.error ?? null;
  } catch (thrown) {
    return {
      ok: false,
      reason: "network_error",
      detail: thrown instanceof Error ? thrown.message : String(thrown),
    };
  }

  if (error !== null) {
    return offeringRefundRpcFailure(error);
  }
  if (!isRecord(data)) {
    return { ok: false, reason: "internal_error", detail: "unreadable reply" };
  }

  if (data.ok === true) {
    const written = data.refundPolicy;
    if (written === null || written === undefined) {
      return { ok: true, refundPolicy: null };
    }
    if (!isRefundPolicyShape(written)) {
      return { ok: false, reason: "internal_error", detail: "unreadable refundPolicy" };
    }
    return { ok: true, refundPolicy: written };
  }

  const serverReason = typeof data.reason === "string" ? data.reason : "";
  if (!isServerReturnReason(serverReason)) {
    return {
      ok: false,
      reason: "internal_error",
      detail: serverReason === "" ? "missing reason" : serverReason,
    };
  }
  if (serverReason === "refund_policy_downgrade_with_sales") {
    const count = Number(data.affected_order_count);
    return {
      ok: false,
      reason: serverReason,
      ...(Number.isInteger(count) && count >= 0 ? { affectedOrderCount: count } : {}),
    };
  }
  return { ok: false, reason: serverReason };
}
