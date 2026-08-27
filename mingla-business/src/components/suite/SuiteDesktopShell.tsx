/**
 * Issue #1484 [stay-desktop-shell] — SuiteDesktopShell: the ONE shared
 * wide-desktop (>=1024px web) two-column layout for every offering-manager
 * suite.
 *
 * WHY THIS EXISTS: ORCH-1184 built the "bare rail + full-width workspace"
 * desktop layout as PRIVATE styles inside `VenueSuiteShell.tsx`. There was
 * nothing to inherit, so the next suite (`StaySuiteShell`, #1446/#1448/#1449)
 * was written from the pre-1184 phone-first template and silently shipped a
 * horizontal pill row + an 820px centred column on desktop. Extracting the
 * layout here (decision D2) means both suites now render the SAME shell and a
 * future suite gets the desktop treatment by construction.
 *
 * The rendered output is VERBATIM the ORCH-1184 venue desktop layout:
 *   desktopHost → desktopCentered (row) → desktopRail (220, tablist) +
 *   desktopWorkspace (flex:1).
 *
 * WIDTH MATH — LOAD-BEARING, DO NOT "TIDY":
 *  - `desktopCentered` has NO width cap. ORCH-1184 deliberately deleted the old
 *    1200px suite max-width because it left dead right-side canvas (the "weird
 *    black bar") on wide monitors. Re-adding any cap here is a regression, and
 *    is pinned by `venue/__tests__/venueSuiteShell.orch1184.fullwidth.test.ts`.
 *  - The LEFT anchor (`alignSelf: "flex-start"`) + the edge gutters
 *    (`paddingHorizontal: spacing.md`) are KEPT so the block shares the Hub
 *    chrome's exact left edge.
 *
 * Scroll ownership stays with the CALLER: a module that owns its own
 * ScrollView passes `workspaceSelfScrolls` so the shell does not nest a second
 * same-axis scroll container (the "doesn't scroll properly" symptom).
 *
 * The shell is DESKTOP-ONLY by contract — it is rendered behind the caller's
 * `useResponsiveLayout().isWideDesktop` branch (invariant I-DESKTOP-GATE-VIA-
 * HOOK). It never gates itself, so it stays free of platform checks.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { PressableStateCallbackType, ViewStyle } from "react-native";

import {
  accent,
  glass,
  radius,
  spacing,
  text as textTokens,
  typography,
  venueRailWidth,
  durations,
  easings,
} from "../../constants/designSystem";

/** One rail entry. `key` is the caller's module id; `label` is what renders. */
export interface SuiteDesktopModule {
  key: string;
  label: string;
  /** Optional visual group. Venue supplies this; ungrouped suites stay unchanged. */
  group?: string;
}

export interface SuiteDesktopShellProps {
  /** Rail entries IN RENDER ORDER — the caller owns ordering/grouping. */
  modules: readonly SuiteDesktopModule[];
  activeModule: string;
  onSelect: (key: string, restoreFocus?: () => void) => void;
  /** The workspace body for `activeModule`. */
  children: React.ReactNode;
  /** True when `children` owns its own ScrollView (no outer scroll wrapper). */
  workspaceSelfScrolls: boolean;
  /** Bottom-nav / home-indicator clearance for the shell-owned ScrollView. */
  scrollBottomPad: number;
  /** testID prefix for rail rows, e.g. `"venue-rail-"` → `venue-rail-overview`. */
  railTestIdPrefix: string;
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

type RailWebTransitionStyle = ViewStyle & {
  transitionProperty: "opacity";
  transitionDuration: string;
  transitionTimingFunction: typeof easings.out;
};

function railWebTransitionStyle(reduceMotion: boolean): RailWebTransitionStyle {
  return {
    transitionProperty: "opacity",
    transitionDuration: reduceMotion ? "0ms" : `${durations.normal}ms`,
    transitionTimingFunction: easings.out,
  };
}

export function SuiteDesktopShell({
  modules,
  activeModule,
  onSelect,
  children,
  workspaceSelfScrolls,
  scrollBottomPad,
  railTestIdPrefix,
  testID,
}: SuiteDesktopShellProps): React.ReactElement {
  const grouped = modules.some((module) => module.group !== undefined);
  return (
    <View style={styles.desktopHost} testID={testID}>
      <View style={styles.desktopCentered}>
        <View
          style={[styles.desktopRail, grouped ? styles.desktopRailGrouped : null]}
          accessibilityRole="tablist"
          accessibilityLabel="Restaurant Hub sections"
        >
          <SuiteDesktopRail
            modules={modules}
            activeModule={activeModule}
            onSelect={onSelect}
            testIdPrefix={railTestIdPrefix}
          />
        </View>
        <View style={styles.desktopWorkspace}>
          {workspaceSelfScrolls ? (
            // The module self-scrolls; avoid nesting a second ScrollView.
            children
          ) : (
            <ScrollView
              contentContainerStyle={[
                styles.desktopScroll,
                { paddingBottom: scrollBottomPad },
              ]}
            >
              {children}
            </ScrollView>
          )}
        </View>
      </View>
    </View>
  );
}

interface SuiteDesktopRailProps {
  modules: readonly SuiteDesktopModule[];
  activeModule: string;
  onSelect: (key: string, restoreFocus?: () => void) => void;
  testIdPrefix: string;
}

function SuiteDesktopRail({
  modules,
  activeModule,
  onSelect,
  testIdPrefix,
}: SuiteDesktopRailProps): React.ReactElement {
  const controlRefs = useRef<Record<string, View | null>>({});
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion,
    );
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);
  const focusControl = useCallback((control: View | null): void => {
    if (hasFocusCapability(control)) control.focus();
  }, []);
  const groups = useMemo(() => {
    const result: { label: string | null; modules: SuiteDesktopModule[] }[] = [];
    for (const module of modules) {
      const label = module.group ?? null;
      const current = result[result.length - 1];
      if (current === undefined || current.label !== label) {
        result.push({ label, modules: [module] });
      } else {
        current.modules.push(module);
      }
    }
    return result;
  }, [modules]);

  const selectAndFocus = useCallback(
    (index: number): void => {
      const module = modules[index];
      if (module === undefined) return;
      onSelect(module.key, () => focusControl(controlRefs.current[module.key] ?? null));
      requestAnimationFrame(() => focusControl(controlRefs.current[module.key] ?? null));
    },
    [focusControl, modules, onSelect],
  );

  return (
    <View style={styles.railInner}>
      {groups.map((group, groupIndex) => (
        <View
          key={`${group.label ?? "ungrouped"}-${groupIndex}`}
          style={[styles.railGroup, groupIndex > 0 ? styles.railGroupAfterFirst : null]}
        >
          {group.label !== null ? (
            <View style={styles.railGroupHeadingBox}>
              <Text accessible={false} style={styles.railGroupHeading}>
                {group.label}
              </Text>
            </View>
          ) : null}
          <View style={styles.railGroupTabs}>
            {group.modules.map((module) => {
              const moduleIndex = modules.findIndex((candidate) => candidate.key === module.key);
              const isActive = module.key === activeModule;
              const webProps = Platform.OS === "web"
                ? {
                    tabIndex: isActive ? (0 as const) : (-1 as const),
                    onKeyDown: (event: React.KeyboardEvent<HTMLElement>): void => {
                      let nextIndex: number | null = null;
                      if (event.key === "ArrowDown" || event.key === "ArrowRight") {
                        nextIndex = (moduleIndex + 1) % modules.length;
                      } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
                        nextIndex = (moduleIndex - 1 + modules.length) % modules.length;
                      } else if (event.key === "Home") {
                        nextIndex = 0;
                      } else if (event.key === "End") {
                        nextIndex = modules.length - 1;
                      } else if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
                        nextIndex = moduleIndex;
                      }
                      if (nextIndex !== null) {
                        event.preventDefault();
                        selectAndFocus(nextIndex);
                      }
                    },
                  }
                : {};
              return (
                <Pressable
                  {...webProps}
                  ref={(instance) => { controlRefs.current[module.key] = instance; }}
                  key={module.key}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: isActive }}
                  accessibilityLabel={
                    module.group !== undefined
                      ? `${module.group}, ${module.label} module`
                      : `${module.label} module`
                  }
                  onPress={() => onSelect(
                    module.key,
                    () => focusControl(controlRefs.current[module.key] ?? null),
                  )}
                  style={(state: PressableStateCallbackType) => {
                    const webState = state as PressableStateCallbackType & {
                      hovered?: boolean;
                      focused?: boolean;
                    };
                    return [
                      styles.railRow,
                      module.group !== undefined ? styles.railRowGrouped : null,
                      webState.hovered === true && !isActive ? styles.railRowHover : null,
                      webState.focused === true ? styles.railRowFocus : null,
                    ];
                  }}
                  testID={`${testIdPrefix}${module.key}`}
                >
                  <View
                    style={[
                      styles.railSelectionLayer,
                      isActive ? styles.railSelectionLayerActive : null,
                      Platform.OS === "web" ? railWebTransitionStyle(reduceMotion) : null,
                    ]}
                    testID={`${testIdPrefix}${module.key}-selection`}
                  >
                    <View style={styles.railActiveBar} />
                  </View>
                  <Text style={[styles.railLabel, isActive ? styles.railLabelActive : null]}>
                    {module.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  desktopHost: {
    flex: 1,
  },
  desktopCentered: {
    flex: 1,
    flexDirection: "row",
    width: "100%",
    // ORCH-1184 — the workspace FILLS the page width (Seth's decision). The old
    // `maxWidth: venueSuiteMaxWidth` (1200) cap stopped the two-column block at
    // 1200px on wide monitors, leaving dead right-side canvas (the "weird black
    // bar"). The cap is removed so the block expands to the full available page
    // width; the rail stays fixed-width and the `flex:1` workspace absorbs the
    // extra width (settings cards get wider). We KEEP the LEFT anchor and the
    // `paddingHorizontal: spacing.md` edge gutters — the block shares the Hub
    // chrome's exact left edge (TopBar / To-Do / sub-nav, all left-aligned to
    // `spacing.md` in hub/_layout.tsx), so the rail still sits flush under the
    // nav, now with no right-side dead space.
    alignSelf: "flex-start",
    paddingHorizontal: spacing.md,
  },
  desktopRail: {
    width: venueRailWidth,
    paddingTop: spacing.xs,
    // Hairline divider separating the rail from the workspace, top-aligned with
    // the content. Subtle (matches the app's restrained desktop chrome), opaque
    // safe on Android.
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: glass.border.profileBase,
    paddingRight: spacing.sm,
  },
  desktopRailGrouped: {
    paddingTop: 0,
  },
  railInner: {
    gap: spacing.xxs,
  },
  railGroup: {},
  railGroupAfterFirst: {
    marginTop: 12,
  },
  railGroupHeadingBox: {
    height: 20,
    justifyContent: "center",
    marginBottom: spacing.xs,
  },
  railGroupHeading: {
    ...typography.caption,
    color: textTokens.tertiary,
  },
  railGroupTabs: {
    gap: spacing.xxs,
  },
  railRow: {
    flexDirection: "row",
    alignItems: "center",
    // Tighter, consistent vertical rhythm (was sm/16h) and a snug left grid.
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    ...Platform.select({ web: { cursor: "pointer" }, default: {} }),
  },
  railSelectionLayer: {
    ...StyleSheet.absoluteFillObject,
    pointerEvents: "none",
    borderRadius: radius.md,
    backgroundColor: glass.tint.profileElevated,
    opacity: 0,
  },
  railSelectionLayerActive: {
    // #2726: keep both old/new selection layers mounted so the approved 200ms
    // opacity crossfade is real; mounting an already-opaque bar was instant.
    opacity: 1,
  },
  railRowGrouped: {
    // #2726: compact visual rhythm must never shrink the actual pointer,
    // keyboard, or assistive-technology target below the 44px floor.
    minHeight: 44,
  },
  railRowHover: {
    backgroundColor: glass.tint.profileBase,
  },
  railRowFocus: {
    outlineColor: accent.warm,
    outlineWidth: 2,
    outlineStyle: "solid",
    outlineOffset: 2,
  },
  railActiveBar: {
    position: "absolute",
    left: 0,
    top: spacing.xs,
    bottom: spacing.xs,
    width: 3,
    borderRadius: radius.full,
    backgroundColor: accent.warm,
  },
  railLabel: {
    ...typography.body,
    color: textTokens.secondary,
  },
  railLabelActive: {
    color: textTokens.primary,
    fontWeight: "600",
  },
  desktopWorkspace: {
    flex: 1,
    // Balanced gutter between the rail and the workspace (paired with the rail's
    // `paddingRight: spacing.sm` + hairline → a coherent, symmetric seam).
    paddingLeft: spacing.lg,
  },
  desktopScroll: {
    // paddingBottom supplied inline (insets.bottom + 120) for nav clearance.
  },
});

export default SuiteDesktopShell;
