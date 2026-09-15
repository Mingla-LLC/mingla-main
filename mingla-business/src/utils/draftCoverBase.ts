/**
 * Draft cover base — the cover each draft last received FROM THE SERVER.
 *
 * WHY. A cover video picked on the Cover step finishes on the server: the
 * Bunny webhook applies a `draft_auto` job straight to `events.cover_media_*`,
 * often minutes after the host has closed the sheet and moved on. The wizard's
 * local draft never learns about it, so its next autosave sent the stale cover
 * (none) and erased the video — "You can close this sheet—we'll finish
 * automatically" finished nothing.
 *
 * The fix is a three-way merge, and this module holds its third leg:
 *   - the autosave sends `__coverBase` (this value) alongside its cover, and
 *     the draft owners keep the stored cover when the client's cover is still
 *     its base but the server's has moved;
 *   - the wizard adopts a server cover only when the local cover is still the
 *     base (the host has not changed it in the meantime).
 *
 * In memory on purpose: it describes what THIS session last received. A cold
 * start has no base, and both sides fall back to their conservative rules.
 * No runtime store, React or Supabase import (types only), so services and the
 * store can share it.
 */

import type { DraftEvent } from "../store/draftEventStore";

/** Every cover field a draft carries, as the server currently holds them. */
export type ServerDraftCover = {
  [K in
    | "coverMediaUrl"
    | "coverMediaPosterUrl"
    | "coverMediaType"
    | "coverMediaProvider"
    | "coverMediaSourceUrl"
    | "coverMediaCredit"
    | "coverMediaCreditUrl"
    | "coverMediaAlt"]-?: Exclude<DraftEvent[K], undefined>;
};

const bases = new Map<string, string | null>();

/** Record the cover URL a server copy of this draft carried. */
export const recordServerCoverBase = (
  draftId: string,
  coverMediaUrl: string | null | undefined,
): void => {
  bases.set(draftId, coverMediaUrl ?? null);
};

/** The recorded base, or `undefined` when this session has not seen one. */
export const serverCoverBaseFor = (draftId: string): string | null | undefined =>
  bases.has(draftId) ? (bases.get(draftId) ?? null) : undefined;

/** Test/reset hook. */
export const forgetServerCoverBase = (draftId?: string): void => {
  if (draftId === undefined) bases.clear();
  else bases.delete(draftId);
};

/** The autosave payload extension: `{ __coverBase }` only when a base is known. */
export const coverBasePayload = (
  draftId: string,
): { __coverBase?: string | null } => {
  const base = serverCoverBaseFor(draftId);
  return base === undefined ? {} : { __coverBase: base };
};

/**
 * Should the wizard adopt the server's cover?
 *
 * - Nothing to do when the server and the local draft already agree.
 * - With a known base: adopt when the server moved away from the base AND the
 *   local cover is still the base (the host did not change it).
 * - Without a base: adopt only a server cover onto a draft that has none —
 *   never overwrite a cover the host may have just picked.
 */
export const shouldAdoptServerCover = (args: {
  serverUrl: string | null;
  baseUrl: string | null | undefined;
  localUrl: string | null;
}): boolean => {
  const { serverUrl, baseUrl, localUrl } = args;
  if (serverUrl === localUrl) return false;
  if (baseUrl === undefined) return localUrl === null && serverUrl !== null;
  return serverUrl !== baseUrl && localUrl === baseUrl;
};
