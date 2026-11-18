/**
 * Issue #3645 — one reader of a brand's payout-hold cut-over stamp
 * (brands.payout_hold_cutover_at) for every checkout that can charge through
 * Paystack.
 *
 * The stamp decides who is paid at charge time. An UNSTAMPED brand with a
 * subaccount splits the charge to the organiser at once; a STAMPED brand
 * settles to Mingla and the payout sweep pays the organiser later. A checkout
 * that guessed "unstamped" when the read failed split a stamped brand's sale
 * at charge time AND left the sale for the sweep, which then paid the
 * organiser a second time. A failed read therefore refuses the checkout with a
 * retryable error; it never guesses.
 *
 * A read that succeeds with no row keeps the old meaning (no stamp).
 */

export type PayoutHoldStamp =
  | { ok: true; isCutover: boolean }
  | { ok: false };

type StampRow =
  | { payout_hold_cutover_at?: string | null }
  | {
    brands?:
      | { payout_hold_cutover_at?: string | null }
      | Array<{ payout_hold_cutover_at?: string | null }>
      | null;
  };

function stampOf(row: unknown): string | null {
  if (row === null || typeof row !== "object") return null;
  const value = row as StampRow;
  if ("brands" in value) {
    const rel = value.brands;
    const brand = Array.isArray(rel) ? rel[0] : rel;
    return brand?.payout_hold_cutover_at ?? null;
  }
  return (value as { payout_hold_cutover_at?: string | null })
    .payout_hold_cutover_at ?? null;
}

/**
 * Turns the result of a stamp read (a `brands` row, or an `events` row that
 * embeds `brands`) into the stamp decision. Any read error is `{ ok: false }`.
 */
export function payoutHoldStampFromRead(
  read: { data: unknown; error: unknown },
  logTag: string,
): PayoutHoldStamp {
  if (read.error) {
    console.error(
      `[${logTag}] payout_hold_cutover_at read failed; refusing the checkout`,
      read.error,
    );
    return { ok: false };
  }
  return { ok: true, isCutover: stampOf(read.data) !== null };
}

type BrandStampQuery = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        maybeSingle: () => PromiseLike<{ data: unknown; error: unknown }>;
      };
    };
  };
};

/** Reads one brand's stamp by primary key. A thrown read is a failed read. */
export async function readBrandPayoutHoldStamp(
  // Loose on purpose: a fully typed supabase client is too deep to match
  // structurally; only the brands PK read below is used.
  client: { from: (table: string) => unknown },
  brandId: string,
  logTag: string,
): Promise<PayoutHoldStamp> {
  try {
    const read = await (client as BrandStampQuery)
      .from("brands")
      .select("payout_hold_cutover_at")
      .eq("id", brandId)
      .maybeSingle();
    return payoutHoldStampFromRead(read, logTag);
  } catch (error) {
    return payoutHoldStampFromRead({ data: null, error }, logTag);
  }
}

/** The refusal every checkout returns when the stamp cannot be read. */
export const PAYOUT_HOLD_UNREADABLE_ERROR = "payout_settings_unavailable";
export const PAYOUT_HOLD_UNREADABLE_STATUS = 503;
