/**
 * Issue #3645 — the currency a draft should be in, asked of the SERVER.
 *
 * One small read of the draft row with its brand's current currency. It is
 * used when a draft opens in a wizard and before each draft save, so neither
 * ever has to trust a brand list cached on this device, which can be older
 * than the draft it would be compared with.
 *
 * It is a read of its own, not a column added to the save's existing read of
 * the draft row: that read is pinned to plain event columns.
 */
import { supabase } from "./supabase";

const codeOrNull = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0
    ? value.trim().toUpperCase()
    : null;

interface DraftCurrencyRow {
  rowCurrency: string | null;
  /** undefined = the answer carried no brand. */
  brandCurrency: string | null | undefined;
}

const readDraftCurrencyRow = async (
  draftId: string,
): Promise<DraftCurrencyRow | null> => {
  // orch-strict-grep-allow events-type-filter — issue #3645: draft currency read is scoped via .in("event_type", ["event","rsvp"]); event_type IS filtered (event+rsvp), not unfiltered.
  const { data, error } = await supabase
    .from("events")
    .select("currency,brand:brands(default_currency)")
    .eq("id", draftId)
    .in("event_type", ["event", "rsvp"])
    .eq("status", "draft")
    .is("deleted_at", null)
    .maybeSingle();
  if (error !== null && error !== undefined) throw error;
  if (data === null || data === undefined || typeof data !== "object") return null;
  const row = data as { currency?: unknown; brand?: unknown };
  const brand = Array.isArray(row.brand) ? row.brand[0] : row.brand;
  const brandCurrency =
    typeof brand === "object" && brand !== null && "default_currency" in brand
      ? codeOrNull((brand as { default_currency?: unknown }).default_currency)
      : undefined;
  return { rowCurrency: codeOrNull(row.currency), brandCurrency };
};

/**
 * The brand's current currency for this draft. `null` = the brand has none;
 * `undefined` = the answer carried no brand (nothing is known). Throws when
 * the read fails.
 */
export const fetchDraftBrandCurrency = async (
  draftId: string,
): Promise<string | null | undefined> => {
  const row = await readDraftCurrencyRow(draftId);
  return row === null ? undefined : row.brandCurrency;
};

/**
 * The currency this draft should be in: the brand's when it has one (after
 * migration 20270829003645 the two agree for a draft with nothing sold),
 * otherwise the row's. Null = the server holds none.
 */
export const fetchDraftCurrencyTruth = async (
  draftId: string,
): Promise<string | null> => {
  const row = await readDraftCurrencyRow(draftId);
  if (row === null) return null;
  return row.brandCurrency ?? row.rowCurrency;
};
