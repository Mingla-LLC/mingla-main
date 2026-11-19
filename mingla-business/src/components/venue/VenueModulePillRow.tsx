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
import {
  AccessibilityInfo,
  findNodeHandle,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { LayoutChangeEvent } from "react-native";

import {
  radius,
  color,
  materials,
  space,
  type,
} from "../../constants/designSystem";
import { useTouchFloor } from "../../hooks/useTouchFloor";
import { venueModuleLabel } from "./venueModules";
import type { VenueModule } from "../../types/venueReservation";

export interface VenueModulePillRowProps {
  modules: readonly VenueModule[];
  activeModule: VenueModule;
  onSelect: (module: VenueModule, restoreFocus?: () => void) => void;
  /** Return to the Hub offering pills (Events / Experiences / Trips). */
  onBackToHub?: (restoreFocus?: () => void) => void;
  /** #3655 — modules with unsaved work show a 6×6 dirty dot. */
  dirtyModules?: ReadonlySet<VenueModule>;
  testID?: string;
}

interface FocusCapable {
  focus: () => void;
}

function hasFocusCapability(value: unknown): value is FocusCapable {
  return (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    "focus" in value &&
    typeof value.focus === "function"
  );
}

/**
 * Issue #1735 rework P3-5 — the scroll offset that reveals a pill whose left
 * edge sits at `pillX` inside the content container: lead with one gutter so
 * the ACTIVE pill is visibly in-frame (never flush to the clipped edge).
 * Pure, unit-tested.
 */
export function pillRevealOffset(pillX: number): number {
  return Math.max(0, pillX - space[6]);
}

export function VenueModulePillRow({
  modules,
  activeModule,
  onSelect,
  onBackToHub,
  dirtyModules,
  testID,
}: VenueModulePillRowProps): React.ReactElement {
  // #1735 P3-5 — a deep link (`?module=insights`) can land with the active
  // pill scrolled out of frame (the row starts at x=0). Track each pill's
  // layout x and scroll the ACTIVE one into view: instantly on its first
  // layout (mount), animated on later activeModule changes.
  const touchFloor = useTouchFloor();
  const scrollRef = useRef<ScrollView | null>(null);
  const backRef = useRef<View | null>(null);
  const pillRefs = useRef<Partial<Record<VenueModule, View | null>>>({});
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
  const focusControl = useCallback((control: View | null): void => {
    if (control === null) return;
    if (Platform.OS === "web") {
      if (hasFocusCapability(control)) control.focus();
      return;
    }
    const handle = findNodeHandle(control);
    if (handle !== null) AccessibilityInfo.setAccessibilityFocus(handle);
  }, []);

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
            ref={backRef}
            accessibilityRole="button"
            accessibilityLabel="Back to Hub"
            onPress={() => onBackToHub(() => focusControl(backRef.current))}
            style={[styles.pill, touchFloor > 0 ? { minHeight: touchFloor } : null, styles.pillInactive]}
            testID="venue-module-back-to-hub"
          >
            <Text style={[styles.pillLabel, styles.pillLabelInactive]}>‹ Hub</Text>
          </Pressable>
        ) : null}
        {modules.map((id) => {
          const isActive = id === activeModule;
          const isDirty = dirtyModules?.has(id) === true;
          const label = venueModuleLabel(id, modules);
          return (
            <Pressable
              ref={(instance) => {
                pillRefs.current[id] = instance;
              }}
              key={id}
              accessibilityRole="tab"
              accessibilityLabel={
                isDirty
                  ? `${label}, ${isActive ? "selected, " : ""}unsaved changes`
                  : `${label} module`
              }
              accessibilityState={{ selected: isActive }}
              onPress={() =>
                onSelect(id, () => focusControl(pillRefs.current[id] ?? null))
              }
              onLayout={(event) => handlePillLayout(id, event)}
              style={[
                styles.pill,
                touchFloor > 0 ? { minHeight: touchFloor } : null,
                isActive ? styles.pillActive : styles.pillInactive,
                isDirty ? styles.pillDirtyPad : null,
              ]}
              testID={`venue-module-pill-${id}`}
            >
              <Text
                style={[
                  styles.pillLabel,
                  isActive ? styles.pillLabelActive : styles.pillLabelInactive,
                ]}
              >
                {label}
              </Text>
              {isDirty ? (
                <View
                  style={[styles.dirtyDot, isActive ? styles.dirtyDotOnActive : null]}
                  testID={`venue-module-pill-dirty-${id}`}
                />
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    paddingHorizontal: space[4],
    paddingVertical: space[2],
  },
  content: {
    flexDirection: "row",
    gap: space[2],
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: space[4],
    minHeight: 36,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pillDirtyPad: {
    // 6pt dot + 7pt gap ≈ 13pt growth on the right only.
    paddingRight: space[6] + 13,
  },
  // #4420 — the selected module uses the kit's selected material (as the
  // shared Chip does), not an orange fill: orange is for primary actions.
  pillActive: {
    backgroundColor: materials.selected.solidFill,
    borderColor: materials.selected.rim.edge,
    borderTopColor: materials.selected.rim.top ?? materials.selected.rim.edge,
  },
  pillInactive: {
    backgroundColor: color.fill.tile,
    borderColor: color.line,
  },
  pillLabel: {
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
    fontWeight: "600",
  },
  pillLabelActive: {
    color: color.textStrong,
  },
  pillLabelInactive: {
    color: color.text2,
  },
  dirtyDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: color.accent,
  },
  dirtyDotOnActive: {
    backgroundColor: color.accent,
  },
});

export default VenueModulePillRow;
