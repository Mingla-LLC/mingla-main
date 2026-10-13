/**
 * rsvpChipInBankRefusal — issue #3645.
 *
 * The server token `stripe_charges_disabled` on an RSVP write means one thing:
 * chip-ins are switched on and the brand cannot take payments yet. It is not a
 * connection problem, so it must never be shown as "check your connection".
 *
 * `supabase.rpc()` rejects with a PostgREST PLAIN OBJECT, not an `Error`, so
 * the failure is read with `readRpcFailureMessage` (issue #3047), which handles
 * an Error, a plain object and a string and never yields "[object Object]".
 *
 * Since migration 20270824003645 a DRAFT save is no longer refused for this
 * reason; the copy below covers a server that has not received that migration
 * yet, and any other write that still refuses.
 */

import { readRpcFailureMessage } from "../services/rsvpRpcFailure";

/** Host-facing; never names a payment provider. */
export const RSVP_CHIP_IN_SAVE_REFUSED_COPY =
  "This draft can't save with chip-ins on until a bank is connected. Connect a bank, or switch chip-ins off for now.";

/** The generic draft-save failure the route has always shown. */
export const RSVP_DRAFT_SAVE_FAILED_COPY =
  "Couldn't save this draft. Tap Save again or check your connection.";

export const isRsvpChipInBankRefusal = (error: unknown): boolean =>
  readRpcFailureMessage(error).includes("stripe_charges_disabled");

/** One sentence for a failed RSVP draft save: the true reason when known. */
export const rsvpDraftSaveFailureCopy = (error: unknown): string =>
  isRsvpChipInBankRefusal(error)
    ? RSVP_CHIP_IN_SAVE_REFUSED_COPY
    : RSVP_DRAFT_SAVE_FAILED_COPY;
