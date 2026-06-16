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

import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

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

export function VenueModulePillRow({
  modules,
  activeModule,
  onSelect,
  onBackToHub,
  testID,
}: VenueModulePillRowProps): React.ReactElement {
  return (
    <View style={styles.host} testID={testID ?? "venue-module-pill-row"}>
      <ScrollView
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
