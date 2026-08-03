/**
 * #948 W4 [web-skip-download] — the invite-funnel READER (pure), isolated for a
 * bundle reason (ORCH-1083).
 *
 * This module is imported ONLY by the LAZY `/brand/[id]/connect` web body
 * (`BrandBankConnectBody.web.tsx`), so it lives in that route's split chunk and
 * never enters the eager `__common` boot chunk. It deliberately holds NO imports
 * of its own — importing the param constants from `bankFirstPartnerInvite` would
 * pull that module (decide helper + roles Set) into the lazy chunk AND, because
 * the eager accept route also imports it, cause Metro to hoist the whole thing
 * into `__common` (the leak this split exists to prevent). The WRITER
 * (`withInviteFunnelParam`) + the param constants live in `bankFirstPartnerInvite`
 * — the eager accept route already loads that module, so the writer is free there.
 *
 * The invite phase is marked by a `?from=invite` query param appended at the two
 * invite→connect redirects (accept route via `withInviteFunnelParam`; the legacy
 * success route inlines the same literal). The web bank screen hides its top Back
 * and reveals "Skip for now" ONLY when this reader returns true.
 *
 * INVARIANT: the compared value below MUST stay in sync with
 * `bankFirstPartnerInvite.INVITE_FUNNEL_VALUE` (both "invite"). Cross-covered:
 * the writer emits `?from=<INVITE_FUNNEL_VALUE>` and this reader gates on it — if
 * they drift, the render suites' T-a (invite → Skip shown) goes red.
 */

const INVITE_FUNNEL_VALUE = "invite";

/**
 * Exact-match reader for the invite-funnel signal. Treats ONLY a first value of
 * exactly "invite" as truthy — `"invitee"`, `"dashboard"`, `"INVITE"`, and absent
 * are all NON-invite. Exact (not substring/case-insensitive) match is
 * load-bearing: it is the airtight gate that keeps the dashboard/direct/bookmark
 * entry's Back button intact.
 */
export function isInviteFunnelValue(
  value: string | string[] | undefined,
): boolean {
  const first = Array.isArray(value) ? value[0] : value;
  return first === INVITE_FUNNEL_VALUE;
}
