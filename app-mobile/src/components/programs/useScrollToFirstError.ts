import { useCallback, useRef } from 'react';
import type { LayoutChangeEvent, ScrollView, TextInput } from 'react-native';

import { firstErrorKey, scrollTargetY } from './formFocus';

/**
 * #4445: one small helper for any ProgramScreen form. Give `scrollRef` to the screen,
 * wrap each field in a View with `onLayout={layoutOf(key)}`, give a text field
 * `inputRef={inputOf(key)}`, then call `scrollToFirstError(order, hasError)` when a
 * submit is blocked.
 */
export function useScrollToFirstError<K extends string>(): {
  scrollRef: React.RefObject<ScrollView | null>;
  layoutOf: (key: K) => (event: LayoutChangeEvent) => void;
  inputOf: (key: K) => (node: TextInput | null) => void;
  scrollToFirstError: (order: readonly K[], hasError: Partial<Record<K, boolean>>) => K | null;
} {
  const scrollRef = useRef<ScrollView | null>(null);
  const ys = useRef<Partial<Record<K, number>>>({});
  const inputs = useRef<Partial<Record<K, TextInput | null>>>({});
  const layoutOf = useCallback((key: K) => (event: LayoutChangeEvent): void => { ys.current[key] = event.nativeEvent.layout.y; }, []);
  const inputOf = useCallback((key: K) => (node: TextInput | null): void => { inputs.current[key] = node; }, []);
  const scrollToFirstError = useCallback((order: readonly K[], hasError: Partial<Record<K, boolean>>): K | null => {
    const key = firstErrorKey(order, hasError);
    if (!key) return null;
    const y = ys.current[key];
    if (typeof y === 'number') scrollRef.current?.scrollTo({ y: scrollTargetY(y), animated: true });
    // Focus after the scroll starts so the keyboard does not fight it.
    setTimeout(() => inputs.current[key]?.focus(), 250);
    return key;
  }, []);
  return { scrollRef, layoutOf, inputOf, scrollToFirstError };
}
