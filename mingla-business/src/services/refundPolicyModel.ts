/**
 * issue #3284 [bundle budget] — the refund policy MODEL: types and preset terms.
 *
 * No network and no logic: the shapes every refund-terms reader and writer shares,
 * and the preset policies the editor offers. It is split from the Supabase
 * writers in `refundPolicyService.ts` along that real boundary (data vs network
 * calls), because Metro places a module in the business-web boot payload
 * (`__common`, ORCH-1083) whenever two lazy chunks import it. Here the presets
 * ride only with the lazily loaded editor, the types are erased at build time,
 * and the writers load on demand through `refundPolicyWrites.ts`.
 *
 * Moved verbatim from `refundPolicyService.ts`.
 */

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

// ---------------------------------------------------------------------------
// Issue #3284 — refund terms on events and experiences: result shapes.
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
