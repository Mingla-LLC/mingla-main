// #3872 — pure helpers for the shoot-dates range picker.
import { toIsoDay } from "../../utils/creatorProgramFormat";

export type DayRange = { start: string; end: string };

/** Monday-first grid of "YYYY-MM-DD" (or null padding) for one month. */
export function monthGrid(year: number, month: number): Array<string | null> {
  const first = new Date(year, month, 1);
  const pad = (first.getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const cells: Array<string | null> = Array.from({ length: pad }, () => null);
  for (let day = 1; day <= days; day += 1) cells.push(toIsoDay(new Date(year, month, day)));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/** Tapping a day: first tap starts a range, second tap closes it (swapping if earlier). */
export function nextRange(current: DayRange | null, picking: "start" | "end", day: string): { range: DayRange; picking: "start" | "end" } {
  if (!current || picking === "start") return { range: { start: day, end: day }, picking: "end" };
  if (day < current.start) return { range: { start: day, end: current.start }, picking: "start" };
  return { range: { start: current.start, end: day }, picking: "start" };
}

