/**
 * #4420 — thread history: Load earlier (real pagination), Jump to latest and
 * sticky day markers. Pure: no React.
 *
 * The Team chat pages through issue_3720_list_brand_group_messages, 120 per
 * page, newest first, with a `before` cursor (listBrandGroupMessages). A full
 * page means there may be more; a short page means the start of the chat.
 */
export const BRAND_GROUP_PAGE_SIZE = 120;
/** Further than this from the newest message, "Jump to latest" shows. */
export const JUMP_TO_LATEST_DISTANCE = 400;

interface Timed {
  id: string;
  created_at: string;
}

/** Whether a page this long can have older messages before it. */
export function mayHaveEarlier(pageLength: number): boolean {
  return pageLength >= BRAND_GROUP_PAGE_SIZE;
}

function byTime<T extends Timed>(left: T, right: T): number {
  return left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id);
}

/**
 * A fresh newest page replaces everything from its first message on and
 * keeps the older pages already loaded (a refresh never throws away "Load
 * earlier" work, and a message deleted inside the newest page disappears).
 */
export function mergeNewestPage<T extends Timed>(current: readonly T[], page: readonly T[]): T[] {
  if (page.length === 0) return [];
  const start = page[0].created_at;
  const older = current.filter((message) => message.created_at < start);
  const ids = new Set(page.map((message) => message.id));
  return [...older.filter((message) => !ids.has(message.id)), ...page].sort(byTime);
}

/** An older page goes in front; duplicates are dropped. */
export function prependEarlierPage<T extends Timed>(current: readonly T[], older: readonly T[]): T[] {
  const byId = new Map<string, T>();
  for (const message of [...older, ...current]) byId.set(message.id, message);
  return [...byId.values()].sort(byTime);
}

/** The cursor for the next older page: the oldest loaded message's time. */
export function earlierCursor(current: readonly Timed[]): string | null {
  return current[0]?.created_at ?? null;
}

export function showsJumpToLatest(distanceFromLatest: number): boolean {
  return distanceFromLatest > JUMP_TO_LATEST_DISTANCE;
}

/** ScrollView stickyHeaderIndices for the day markers, after `leading` children. */
export function stickyDayIndices(items: readonly { kind: string }[], leading: number): number[] {
  const out: number[] = [];
  items.forEach((item, index) => {
    if (item.kind === "day") out.push(index + leading);
  });
  return out;
}
