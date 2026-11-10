/**
 * #4347 wave 3 — the sticky stop navigator.
 *
 * Mounted in the sheet's `header` slot as an ABSOLUTELY positioned bar over the
 * top of the scroll body: it takes no layout space, so showing it never shifts
 * the content, and its own bounds are its hit area (no zero-height parent that
 * Android would refuse touches through). It appears once the route strip has
 * scrolled away, highlights the stop in view, fills the line between stops as
 * you scroll, and a tap on a stop jumps there (the card then pulses).
 *
 * Hidden, it is transparent and takes no touches. Under Reduce Motion it shows
 * and hides without the slide.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Reanimated from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { PLAN_SHEET } from './spineTokens';
import { NAVIGATOR_HEIGHT, usePlanScroll, type PlanScrollStore } from './planScroll';
import { useShowStyle } from './planMotion';

export interface NavigatorStop {
  readonly key: string;
  readonly ordinal: number | null;
  readonly name: string;
}

export interface PlanStopNavigatorProps {
  readonly store: PlanScrollStore;
  readonly stops: readonly NavigatorStop[];
  readonly onJump: (index: number) => void;
  readonly reducedMotion: boolean;
  /** Distance from the top of the sheet (below a review-mode header). */
  readonly top?: number;
}

export function PlanStopNavigator({ store, stops, onJump, reducedMotion, top = 0 }: PlanStopNavigatorProps): React.ReactElement | null {
  const { t } = useTranslation(['cards']);
  const snap = usePlanScroll(store);
  const show = useShowStyle(snap.visible, reducedMotion, -8);
  if (stops.length < 2) return null;
  return (
    <Reanimated.View
      testID="plan-navigator"
      pointerEvents={snap.visible ? 'auto' : 'none'}
      accessibilityElementsHidden={!snap.visible}
      importantForAccessibility={snap.visible ? 'auto' : 'no-hide-descendants'}
      accessibilityLabel={t('cards:plan.navigator_a11y')}
      style={[styles.bar, { top }, show]}
    >
      {stops.map((stop, i) => {
        const on = i === snap.active;
        const done = i < snap.active;
        return (
          <React.Fragment key={stop.key}>
            {i > 0 ? (
              <View style={styles.line}>
                <View
                  testID={`plan-navigator-line-${i - 1}`}
                  style={[styles.lineFill, { width: `${Math.round((snap.fills[i - 1] ?? 0) * 100)}%` }]}
                />
              </View>
            ) : null}
            <Pressable
              testID={`plan-navigator-stop-${i}`}
              onPress={() => onJump(i)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={
                stop.ordinal !== null
                  ? t('cards:plan.route_stop_a11y', { number: stop.ordinal, name: stop.name })
                  : stop.name
              }
              style={styles.stop}
            >
              <View style={[styles.dot, on ? styles.dotOn : done ? styles.dotDone : null]}>
                <Text style={[styles.dotText, on ? styles.dotTextOn : null]} maxFontSizeMultiplier={1}>
                  {stop.ordinal ?? '+'}
                </Text>
              </View>
              {on ? (
                <Text testID="plan-navigator-active-name" style={styles.name} numberOfLines={1} maxFontSizeMultiplier={1.2}>
                  {stop.name}
                </Text>
              ) : null}
            </Pressable>
          </React.Fragment>
        );
      })}
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: NAVIGATOR_HEIGHT,
    zIndex: 20,
    elevation: 6,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    backgroundColor: PLAN_SHEET.navFill,
    borderBottomWidth: 1,
    borderBottomColor: PLAN_SHEET.navBorder,
  },
  stop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    flexShrink: 1,
  },
  dot: {
    width: PLAN_SHEET.navDot,
    height: PLAN_SHEET.navDot,
    borderRadius: PLAN_SHEET.navDot / 2,
    borderWidth: 1.5,
    borderColor: PLAN_SHEET.navDotBorder,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  dotOn: {
    backgroundColor: PLAN_SHEET.navDotOn,
    borderColor: PLAN_SHEET.navDotOn,
  },
  dotDone: {
    backgroundColor: PLAN_SHEET.navDotDone,
    borderColor: PLAN_SHEET.navDotDone,
  },
  dotText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#111111',
  },
  dotTextOn: {
    color: '#FFFFFF',
  },
  name: {
    maxWidth: 110,
    fontSize: 12,
    fontWeight: '600',
    color: '#111111',
  },
  line: {
    flex: 1,
    minWidth: 8,
    height: 2,
    marginHorizontal: 6,
    borderRadius: 2,
    backgroundColor: PLAN_SHEET.navLine,
    overflow: 'hidden',
  },
  lineFill: {
    height: 2,
    backgroundColor: PLAN_SHEET.navLineFill,
  },
});
