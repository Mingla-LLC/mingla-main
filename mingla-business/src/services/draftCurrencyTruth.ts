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
  /** The row's draft JSON, for the server's "prices were cleared" note. */
  theme: unknown;
}

const readDraftCurrencyRow = async (
  draftId: string,
  signal?: AbortSignal,
): Promise<DraftCurrencyRow | null> => {
  // orch-strict-grep-allow events-type-filter — issue #3645: draft currency read is scoped via .in("event_type", ["event","rsvp"]); event_type IS filtered (event+rsvp), not unfiltered.
  const query = supabase
    .from("events")
    .select("currency,theme,brand:brands(default_currency)")
    .eq("id", draftId)
    .in("event_type", ["event", "rsvp"])
    .eq("status", "draft")
    .is("deleted_at", null);
  // A read that can be stopped is stopped with its screen: left alone, a
  // failing read is retried for several seconds after the screen has gone.
  const { data, error } = await (signal !== undefined &&
  typeof query.abortSignal === "function"
    ? query.abortSignal(signal)
    : query
  ).maybeSingle();
  if (error !== null && error !== undefined) throw error;
  if (data === null || data === undefined || typeof data !== "object") return null;
  const row = data as { currency?: unknown; brand?: unknown; theme?: unknown };
  const brand = Array.isArray(row.brand) ? row.brand[0] : row.brand;
  const brandCurrency =
    typeof brand === "object" && brand !== null && "default_currency" in brand
      ? codeOrNull((brand as { default_currency?: unknown }).default_currency)
      : undefined;
  return { rowCurrency: codeOrNull(row.currency), brandCurrency, theme: row.theme };
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
 * The currency this draft is in on the server: the draft ROW's own currency
 * (the brand trigger of migration 20270829003645 keeps it in step with the
 * brand for a draft with nothing sold), or the brand's when the row has none
 * yet. Null = the server holds none.
 */
export const fetchDraftCurrencyTruth = async (
  draftId: string,
): Promise<string | null> => {
  const row = await readDraftCurrencyRow(draftId);
  if (row === null) return null;
  return row.rowCurrency ?? row.brandCurrency ?? null;
};

/**
 * What a wizard needs when a draft opens: the currency the draft is in on the
 * server, and the row's draft JSON (it carries the server's "prices were
 * cleared" note when the brand's currency change cleared this draft).
 */
export const fetchDraftOpenState = async (
  draftId: string,
): Promise<{ currency: string | null; theme: unknown }> => {
  const read = new AbortController();
  openReads.set(read, draftId);
  try {
    const row = await readDraftCurrencyRow(draftId, read.signal);
    if (row === null) return { currency: null, theme: undefined };
    return { currency: row.rowCurrency ?? row.brandCurrency ?? null, theme: row.theme };
  } finally {
    openReads.delete(read);
  }
};

/** The open reads still in flight, each with the draft it is for. */
const openReads = new Map<AbortController, string>();

/**
 * The screen showing this draft has closed: stop its open reads that are
 * still in flight. Each one then fails for its caller, which has stopped
 * listening. A save's own read of the brand currency is never stopped here.
 */
export const stopDraftOpenReads = (draftId: string): void => {
  for (const [read, id] of openReads) {
    if (id === draftId) read.abort();
  }
};
