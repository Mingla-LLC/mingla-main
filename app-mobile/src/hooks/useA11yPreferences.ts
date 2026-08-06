/**
 * a11yPreferences — ONE app-wide reduce-motion / reduce-transparency probe.
 *
 * Issue #1638 (Track A: make the destination cheaper to reach).
 *
 * THE PROBLEM THIS REPLACES
 * -------------------------
 * 25 components each ran their own `AccessibilityInfo.isReduce*` probe in a mount
 * effect, each registered its own `addEventListener` pair, and each re-rendered a second
 * time when its promise resolved. Three of those components are rendered PER INSTANCE
 * (`GlassCard`, `GlassIconButton`, `GlassBadge`) — ProfilePage alone mounts six
 * `GlassCard`s, so a single tab switch to Profile paid six native round trips and six
 * extra re-renders for an answer that is identical for every component on the screen and
 * changes only when the user edits a system setting.
 *
 * Per React Native's own `AccessibilityInfo`:
 *   - `isReduceMotionEnabled` is a native async call on BOTH platforms.
 *   - `isReduceTransparencyEnabled` is a native async call on iOS
 *     (`Promise.resolve(false)` on Android).
 *
 * THE CONTRACT
 * ------------
 *   - The probe runs ONCE per app session, on first subscription.
 *   - Exactly ONE listener pair exists for the whole app, for the whole session.
 *   - Every mount after the first resolution reads the answer SYNCHRONOUSLY from the
 *     module cache: no native call, no promise, no post-resolve re-render.
 *   - System-setting changes still propagate to every consumer, live, via
 *     `useSyncExternalStore`.
 *
 * DEFAULTS — deliberately unchanged from what the call sites already did:
 *   - before the first resolution: `{ reduceMotion: false, reduceTransparency: false }`
 *     (glass on, motion on) — the same optimistic default every converted component
 *     used as its `useState` seed, so first paint is pixel-identical.
 *   - on probe FAILURE: both `true` (solid fallback, no motion) — the "more readable"
 *     default `GlassBottomNav` and `GlassCard` already chose. `GlassTopBar` previously
 *     left `reduceMotion` false on failure; it now matches the rest. A failed probe is
 *     an error path that has never been observed in the field, and one consistent
 *     safe-side answer beats three different ones.
 */
import { useSyncExternalStore } from 'react';
import { AccessibilityInfo } from 'react-native';

export type A11yPreferences = {
  reduceMotion: boolean;
  reduceTransparency: boolean;
};

const OPTIMISTIC: A11yPreferences = { reduceMotion: false, reduceTransparency: false };
const SAFE_FALLBACK: A11yPreferences = { reduceMotion: true, reduceTransparency: true };

// The snapshot MUST be referentially stable between changes — `useSyncExternalStore`
// re-renders on every `getSnapshot()` identity change, so returning a fresh object each
// call would produce an infinite render loop.
let snapshot: A11yPreferences = OPTIMISTIC;

const listeners = new Set<() => void>();
let probeStarted = false;

const publish = (next: A11yPreferences): void => {
  if (
    next.reduceMotion === snapshot.reduceMotion &&
    next.reduceTransparency === snapshot.reduceTransparency
  ) {
    return;
  }
  snapshot = next;
  for (const listener of listeners) listener();
};

const startProbe = (): void => {
  if (probeStarted) return;
  probeStarted = true;

  Promise.all([
    AccessibilityInfo.isReduceMotionEnabled(),
    AccessibilityInfo.isReduceTransparencyEnabled(),
  ])
    .then(([reduceMotion, reduceTransparency]) => {
      publish({ reduceMotion, reduceTransparency });
    })
    .catch(() => {
      publish(SAFE_FALLBACK);
    });

  // One listener pair for the whole app, for the whole session. Never removed: these
  // track OS settings, every glass surface in the app depends on them, and tearing them
  // down when the last consumer unmounts would just mean re-probing on the next mount —
  // the exact cost this module exists to remove.
  AccessibilityInfo.addEventListener('reduceMotionChanged', (reduceMotion: boolean) => {
    publish({ ...snapshot, reduceMotion });
  });
  AccessibilityInfo.addEventListener(
    'reduceTransparencyChanged',
    (reduceTransparency: boolean) => {
      publish({ ...snapshot, reduceTransparency });
    },
  );
};

const subscribe = (listener: () => void): (() => void) => {
  startProbe();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getSnapshot = (): A11yPreferences => snapshot;

/**
 * Reduce-motion + reduce-transparency, from one shared probe.
 * Replaces the per-component `useState` + `useEffect` + `AccessibilityInfo` block.
 */
export function useA11yPreferences(): A11yPreferences {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Non-hook read, for the rare caller outside a component (animation helpers).
 * Does NOT start the probe — a hook consumer always does that first in this app.
 */
export function peekA11yPreferences(): A11yPreferences {
  return snapshot;
}
