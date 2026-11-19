/**
 * #4420 — plan activity in the Team chat folds into one card.
 *
 * A quiet plan line is a system message with no sender (#4270: "Mingla added
 * “Last call” to the plan for Tue 25 Nov."). Plan lines that follow each other
 * on the same day, with nothing between them, become ONE card ("Mingla added
 * 11 items to the plan") instead of eleven grey lines. Same rule as Admin's
 * foldThread (mingla-admin/src/lib/brandGroupInbox.js): a day change or any
 * other message ends the run. Pure: no React, no services.
 */
import type { BrandGroupClusterInput, BrandGroupThreadItem } from "./brandGroupThreadModel";

export interface BrandPlanLineInput extends BrandGroupClusterInput {
  content: string;
}

export type BrandFoldedThreadItem<T extends BrandPlanLineInput> =
  | BrandGroupThreadItem<T>
  | { kind: "plan"; key: string; lines: T[] };

/** A quiet plan line: a system message nobody sent. */
export function isBrandPlanLine(message: { message_type?: string | null; sender_id: string | null }): boolean {
  return message.message_type === "system" && !message.sender_id;
}

/** Day separators + bubbles → the same, with each run of plan lines folded into one card. */
export function foldBrandPlanLines<T extends BrandPlanLineInput>(
  items: readonly BrandGroupThreadItem<T>[],
): BrandFoldedThreadItem<T>[] {
  const out: BrandFoldedThreadItem<T>[] = [];
  for (const item of items) {
    if (item.kind === "message" && isBrandPlanLine(item.message)) {
      const previous = out[out.length - 1];
      if (previous && previous.kind === "plan") previous.lines.push(item.message);
      else out.push({ kind: "plan", key: `plan-${item.message.id}`, lines: [item.message] });
      continue;
    }
    out.push(item);
  }
  return out;
}

/** "Mingla added 11 items to the plan" when one person added them all, else "3 plan updates". */
export function brandPlanActivityTitle(lines: readonly { content: string }[]): string {
  const n = lines.length;
  const names = lines.map((line) => /^(.+?) added “/.exec(line.content ?? "")?.[1] ?? null);
  if (n > 0 && names.every((name) => name !== null && name === names[0])) {
    return `${names[0]} added ${n} ${n === 1 ? "item" : "items"} to the plan`;
  }
  return `${n} ${n === 1 ? "plan update" : "plan updates"}`;
}

/** How many lines the card shows before "Show all". */
export const BRAND_PLAN_CARD_PREVIEW = 3;
