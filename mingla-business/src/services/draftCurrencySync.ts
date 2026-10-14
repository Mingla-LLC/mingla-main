/**
 * Issue #3645 — the way out of a Publish refused with `price_reentry_required`.
 *
 * The ONLY caller of `biz_sync_draft_currency`. That function runs, for one
 * draft, the same routine the brand trigger runs: if the draft may be moved it
 * goes to the brand's currency with its prices cleared; if a checkout is still
 * in progress or a sale exists it is left alone. The server decides; this file
 * holds no rule of its own.
 */
import { supabase } from "./supabase";
import {
  PRICE_REENTRY_REQUIRED_CODE,
  draftCurrencySyncOutcomeCode,
} from "../utils/draftCurrencyPublishRefusal";

const failureMessage = (error: unknown): string => {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "";
};

export const syncDraftCurrency = async (eventId: string): Promise<string> => {
  const { data, error } = await supabase.rpc("biz_sync_draft_currency", {
    p_event_id: eventId,
  });
  if (error !== null && error !== undefined) throw error;
  const outcome = (data as { outcome?: unknown } | null)?.outcome;
  return typeof outcome === "string" ? outcome : "";
};

/**
 * Run a publish. If the server refuses it with `price_reentry_required`, ask
 * the server to bring the draft in step, let the caller re-read it
 * (`onSynced`), and re-throw:
 *   - the original refusal when the draft was moved (the host now sees empty
 *     price fields and is told to enter prices again) or is no longer a draft;
 *   - `draft_currency_checkout_in_progress` when a checkout or a sale stops
 *     it, `draft_currency_brand_has_none` when the brand has no currency.
 * A failure of the sync itself is logged and the original refusal stands.
 */
export const publishWithDraftCurrencySync = async <T>(
  eventId: string,
  publish: () => Promise<T>,
  onSynced: () => Promise<void> | void,
): Promise<T> => {
  try {
    return await publish();
  } catch (refusal) {
    if (failureMessage(refusal) !== PRICE_REENTRY_REQUIRED_CODE) throw refusal;
    let outcome: string;
    try {
      outcome = await syncDraftCurrency(eventId);
    } catch (syncError) {
      console.warn("[publishWithDraftCurrencySync] could not bring the draft in step", {
        eventId,
        message: failureMessage(syncError),
      });
      throw refusal;
    }
    try {
      await onSynced();
    } catch (readError) {
      console.warn("[publishWithDraftCurrencySync] could not re-read the draft", {
        eventId,
        message: failureMessage(readError),
      });
    }
    // The answer decides the words (utils/draftCurrencyPublishRefusal). When
    // there is nothing new to say, the original refusal stands.
    const code = draftCurrencySyncOutcomeCode(outcome);
    if (code === null) throw refusal;
    throw new Error(code);
  }
};
