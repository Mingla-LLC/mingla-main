/**
 * META-ORCH-1148 sub-ORCH 2.0 — venue module pill row (state-driven nav).
 *
 * Reuses the HubSubNav pill VISUALS (warm-fill active / glass inactive,
 * horizontal scroller) but is driven by `activeModule` STATE — it calls
 * `onSelect`, NEVER `router.push`. This is the row that REPLACES the Hub
 * offering pills on native + web-phone while the Venue suite is active (LOCKED
 * DECISION 5 / I-PROPOSED-1148-VENUE-MODULE-NAV-REPLACES-HUB-PILLS).
 *
 * The first element is a "‹ Hub" chip so the operator can return to the Hub
 * offering pills (Events / Experiences / Trips) — leaving the suite restores the
 * normal HubSubNav. No navigation happens from the module pills themselves; the
 * nav-lock guard in `_layout.tsx` is never touched.
 */

import React, { useCallback, useEffect, useRef } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { LayoutChangeEvent } from "react-native";

import {
  accent,
  glass,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { VENUE_MODULES } from "./venueModules";
import type { VenueModule } from "../../types/venueReservation";

export interface VenueModulePillRowProps {
  modules: readonly VenueModule[];
  activeModule: VenueModule;
  onSelect: (module: VenueModule) => void;
  /** Return to the Hub offering pills (Events / Experiences / Trips). */
  onBackToHub?: () => void;
  testID?: string;
}

/**
 * Issue #1735 rework P3-5 — the scroll offset that reveals a pill whose left
 * edge sits at `pillX` inside the content container: lead with one gutter so
 * the ACTIVE pill is visibly in-frame (never flush to the clipped edge).
 * Pure, unit-tested.
 */
export function pillRevealOffset(pillX: number): number {
  return Math.max(0, pillX - spacing.lg);
}

export function VenueModulePillRow({
  modules,
  activeModule,
  onSelect,
  onBackToHub,
  testID,
}: VenueModulePillRowProps): React.ReactElement {
  // #1735 P3-5 — a deep link (`?module=insights`) can land with the active
  // pill scrolled out of frame (the row starts at x=0). Track each pill's
  // layout x and scroll the ACTIVE one into view: instantly on its first
  // layout (mount), animated on later activeModule changes.
  const scrollRef = useRef<ScrollView | null>(null);
  const pillXRef = useRef<Partial<Record<VenueModule, number>>>({});
  const revealActive = useCallback(
    (module: VenueModule, animated: boolean): void => {
      const x = pillXRef.current[module];
      if (x === undefined) return;
      scrollRef.current?.scrollTo({ x: pillRevealOffset(x), animated });
    },
    [],
  );
  const handlePillLayout = useCallback(
    (module: VenueModule, event: LayoutChangeEvent): void => {
      pillXRef.current[module] = event.nativeEvent.layout.x;
      if (module === activeModule) revealActive(module, false);
    },
    [activeModule, revealActive],
  );
  useEffect(() => {
    revealActive(activeModule, true);
  }, [activeModule, revealActive]);

  return (
    <View style={styles.host} testID={testID ?? "venue-module-pill-row"}>
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        {onBackToHub !== undefined ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to Hub"
            onPress={onBackToHub}
            style={[styles.pill, styles.pillInactive]}
            testID="venue-module-back-to-hub"
          >
            <Text style={[styles.pillLabel, styles.pillLabelInactive]}>‹ Hub</Text>
          </Pressable>
        ) : null}
        {modules.map((id) => {
          const isActive = id === activeModule;
          return (
            <Pressable
              key={id}
              accessibilityRole="tab"
              accessibilityLabel={`${VENUE_MODULES[id].label} module`}
              accessibilityState={{ selected: isActive }}
              onPress={() => onSelect(id)}
              onLayout={(event) => handlePillLayout(id, event)}
              style={[
                styles.pill,
                isActive ? styles.pillActive : styles.pillInactive,
              ]}
              testID={`venue-module-pill-${id}`}
            >
              <Text
                style={[
                  styles.pillLabel,
                  isActive ? styles.pillLabelActive : styles.pillLabelInactive,
                ]}
              >
                {VENUE_MODULES[id].label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  content: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  pill: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pillActive: {
    backgroundColor: accent.warm,
    borderColor: accent.warm,
  },
  pillInactive: {
    backgroundColor: glass.tint.profileBase,
    borderColor: glass.border.profileBase,
  },
  pillLabel: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    fontWeight: "600",
  },
  pillLabelActive: {
    color: "#0c0e12",
  },
  pillLabelInactive: {
    color: textTokens.secondary,
  },
});

export default VenueModulePillRow;
