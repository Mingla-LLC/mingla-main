/**
 * issue #3281 — Extras on a ticket tier: the editor's validation and helpers.
 *
 * The database remains the authority: every function here is a courtesy that
 * mirrors `issue_3281_normalize_tier_extras` and the sold locks in
 * `issue_3281_sync_live_tier_extras`, never a substitute for them.
 */

import type { TicketExtraStub } from "../store/draftEventStore";

export { extrasFromServer } from "./ticketExtrasFromServer";

export const MAX_EXTRAS_PER_TIER = 20;
export const MAX_PER_TICKET_LIMIT = 20;

let extraCounter = 0;

/** A new extra's id until it saves; the server swaps it for a row id. */
export const generateExtraId = (): string => {
  extraCounter += 1;
  return `x_${Date.now().toString(36)}${extraCounter.toString(36)}`;
};

export const emptyExtra = (): TicketExtraStub => ({
  id: generateExtraId(),
  name: "",
  description: null,
  priceGbp: 0,
  isUnlimited: false,
  capacity: null,
  maxPerTicket: 1,
  validDayIds: null,
});

/** The first problem with an extra, as a sentence, or null when it can save. */
export const validateTicketExtra = (
  extra: TicketExtraStub,
  options: { tierIsFree: boolean },
): string | null => {
  const name = extra.name.trim();
  if (name.length === 0) return "Give this extra a name.";
  if (name.length > 120) return "Keep the name to 120 characters.";
  if ((extra.description ?? "").trim().length > 280) {
    return "Keep the description to 280 characters.";
  }
  if (!Number.isFinite(extra.priceGbp) || extra.priceGbp < 0) {
    return "An extra can't cost less than nothing. If you want a cheaper option, add a second ticket type.";
  }
  if (Number(extra.priceGbp.toFixed(2)) !== extra.priceGbp) {
    return "Use at most two decimal places for the price.";
  }
  if (extra.priceGbp > 0 && options.tierIsFree) {
    return "A free ticket can only have free extras.";
  }
  if (!extra.isUnlimited) {
    if (
      extra.capacity === null ||
      !Number.isInteger(extra.capacity) ||
      extra.capacity < 1
    ) {
      return "Capacity must be 1 or more.";
    }
    const floor = extra.capacityFloor ?? extra.soldCount ?? 0;
    if (extra.capacity < floor) {
      return extra.validDayIds === null
        ? `Capacity is below the ${floor} already sold.`
        : `Capacity is below the ${floor} already sold on its busiest date.`;
    }
  }
  if (
    !Number.isInteger(extra.maxPerTicket) ||
    extra.maxPerTicket < 1 ||
    extra.maxPerTicket > MAX_PER_TICKET_LIMIT
  ) {
    return `Allow between 1 and ${MAX_PER_TICKET_LIMIT} per ticket.`;
  }
  if (extra.validDayIds !== null && extra.validDayIds.length === 0) {
    return "Choose at least one date for this extra.";
  }
  return null;
};

/** Keeps an extra's dates inside its tier's dates; null tier dates keep all. */
export const keepExtraDaysInTier = (
  extras: readonly TicketExtraStub[],
  tierDayIds: readonly string[] | null,
): TicketExtraStub[] =>
  extras.map((extra) =>
    extra.validDayIds === null || tierDayIds === null
      ? extra
      : {
          ...extra,
          validDayIds: extra.validDayIds.filter((id) =>
            tierDayIds.includes(id),
          ),
        },
  );
