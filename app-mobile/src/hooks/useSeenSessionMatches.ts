/**
 * Issue #4114 Wave 3 (D9): which collab matches this phone has already opened,
 * so the header's matches cell can show a dot for the new ones.
 *
 * Client-only and keyed per session. Browser-style storage can come back empty
 * or throw (cleared data, a fresh install); every read and write is guarded and
 * the dot simply shows until the matches sheet is opened again.
 */
import { useCallback, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

/** Per-account (cleared on logout by utils/authCleanup). */
export const SEEN_MATCHES_KEY_PREFIX = "chat:seen-matches:";
const KEY_PREFIX = SEEN_MATCHES_KEY_PREFIX;

export function useSeenSessionMatches(sessionId: string | null | undefined): {
  seenIds: ReadonlySet<string>;
  markSeen: (ids: readonly string[]) => void;
} {
  const [seenIds, setSeenIds] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    let active = true;
    setSeenIds(new Set());
    if (!sessionId) return undefined;
    AsyncStorage.getItem(`${KEY_PREFIX}${sessionId}`)
      .then((raw) => {
        if (!active || !raw) return;
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setSeenIds(new Set(parsed.filter((id): id is string => typeof id === "string")));
        }
      })
      .catch((error: unknown) => {
        console.warn("[useSeenSessionMatches] read failed; matches show as new", error);
      });
    return () => {
      active = false;
    };
  }, [sessionId]);

  const markSeen = useCallback(
    (ids: readonly string[]) => {
      if (!sessionId || ids.length === 0) return;
      setSeenIds((prev) => {
        if (ids.every((id) => prev.has(id))) return prev;
        const next = new Set(prev);
        ids.forEach((id) => next.add(id));
        AsyncStorage.setItem(`${KEY_PREFIX}${sessionId}`, JSON.stringify([...next].slice(-200))).catch(
          (error: unknown) => {
            console.warn("[useSeenSessionMatches] write failed", error);
          },
        );
        return next;
      });
    },
    [sessionId],
  );

  return { seenIds, markSeen };
}
