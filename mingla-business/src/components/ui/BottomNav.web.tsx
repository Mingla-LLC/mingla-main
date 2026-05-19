/**
 * BottomNav.web — ORCH-0885-A Tier 1 web variant.
 *
 * Metro resolves `BottomNav` to this file on web (`Platform.OS === 'web'`)
 * and to the canonical mobile capsule `BottomNav.tsx` on iOS/Android. The
 * native bundle never includes this file. Precedent: `StripeProviderWrapper`
 * + `.native.tsx` at `app/_layout.tsx:40` (ORCH-0849).
 *
 * # Runtime behaviour
 * - On `isWideDesktop === false` → renders the canonical mobile capsule
 *   (`MobileBottomNav` re-exported below). This keeps narrow web viewports
 *   (tablet portrait, mobile browser, dev resize ≤1023px) bit-identical to
 *   the iOS/Android capsule.
 * - On `isWideDesktop === true` → renders the **left vertical rail**: a
 *   `position: 'fixed'` 80px-wide column anchored to the left edge of the
 *   viewport, with the brand-mark badge at the top, the 5 tabs stacked
 *   vertically (Home / Hub / Ari / Blast at the top; Account pinned to the
 *   bottom via flex spacer), and no glass-capsule chrome.
 *
 * # Active-state tokens (SPEC §7 + /ui-ux-pro-max pre-flight decision)
 * Active tab background: `rgba(255,255,255,0.05)` (mock 01 line 70
 * `bg-white/5`). Border: `rgba(255,255,255,0.10)` (mock line 70
 * `border-white/10`). Outer ring: 2px `accent.glow` via `box-shadow` /
 * RN `shadowColor` token from `designSystem.shadows.glassChromeActive`.
 * Icon stroke + label color: `accent.warm` (#eb7825). Inactive icons:
 * `#b9b9c2` (mock line 76 stroke). Inactive labels: `#a1a1aa` (Tailwind
 * zinc-400, mock `text-zinc-400` line 76).
 *
 * /ui-ux-pro-max pre-flight rationale (2026-05-19): the mock chose a soft
 * white-wash + glow ring (not a full accent.tint fill like the mobile
 * capsule) because the rail sits on the ambient gradient — a strong
 * accent.tint fill would compete with the gradient's own warm wash. The
 * mobile capsule's stronger fill is needed because it lives on glass
 * chrome that has no inherent warm tone.
 *
 * # Invariants honoured
 * - I-DESKTOP-GATE-VIA-HOOK — gates exclusively via `useResponsiveLayout()`.
 * - I-NO-BOTTOMNAV-OUTSIDE-LAYOUT — file is only ever imported by
 *   `app/(tabs)/_layout.tsx` (via the bare `./BottomNav` specifier; Metro
 *   picks this file on web). Enforced by strict-grep
 *   `orch-0885-a-no-bottomnav-on-wide-desktop`.
 * - I-RN-COLOR-FORMATS — every colour is hex or rgba.
 * - No haptic feedback on web (mirrors `Platform.OS !== 'web'` gate in
 *   the mobile file's `handlePress`).
 *
 * Per SPEC_ORCH-0885-A §4.
 */

import React, { useCallback } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";

import {
  accent,
  shadows,
  spacing,
  typography,
} from "../../constants/designSystem";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";

import { BottomNav as MobileBottomNav } from "./BottomNav";
import { Icon } from "./Icon";
import type { IconName } from "./Icon";

export interface BottomNavTab {
  id: string;
  icon: IconName;
  label: string;
}

export interface BottomNavProps {
  tabs: BottomNavTab[];
  active: string;
  onChange: (id: string) => void;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

// Rail geometry constants — mock 01 lines 68 + 70.
const RAIL_WIDTH = 80;
const TAB_SIZE = 48;
const TAB_RADIUS = 16;
const ICON_SIZE = 20;
const BRAND_MARK_SIZE = 40;
const BRAND_MARK_RADIUS = 12;

// Active / inactive colour tokens — see file header for /ui-ux-pro-max
// pre-flight rationale and verbatim mock-01 sourcing.
const ACTIVE_BG = "rgba(255, 255, 255, 0.05)";
const ACTIVE_BORDER = "rgba(255, 255, 255, 0.10)";
const INACTIVE_ICON = "#b9b9c2";
const INACTIVE_LABEL = "#a1a1aa";
const RAIL_RIGHT_BORDER = "rgba(255, 255, 255, 0.05)";

// Brand-mark gradient — Tailwind `from-orange-500` to `to-rose-600`
// (mock line 69), resolved to hex so the implementor does not improvise.
const BRAND_MARK_GRADIENT_START = "#F4811F";
const BRAND_MARK_GRADIENT_END = "#E11D48";

export const BottomNav: React.FC<BottomNavProps> = ({
  tabs,
  active,
  onChange,
  testID,
  style,
}) => {
  const { isWideDesktop } = useResponsiveLayout();

  // Narrow web viewport (tablet portrait, mobile browser, <1024px desktop):
  // fall through to the canonical glass-capsule. Visual contract identical
  // to iOS/Android because we re-export the same component.
  if (!isWideDesktop) {
    return (
      <MobileBottomNav
        tabs={tabs}
        active={active}
        onChange={onChange}
        testID={testID}
        style={style}
      />
    );
  }

  return <DesktopRail tabs={tabs} active={active} onChange={onChange} testID={testID} />;
};

interface DesktopRailProps {
  tabs: BottomNavTab[];
  active: string;
  onChange: (id: string) => void;
  testID?: string;
}

const DesktopRail: React.FC<DesktopRailProps> = ({ tabs, active, onChange, testID }) => {
  const handlePress = useCallback(
    (id: string) => (): void => {
      // No haptics on web — mirror Platform.OS !== 'web' gate in mobile file.
      onChange(id);
    },
    [onChange],
  );

  // On-the-fly UI iteration (2026-05-19): Account moved from the rail's
  // bottom-pinned slot to the TopBar's right cluster (after the bell icon)
  // on web ≥1024px. Source of truth for desktop nav: rail = primary tabs
  // only (Home / Hub / Ari / Blast); identity/settings = TopBar. The
  // mobile capsule (narrow web + native) is unaffected — this file's
  // capsule branch upstream still renders ALL 5 tabs including Account.
  // Therefore `accountTab` is intentionally NOT rendered in the rail.
  const primaryTabs = tabs.filter((tab) => tab.id !== "account");

  return (
    <View
      testID={testID}
      style={styles.rail}
      accessibilityRole="tablist"
    >
      {/* Brand-mark badge (top of rail). 40×40, gradient from orange-500
          to rose-600, centred bold "M". Mock 01 line 69. */}
      <LinearGradient
        colors={[BRAND_MARK_GRADIENT_START, BRAND_MARK_GRADIENT_END]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.brandMark}
      >
        <Text style={styles.brandMarkLetter}>M</Text>
      </LinearGradient>

      {/* Primary tabs (Home / Hub / Ari / Blast / any future non-account tab). */}
      {primaryTabs.map((tab) => (
        <RailTab
          key={tab.id}
          tab={tab}
          isActive={tab.id === active}
          onPress={handlePress(tab.id)}
        />
      ))}

      {/* Flex spacer fills the remaining rail height. Account used to be
          pinned below this spacer; per the 2026-05-19 on-the-fly UI
          iteration, Account now lives in the TopBar right cluster. The
          spacer stays so primary tabs stay anchored to the top. */}
      <View style={styles.spacer} />
    </View>
  );
};

interface RailTabProps {
  tab: BottomNavTab;
  isActive: boolean;
  onPress: () => void;
}

const RailTab: React.FC<RailTabProps> = ({ tab, isActive, onPress }) => {
  const iconColor = isActive ? accent.warm : INACTIVE_ICON;
  const labelColor = isActive ? accent.warm : INACTIVE_LABEL;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: isActive }}
      accessibilityLabel={tab.label}
      style={[styles.tab, isActive ? styles.tabActive : null]}
    >
      <Icon name={tab.icon} size={ICON_SIZE} color={iconColor} />
      <Text style={[styles.tabLabel, { color: labelColor }]} numberOfLines={1}>
        {tab.label}
      </Text>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  rail: {
    // RN-web maps `position: 'fixed'` to CSS `position: fixed`. Type cast
    // is at the View style assignment above.
    position: "fixed" as unknown as "absolute",
    top: 0,
    left: 0,
    bottom: 0,
    width: RAIL_WIDTH,
    flexDirection: "column",
    alignItems: "center",
    paddingVertical: spacing.lg,
    gap: spacing.sm,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: RAIL_RIGHT_BORDER,
    // Higher than typical content but below modal overlay (Sheet uses
    // RN Modal which portals to root). 50 fits the documented z-index
    // scale (10/20/30/50) — rail is chrome, not modal.
    zIndex: 50,
  },
  brandMark: {
    width: BRAND_MARK_SIZE,
    height: BRAND_MARK_SIZE,
    borderRadius: BRAND_MARK_RADIUS,
    marginBottom: spacing.md,
    alignItems: "center",
    justifyContent: "center",
  },
  brandMarkLetter: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: 0,
  },
  tab: {
    width: TAB_SIZE,
    height: TAB_SIZE,
    borderRadius: TAB_RADIUS,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    borderWidth: 1,
    borderColor: "transparent",
  },
  tabActive: {
    backgroundColor: ACTIVE_BG,
    borderColor: ACTIVE_BORDER,
    // 2px accent.glow outer ring — mock 01 line 70 `box-shadow: 0 0 0 2px
    // var(--accent-glow)`. Use the existing token from designSystem so we
    // don't fork shadow values.
    ...shadows.glassChromeActive,
  },
  tabLabel: {
    fontSize: 9,
    lineHeight: 11,
    fontWeight: typography.micro.fontWeight,
    letterSpacing: typography.micro.letterSpacing,
  },
  spacer: {
    flex: 1,
  },
});

export default BottomNav;
