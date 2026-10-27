/**
 * Issue #4114 Wave 3: the composer grows (up to 5 lines), so its height is no
 * longer the fixed 56pt capsule. This hook measures the floating composer
 * (reply bar + capsule) so the thread's bottom padding follows it and the last
 * message is never hidden behind a taller composer.
 */
import { useCallback, useState } from "react";
import type { LayoutChangeEvent } from "react-native";
import { COMPOSER_MIN_HEIGHT } from "../utils/threadModel";

export function useComposerLayout(): {
  composerHeight: number;
  onComposerLayout: (event: LayoutChangeEvent) => void;
} {
  const [composerHeight, setComposerHeight] = useState<number>(COMPOSER_MIN_HEIGHT);
  const onComposerLayout = useCallback((event: LayoutChangeEvent) => {
    const next = Math.max(COMPOSER_MIN_HEIGHT, Math.round(event.nativeEvent.layout.height));
    setComposerHeight((prev) => (prev === next ? prev : next));
  }, []);
  return { composerHeight, onComposerLayout };
}
