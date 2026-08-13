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

import React, { useCallback, useRef } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  accent,
  glass,
  radius,
  spacing,
  text as textTokens,
  typography,
  venueRailWidth,
} from "../../constants/designSystem";

/** One rail entry. `key` is the caller's module id; `label` is what renders. */
export interface SuiteDesktopModule {
  key: string;
  label: string;
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
  return (
    <View style={styles.desktopHost} testID={testID}>
      <View style={styles.desktopCentered}>
        <View style={styles.desktopRail} accessibilityRole="tablist">
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
  const focusControl = useCallback((control: View | null): void => {
    (control as unknown as { focus?: () => void } | null)?.focus?.();
  }, []);
  // ORCH-1184 — no grey uppercase section captions: the rail reads as ONE
  // clean, uniformly-spaced list. Ordering/grouping is the caller's job.
  return (
    <View style={styles.railInner}>
      {modules.map((module) => {
        const isActive = module.key === activeModule;
        return (
          <Pressable
            ref={(instance) => {
              controlRefs.current[module.key] = instance;
            }}
            key={module.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={`${module.label} module`}
            onPress={() =>
              onSelect(module.key, () =>
                focusControl(controlRefs.current[module.key] ?? null)
              )
            }
            style={[styles.railRow, isActive ? styles.railRowActive : null]}
            testID={`${testIdPrefix}${module.key}`}
          >
            {isActive ? <View style={styles.railActiveBar} /> : null}
            <Text
              style={[
                styles.railLabel,
                isActive ? styles.railLabelActive : null,
              ]}
            >
              {module.label}
            </Text>
          </Pressable>
        );
      })}
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
  railInner: {
    // ORCH-1184 — the Command/Booking captions were removed, so the rail is one
    // uniformly-spaced list. `gap` applies evenly between every item.
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
  railRowActive: {
    // 2.0.1 polish — sleeker selected state. The old `accent.tint` (warm @0.28
    // alpha) read as a heavy brown fill. The app's restrained convention is a
    // faint neutral surface + the warm accent reserved for the edge bar + label,
    // so the active row uses the elevated glass surface (opaque-safe rgba) and
    // the warm signal lives in `railActiveBar` + `railLabelActive`.
    backgroundColor: glass.tint.profileElevated,
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
