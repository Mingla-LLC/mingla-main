/**
 * TopBar — top-of-screen chrome.
 *
 * Three left-slot variants:
 *   - `brand` — the WorkspaceBrandSwitcher (#4453): brand mark, name and
 *               chevron for the brand of the screen you are on (the route's
 *               brand wins over the current-brand store). `onBrandTap` is
 *               the host's own full switcher sheet: phones open it, the
 *               desktop popover offers it as "Manage brands". Without it the
 *               switcher opens its own menu. MinglaMark logo intentionally
 *               omitted per ORCH-BIZ-0a-D1.
 *   - `back`  — `chevL` IconChrome + optional title.
 *   - `none`  — no left content (renders empty View for layout balance).
 *
 * Right slot is configurable; defaults to a Messages IconChrome + bell
 * IconChrome with badge. Caller passes any `React.ReactNode`. #4255 W5: for
 * active Admin staff only, a Mingla team "M" sits between the two.
 *
 * Wrapper uses `GlassChrome` with `intensity="cardElevated"` (premium
 * frost), tinted floor `rgba(12,14,18,0.55)`, and `shadows.glassCard-
 * Elevated` for stronger separation from the canvas. Component-level
 * overrides per ORCH-BIZ-0a-D2 (Path D — full premium).
 */

import React, { useContext } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { useRouter } from "expo-router";
import { QueryClientContext } from "@tanstack/react-query";

import { color, shadow as shadowTokens, space, type } from "../../constants/designSystem";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";
import { useAuth } from "../../context/AuthContext";
import { useBusinessNotificationsInbox } from "../../hooks/useBusinessNotifications";
import { useBrandGroups } from "../../hooks/useBrandGroups";
import { useBrandEnquiries } from "../../hooks/useBrandEnquiries";
import { messagesBadgeCount } from "../../utils/brandEnquiryWaiting";

import { WorkspaceBrandSwitcher } from "../brand/WorkspaceBrandSwitcher";

import { Avatar } from "./Avatar";
import { GlassChrome } from "./GlassChrome";
import { IconChrome } from "./IconChrome";

export type TopBarLeftKind = "brand" | "back" | "none";

export interface TopBarProps {
  leftKind: TopBarLeftKind;
  /** Title text (`back` variant). Ignored for other variants. */
  title?: string;
  /** Back-button handler (`back` variant). */
  onBack?: (restoreFocus?: () => void) => void;
  /**
   * Right slot content. If defined, REPLACES the default `[search, bell]`
   * cluster.
   *
   * Per I-37: `leftKind="brand"` consumers MUST NOT pass `rightSlot=` —
   * use `extraRightSlot` to ADD icons after the default cluster instead.
   *
   * For `leftKind="back"` consumers, `rightSlot=` is the canonical
   * suppress/replace mechanism. Three documented patterns:
   *   - `rightSlot={null}` → suppresses default cluster entirely
   *     (e.g., `app/brand/[id]/audit-log.tsx`, `app/brand/[id]/team.tsx`
   *      loading branch)
   *   - `rightSlot={<View />}` → empty placeholder for layout balance
   *     (e.g., `BrandProfileView.tsx`, `BrandPaymentsView.tsx` ready/loading
   *      branches)
   *   - `rightSlot={<page-specific-action>}` → page-specific replace
   *     (e.g., `BrandEditView.tsx` Save button, `event/[id]/index.tsx`
   *      Share + Manage cluster, `team.tsx` invite Plus)
   *
   * Strict-grep CI gate enforces I-37 — `.github/workflows/strict-grep-
   * mingla-business.yml` fails CI if any `<TopBar leftKind="brand">`
   * consumer passes `rightSlot=`.
   */
  rightSlot?: React.ReactNode;
  /**
   * Optional icons composed AFTER the default `[search, bell]` cluster.
   * Use this for primary-tab page-specific extras (e.g., events tab `+`).
   * Renders inside the same flex row, gap=spacing.sm, in source order.
   *
   * Per I-37: ONLY honored when `rightSlot` is undefined. If both are
   * passed, `rightSlot` wins (preserves back-route compatibility);
   * the strict-grep CI gate flags `leftKind="brand"` consumers that
   * pass `rightSlot=` as I-37 violations.
   */
  extraRightSlot?: React.ReactNode;
  /** Bell badge count when default right slot renders. */
  unreadCount?: number;
  /**
   * The host's own full brand switcher sheet (create, continue setup, delete).
   * Phones open it from the brand chip; on desktop the chip opens the
   * WorkspaceBrandSwitcher popover, which offers it as "Manage brands".
   * Undefined: the chip opens the switcher's own menu (#4453).
   */
  onBrandTap?: () => void;
  /**
   * issue #3345 — the host knows the active brand is still being resolved
   * (Home passes its recovery state). The top bar also derives the id-selected
   * and not-yet-hydrated windows itself, so every screen is covered without it.
   */
  brandLoading?: boolean;
  /**
   * #4420 (B5): show the profile button (Avatar 36 → `/(tabs)/account`) at
   * the end of the phone top bar. Defaults to true for `leftKind="brand"`
   * (the tab roots) on phones; desktop keeps its Account icon.
   */
  showProfileButton?: boolean;
  /**
   * #4420: pushed-screen title alignment on phones. Default `center` (kit
   * NavBar-m) when the right side is the default cluster or empty; `left`
   * when a custom right slot is given, so a long title never runs under it.
   */
  titleAlign?: "left" | "center";
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

const TOPBAR_HEIGHT = 56;
/** Room kept clear on each side of a centred title (back button / right icons). */
const CENTER_TITLE_INSET = 96;

/**
 * Default right-slot icons (Messages + bell). Rendered WITHOUT outer View
 * wrap so the parent render branch can compose with `extraRightSlot` in
 * one flex row. The wrapping `<View style={styles.rightCluster}>` lives
 * in the TopBar render branch below.
 */
/** Stands in when a test replaces react-query without its context. */
const NO_QUERY_CLIENT = React.createContext<undefined>(undefined);

/**
 * #4420 B5 — the profile button that replaces the Account tab on phones.
 * The `/(tabs)/account` route stays, so deep links keep working.
 */
export const ProfileButton: React.FC = () => {
  const router = useRouter();
  const { user } = useAuth();
  const metadata = (user as { user_metadata?: { full_name?: unknown; name?: unknown; avatar_url?: unknown } } | null)
    ?.user_metadata;
  const name =
    (typeof metadata?.full_name === "string" && metadata.full_name) ||
    (typeof metadata?.name === "string" && metadata.name) ||
    user?.email ||
    "";
  const photo = typeof metadata?.avatar_url === "string" && metadata.avatar_url.length > 0 ? metadata.avatar_url : undefined;
  return (
    <Pressable
      onPress={() => router.push("/(tabs)/account" as never)}
      accessibilityRole="button"
      accessibilityLabel="Account"
      hitSlop={4}
      testID="topbar-profile-button"
    >
      <Avatar name={name} size="sm" photo={photo} accessibilityLabel="Account" />
    </Pressable>
  );
};

const MessagesButton: React.FC<{ unread: number }> = ({ unread }) => {
  const router = useRouter();
  return (
    <IconChrome
      icon="chat"
      size={36}
      badge={unread}
      badgeCap={9}
      accessibilityLabel={unread > 0 ? `Messages, ${unread} unread` : "Messages"}
      onPress={() => router.push("/messages" as never)}
    />
  );
};

/**
 * #4111 D4 — the speech bubble also counts customer enquiries waiting on the
 * team (new|waiting). Enquiry cards in Brand groups are never unread.
 */
const EnquiryAwareMessagesButton: React.FC<{ groupUnread: number }> = ({
  groupUnread,
}) => {
  const enquiries = useBrandEnquiries("open");
  return (
    <MessagesButton
      unread={messagesBadgeCount(groupUnread, enquiries.data?.counts)}
    />
  );
};

/**
 * #4255 W5 — the Mingla team "M" (active Admin staff only). Its staff check
 * and button are one small lazy chunk; until team_badge says staff it renders
 * nothing (no gap, no crash), and it needs the app's query client.
 */
const LazyMinglaTeamSlot = React.lazy(() => import("../minglaTeam/teamBadge"));

const DefaultRightSlotInner: React.FC<{ unreadCount: number | undefined }> = ({
  unreadCount,
}) => {
  const router = useRouter();
  const { user } = useAuth();
  // META-ORCH-1074 Sub-C: the bell self-sources its unread badge from the
  // notifications inbox hook (no TopBar consumer passes `unreadCount`, so the
  // badge would otherwise always be empty). An explicit `unreadCount` prop, if
  // ever passed, still wins. I-37 safe: this lives INSIDE the default cluster.
  const { unreadCount: derivedUnread } = useBusinessNotificationsInbox(
    user?.id ?? null,
  );
  const { unreadCount: groupUnread } = useBrandGroups();
  // #4111 D4 — the enquiry count needs the app's query client. The top bar is
  // also mounted without one (isolated renders); then it counts Brand groups
  // only instead of crashing.
  const hasQueryClient =
    useContext(QueryClientContext ?? NO_QUERY_CLIENT) !== undefined;
  const badge = unreadCount ?? derivedUnread;
  return (
    <>
      {hasQueryClient ? (
        <EnquiryAwareMessagesButton groupUnread={groupUnread} />
      ) : (
        <MessagesButton unread={groupUnread} />
      )}
      {/* #4255 W5 — between the chat bubble and the bell; needs the query
          client, so an isolated render without one shows no M. */}
      {hasQueryClient && user?.id ? (
        <React.Suspense fallback={null}>
          <LazyMinglaTeamSlot userId={user.id} />
        </React.Suspense>
      ) : null}
      {/* META-ORCH-1074 Sub-C: the bell opens the notifications inbox route.
          Badge caps at 9+ (operator noise reduction; other call-sites keep 99). */}
      <IconChrome
        icon="bell"
        size={36}
        badge={badge}
        badgeCap={9}
        onPress={() => router.push("/notifications" as never)}
        accessibilityLabel={
          badge > 0 ? `Notifications, ${badge} unread` : "Notifications"
        }
      />
    </>
  );
};

/**
 * #4389 AB — Messages + bell exactly as Home's default cluster, for Ari's
 * first-run bar (no Home tab to reach them). Ari composes this with its own
 * icons; it never passes `rightSlot=` to a brand TopBar (I-37).
 */
export const TopBarMessagesAndBell: React.FC = () => (
  <DefaultRightSlotInner unreadCount={undefined} />
);

export const TopBar: React.FC<TopBarProps> = ({
  leftKind,
  title,
  onBack,
  rightSlot,
  extraRightSlot,
  unreadCount,
  onBrandTap,
  brandLoading = false,
  showProfileButton,
  titleAlign,
  testID,
  style,
}) => {
  const router = useRouter();
  const { isWideDesktop } = useResponsiveLayout();

  // Desktop top-bar layout (web ≥1024px, default-cluster consumers only):
  // `extraRightSlot` (typically the "+" CTA) moves to an absolutely-positioned
  // centre slot; right cluster gains an Account IconChrome after the bell.
  // Gate: isWideDesktop + rightSlot === undefined (respect any consumer
  // that fully replaces the right slot — back routes, BrandEdit Save, etc.).
  // Mobile + narrow web + rightSlot consumers: render byte-identical to today.
  const useDesktopLayout = isWideDesktop && rightSlot === undefined;
  const profileOnPhone = !isWideDesktop && (showProfileButton ?? leftKind === "brand");
  const centredTitle =
    leftKind === "back" &&
    title !== undefined &&
    !isWideDesktop &&
    (titleAlign ?? (rightSlot === undefined || rightSlot === null ? "center" : "left")) === "center";

  const handleAccountTap = (): void => {
    router.push("/(tabs)/account" as never);
  };

  const renderLeft = (): React.ReactNode => {
    switch (leftKind) {
      case "brand": {
        // #4453 — the one switcher: it shows the brand of the screen you
        // are on and opens the same screen for the brand you pick.
        return <WorkspaceBrandSwitcher onOpenSheet={onBrandTap} brandLoading={brandLoading} />;
      }
      case "back": {
        return (
          <View style={styles.backRow}>
            <IconChrome
              icon="chevL"
              size={36}
              onPress={onBack}
              accessibilityLabel="Back"
            />
            {title !== undefined && !centredTitle ? (
              <Text style={styles.backTitle} numberOfLines={1}>
                {title}
              </Text>
            ) : null}
          </View>
        );
      }
      case "none":
      default:
        return <View style={styles.none} />;
    }
  };

  return (
    <View testID={testID} style={style}>
      <GlassChrome material="chrome" shadow={shadowTokens.pane} radius="xl" style={styles.bar}>
        <View style={styles.barInner}>
          {centredTitle ? (
            <View style={styles.centerTitleWrap} pointerEvents="none">
              <Text style={styles.centerTitle} numberOfLines={1} accessibilityRole="header">
                {title}
              </Text>
            </View>
          ) : null}
          <View style={styles.leftSlot}>{renderLeft()}</View>
          {/* Centre slot — absolutely positioned + pointerEvents="box-none"
              so it doesn't intercept taps destined for left/right clusters.
              Only mounts when desktop layout is active AND extraRightSlot
              is non-null (otherwise empty overlay = no visual change). */}
          {useDesktopLayout && extraRightSlot !== undefined ? (
            <View style={styles.centerSlot} pointerEvents="box-none">
              {extraRightSlot}
            </View>
          ) : null}
          <View style={styles.rightSlot}>
            {rightSlot !== undefined ? rightSlot : (
              <View style={styles.rightCluster}>
                <DefaultRightSlotInner unreadCount={unreadCount} />
                {/* On desktop, Account moves from the rail to here; the +
                    button that would have been here moves to centerSlot
                    above. On mobile/narrow-web, render exactly as today
                    (extraRightSlot appended). */}
                {useDesktopLayout ? (
                  <IconChrome
                    icon="user"
                    size={36}
                    onPress={handleAccountTap}
                    accessibilityLabel="Account"
                  />
                ) : (
                  extraRightSlot
                )}
                {profileOnPhone ? <ProfileButton /> : null}
              </View>
            )}
          </View>
        </View>
      </GlassChrome>
    </View>
  );
};

const styles = StyleSheet.create({
  bar: {
    minHeight: TOPBAR_HEIGHT,
  },
  barInner: {
    minHeight: TOPBAR_HEIGHT,
    paddingHorizontal: space[3],
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space[2],
  },
  leftSlot: {
    flexShrink: 1,
    minWidth: 0,
  },
  rightSlot: {
    flexShrink: 0,
  },
  centerSlot: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  centerTitleWrap: {
    position: "absolute",
    left: CENTER_TITLE_INSET,
    right: CENTER_TITLE_INSET,
    top: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  centerTitle: {
    ...type.h2,
    color: color.text1,
  },
  rightCluster: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
  },
  backRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
  },
  backTitle: {
    color: color.text1,
    fontSize: type.h2.fontSize,
    lineHeight: type.h2.lineHeight,
    fontWeight: type.h2.fontWeight,
  },
  none: {
    width: 36,
    height: 36,
  },
});

export default TopBar;
