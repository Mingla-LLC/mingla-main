/**
 * AnalyticsHomeTile — issue #1616 [Business Home analytics card starts collapsed].
 *
 * Collapsed by default: chart icon + ANALYTICS eyebrow + the headline, with a
 * chevron pinned to the card's top-right content origin. Expanding reveals the
 * 30-day window, the figures (or skeletons / error) and the "Open ›" row.
 *
 * Tap semantics are STATE-DEPENDENT (issue #1616 intake amendment 1):
 *   collapsed → the whole row EXPANDS (it must never navigate, or a collapsed
 *               card could not be opened at all — Constitution #1),
 *   expanded  → the whole card NAVIGATES to Analytics,
 *   expanded  → the chevron, and only the chevron, COLLAPSES.
 *
 * The chevron is a SIBLING of the card `Pressable`, not a child of it: RN
 * `Pressable` defaults `accessible={true}`, and on iOS an `accessible` parent
 * collapses its whole subtree into one accessibility element — a nested chevron
 * would be unreachable by VoiceOver and the card would become a one-way door for
 * screen-reader users. Sibling placement exposes two peer actions AND removes the
 * touch-responder contest structurally (the regions are disjoint).
 *
 * Position does NOT persist (issue #1616 decision 2): plain `useState(false)`, no
 * store, no AsyncStorage, no hydration gate. This deliberately diverges from the
 * To-do row it mirrors visually (`todoToggleCollapseStore`) and from the Live-now
 * accordion (`liveSectionCollapseStore`) — recorded here as intentional so it is
 * not later "repaired". Cold launch is always collapsed.
 */
import React, { useCallback, useState } from "react";
import {
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  UIManager,
  View,
} from "react-native";
import {
  accent,
  durations,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { formatCurrency } from "../../utils/currency";
import type { BrandMinglaDroveRollup } from "../../services/brandAnalyticsService";
import { useReducedMotionNative } from "../../hooks/useReducedMotionNative";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";
import { Skeleton } from "../ui/Skeleton";

// #1616 — without this Android snaps with no animation at all. Mirrors
// `BusinessTodoToggle.tsx`.
if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental !== undefined
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface AnalyticsHomeTileProps {
  data: BrandMinglaDroveRollup | undefined;
  isLoading: boolean;
  isError: boolean;
  onPress: () => void;
}

// #1616 — CONSTANT across loading / loaded / error / unauthorized: the collapsed
// row shows no data, so it has nothing to be loading or wrong about. It must NOT
// contain "Open Analytics" — the collapsed row does not open Analytics.
const COLLAPSED_ACCESSIBILITY_LABEL =
  "Expand analytics, Customers Mingla drove you";

const customerLabel = (count: number): string =>
  `${count.toLocaleString("en-GB")} ${count === 1 ? "customer" : "customers"}`;

const valueLabels = (values: Record<string, number>): string[] =>
  Object.entries(values).map(
    ([currency, cents]) => `${formatCurrency(cents, currency, true)} booking value`,
  );

export const AnalyticsHomeTile: React.FC<AnalyticsHomeTileProps> = ({
  data,
  isLoading,
  isError,
  onPress,
}) => {
  const [expanded, setExpanded] = useState<boolean>(false);
  const reduceMotion = useReducedMotionNative();

  // #1616 — serves as both handleExpand (collapsed card) and handleCollapse
  // (expanded chevron); the toggle is symmetric. Fires ONLY on an explicit user
  // toggle — never on a data change, so a background refetch never animates.
  const toggleExpanded = useCallback((): void => {
    if (!reduceMotion) {
      LayoutAnimation.configureNext(
        LayoutAnimation.create(
          // `easings.inOut` is the token this corresponds to, but
          // `LayoutAnimation.Types` is a fixed enum and cannot take a
          // cubic-bezier — so it is cited, not wired.
          durations.normal,
          LayoutAnimation.Types.easeInEaseOut,
          LayoutAnimation.Properties.opacity,
        ),
      );
    }
    setExpanded((value) => !value);
  }, [reduceMotion]);

  const valid = data?.authorized === true && !isError;
  const values = valid ? valueLabels(data.valueCents30d) : [];
  const count = valid ? data.minglaDrove30d : 0;
  const loadedLines = [
    customerLabel(count),
    ...(values.length > 0 ? values : ["No paid booking value yet"]),
  ];
  const expandedAccessibilityLabel = valid
    ? `Open Analytics, ${loadedLines.join(", ")}`
    : isLoading
      ? "Open Analytics, loading 30-day snapshot"
      : "Open Analytics, couldn't load your 30-day snapshot";

  return (
    <View style={styles.root} testID="analytics-home-tile-root">
      <Pressable
        // #1616 — state-dependent: collapsed EXPANDS, expanded NAVIGATES.
        onPress={expanded ? onPress : toggleExpanded}
        accessibilityRole="button"
        accessibilityLabel={
          expanded ? expandedAccessibilityLabel : COLLAPSED_ACCESSIBILITY_LABEL
        }
        // #1616 — `expanded` lives on whichever node OWNS the toggle, and only
        // there. Expanded, this node navigates, so it must not report a
        // collapsed/expanded state to a screen reader.
        accessibilityState={expanded ? undefined : { expanded: false }}
        style={({ pressed }) => [styles.pressable, pressed && styles.pressed]}
        testID="analytics-home-tile"
      >
        <GlassCard
          variant="base"
          style={[styles.card, expanded && styles.cardExpanded]}
        >
          <View style={styles.header}>
            <View style={styles.iconWrap} accessible={false}>
              <Icon name="chart" size={20} color={accent.warm} />
            </View>
            <Text style={styles.eyebrow}>ANALYTICS</Text>
          </View>
          <Text style={styles.title} accessibilityRole="header">
            Customers Mingla drove you
          </Text>
          {expanded ? (
            <>
              <Text style={styles.window}>Last 30 days</Text>
              {isLoading ? (
                <View style={styles.skeletons} testID="analytics-home-loading">
                  <Skeleton width="46%" height={20} />
                  <Skeleton width="72%" height={16} />
                </View>
              ) : valid ? (
                <View style={styles.values}>
                  <Text style={styles.customer}>{customerLabel(count)}</Text>
                  {(values.length > 0 ? values : ["No paid booking value yet"]).map(
                    (line) => (
                      <Text key={line} style={styles.value}>
                        {line}
                      </Text>
                    ),
                  )}
                </View>
              ) : (
                <Text style={styles.error}>
                  Couldn&apos;t load your 30-day snapshot
                </Text>
              )}
              <View style={styles.action}>
                <Text style={styles.actionText}>Open</Text>
                <View accessible={false}>
                  <Icon name="chevR" size={16} color={accent.warm} />
                </View>
              </View>
            </>
          ) : null}
        </GlassCard>

        {expanded ? null : (
          // #1616 — decorative while collapsed: the card Pressable already owns
          // the whole row, so this must never intercept the touch and must add
          // no node inside the flattened accessible button.
          <View style={styles.chevronSlot} accessible={false} pointerEvents="none">
            <Icon name="chevD" size={18} color={textTokens.secondary} />
          </View>
        )}
      </Pressable>

      {expanded ? (
        // #1616 — SIBLING of the card Pressable (see the file header). 24pt slot
        // + 13pt hitSlop on all four sides = a 50 × 50 effective target, and the
        // extension stays inside `styles.root`'s box so Android honours it.
        <Pressable
          onPress={toggleExpanded}
          hitSlop={{ top: 13, right: 13, bottom: 13, left: 13 }}
          accessibilityRole="button"
          accessibilityLabel="Collapse analytics"
          accessibilityState={{ expanded: true }}
          style={styles.chevronSlot}
          testID="analytics-home-tile-chevron"
        >
          <Icon name="chevU" size={18} color={textTokens.secondary} />
        </Pressable>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  // #1616 — NO padding, margin or border: the root's top-left must coincide with
  // the card Pressable's, so `top: 16 / right: 16` resolves to the identical
  // screen position in both states and the chevron never moves on toggle.
  root: { position: "relative" },
  pressable: { minHeight: 44 },
  pressed: { opacity: 0.72 },
  // #1616 — `minHeight: 188` moved to `cardExpanded`; a 92pt collapsed row is
  // the whole point of the issue. Kept as the marker the style array composes on.
  card: {},
  // #1616 — jitter guard for the EXPANDED body only: the error state renders 8pt
  // shorter than the loaded state, so without this an expanded card that is
  // loading (204) and then errors (180) visibly shrinks and drags the Upcoming
  // header up with it. Stays on the chrome node — moving it to `contentStyle`
  // would stack the card's 32pt padding on top of the 188.
  cardExpanded: { minHeight: 188 },
  // #1616 — pinned to the eyebrow row, NOT vertically centred on the block, so it
  // holds the identical position whether the card is 92pt or 188pt tall (and when
  // the headline wraps to two lines).
  chevronSlot: {
    position: "absolute",
    top: spacing.md,
    right: spacing.md,
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1,
  },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  iconWrap: { width: 24, height: 24, alignItems: "center", justifyContent: "center" },
  eyebrow: {
    color: textTokens.tertiary,
    fontSize: typography.labelCap.fontSize,
    lineHeight: typography.labelCap.lineHeight,
    fontWeight: typography.labelCap.fontWeight,
    letterSpacing: typography.labelCap.letterSpacing,
  },
  title: {
    color: textTokens.primary,
    fontSize: typography.bodyLg.fontSize,
    lineHeight: typography.bodyLg.lineHeight,
    fontWeight: "700",
    marginTop: spacing.sm,
  },
  window: {
    color: textTokens.tertiary,
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
  },
  skeletons: { gap: spacing.sm, marginTop: spacing.md },
  values: { gap: spacing.xs, marginTop: spacing.md },
  customer: {
    color: textTokens.primary,
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
  },
  value: {
    color: textTokens.secondary,
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
  },
  error: {
    color: textTokens.secondary,
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    marginTop: spacing.md,
  },
  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  actionText: {
    color: accent.warm,
    fontSize: typography.buttonMd.fontSize,
    lineHeight: typography.buttonMd.lineHeight,
    fontWeight: typography.buttonMd.fontWeight,
  },
});

export default AnalyticsHomeTile;
