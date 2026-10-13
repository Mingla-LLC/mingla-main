/**
 * issue #3237 — the one-shot "this was just published" signal.
 *
 * After a successful Publish the host lands on the item's manage screen, which
 * shows a "Published. It's live." banner once. The publish route marks the item
 * id here just before it navigates; the manage screen consumes the mark when it
 * mounts.
 *
 * In memory on purpose, not a `?published=1` route param:
 *   - a refresh or a later visit never re-shows the banner (nothing is left in
 *     the URL to replay), and there is no param to scrub afterwards;
 *   - the trip route's publish destination is pinned as the bare `/trip/{id}`
 *     literal by an existing test, so a query string cannot ride on it.
 *
 * A mark is consumed exactly once and expires, so a publish whose navigation
 * never arrived cannot surface a stale banner much later in the session.
 *
 * Client-only UI state (Constitution #5): nothing here is fetched from the
 * server and nothing is persisted.
 */

/** How long a mark stays claimable. Covers a slow first render after publish. */
export const JUST_PUBLISHED_TTL_MS = 60_000;

const pending = new Map<string, number>();

const isUsableId = (id: string | null | undefined): id is string =>
  typeof id === "string" && id.length > 0;

const isFresh = (markedAt: number | undefined, nowMs: number): boolean =>
  markedAt !== undefined && nowMs - markedAt <= JUST_PUBLISHED_TTL_MS;

/** Called by a publish route straight after the server confirms the publish. */
export const markJustPublished = (
  id: string | null | undefined,
  nowMs: number = Date.now(),
): void => {
  if (!isUsableId(id)) return;
  pending.set(id, nowMs);
};

/** True while an unclaimed, unexpired mark exists. Does not consume it. */
export const isJustPublishedPending = (
  id: string | null | undefined,
  nowMs: number = Date.now(),
): boolean => isUsableId(id) && isFresh(pending.get(id), nowMs);

/** Claims the mark. Returns true once per publish, then false. */
export const consumeJustPublished = (
  id: string | null | undefined,
  nowMs: number = Date.now(),
): boolean => {
  if (!isUsableId(id)) return false;
  const markedAt = pending.get(id);
  if (markedAt === undefined) return false;
  pending.delete(id);
  return isFresh(markedAt, nowMs);
};

/** Test seam — module state must not leak between test cases. */
export const resetJustPublishedForTests = (): void => {
  pending.clear();
};
