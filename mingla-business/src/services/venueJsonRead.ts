/**
 * #4490 — small defensive readers for the venue RPC and edge JSON (the JSON is
 * the server's, not ours). A leaf shared by the Host and Guest venue services,
 * so neither side pulls the other's code along.
 */
export type Json = Record<string, unknown>;
export const obj = (v: unknown): Json => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
export const strOrNull = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
export const num = (v: unknown, fallback = 0): number => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return fallback;
};
export const numOrNull = (v: unknown): number | null =>
  v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null;
export const weekdays = (v: unknown): number[] =>
  arr(v)
    .map((d) => Number(d))
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
