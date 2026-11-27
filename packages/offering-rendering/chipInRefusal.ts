/**
 * Issue #3645 (18 Nov payments audit, item 7 follow-through) — the chip-in
 * refusal the panel words, carried from the `rsvp-contribution-create` body
 * to `RsvpOfferingBody`.
 *
 * The server refuses a gift below the minimum with 422
 * `{ error: "amount_below_min", minCents, reason? }`: `minCents` is the host's
 * minimum, or the payment provider's minimum charge (for example ₦100 when
 * the host set ₦50). Before this, both callers lost the body (supabase-js puts
 * the raw Response in `error.context`), so every refusal read "Couldn't
 * process that", and the panel could only ever name the host's minimum.
 *
 * Kept deliberately tiny: it ships in the eager Host web chunk (#3493
 * movement threshold), so it is a plain Error, not a subclass, and carries
 * only what the panel reads. Pure: no React, no supabase.
 */

/** The Error's `message` is the server code (callers match on it). */
export type ChipInRefusalError = Error & {
  /** The server's floor in minor units, or null when it sent no valid one. */
  readonly minCents: number | null;
};

/**
 * Build the refusal from the server's error code and its parsed JSON body
 * (`null` when the body could not be read). A missing or malformed
 * `minCents` is dropped, never guessed.
 */
export function chipInRefusalFromBody(code: string, body: unknown): ChipInRefusalError {
  const minCents = (body as { minCents?: unknown } | null)?.minCents;
  return Object.assign(new Error(code), {
    minCents:
      typeof minCents === "number" && Number.isSafeInteger(minCents) && minCents > 0
        ? minCents
        : null,
  });
}
