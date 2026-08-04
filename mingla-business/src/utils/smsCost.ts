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
 * The marketing body as COMPOSED — what `composeSmsBody(message, true)` in
 * `supabase/functions/_shared/adapters/smsAdapter.ts` produces before its
 * trailing `sanitizeGsm7()` pass. For the transmitted bytes, use `wireBody()`.
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
 * This function returns the body as COMPOSED, not as TRANSMITTED: the adapter
 * runs `sanitizeGsm7()` over it before it hits the wire. Anything MEASURING the
 * body must therefore measure `wireBody()` below, never this. Display surfaces
 * (SmsPreviewPane's bubble, the review sheet's MESSAGE row) render this one —
 * see the note on `wireBody`.
 */
export function bodyWithFooter(message: string): string {
  const body = message.trim();
  if (/reply stop to opt out\.\s*$/i.test(body)) return body;
  // ORCH-1289 — the STOP footer sits on its OWN line (a blank line, then the
  // STOP line) so this preview matches the wire body the adapter composes
  // (composeSmsBody with stopFooterOwnLine=true on the marketing route).
  return `${body}\n\n${STOP_FOOTER}`;
}

/**
 * GSM-7 sanitizer — behaviourally identical to `sanitizeGsm7` in the adapter
 * (`supabase/functions/_shared/adapters/smsAdapter.ts`).
 *
 * =============================================================================
 * #1556 — WHY THE PREVIEW HAS TO RUN THIS TOO.
 * =============================================================================
 * The adapter sanitizes the composed body before transmitting, folding the
 * UTF-8 punctuation that would force UCS-2 down to GSM-7-safe ASCII. This
 * module did not, so it measured characters the recipient never receives:
 *
 *   "Don’t miss it"   (iOS auto-substitutes the CURLY apostrophe, U+2019)
 *     preview: sees U+2019 -> "not GSM-7" -> UCS-2 -> 70 chars/segment
 *     wire:    sanitized to U+0027 -> GSM-7 -> 160 chars/segment
 *
 * so the composer OVER-reported segments and campaign cost by ~2.3x on
 * ordinary copy — the inverse of the footer defect this issue was opened for,
 * and far more common, because almost every phone inserts a smart apostrophe
 * without being asked. Over-quoting is the worse commercial direction: a brand
 * reads an inflated price and does not run the campaign at all.
 *
 * The character classes are written as explicit \u escapes rather than pasted
 * glyphs — three of the adapter's are invisible (U+00A0, U+2007, U+202F) and a
 * mistyped one would be undetectable by eye. Identity with the adapter is not
 * asserted by this comment: the parity suites sweep every codepoint the
 * adapter's sanitizer touches, plus its neighbours, and fail on any divergence.
 */
export function sanitizeGsm7(input: string): string {
  return input
    .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'") // curly/prime single quotes
    .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"') // curly/prime double quotes
    .replace(/[\u2013\u2014\u2015]/g, "-") // en/em dash, horizontal bar
    .replace(/\u2026/g, "...") // ellipsis
    .replace(/[\u00A0\u2007\u202F]/g, " ") // non-breaking spaces
    .replace(/[\u2022]/g, "-"); // bullet
}

/**
 * The exact bytes the adapter puts on the wire: `composeSmsBody(message, true)`.
 * MEASURE THIS — never `bodyWithFooter` — for anything that counts characters,
 * segments or money.
 *
 * #1556 — this is deliberately NOT what the composer DISPLAYS. `bodyWithFooter`
 * still backs SmsPreviewPane's bubble and the review sheet's MESSAGE row, so a
 * brand's typed apostrophe is never silently rewritten in their own draft.
 * Rewriting what someone sees themselves typing is a product decision, not a
 * correctness one, and it is Seth's to make (#1556). The consequence, stated so
 * the next reader is not surprised: for copy containing an ellipsis the bubble
 * shows "…" (1 char) while the count reports the 3 characters that actually
 * ship. The count is the truthful one — it is what bills.
 */
export function wireBody(message: string): string {
  return sanitizeGsm7(bodyWithFooter(message));
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
  // #1556 — MEASURE THE TRANSMITTED BYTES. `wireBody` applies the adapter's
  // GSM-7 sanitizer, so an iOS smart apostrophe is counted as the ASCII one the
  // recipient actually gets (GSM-7, 160/seg) instead of forcing this estimate
  // into UCS-2 (70/seg) and over-quoting the campaign by ~2.3x.
  const wire = message.trim().length === 0 ? "" : wireBody(message);
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
