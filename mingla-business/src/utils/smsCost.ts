/**
 * META-ORCH-1161 Sub-B — SMS segment + cost estimate (composer cost guard).
 *
 * Mirrors the GSM-7 / UCS-2 segmentation in the server-side smsAdapter
 * (`supabase/functions/_shared/adapters/smsAdapter.ts`) so the composer can show
 * an HONEST per-recipient segment count + a campaign cost estimate BEFORE send
 * (SPEC §6.4). Estimate only — Twilio bills the authoritative count; this never
 * claims to be exact (Constitution #9 — no fabricated precision).
 */

// GSM-7 default + basic-extended alphabet. Chars outside it force the whole
// message to UCS-2 (70/seg instead of 160/seg). Kept byte-identical to the
// adapter's GSM7_BASIC + GSM7_EXT so client + server agree on segmentation.
const GSM7_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ ÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM7_EXT = "^{}\\[~]|€";

export function isGsm7(text: string): boolean {
  for (const ch of text) {
    if (GSM7_BASIC.indexOf(ch) === -1 && GSM7_EXT.indexOf(ch) === -1) {
      return false;
    }
  }
  return true;
}

/** Append the STOP footer the adapter adds, so the estimate reflects the wire body. */
const STOP_FOOTER = "Reply STOP to opt out.";

/**
 * The marketing wire body: exactly what `composeSmsBody(message, true)` in
 * `supabase/functions/_shared/adapters/smsAdapter.ts` produces, modulo that
 * function's trailing `sanitizeGsm7()` pass (see KNOWN GAP below).
 *
 * =============================================================================
 * #1556 — THE SUPPRESSION GUARD IS END-ANCHORED, BECAUSE THE ADAPTER'S IS.
 * =============================================================================
 * This used to be `/reply stop/i` over the WHOLE body while the adapter's guard
 * was end-anchored by #1541. The two conditions disagreed for any body that
 * MENTIONS "reply stop" without ENDING in the footer — an event called "Reply
 * Stop", or copy that explains the opt-out in prose mid-message:
 *
 *   preview: footer suppressed -> segments computed on a body 24 chars shorter
 *   wire:    footer appended   -> the real send is longer, and can cross a
 *                                 153/160 (GSM-7) or 67/70 (UCS-2) boundary
 *
 * so the composer UNDER-reported segment count and campaign cost against what
 * actually bills. The wire was always correct and always carried the opt-out
 * line, so this was preview accuracy, never compliance.
 *
 * The guard below is the adapter's guard, character for character — same
 * anchoring, same `\s*$` tail (which covers both the transactional single-space
 * and the ORCH-1289 own-line footer form), same `/i`, over the same `.trim()`ed
 * body, with the same empty-body handling (an empty body does NOT end with the
 * footer, so it GETS one — same as the adapter).
 *
 * It is pinned behaviourally, not by this comment: two suites now EXECUTE both
 * implementations over one shared adversarial corpus and fail if they disagree
 * on footer suppression —
 *   supabase/functions/__tests__/issue1556_sms_footer_parity.test.ts  (Deno; imports both real modules)
 *   mingla-business/src/utils/__tests__/smsCost.issue1556.test.ts     (Jest; executes the adapter's shipped composeSmsBody source)
 * A comment claiming parity is exactly what was true when written and silently
 * stopped being true. Do not re-state parity here — extend the corpus instead.
 *
 * KNOWN GAP (NOT this issue, reported on #1556): the adapter also runs
 * `sanitizeGsm7()` over the composed body, folding curly quotes / dashes /
 * ellipsis / NBSP down to GSM-7. This module does not, so a body typed with an
 * iOS smart apostrophe is scored UCS-2 (70/seg) here while the wire ships
 * GSM-7 (160/seg) — the INVERSE error, an OVER-report. The parity suites assert
 * the equality modulo that sanitizer so the gap is visible, not papered over.
 */
export function bodyWithFooter(message: string): string {
  const body = message.trim();
  if (/reply stop to opt out\.\s*$/i.test(body)) return body;
  // ORCH-1289 — the STOP footer sits on its OWN line (a blank line, then the
  // STOP line) so this preview matches the wire body the adapter composes
  // (composeSmsBody with stopFooterOwnLine=true on the marketing route).
  return `${body}\n\n${STOP_FOOTER}`;
}

/** Segment count for a body. GSM-7 = 160 single / 153 concat; UCS-2 = 70 / 67. */
export function computeSegments(text: string): number {
  if (text.length === 0) return 0;
  const gsm7 = isGsm7(text);
  const len = text.length;
  if (gsm7) {
    return len <= 160 ? 1 : Math.ceil(len / 153);
  }
  return len <= 70 ? 1 : Math.ceil(len / 67);
}

export interface SmsEstimate {
  /**
   * Encoding the body will use on the wire. ORCH-1282: "MMS" when a photo is
   * attached (the text still rides the MMS, but it is billed per message).
   */
  encoding: "GSM-7" | "UCS-2" | "MMS";
  /** Characters counted (body + STOP footer). */
  charCount: number;
  /** Segments per recipient (always 1 for MMS — billed per message). */
  segmentsPerRecipient: number;
  /** Total segments across the reachable audience (message count for MMS). */
  totalSegments: number;
  /** Estimated cost in MINOR units of the display currency (cents). */
  estimatedCostMinor: number;
}

// Default per-segment outbound price (USD cents). Twilio US toll-free ~ $0.0079
// outbound; we use a conservative whole-cent estimate. Operator can tune later.
const DEFAULT_SEGMENT_COST_MINOR = 1; // 1 cent per segment (rounded up from ~0.79c)

// ORCH-1282 — default per-MESSAGE MMS price (US cents). US MMS ~ $0.02/msg;
// billed per message, not per segment. Conservative whole-cent estimate
// (operator can tune later — see SPEC §10 OQ-1). Estimate only; Twilio meters
// authoritatively (Constitution #9).
const DEFAULT_MMS_COST_MINOR = 2;

/**
 * Estimate segments + cost for an SMS/MMS blast.
 *
 * @param message       composer body (without the STOP footer — added here)
 * @param reachableSms  recipients reachable on SMS (truthful reach from audience)
 * @param segmentCostMinor optional per-segment cost in minor units (default 1c)
 * @param hasMedia      ORCH-1282 — when true the blast is an MMS (photo attached):
 *                      billed per MESSAGE (1 "segment"/recipient) at the MMS rate,
 *                      not per SMS segment. The text still counts toward charCount.
 */
export function estimateSmsCost(
  message: string,
  reachableSms: number,
  segmentCostMinor: number = DEFAULT_SEGMENT_COST_MINOR,
  hasMedia: boolean = false,
): SmsEstimate {
  // #1556 — "nothing typed yet" is a PREVIEW concern, not a body-composition
  // one. It used to live inside `bodyWithFooter` as `body.length === 0 ? body`,
  // which is the one place that function could not mirror the adapter (the
  // adapter appends the footer to an empty body) and so blocked a byte-exact
  // parity guard. Hoisted here, the composer's empty state is preserved
  // EXACTLY — 0 chars / 0 segments / 0 cost, and the MMS branch below still
  // bills one message per recipient. An empty body is unreachable at send time
  // anyway: compose.tsx requires `smsBody.trim().length > 0` to continue.
  const wire = message.trim().length === 0 ? "" : bodyWithFooter(message);
  const safeReach = reachableSms > 0 ? reachableSms : 0;
  if (hasMedia) {
    // MMS — one message per recipient, billed at the MMS per-message rate.
    return {
      encoding: "MMS",
      charCount: wire.length,
      segmentsPerRecipient: 1,
      totalSegments: safeReach,
      estimatedCostMinor: safeReach * DEFAULT_MMS_COST_MINOR,
    };
  }
  const encoding: "GSM-7" | "UCS-2" = isGsm7(wire) ? "GSM-7" : "UCS-2";
  const segmentsPerRecipient = computeSegments(wire);
  const totalSegments = segmentsPerRecipient * safeReach;
  return {
    encoding,
    charCount: wire.length,
    segmentsPerRecipient,
    totalSegments,
    estimatedCostMinor: totalSegments * segmentCostMinor,
  };
}
