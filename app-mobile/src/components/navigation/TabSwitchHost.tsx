/**
 * TabSwitchHost — issue #1638.
 *
 * Wraps the shell's active-tab subtree and owns the two halves of the tab-switch fix.
 *
 *  1. THE PENDING STATE (Track B). On the tap frame — URGENT lane, before the deferred
 *     mount is even scheduled — it paints `TabSwitchScaffold`: the destination's own
 *     structure, over the outgoing screen. It is cleared by the destination's own COMMIT
 *     (the layout effect below), never by a timer.
 *
 *  2. MEASUREMENT (`__DEV__` only). It emits the T4 / T6 / T8 marks for the tab-switch
 *     latency harness. Doing it here rather than inside each of the five pages gives one
 *     uniform clock for every tab — including the ones this branch may not touch — and
 *     costs zero page-file edits.
 *
 * WHY A WRAPPER
 * -------------
 * React renders parents before children and runs layout effects children-first. So this
 * component's render body is the last thing that happens before the destination page's
 * own render begins (T4), and its layout effect is the first thing that happens after
 * every descendant has mounted and laid out (T6) — exactly the pair the #1638
 * investigation asked for, from one place. That same ordering is what makes the scaffold
 * disappear in the SAME commit the destination appears in, with no intermediate frame.
 *
 * WHY A REF AND NOT CONTEXT / useTransition
 * -----------------------------------------
 * The obvious shape is `useTransition()` in `app/index.tsx` and render on `isPending`.
 * `currentPage` lives in `useAppState()` and is consumed by `AppContent` — a ~2900-line
 * component. Hoisting `isPending` there would add TWO extra full-shell renders (true,
 * then false) to the critical path of the very switch we are trying to shorten. Instead
 * the pending flag lives HERE, is set imperatively through a ref (no parent re-render at
 * all), and `children` is taken as a PROP — so when this component's own state changes,
 * the children element is referentially identical and React bails out of re-rendering
 * the whole tab subtree. The pending state is still strictly transition-bound: it is
 * raised in the same event handler that schedules the transition and cleared by that
 * transition's commit.
 */
import React, { useCallback, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import {
  markTabSwitch,
  markTabSwitchForPage,
  startTabSwitchHeartbeat,
} from '../../utils/tabSwitchPerf';
import { TabSwitchScaffold, type ScaffoldPage } from './TabSwitchScaffold';

const SCAFFOLD_PAGES: readonly ScaffoldPage[] = [
  'home',
  'discover',
  'connections',
  'likes',
  'profile',
];

const isScaffoldPage = (page: string): page is ScaffoldPage =>
  (SCAFFOLD_PAGES as readonly string[]).includes(page);

/**
 * FAILSAFE CEILING — not the clearing mechanism.
 *
 * The scaffold is cleared by the destination's commit. This timer exists for exactly one
 * scenario: `beginSwitch` was called but `currentPage` never commits (an error boundary
 * swallows the destination, the shell unmounts mid-switch). A pending state that could
 * survive that would be a full-screen dead app, so it is bounded. It is deliberately far
 * longer than any measured switch — the worst `home -> discover` p90 on a Samsung
 * SM-A725F dev build was 2.4s — so it can never become the thing that actually dismisses
 * the scaffold in normal use.
 */
const PENDING_FAILSAFE_MS = 5000;

export type TabSwitchHostHandle = {
  /**
   * Called from the nav's onNavigate on the TAP FRAME, before the (deferred) page commit
   * is scheduled. Raises the pending state on the urgent lane.
   */
  beginSwitch: (page: string) => void;
};

export type TabSwitchHostProps = {
  /** The page the shell is currently rendering — the committed source of truth. */
  currentPage: string;
  /** Translated tab labels, for the pending state's screen-reader announcement. */
  labels: Record<string, string>;
  children: React.ReactNode;
  ref?: React.Ref<TabSwitchHostHandle>;
};

export const TabSwitchHost = ({
  currentPage,
  labels,
  children,
  ref,
}: TabSwitchHostProps): React.ReactElement => {
  // T4 — the destination's render pass has begun. Gated on the page so a shell re-render
  // still carrying the OLD page is never mistaken for the destination's render.
  markTabSwitchForPage('T4.render', currentPage);

  const [pendingPage, setPendingPage] = useState<ScaffoldPage | null>(null);
  const failsafeRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearFailsafe = useCallback((): void => {
    if (failsafeRef.current !== null) {
      clearTimeout(failsafeRef.current);
      failsafeRef.current = null;
    }
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      beginSwitch: (page: string): void => {
        // Already there — the nav's own re-tap guard should have caught this, but a
        // programmatic caller might not have.
        if (page === currentPage) return;
        if (!isScaffoldPage(page)) return;
        clearFailsafe();
        failsafeRef.current = setTimeout(() => {
          failsafeRef.current = null;
          setPendingPage(null);
        }, PENDING_FAILSAFE_MS);
        setPendingPage(page);
      },
    }),
    [currentPage, clearFailsafe],
  );

  useLayoutEffect(() => {
    startTabSwitchHeartbeat();
    return clearFailsafe;
  }, [clearFailsafe]);

  useLayoutEffect(() => {
    // THE CLEAR. This runs inside the destination's own commit, after every descendant
    // has mounted and laid out — so the scaffold is removed and the real page revealed in
    // ONE frame, with no flash of the outgoing screen in between.
    //
    // It clears on ANY currentPage commit, not only on the one that was tapped. That is
    // the same anti-desync contract GlassBottomNav's `pendingPage` reconcile already uses
    // (ORCH-0995 T-15): if a deep link or a push notification wins the race and routes
    // somewhere else, the pending scaffold must never be left painted over a page it does
    // not describe.
    clearFailsafe();
    setPendingPage(null);

    markTabSwitchForPage('T6.commit', currentPage);
    const raf = requestAnimationFrame(() => {
      // T8 — closest JS-side proxy for first paint of the destination.
      markTabSwitchForPage('T8.firstFrame', currentPage);
    });
    return () => cancelAnimationFrame(raf);
  }, [currentPage, clearFailsafe]);

  return (
    <>
      {children}
      {pendingPage !== null ? (
        <TabSwitchScaffold page={pendingPage} label={labels[pendingPage] ?? pendingPage} />
      ) : null}
    </>
  );
};

export default TabSwitchHost;

// Re-exported so the shell imports its whole tab-switch surface from one module.
export { markTabSwitch };
