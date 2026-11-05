/**
 * issue #3281 — Extras at the door. An extra is a count on the order, never a
 * seat (#3283 §2.5), so the door is told the count still owed: "Extras:
 * Friday dinner × 2 · Tote bag × 1". When the scan knows the day it admitted,
 * an extra for other days only says so, so nobody is handed Friday's dinner
 * on Saturday.
 */

export interface DoorExtra {
  name: string;
  quantity: number;
  /** event_dates ids it is for; null means every date the ticket admits. */
  eventDateIds: string[] | null;
}

/** Reads `extras` off a scan or door-search answer; anything malformed is dropped. */
export const readDoorExtras = (value: unknown): DoorExtra[] =>
  Array.isArray(value)
    ? value.flatMap((raw) => {
        const x = raw as Record<string, unknown> | null;
        if (
          x === null ||
          typeof x !== "object" ||
          typeof x.name !== "string" ||
          !Number.isInteger(x.quantity) ||
          (x.quantity as number) < 1
        ) {
          return [];
        }
        return [
          {
            name: x.name,
            quantity: x.quantity as number,
            eventDateIds: Array.isArray(x.eventDateIds)
              ? x.eventDateIds.filter((id): id is string => typeof id === "string")
              : null,
          },
        ];
      })
    : [];

/** "Extras: Friday dinner × 2 · Tote bag × 1", or null when there are none. */
export const doorExtrasLine = (
  extras: readonly DoorExtra[],
  admittedDateId: string | null = null,
): string | null => {
  if (extras.length === 0) return null;
  const parts = extras.map((extra) => {
    const otherDay =
      admittedDateId !== null &&
      extra.eventDateIds !== null &&
      !extra.eventDateIds.includes(admittedDateId);
    return `${extra.name} × ${extra.quantity}${otherDay ? " (another day)" : ""}`;
  });
  return `Extras: ${parts.join(" · ")}`;
};
