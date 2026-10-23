/** Listing-card scarcity copy for an active sale; quantity wins over time. */
export const saleAvailabilityCopy = (
  remaining: number | null | undefined,
  endsAt: string | null | undefined,
  timezone?: string | null,
): string | null => {
  if (typeof remaining === "number" && remaining >= 0 && remaining <= 10) {
    return `Only ${remaining} left at this price`;
  }
  if (!endsAt) return null;
  const end = new Date(endsAt);
  if (!Number.isFinite(end.getTime())) return null;
  const options: Intl.DateTimeFormatOptions = {
    dateStyle: "medium",
    timeStyle: "short",
    ...(timezone ? { timeZone: timezone } : {}),
  };
  try {
    return `Sale ends ${new Intl.DateTimeFormat(undefined, options).format(end)}`;
  } catch {
    delete options.timeZone;
    return `Sale ends ${new Intl.DateTimeFormat(undefined, options).format(end)}`;
  }
};
