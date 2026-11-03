// Issue #4130 (Wave 1) — the reads Work › Today and Copy standup share: the
// open cards, what closed since yesterday 09:00 and what changed in the last
// 24 hours. Plain module (no components), so the page and the view share it.
//
// Issue #4255 — Today, This week and This month read the same way (loadPeriod):
// every open card and every card closed inside the window, page by page, so
// "+N more" can always list everything.
import * as ops from "../../services/opsService";
import { lastDaySince, standupSince } from "../../lib/workViews";
import { todayIso } from "../../lib/opsModel";

/** The three reads Copy standup uses. */
export async function loadToday(owner) {
  const now = new Date();
  const [open, standup, feed] = await Promise.all([
    ops.listWork({ status: ["todo", "doing", "person"], done_days: 0, limit: 300, ...(owner ? { owner } : {}) }),
    ops.fetchEventsSince(standupSince(now).toISOString(), owner),
    ops.fetchEventsSince(lastDaySince(now).toISOString(), owner),
  ]);
  return { cards: Array.isArray(open?.cards) ? open.cards : [], truncated: !!open?.truncated, standup, feed };
}

const PAGE = 300;
const MAX_PAGES = 20;

/** Every card a query matches, 300 at a time (at most 6,000). */
export async function listAllWork(query, list = ops.listWork) {
  const cards = [];
  let offset = 0;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const answer = await list({ ...query, limit: PAGE, ...(offset ? { offset } : {}) });
    const got = Array.isArray(answer?.cards) ? answer.cards : [];
    cards.push(...got);
    if (!answer?.truncated || got.length === 0) return { cards, truncated: false };
    offset += got.length;
  }
  return { cards, truncated: true };
}

// [TRANSITIONAL] A server without 20280323004255 refuses closed_since; then
// the done cards come from done_days (up to 60) and are cut to the window
// here. Exit: remove once that migration is applied in production.
function refusesRange(error) {
  return error?.token === "invalid_query" && /closed_since|offset/.test(`${error?.message || ""} ${error?.detail || ""}`);
}

async function closedInWindow(base, win, list) {
  try {
    return await listAllWork({ ...base, status: ["done"], closed_since: win.from.toISOString(), closed_until: win.to.toISOString() }, list);
  } catch (error) {
    if (!refusesRange(error)) throw error;
    const days = Math.min(60, Math.max(1, Math.ceil((Date.now() - win.from.getTime()) / 86_400_000)));
    const answer = await list({ ...base, status: ["done"], done_days: days, limit: PAGE });
    const from = win.from.getTime();
    const to = win.to.getTime();
    const cards = (Array.isArray(answer?.cards) ? answer.cards : []).filter((c) => {
      const t = c?.closed_at ? new Date(c.closed_at).getTime() : NaN;
      return t >= from && t < to;
    });
    return { cards, truncated: !!answer?.truncated };
  }
}

/**
 * The cards of a period tab (lib/workViews.js periodWindow): every open card
 * (the view decides which count) and every card closed inside the window.
 * `owner`, `who` and `q` are the same filters the board sends; on Today the
 * last 24 hours of changes come too ("What changed").
 */
export async function loadPeriod(win, { owner = null, who = "all", q = "" } = {}, list = ops.listWork) {
  const base = { who, today: todayIso(), ...(owner ? { owner } : {}), ...(q ? { q } : {}) };
  const [open, done, feed] = await Promise.all([
    listAllWork({ ...base, status: ["todo", "doing", "person"], done_days: 0 }, list),
    closedInWindow(base, win, list),
    win.view === "today" ? ops.fetchEventsSince(lastDaySince().toISOString(), owner) : Promise.resolve(null),
  ]);
  return { cards: [...open.cards, ...done.cards], truncated: open.truncated || done.truncated, feed };
}
