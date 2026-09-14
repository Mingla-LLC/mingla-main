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

// Issue #3284 — event and experience presets. Trip presets above assume booking
// months ahead; events and experiences are bought days to weeks ahead, so these
// count in days (Seth-approved 2026-09-12). Ordered most to least generous:
// Flexible >= Standard >= Strict >= No refunds at every threshold.
export const EVENT_FLEXIBLE_POLICY: RefundPolicy = {
  kind: "flexible",
  tiers: [
    { days_before_start: 7, refund_pct: 100 },
    { days_before_start: 2, refund_pct: 50 },
    { days_before_start: 0, refund_pct: 0 },
  ],
};

export const EVENT_STANDARD_POLICY: RefundPolicy = {
  kind: "standard",
  tiers: [
    { days_before_start: 14, refund_pct: 100 },
    { days_before_start: 7, refund_pct: 50 },
    { days_before_start: 0, refund_pct: 0 },
  ],
};

export const EVENT_STRICT_POLICY: RefundPolicy = {
  kind: "strict",
  tiers: [
    { days_before_start: 30, refund_pct: 100 },
    { days_before_start: 0, refund_pct: 0 },
  ],
};

/** "No refunds" — one 0% tier from the moment of purchase. */
export const NO_REFUNDS_POLICY: RefundPolicy = {
  kind: "custom",
  tiers: [{ days_before_start: 0, refund_pct: 0 }],
};

/**
 * Issue #3284 — the refund % a policy gives with `daysRemaining` whole days left
 * before the offering starts. The SAME tier rule as the server (the #3284 writer's
 * downgrade classifier and biz_compute_refund_for_cancel): the tier with the
 * largest `days_before_start <= daysRemaining` wins, otherwise 0. A null policy
 * refunds 0% at every point, and so does any time after the start (negative days).
 *
 * Used only to PRE-FILL the organiser's refund sheet. It never moves money.
 */
export function realizedRefundPct(
  policy: RefundPolicy | null,
  daysRemaining: number,
): number {
  if (policy === null || !Number.isFinite(daysRemaining)) return 0;
  let winner: RefundPolicyTier | null = null;
  for (const tier of policy.tiers) {
    if (tier.days_before_start > daysRemaining) continue;
    if (winner === null || tier.days_before_start > winner.days_before_start) {
      winner = tier;
    }
  }
  return winner === null ? 0 : winner.refund_pct;
}

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

// ---------------------------------------------------------------------------
// Issue #3284 — refund terms on events and experiences.
// ---------------------------------------------------------------------------

/**
 * Why a refund-terms save on an event or experience did not land.
 *
 * - Server reasons, verbatim from `business_patch_offering_refund_policy`:
 *   `refund_policy_downgrade_with_sales` (paid buyers exist and the new terms are
 *   worse at some threshold — carries `affectedOrderCount`), `missing_edit_reason`,
 *   `invalid_edit_reason`, `offering_not_found`, `offering_type_not_supported`,
 *   `offering_not_editable_status`.
 * - Server exceptions: `authentication_required`, `insufficient_event_permission`,
 *   and `policy_invalid` (the shape validator or its CHECK constraint refused).
 * - `unavailable` — the server does not have the function yet (PostgREST PGRST202).
 *   Callers must NOT continue the rest of a save on this: nothing was written.
 * - `network_error` — the request never produced a server answer.
 * - `internal_error` — anything else, including a reply this client cannot read.
 */
export type OfferingRefundPolicyFailureReason =
  | "refund_policy_downgrade_with_sales"
  | "missing_edit_reason"
  | "invalid_edit_reason"
  | "offering_not_found"
  | "offering_type_not_supported"
  | "offering_not_editable_status"
  | "authentication_required"
  | "insufficient_event_permission"
  | "policy_invalid"
  | "unavailable"
  | "network_error"
  | "internal_error";

export type SetOfferingRefundPolicyResult =
  | { ok: true; refundPolicy: RefundPolicy | null }
  | {
      ok: false;
      reason: OfferingRefundPolicyFailureReason;
      /** Present only for `refund_policy_downgrade_with_sales`. */
      affectedOrderCount?: number;
      /** The raw server message or reason, for logs. Never shown to guests. */
      detail?: string;
    };

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
