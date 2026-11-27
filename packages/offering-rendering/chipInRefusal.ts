/**
 * Issue #3645 (18 Nov payments audit, item 7 follow-through) — the chip-in
 * refusal the panel words, carried from the `rsvp-contribution-create` body
 * to `RsvpOfferingBody`.
 *
 * The server refuses a gift below the minimum with 422
 * `{ error: "amount_below_min", minCents, reason? }`: `minCents` is the host's
 * minimum, or the payment provider's minimum charge with
 * `reason: "provider_minimum"` (for example ₦100 when the host set ₦50).
 * Before this, both callers lost the body (supabase-js puts the raw Response
 * in `error.context`), so every refusal read "Couldn't process that", and the
 * panel could only ever name the host's minimum.
 *
 * The Error's `message` stays the server code, so a caller or test that only
 * checks `message` keeps working. Pure: no React, no supabase.
 */

export type ChipInRefusalReason = "provider_minimum";

export class ChipInRefusalError extends Error {
  readonly code: string;
  /** The server's floor in minor units, when it sent a valid one. */
  readonly minCents: number | null;
  readonly reason: ChipInRefusalReason | null;

  constructor(code: string, minCents: number | null, reason: ChipInRefusalReason | null) {
    super(code);
    this.name = "ChipInRefusalError";
    this.code = code;
    this.minCents = minCents;
    this.reason = reason;
  }
}

const positiveSafeInteger = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;

/**
 * Build the refusal from the server's error code and its parsed JSON body
 * (`null` when the body could not be read). A missing or malformed
 * `minCents` / `reason` is dropped, never guessed.
 */
export function chipInRefusalFromBody(code: string, body: unknown): ChipInRefusalError {
  const record =
    body !== null && typeof body === "object" ? (body as Record<string, unknown>) : null;
  const minCents = positiveSafeInteger(record?.minCents);
  const reason = record?.reason === "provider_minimum" ? "provider_minimum" : null;
  return new ChipInRefusalError(code, minCents, reason);
}

/**
 * The floor to name in "Add at least …" after an `amount_below_min` refusal:
 * the server's `minCents` when it sent one (it knows the provider minimum the
 * client does not), otherwise the host minimum the panel holds, otherwise null.
 */
export function chipInRefusalFloorCents(
  error: unknown,
  hostMinCents: number | null,
): number | null {
  // Duck-typed, not `instanceof`: a surface bundle can hold two copies of
  // this module (workspace symlink + alias), and the floor must still be read.
  const serverFloor =
    error !== null && typeof error === "object"
      ? positiveSafeInteger((error as { minCents?: unknown }).minCents)
      : null;
  return serverFloor ?? positiveSafeInteger(hostMinCents);
}

/**
 * The chip-in amount field takes whole currency units, so the smallest gift a
 * guest can type that clears `floorCents` is the floor rounded UP to a whole
 * unit (DKK 2.50 → 3; ₦100 → 100). Naming the unrounded floor could suggest
 * an amount the field can't hold; rounding down would name one still refused.
 */
export function chipInWholeUnitFloorCents(floorCents: number): number {
  return Math.ceil(floorCents / 100) * 100;
}
