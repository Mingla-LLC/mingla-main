/**
 * Issue #1931 — Private event access, client-side released-set state.
 *
 * RELEASED SET ONLY. `issue_1931_private_event_access_ready()` is service-role-only and
 * lands FALSE, and the operator RPC that would flip it raises
 * `private_access_release_frozen` unconditionally this release. So the shipping,
 * user-visible state of every Private authoring surface is the DISABLED / BLOCKED state,
 * and that is the state this module encodes.
 *
 * This flag is a UX affordance, never an authority. Base SPEC §3 is explicit that client
 * versions are not evidence: the server independently returns typed
 * `private_access_not_ready`, and every released SQL and Edge path denies on its own.
 * Flipping this constant alone cannot admit a Private read, publish or checkout.
 */
export const PRIVATE_EVENT_ACCESS_READY = false as const;

/** Exact copy from Amendment 1 §3. Do not paraphrase — SC-34 asserts these strings. */
export const PRIVATE_NOT_READY_HELPER =
  "Private ticket sales are not ready yet. Choose Public or Unlisted to publish." as const;

/** Typed, non-disclosing server reason class for a blocked Private publish. */
export const PRIVATE_ACCESS_NOT_READY_CODE = "private_access_not_ready" as const;

/** Amendment 1 §3 — preexisting scheduled Private rows are backfilled `needs_setup`. */
export const PRIVATE_NEEDS_SETUP_TITLE = "Finish private access setup" as const;
export const PRIVATE_NEEDS_SETUP_BODY =
  "Secure this event's media and send new invite links before guests can open or buy tickets." as const;
export const PRIVATE_NEEDS_SETUP_ACTION = "Set up private access" as const;

/**
 * True when the creator may select Private and publish it. False for the whole of this
 * release.
 */
export const canSelectPrivateVisibility = (): boolean => PRIVATE_EVENT_ACCESS_READY;

/**
 * Publish gate for a draft. A legacy draft already stored as `private` stays SELECTED —
 * it is not silently rewritten to another visibility — but Publish is blocked with the
 * same actionable copy the creator row shows (Amendment 1 §3).
 */
export const privatePublishBlockReason = (
  visibility: string,
): typeof PRIVATE_NOT_READY_HELPER | null =>
  visibility === "private" && !PRIVATE_EVENT_ACCESS_READY ? PRIVATE_NOT_READY_HELPER : null;
