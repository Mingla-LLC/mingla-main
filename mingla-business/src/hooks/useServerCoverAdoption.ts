/**
 * Adopt a cover the server applied while the Cover sheet was closed.
 *
 * The Cover sheet tells the host "You can close this sheet—we'll finish
 * automatically" for an event-target `draft_auto` video. The finishing happens
 * on the server (the Bunny webhook applies the job to events.cover_media_*),
 * but the picker that would have copied it into the local draft unmounts with
 * the sheet. The Step 4 card and the Preview kept the placeholder, and the next
 * autosave used to erase the server's video.
 *
 * This hook closes the client half: while the wizard is mounted it reads the
 * server draft's cover
 *   - whenever `pulse` changes (the wizard passes its current step, so moving to
 *     the next step — or to Preview — re-checks),
 *   - when the app returns to the foreground,
 *   - every POLL_INTERVAL_MS while `watching` (a cover video was still
 *     processing when its sheet closed), for at most WATCH_LIMIT_MS,
 * and hands a server cover to `onAdopt` when `shouldAdoptServerCover` says the
 * host has not changed the cover since the base this session last received.
 *
 * Inert without `fetchServerCover` (render tests, the published editor) and on
 * a local-only `d_*` draft, which has no server row to read.
 */

import { useCallback, useEffect, useRef } from "react";
import { AppState } from "react-native";

import {
  recordServerCoverBase,
  serverCoverBaseFor,
  shouldAdoptServerCover,
  type ServerDraftCover,
} from "../utils/draftCoverBase";

export const SERVER_COVER_POLL_INTERVAL_MS = 5_000;
export const SERVER_COVER_WATCH_LIMIT_MS = 30 * 60_000;

export type FetchServerCover = (
  draftId: string,
) => Promise<ServerDraftCover | null>;

/**
 * One check. Exported for tests: reads the server cover, keeps the base in step,
 * and calls `onAdopt` when the server cover should replace the local one.
 * Resolves true when it adopted. Never throws — a failed read is retried by the
 * next trigger.
 */
export const checkServerCoverOnce = async (args: {
  draftId: string;
  fetchServerCover: FetchServerCover;
  getLocalCoverUrl: () => string | null;
  onAdopt: (cover: ServerDraftCover) => void;
}): Promise<boolean> => {
  const { draftId, fetchServerCover, getLocalCoverUrl, onAdopt } = args;
  let server: ServerDraftCover | null;
  try {
    server = await fetchServerCover(draftId);
  } catch {
    return false;
  }
  if (server === null) return false;
  const localUrl = getLocalCoverUrl();
  if (server.coverMediaUrl === localUrl) {
    // Already in agreement: that is now the base both sides merge against.
    recordServerCoverBase(draftId, server.coverMediaUrl);
    return false;
  }
  if (
    !shouldAdoptServerCover({
      serverUrl: server.coverMediaUrl,
      baseUrl: serverCoverBaseFor(draftId),
      localUrl,
    })
  ) {
    return false;
  }
  recordServerCoverBase(draftId, server.coverMediaUrl);
  onAdopt(server);
  return true;
};

export const useServerCoverAdoption = (args: {
  draftId: string;
  fetchServerCover: FetchServerCover | undefined;
  localCoverUrl: string | null;
  watching: boolean;
  pulse: unknown;
  onAdopt: (cover: ServerDraftCover) => void;
}): void => {
  const { draftId, fetchServerCover, localCoverUrl, watching, pulse, onAdopt } =
    args;
  const localRef = useRef(localCoverUrl);
  localRef.current = localCoverUrl;
  const onAdoptRef = useRef(onAdopt);
  onAdoptRef.current = onAdopt;
  const inFlightRef = useRef(false);

  const enabled = fetchServerCover !== undefined && !draftId.startsWith("d_");

  const check = useCallback((): void => {
    if (!enabled || fetchServerCover === undefined || inFlightRef.current) {
      return;
    }
    inFlightRef.current = true;
    void checkServerCoverOnce({
      draftId,
      fetchServerCover,
      getLocalCoverUrl: () => localRef.current,
      onAdopt: (cover) => onAdoptRef.current(cover),
    }).finally(() => {
      inFlightRef.current = false;
    });
  }, [draftId, enabled, fetchServerCover]);

  // Mount + every step change.
  useEffect(() => {
    check();
  }, [check, pulse]);

  // Foreground.
  useEffect(() => {
    if (!enabled) return undefined;
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") check();
    });
    return () => subscription.remove();
  }, [check, enabled]);

  // Poll while a cover video is still processing server-side.
  useEffect(() => {
    if (!enabled || !watching) return undefined;
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - startedAt > SERVER_COVER_WATCH_LIMIT_MS) {
        clearInterval(timer);
        return;
      }
      check();
    }, SERVER_COVER_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [check, enabled, watching]);
};
