import type { PublicEventOccurrence } from "../services/publicEventOccurrencesService";

const nonEmptyString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value : null;

const validInstant = (value: string): boolean =>
  Number.isFinite(Date.parse(value));

/**
 * issue #2399 — the one app-local owner of buyer occurrence normalization.
 * Invalid rows are discarded, duplicate ids cannot create duplicate choices,
 * and output order is canonical chronology rather than transport/tap order.
 */
export const normalizePublicEventOccurrences = (
  value: unknown,
  fallbackTimezone: string | null,
): PublicEventOccurrence[] => {
  if (!Array.isArray(value)) return [];
  const byId = new Map<string, PublicEventOccurrence>();
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) continue;
    const row = raw as Record<string, unknown>;
    const id = nonEmptyString(row.id);
    const startAt = nonEmptyString(row.startAt);
    const endAt = nonEmptyString(row.endAt);
    if (
      id === null ||
      startAt === null ||
      endAt === null ||
      !validInstant(startAt) ||
      !validInstant(endAt) ||
      Date.parse(endAt) < Date.parse(startAt)
    ) {
      continue;
    }
    const timezone = nonEmptyString(row.timezone) ?? fallbackTimezone ?? "UTC";
    byId.set(id, {
      id,
      startAt,
      endAt,
      timezone,
      isMaster: row.isMaster === true,
      ticketsRemaining: null,
    });
  }
  return [...byId.values()].sort(
    (a, b) =>
      Date.parse(a.startAt) - Date.parse(b.startAt) || a.id.localeCompare(b.id),
  );
};
