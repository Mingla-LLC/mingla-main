/**
 * Issue #4114 Wave 3: the thread's scroll-to-latest button. Shown once you
 * scroll more than `threshold` away from the newest message (an inverted list,
 * so offset 0 is the latest); counts incoming messages that land meanwhile.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { FlatList, NativeScrollEvent, NativeSyntheticEvent } from "react-native";

export function useScrollToLatest<T>(input: {
  listRef: React.RefObject<FlatList<T> | null>;
  newestMessageId: string | null;
  newestIsMine: boolean;
  threshold: number;
}): {
  showScrollToLatest: boolean;
  unseenWhileScrolled: number;
  handleThreadScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  scrollToLatest: () => void;
} {
  const { listRef, newestMessageId, newestIsMine, threshold } = input;
  const [showScrollToLatest, setShowScrollToLatest] = useState(false);
  const [unseenWhileScrolled, setUnseenWhileScrolled] = useState(0);
  const awayRef = useRef(false);

  const handleThreadScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const away = event.nativeEvent.contentOffset.y > threshold;
      if (away === awayRef.current) return;
      awayRef.current = away;
      setShowScrollToLatest(away);
      if (!away) setUnseenWhileScrolled(0);
    },
    [threshold],
  );

  const previousNewestRef = useRef<string | null>(newestMessageId);
  useEffect(() => {
    if (newestMessageId && newestMessageId !== previousNewestRef.current && awayRef.current && !newestIsMine) {
      setUnseenWhileScrolled((count) => count + 1);
    }
    previousNewestRef.current = newestMessageId;
  }, [newestIsMine, newestMessageId]);

  const scrollToLatest = useCallback(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
    setUnseenWhileScrolled(0);
  }, [listRef]);

  return { showScrollToLatest, unseenWhileScrolled, handleThreadScroll, scrollToLatest };
}
