/**
 * Issue #4114 Wave 3: the thread's scroll-to-latest button. Shown once you
 * scroll more than `threshold` away from the newest message (an inverted list,
 * so offset 0 is the latest); counts incoming messages that land meanwhile.
 *
 * Issue #4114: sending your own message jumps to it from anywhere in the
 * thread (see `newestArrivalAction`). The jump runs once the new row has laid
 * out (`handleContentSizeChange`), so maintainVisibleContentPosition does not
 * hold you where you were.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { FlatList, NativeScrollEvent, NativeSyntheticEvent } from "react-native";

import { newestArrivalAction, type NewestMessage } from "../utils/threadModel";

/** If the new row never reports a size change, jump anyway after this long. */
const JUMP_FALLBACK_MS = 250;
/** While a jump animates, scroll events still far from the latest do not re-show the button. */
const JUMP_SETTLE_MS = 1000;

export function useScrollToLatest<T>(input: {
  listRef: React.RefObject<FlatList<T> | null>;
  newest: NewestMessage | null;
  threshold: number;
  /** Called when your own send jumps to the latest (clears the new-messages divider). */
  onOwnSendJump?: () => void;
}): {
  showScrollToLatest: boolean;
  unseenWhileScrolled: number;
  handleThreadScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  handleContentSizeChange: () => void;
  scrollToLatest: () => void;
} {
  const { listRef, newest, threshold, onOwnSendJump } = input;
  const [showScrollToLatest, setShowScrollToLatest] = useState(false);
  const [unseenWhileScrolled, setUnseenWhileScrolled] = useState(0);
  const awayRef = useRef(false);
  const jumpingUntilRef = useRef(0);
  const pendingJumpRef = useRef(false);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onOwnSendJumpRef = useRef(onOwnSendJump);
  onOwnSendJumpRef.current = onOwnSendJump;

  const handleThreadScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const away = event.nativeEvent.contentOffset.y > threshold;
      if (away && Date.now() < jumpingUntilRef.current) return;
      if (!away) jumpingUntilRef.current = 0;
      if (away === awayRef.current) return;
      awayRef.current = away;
      setShowScrollToLatest(away);
      if (!away) setUnseenWhileScrolled(0);
    },
    [threshold],
  );

  const jumpToLatest = useCallback(() => {
    pendingJumpRef.current = false;
    if (fallbackTimerRef.current) {
      clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
    jumpingUntilRef.current = Date.now() + JUMP_SETTLE_MS;
    awayRef.current = false;
    setShowScrollToLatest(false);
    setUnseenWhileScrolled(0);
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
  }, [listRef]);

  const handleContentSizeChange = useCallback(() => {
    if (pendingJumpRef.current) jumpToLatest();
  }, [jumpToLatest]);

  const previousNewestRef = useRef<NewestMessage | null>(newest);
  const newestId = newest?.id ?? null;
  const newestKey = newest?.key ?? null;
  const newestIsMine = newest?.isMine ?? false;
  useEffect(() => {
    const next = newestId && newestKey ? { id: newestId, key: newestKey, isMine: newestIsMine } : null;
    const action = newestArrivalAction(previousNewestRef.current, next, awayRef.current);
    previousNewestRef.current = next;
    if (action === "countUnseen") {
      setUnseenWhileScrolled((count) => count + 1);
    } else if (action === "jumpToLatest") {
      onOwnSendJumpRef.current?.();
      pendingJumpRef.current = true;
      if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = setTimeout(() => {
        if (pendingJumpRef.current) jumpToLatest();
      }, JUMP_FALLBACK_MS);
    }
  }, [jumpToLatest, newestId, newestIsMine, newestKey]);

  useEffect(
    () => () => {
      if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
    },
    [],
  );

  const scrollToLatest = useCallback(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
    setUnseenWhileScrolled(0);
  }, [listRef]);

  return { showScrollToLatest, unseenWhileScrolled, handleThreadScroll, handleContentSizeChange, scrollToLatest };
}
