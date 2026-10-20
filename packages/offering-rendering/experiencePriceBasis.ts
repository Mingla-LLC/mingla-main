/**
 * experiencePriceBasis — issue #3281 Round 2 (guest unit labels).
 *
 * Pure helpers for "per person | per group | per N min" beside experience
 * prices. Dep-free (I-MOR-0827-PACKAGE-ISOLATION): no imports from sibling
 * modules so Deno unit tests and Metro both resolve cleanly.
 */

export type ExperiencePriceBasis = "person" | "group" | "block";

/** Minimal option shape used by option list / label helpers. */
export type ExperiencePriceOptionLike = {
  ticketTypeId?: string;
  name?: string;
  priceBasis?: ExperiencePriceBasis;
  blockMinutes?: number | null;
};

/** Unit label for a price option (defaults to "per person"). */
export function experiencePriceBasisLabel(
  basis?: ExperiencePriceBasis | null,
  blockMinutes?: number | null,
): string {
  if (basis === "group") return "per group";
  if (basis === "block") {
    const n =
      typeof blockMinutes === "number" &&
      Number.isFinite(blockMinutes) &&
      blockMinutes > 0
        ? Math.round(blockMinutes)
        : 60;
    return `per ${n} min`;
  }
  return "per person";
}

/** Resolve options for UI: public `options` when present, else `[ticket]`. */
export function experienceOfferingOptions<T extends ExperiencePriceOptionLike>(
  data: { ticket: T | null; options?: readonly T[] | null },
): T[] {
  if (Array.isArray(data.options) && data.options.length > 0) {
    return [...data.options];
  }
  return data.ticket !== null ? [data.ticket] : [];
}

/** Format a hire length for the "How long" picker. */
export function experienceBlockLengthLabel(
  blocks: number,
  blockMinutes: number,
): string {
  const mins = Math.max(1, Math.round(blocks)) * Math.max(1, Math.round(blockMinutes));
  if (mins % 60 === 0) {
    const hours = mins / 60;
    return hours === 1 ? "1 hour" : `${hours} hours`;
  }
  return `${mins} min`;
}

/** Coerce a raw public/RPC basis string into the typed union (or undefined). */
export function parseExperiencePriceBasis(
  raw: unknown,
): ExperiencePriceBasis | undefined {
  if (raw === "person" || raw === "group" || raw === "block") return raw;
  return undefined;
}
