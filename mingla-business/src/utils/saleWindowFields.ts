/**
 * #4523 — the ticket sale window is stored as ISO instants; the Mingla calendar
 * speaks local wall-clock `{ date: "YYYY-MM-DD", time: "HH:mm" }`. These two
 * functions are the whole conversion (same local-time reading the browser
 * datetime-local input used), so the saved payload does not change.
 */

export interface SaleFieldValue {
  date: string;
  time: string;
}

export const saleFieldValue = (iso: string | null): SaleFieldValue => {
  if (iso === null) return { date: "", time: "" };
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return { date: "", time: "" };
  const pad = (n: number): string => String(n).padStart(2, "0");
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
};

export const isoFromSaleField = (next: SaleFieldValue): string => {
  const [y, m, d] = next.date.split("-").map(Number);
  const [h, mm] = next.time.split(":").map(Number);
  return new Date(y, m - 1, d, h, mm, 0, 0).toISOString();
};
