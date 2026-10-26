// Issue #4130 (Wave 1) — the reads Work › Today and Copy standup share: the
// open cards, what closed since yesterday 09:00 and what changed in the last
// 24 hours. Plain module (no components), so the page and the view share it.
import * as ops from "../../services/opsService";
import { lastDaySince, standupSince } from "../../lib/workViews";

/** The three reads Today and Copy standup share. */
export async function loadToday(owner) {
  const now = new Date();
  const [open, standup, feed] = await Promise.all([
    ops.listWork({ status: ["todo", "doing", "person"], done_days: 0, limit: 300, ...(owner ? { owner } : {}) }),
    ops.fetchEventsSince(standupSince(now).toISOString(), owner),
    ops.fetchEventsSince(lastDaySince(now).toISOString(), owner),
  ]);
  return { cards: Array.isArray(open?.cards) ? open.cards : [], truncated: !!open?.truncated, standup, feed };
}
