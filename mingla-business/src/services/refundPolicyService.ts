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

export interface RefundPolicyTier {
  /** Integer >= 0 — days before trip start. */
  days_before_start: number;
  /** Integer 0-100 — refund percentage at this tier. */
  refund_pct: number;
}

export type RefundPolicyKind = "flexible" | "standard" | "strict" | "custom";

export interface RefundPolicy {
  kind: RefundPolicyKind;
  /** Sorted DESC by days_before_start; refund_pct non-increasing. */
  tiers: RefundPolicyTier[];
}

// Locked defaults per SPEC §10 Q1 + DESIGN §5.1 — operator-overridable
// at any time via the custom builder.
export const FLEXIBLE_POLICY: RefundPolicy = {
  kind: "flexible",
  tiers: [
    { days_before_start: 30, refund_pct: 100 },
    { days_before_start: 14, refund_pct: 50 },
    { days_before_start: 0, refund_pct: 0 },
  ],
};

export const STANDARD_POLICY: RefundPolicy = {
  kind: "standard",
  tiers: [
    { days_before_start: 60, refund_pct: 100 },
    { days_before_start: 30, refund_pct: 50 },
    { days_before_start: 0, refund_pct: 0 },
  ],
};

export const STRICT_POLICY: RefundPolicy = {
  kind: "strict",
  tiers: [
    { days_before_start: 90, refund_pct: 100 },
    { days_before_start: 0, refund_pct: 0 },
  ],
};

export interface RefundPolicyServiceError extends Error {
  code:
    | "policy_invalid"
    | "monotonicity_violation"
    | "days_not_descending"
    | "tier_pct_out_of_range"
    | "tier_count_invalid"
    | "kind_invalid"
    | "unauthorized"
    | "not_found"
    | "network_error"
    | "internal_error";
  detail?: string;
}

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
