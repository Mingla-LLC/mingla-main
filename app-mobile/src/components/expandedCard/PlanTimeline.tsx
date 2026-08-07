/**
 * Issue #1706 — a plan's Details, as a drawn timeline.
 *
 * Seth: "Details section should show an animated vertical timeline."
 *
 * A plan's Details was two fact rows — "Starts at" and "Ends near" — which is
 * the right INFORMATION in the wrong shape: a plan is a sequence, and two rows
 * that happen to be ordered do not say so. This draws the sequence: a spine, a
 * node per end, and the leg between them carrying the travel time.
 *
 * ---------------------------------------------------------------------------
 * WHY A PLAN GETS THIS AND A SINGLE PLACE DOES NOT
 *
 * A place's Details is an address, opening hours, a phone number and a website.
 * Those are attributes, not steps: there is no order among them, so a timeline
 * over them would be decoration pretending to be structure. `PracticalDetails
 * Section` keeps them as fact rows and this component is mounted only on the
 * curated branch.
 *
 * ---------------------------------------------------------------------------
 * THE ANIMATION, AND ITS OFF SWITCH
 *
 * The spine draws downward once on mount and the nodes settle in sequence. It
 * runs ONCE — not a loop. An indefinitely animating element inside a scrollable
 * sheet is a permanent frame cost and a permanent distraction, and #1576 is
 * this deck's standing lesson about animation on a hot path.
 *
 * `AccessibilityInfo.isReduceMotionEnabled` is honoured, and honoured by
 * SKIPPING TO THE END rather than by disabling the driver: a reduced-motion user
 * must see the finished timeline, not an un-drawn one. The subscription is
 * cleaned up on unmount.
 *
 * `useNativeDriver: true` throughout — these are opacity and transform only, so
 * the whole sequence runs off the JS thread and cannot be stalled by the sheet's
 * own work.
 */
import React from 'react';
import { AccessibilityInfo, Animated, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Icon } from '../ui/Icon';
import { Section } from './SpineParts';
import { SPINE, STOP_ROW } from './spineTokens';

export interface PlanTimelineLeg {
  /** Minutes for this leg, or null when there is no real figure. */
  readonly minutes: number | null;
  readonly mode: string | null;
  /**
   * TRUE when the figure is computed rather than measured.
   *
   * This is not decoration and it is not optional. Traffic was DELETED from this
   * sheet three weeks ago (see `busynessService`'s header) because its fallback
   * returned `${10 + extraMin} min` from nothing but the clock and rendered it
   * beside a real Mapbox reading in the same row, unlabelled. A haversine figure
   * is a different thing — computed from two real coordinates, reproducible —
   * but it is still not a measurement, and the disclosure is the entire reason
   * it is allowed on the sheet at all (Constitution 9).
   */
  readonly estimated: boolean;
}

export interface PlanTimelineProps {
  readonly heading: string;
  readonly startsAt: string | null;
  readonly startsAtName: string | null;
  readonly endsNear: string | null;
  readonly endsNearName: string | null;
  readonly leg: PlanTimelineLeg | null;
}

const DRAW_MS = 520;
const NODE_MS = 220;

function travelIcon(mode: string | null): string {
  if (mode === 'driving') return 'car-outline';
  if (mode === 'walking') return 'walk-outline';
  if (mode === 'bicycling' || mode === 'biking') return 'bicycle-outline';
  if (mode === 'transit') return 'bus-outline';
  return 'navigate-outline';
}

export default function PlanTimeline({
  heading,
  startsAt,
  startsAtName,
  endsNear,
  endsNearName,
  leg,
}: PlanTimelineProps): React.ReactElement | null {
  const { t } = useTranslation(['cards', 'common']);
  const draw = React.useRef(new Animated.Value(0)).current;
  const nodeA = React.useRef(new Animated.Value(0)).current;
  const nodeB = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    let cancelled = false;
    const settle = (): void => {
      draw.setValue(1);
      nodeA.setValue(1);
      nodeB.setValue(1);
    };

    AccessibilityInfo.isReduceMotionEnabled()
      .then((reduced) => {
        if (cancelled) return;
        if (reduced) {
          // The FINISHED timeline, immediately. Not a disabled one.
          settle();
          return;
        }
        Animated.sequence([
          Animated.timing(nodeA, { toValue: 1, duration: NODE_MS, useNativeDriver: true }),
          Animated.timing(draw, { toValue: 1, duration: DRAW_MS, useNativeDriver: true }),
          Animated.timing(nodeB, { toValue: 1, duration: NODE_MS, useNativeDriver: true }),
        ]).start();
      })
      .catch(() => {
        // The query can reject on an emulator with no accessibility service.
        // Showing the finished state is the safe failure.
        if (!cancelled) settle();
      });

    return () => {
      cancelled = true;
      draw.stopAnimation();
      nodeA.stopAnimation();
      nodeB.stopAnimation();
    };
  }, [draw, nodeA, nodeB]);

  // Constitution 9 — a plan with neither end has nothing to draw, and an empty
  // spine is worse than no section.
  const hasStart = typeof startsAt === 'string' && startsAt.trim().length > 0;
  const hasEnd = typeof endsNear === 'string' && endsNear.trim().length > 0;
  if (!hasStart && !hasEnd) return null;

  const legMinutes = leg?.minutes;
  const showLeg = typeof legMinutes === 'number' && legMinutes > 0;

  const node = (v: Animated.Value): React.ReactElement => (
    <Animated.View
      style={[styles.node, { opacity: v, transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }] }]}
      pointerEvents="none"
    />
  );

  return (
    <Section title={heading}>
      <View style={styles.wrap}>
        <View style={styles.rail} pointerEvents="none">
          <View style={styles.railTrack} />
          <Animated.View
            style={[styles.railFill, { transform: [{ scaleY: draw }] }]}
          />
        </View>

        {hasStart ? (
          <View style={styles.step}>
            {node(nodeA)}
            <View style={styles.body}>
              <Text style={styles.label}>
                {t('cards:expanded.starts_at', { defaultValue: 'Starts at' })}
              </Text>
              <Text style={styles.value}>
                {startsAtName ? `${startsAtName}, ${startsAt}` : startsAt}
              </Text>
            </View>
          </View>
        ) : null}

        {showLeg ? (
          <View style={[styles.step, styles.legStep]}>
            <View style={styles.body}>
              <View style={styles.legRow}>
                <Icon name={travelIcon(leg?.mode ?? null)} size={13} color={SPINE.factLabel} />
                <Text style={styles.legText}>
                  {t('cards:expanded.minutes_short', {
                    defaultValue: '{{count}} min',
                    count: Math.round(legMinutes as number),
                  })}
                </Text>
                {/*
                  THE DISCLOSURE. See `PlanTimelineLeg.estimated` — this is the
                  reason a computed travel time is allowed on this sheet.
                */}
                {leg?.estimated ? (
                  <Text style={styles.estimated}>
                    {t('cards:expanded.estimated', { defaultValue: 'estimated' })}
                  </Text>
                ) : null}
              </View>
            </View>
          </View>
        ) : null}

        {hasEnd ? (
          <View style={styles.step}>
            {node(nodeB)}
            <View style={styles.body}>
              <Text style={styles.label}>
                {t('cards:expanded.ends_near', { defaultValue: 'Ends near' })}
              </Text>
              <Text style={styles.value}>
                {endsNearName ? `${endsNearName}, ${endsNear}` : endsNear}
              </Text>
            </View>
          </View>
        ) : null}
      </View>
    </Section>
  );
}

const RAIL_LEFT = 5;
const RAIL_W = 2;

const styles = StyleSheet.create({
  wrap: { position: 'relative', paddingLeft: 26, paddingTop: 2, paddingBottom: 2 },
  rail: { position: 'absolute', left: RAIL_LEFT, top: 12, bottom: 12, width: RAIL_W },
  railTrack: { ...StyleSheet.absoluteFillObject, backgroundColor: SPINE.rule, borderRadius: RAIL_W },
  railFill: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: SPINE.accentFill,
    borderRadius: RAIL_W,
    // The draw grows from the top, so the transform origin has to be the top.
    // Without this the spine expands from its centre in both directions.
    transformOrigin: 'top',
  },
  step: { paddingVertical: 7, position: 'relative' },
  legStep: { paddingVertical: 2 },
  node: {
    position: 'absolute',
    left: -26 + RAIL_LEFT - 4.5,
    top: 12,
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: SPINE.paper,
    borderWidth: 2.5,
    borderColor: SPINE.accentFill,
  },
  body: { flex: 1 },
  label: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    color: SPINE.factLabel,
  },
  value: {
    fontSize: STOP_ROW.nameSize,
    fontWeight: '500',
    color: SPINE.factValue,
    lineHeight: 20,
    marginTop: 2,
  },
  legRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  legText: { fontSize: 13, fontWeight: '600', color: SPINE.factLabel },
  estimated: { fontSize: 12.5, fontWeight: '400', color: SPINE.muted },
});
