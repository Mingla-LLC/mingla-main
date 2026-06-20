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

export function bodyWithFooter(message: string): string {
  const body = message.trim();
  if (/reply stop/i.test(body)) return body;
  return body.length === 0 ? body : `${body} ${STOP_FOOTER}`;
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
  /** Encoding the body will use on the wire. */
  encoding: "GSM-7" | "UCS-2";
  /** Characters counted (body + STOP footer). */
  charCount: number;
  /** Segments per recipient. */
  segmentsPerRecipient: number;
  /** Total segments across the reachable audience. */
  totalSegments: number;
  /** Estimated cost in MINOR units of the display currency (cents). */
  estimatedCostMinor: number;
}

// Default per-segment outbound price (USD cents). Twilio US toll-free ~ $0.0079
// outbound; we use a conservative whole-cent estimate. Operator can tune later.
const DEFAULT_SEGMENT_COST_MINOR = 1; // 1 cent per segment (rounded up from ~0.79c)

/**
 * Estimate segments + cost for an SMS blast.
 *
 * @param message       composer body (without the STOP footer — added here)
 * @param reachableSms  recipients reachable on SMS (truthful reach from audience)
 * @param segmentCostMinor optional per-segment cost in minor units (default 1c)
 */
export function estimateSmsCost(
  message: string,
  reachableSms: number,
  segmentCostMinor: number = DEFAULT_SEGMENT_COST_MINOR,
): SmsEstimate {
  const wire = bodyWithFooter(message);
  const encoding: "GSM-7" | "UCS-2" = isGsm7(wire) ? "GSM-7" : "UCS-2";
  const segmentsPerRecipient = computeSegments(wire);
  const safeReach = reachableSms > 0 ? reachableSms : 0;
  const totalSegments = segmentsPerRecipient * safeReach;
  return {
    encoding,
    charCount: wire.length,
    segmentsPerRecipient,
    totalSegments,
    estimatedCostMinor: totalSegments * segmentCostMinor,
  };
}
