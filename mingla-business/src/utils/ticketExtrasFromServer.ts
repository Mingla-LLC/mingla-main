/**
 * issue #3281 — reads a tier's extras from a server payload. Kept apart from
 * `ticketExtras.ts` because the eager service mappers need only this, while the
 * editor helpers stay in the lazy ticket sheet chunk.
 */

import type { TicketExtraStub } from "../store/draftEventStore";

/**
 * Reads a tier's extras from a server payload. Anything that isn't a list is
 * "not loaded" (undefined), so a later save leaves the server's extras alone.
 */
export const extrasFromServer = (
  value: unknown,
): TicketExtraStub[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const extras: TicketExtraStub[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    if (typeof row.id !== "string" || typeof row.name !== "string") continue;
    const price = Number(row.priceGbp ?? 0);
    const capacity =
      row.capacity === null || row.capacity === undefined
        ? null
        : Number(row.capacity);
    extras.push({
      id: row.id,
      name: row.name,
      description: typeof row.description === "string" ? row.description : null,
      priceGbp: Number.isFinite(price) ? price : 0,
      isUnlimited: row.isUnlimited === true,
      capacity:
        capacity !== null && Number.isFinite(capacity) ? capacity : null,
      maxPerTicket: Number.isInteger(row.maxPerTicket)
        ? Number(row.maxPerTicket)
        : 1,
      validDayIds: Array.isArray(row.validDayIds)
        ? row.validDayIds.filter((id): id is string => typeof id === "string")
        : null,
      ...(Number.isInteger(row.soldCount)
        ? { soldCount: Number(row.soldCount) }
        : {}),
    });
  }
  return extras;
};
