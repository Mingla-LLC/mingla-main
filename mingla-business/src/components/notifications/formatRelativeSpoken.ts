/**
 * #4238 W7 (native P4-3): the spoken time for the row's screen-reader label.
 * The visual "now" / "5m" / "12 Nov" read as "now ago" and "12 Nov ago".
 */
export function formatRelativeSpoken(iso: string, nowMs: number = Date.now()): string {
  const at = new Date(iso).getTime();
  if (!Number.isFinite(at)) return "";
  const minutes = Math.floor((nowMs - at) / 60000);
  const plural = (n: number, unit: string): string => `${n} ${unit}${n === 1 ? "" : "s"} ago`;
  if (minutes < 1) return "just now";
  if (minutes < 60) return plural(minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return plural(hours, "hour");
  const days = Math.floor(hours / 24);
  if (days < 7) return plural(days, "day");
  return `on ${new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
}
