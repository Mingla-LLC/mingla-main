/**
 * Account tab — Cycle 1 wiring on top of Cycle 0a placeholder.
 *
 * Cycle 0a: TopBar (brand chip → toast), GlassCard placeholder, sign-out
 * button.
 * Cycle 1: brand chip now opens BrandSwitcherSheet (per DEC-079 carve-out).
 * Two dev-only buttons added under __DEV__:
 *   - "Seed 4 stub brands" — populates store from STUB_BRANDS, sets current
 *     to Sunday Languor (so Home hero AC#3 fires immediately).
 *   - "Wipe brands" — clears store back to empty for AC#1 testing.
 * Both marked [TRANSITIONAL] — removed in B1 backend cycle.
 *
 * Cycle 14 lands real Account features (profile, settings, delete-flow).
 */

import React, { Suspense, useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GlassCard } from "../../src/components/ui/GlassCard";
import { Icon } from "../../src/components/ui/Icon";
import type { IconName } from "../../src/components/ui/Icon";
import { IconChrome } from "../../src/components/ui/IconChrome";
import { Toast } from "../../src/components/ui/Toast";
import { TopBar } from "../../src/components/ui/TopBar";
import {
  accent,
  glass,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../src/constants/designSystem";
import { useAuth } from "../../src/context/AuthContext";
import { useBrandListState } from "../../src/hooks/useBrandListShim";
import { hasStoredSupabaseWebSession } from "../../src/utils/storedWebSession";
import { isAccountAuthWarming } from "../../src/utils/coldLoadAuthGates";
// ORCH-1052 hotfix — surface the partner earnings entry on the Account tab
// when an admin flips creator_accounts.partner_enabled=true. The hook
// refetches on window focus + mount so the flip becomes visible within
// seconds of the next Account-tab open (no manual reload needed).
import { usePartnerStripeStatus } from "../../src/hooks/usePartnerStripe";
// ORCH-1081 — partner_brand_links count drives the "Partner brands" row meta
// (active + pending). Read-only; staleTime 30s.
import { usePartnerBrandLinks } from "../../src/hooks/usePartnerBrandLinks";
import {
  useCurrentBrandStore,
  type Brand,
} from "../../src/store/currentBrandStore";

const LazyBrandSwitcherSheet = React.lazy(async () => {
  const mod = await import("../../src/components/brand/BrandSwitcherSheet");
  return { default: mod.BrandSwitcherSheet };
});

const LazyBrandDeleteSheet = React.lazy(async () => {
  const mod = await import("../../src/components/brand/BrandDeleteSheet");
  return { default: mod.BrandDeleteSheet };
});

const LazyUniversalCreatorSheet = React.lazy(async () => {
  const mod = await import("../../src/components/ui/UniversalCreatorSheet");
  return { default: mod.UniversalCreatorSheet };
});

interface ToastState {
  visible: boolean;
  message: string;
}

const formatBrandEventCount = (count: number): string =>
  `${count} ${count === 1 ? "event" : "events"}`;

export default function AccountTab(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, signOut, lastRecoveryEvent, clearLastRecoveryEvent } = useAuth();
  const brandList = useBrandListState();
  const brands = brandList.brands;

  // ORCH-1100 Wave 3 — cold-direct-load auth-readiness flash fix.
  // On a refresh/bookmark of /account the 3s auth bootstrap can time out and
  // resolve to a transient "signed_out"/"query_disabled" brand-list status while
  // the persisted session is still warming (late SIGNED_IN / TOKEN_REFRESHED).
  // The signed-out RECOVERY landing is suppressed in app/_layout.tsx during that
  // window (a stored token exists), so this route renders instead — and without
  // this guard it would briefly show a BLANK brand area (those statuses hit no
  // branch). Treat "auth not yet resolved but a stored web session exists" as a
  // LOADING state. A genuinely logged-out user never reaches this route (the
  // _layout recovery gate fires first), and has no stored token anyway.
  const isAuthWarming = isAccountAuthWarming({
    brandListStatus: brandList.status,
    hasStoredWebSession: hasStoredSupabaseWebSession(),
  });
  const setCurrentBrand = useCurrentBrandStore((s) => s.setCurrentBrand);

  const [sheetVisible, setSheetVisible] = useState<boolean>(false);
  // ORCH-0826 M0: universal creator sheet (Create event/experience/trip)
  const [isUniversalCreatorOpen, setIsUniversalCreatorOpen] = useState<boolean>(false);
  // Cycle 17e-A: BrandDeleteSheet state — opens from BrandSwitcherSheet trash
  // taps (operator selects which brand to delete from the switcher row UI).
  const [deleteSheetVisible, setDeleteSheetVisible] = useState<boolean>(false);
  const [brandPendingDelete, setBrandPendingDelete] = useState<Brand | null>(
    null,
  );
  const [toast, setToast] = useState<ToastState>({ visible: false, message: "" });

  // Cycle 14 — D-CYCLE14-FOR-6 + I-35: consume recover-on-sign-in event
  useEffect(() => {
    if (lastRecoveryEvent !== null) {
      setToast({
        visible: true,
        message: "Welcome back — your account has been recovered.",
      });
      clearLastRecoveryEvent();
    }
  }, [lastRecoveryEvent, clearLastRecoveryEvent]);

  const handleSignOut = useCallback(async (): Promise<void> => {
    try {
      await signOut();
      // After signOut succeeds, navigate to root. AuthContext clears `user`
      // to null via the Supabase listener, then app/index.tsx renders the
      // BusinessWelcomeScreen. Without this navigation, the user stays on
      // /(tabs)/account with cleared session but unchanged UI (Cycle 0a-vintage
      // bug surfaced during Cycle 0b smoke; per ORCH-BIZ-AUTH-SIGNOUT-NAV).
      router.replace("/");
    } catch (error) {
      if (__DEV__) {
        console.error("[AccountTab] signOut threw:", error);
      }
    }
  }, [signOut, router]);

  // Cycle 14 — Settings hub navigation handlers per SPEC §4.7.1.
  const handleEditProfile = useCallback((): void => {
    router.push("/account/edit-profile" as never);
  }, [router]);

  const handleNotifications = useCallback((): void => {
    router.push("/account/notifications" as never);
  }, [router]);

  // META-ORCH-1104 Phase 1 — Help & Support (business requester entry).
  const handleSupport = useCallback((): void => {
    router.push("/account/support" as never);
  }, [router]);

  // ORCH-1052 hotfix — partner section navigation.
  const handlePartnerEarnings = useCallback((): void => {
    router.push("/partner/earnings" as never);
  }, [router]);
  const partnerStatus = usePartnerStripeStatus();
  const isPartner = partnerStatus.data?.partner_enabled === true;
  // ORCH-1081 — partner brand portfolio entry-row meta. Skipped (no fetch) when
  // the user isn't a partner — `enabled` is implicit through React Query's
  // staleTime + we just don't read .data when isPartner=false.
  const partnerLinksQuery = usePartnerBrandLinks();
  const partnerActiveCount = isPartner
    ? (partnerLinksQuery.data ?? []).filter((r) => r.status === "active").length
    : 0;
  const partnerPendingCount = isPartner
    ? (partnerLinksQuery.data ?? []).filter(
        (r) => r.status === "awaiting_owner" || r.status === "awaiting_stripe",
      ).length
    : 0;
  const handlePartnerBrands = useCallback((): void => {
    router.push("/partner/brands" as never);
  }, [router]);

  const handleOpenSwitcher = useCallback((): void => {
    setSheetVisible(true);
  }, []);

  const handleOpenBrandProfile = useCallback(
    (brandId: string): void => {
      router.push(`/brand/${brandId}` as never);
    },
    [router],
  );

  const handleCloseSheet = useCallback((): void => {
    setSheetVisible(false);
  }, []);

  const handleBrandCreated = useCallback((brand: Brand): void => {
    setToast({ visible: true, message: `${brand.displayName} is ready` });
  }, []);

  // Cycle 17e-A: BrandSwitcherSheet trash tap → open BrandDeleteSheet
  const handleRequestDeleteBrand = useCallback((brand: Brand): void => {
    setBrandPendingDelete(brand);
    setDeleteSheetVisible(true);
  }, []);

  const handleCloseDeleteSheet = useCallback((): void => {
    setDeleteSheetVisible(false);
    // Don't clear brandPendingDelete immediately — exit animation reads it
  }, []);

  const handleBrandDeleted = useCallback(
    (deletedBrandId: string): void => {
      // Clear currentBrand if it matches deleted brand (server already cleared
      // default_brand_id per softDeleteBrand Step 3; this clears local UI state)
      const currentBrandId = useCurrentBrandStore.getState().currentBrandId;
      if (currentBrandId === deletedBrandId) {
        setCurrentBrand(null);
      }
      const deleted = brandPendingDelete;
      setBrandPendingDelete(null);
      setToast({
        visible: true,
        message: `${deleted?.displayName ?? "Brand"} deleted`,
      });
    },
    [setCurrentBrand, brandPendingDelete],
  );

  const handleDismissToast = useCallback((): void => {
    setToast((prev) => ({ ...prev, visible: false }));
  }, []);

  // Cycle 17e-A: dev-seed buttons REMOVED per Decision 8 = C accept-as-loss.
  // Brand list now flows from React Query (Const #5) — operators create real
  // brands via the wired BrandSwitcherSheet create flow. Pre-17e-A phone-only
  // STUB_BRANDS state is wiped on first 17e-A run; documented as intentional
  // breaking change for DEV-only state. Production operators see no change
  // (they never had stub brands; seed/wipe were `__DEV__`-gated).

  return (
    <View style={[styles.host, { paddingTop: insets.top }]}>
      <View style={styles.barWrap}>
        <TopBar
          leftKind="brand"
          onBrandTap={handleOpenSwitcher}
          extraRightSlot={
            <IconChrome
              icon="plus"
              size={36}
              onPress={() => setIsUniversalCreatorOpen(true)}
              accessibilityLabel="Create event, experience, or trip"
              testID="account-universal-creator-button"
            />
          }
        />
      </View>
      <ScrollView contentContainerStyle={styles.scroll}>
        {brandList.status === "ready" ? (
          <GlassCard variant="elevated" padding={spacing.lg}>
            <Text style={styles.title}>Your brands</Text>
            <Text style={styles.body}>Tap a brand to open its profile.</Text>
            <View style={styles.brandRowsCol}>
              {brands.map((brand) => (
                <Pressable
                  key={brand.id}
                  onPress={() => handleOpenBrandProfile(brand.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${brand.displayName} profile`}
                  style={styles.brandRow}
                >
                  <View style={styles.brandAvatar}>
                    <Text style={styles.brandInitial}>
                      {brand.displayName.charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View style={styles.brandTextCol}>
                    <Text style={styles.brandName} numberOfLines={1}>
                      {brand.displayName}
                    </Text>
                    <Text style={styles.brandEventCount} numberOfLines={1}>
                      {formatBrandEventCount(brand.stats.events)}
                    </Text>
                  </View>
                  <Icon name="chevR" size={16} color={textTokens.tertiary} />
                </Pressable>
              ))}
            </View>
          </GlassCard>
        ) : brandList.status === "auth_loading" ||
          brandList.status === "query_loading" ||
          isAuthWarming ? (
          <GlassCard variant="elevated" padding={spacing.lg}>
            <Text style={styles.title}>Your brands</Text>
            <Text style={styles.body}>Loading your brands…</Text>
          </GlassCard>
        ) : brandList.status === "error" ? (
          <GlassCard variant="elevated" padding={spacing.lg}>
            <Text style={styles.title}>Your brands</Text>
            <Text style={styles.body}>
              Couldn't load your brands. Pull down or reopen Account to retry.
            </Text>
          </GlassCard>
        ) : brandList.status === "empty" ? (
          <GlassCard variant="elevated" padding={spacing.lg}>
            <Text style={styles.title}>Your brands</Text>
            <Text style={styles.body}>
              Create your first brand from the brand switcher.
            </Text>
          </GlassCard>
        ) : null}

        {/* ORCH-1052 hotfix — Mingla Partner section. Visible only when
            creator_accounts.partner_enabled=true (account-level flag flipped
            by a Mingla admin via mingla-admin User Management). Surfaces
            within seconds of the toggle thanks to usePartnerStripeStatus
            staleTime:0 + refetchOnWindowFocus:true. */}
        {isPartner ? (
          <GlassCard variant="elevated" padding={spacing.lg}>
            <Text style={styles.title}>Mingla Partner</Text>
            <Text style={styles.body}>
              You earn 0.15% of every ticket sold on brands you manage as a brand admin.
            </Text>
            <View style={styles.navRowsCol}>
              <SettingsNavRow
                icon="trending"
                label="Partner earnings"
                onPress={handlePartnerEarnings}
              />
              {/* ORCH-1081 — Partner brands row. Meta count rendered inline.
                  Shows on every partner's account; the empty-list-state
                  inside the screen handles the no-brands case. */}
              <SettingsNavRow
                icon="tag"
                label={
                  partnerActiveCount === 0 && partnerPendingCount === 0
                    ? "Partner brands"
                    : `Partner brands · ${partnerActiveCount} active · ${partnerPendingCount} pending`
                }
                onPress={handlePartnerBrands}
              />
            </View>
          </GlassCard>
        ) : null}

        {/* Cycle 14 — Settings hub: 3 sub-route nav rows per SPEC §4.7.1 + DEC-096 D-14-17. */}
        <GlassCard variant="elevated" padding={spacing.lg}>
          <Text style={styles.title}>Settings</Text>
          <Text style={styles.body}>
            Manage your profile, notifications, and session.
          </Text>
          <View style={styles.navRowsCol}>
            <SettingsNavRow
              icon="user"
              label="Edit profile"
              onPress={handleEditProfile}
            />
            <SettingsNavRow
              icon="bell"
              label="Notifications"
              onPress={handleNotifications}
            />
            <SettingsNavRow
              icon="chat"
              label="Help & Support"
              onPress={handleSupport}
            />
            <SettingsNavRow
              icon="shield"
              label="Sign out everywhere"
              onPress={handleSignOut}
            />
          </View>
        </GlassCard>

        {/* Cycle 17e-A: dev-seed/wipe buttons removed per Decision 8 = C.
            Operators create real brands via BrandSwitcherSheet → useCreateBrand. */}
      </ScrollView>

      {sheetVisible ? (
        <Suspense fallback={null}>
          <LazyBrandSwitcherSheet
            visible
            onClose={handleCloseSheet}
            onBrandCreated={handleBrandCreated}
            onRequestDeleteBrand={handleRequestDeleteBrand}
          />
        </Suspense>
      ) : null}

      {/* ORCH-0826 M0: universal creator sheet (Create event/experience/trip) */}
      {isUniversalCreatorOpen ? (
        <Suspense fallback={null}>
          <LazyUniversalCreatorSheet
            visible
            onClose={() => setIsUniversalCreatorOpen(false)}
          />
        </Suspense>
      ) : null}

      {deleteSheetVisible ? (
        <Suspense fallback={null}>
          <LazyBrandDeleteSheet
            visible
            brand={brandPendingDelete}
            accountId={user?.id ?? null}
            onClose={handleCloseDeleteSheet}
            onDeleted={handleBrandDeleted}
          />
        </Suspense>
      ) : null}

      <View style={styles.toastWrap} pointerEvents="box-none">
        <Toast
          visible={toast.visible}
          kind="info"
          message={toast.message}
          onDismiss={handleDismissToast}
        />
      </View>
    </View>
  );
}

// Cycle 14 — SettingsNavRow inline component per SPEC §4.7.1.
// Mirrors brandRow visual rhythm but with optional destructive variant.
interface SettingsNavRowProps {
  icon: IconName;
  label: string;
  destructive?: boolean;
  onPress: () => void;
}

const SettingsNavRow: React.FC<SettingsNavRowProps> = ({
  icon,
  label,
  destructive = false,
  onPress,
}) => (
  <Pressable
    onPress={onPress}
    accessibilityRole="button"
    accessibilityLabel={label}
    style={({ pressed }) => [
      styles.navRow,
      pressed && styles.navRowPressed,
    ]}
  >
    <View
      style={[
        styles.navIconBadge,
        destructive && styles.navIconBadgeDestructive,
      ]}
    >
      <Icon
        name={icon}
        size={18}
        color={destructive ? semantic.error : textTokens.primary}
      />
    </View>
    <Text
      style={[
        styles.navLabel,
        destructive && styles.navLabelDestructive,
      ]}
      numberOfLines={1}
    >
      {label}
    </Text>
    <Icon name="chevR" size={16} color={textTokens.tertiary} />
  </Pressable>
);

const styles = StyleSheet.create({
  host: {
    flex: 1,
  },
  barWrap: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  scroll: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.lg,
    paddingBottom: spacing.xl * 4,
    gap: spacing.md,
  },
  title: {
    fontSize: typography.h2.fontSize,
    lineHeight: typography.h2.lineHeight,
    fontWeight: typography.h2.fontWeight,
    letterSpacing: typography.h2.letterSpacing,
    color: textTokens.primary,
    marginBottom: spacing.xs,
  },
  body: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    fontWeight: typography.bodySm.fontWeight,
    color: textTokens.secondary,
  },
  // Cycle 14 — Settings nav rows
  navRowsCol: {
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  navRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.sm,
    borderRadius: radiusTokens.lg,
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
  },
  navRowPressed: {
    opacity: 0.7,
  },
  navIconBadge: {
    width: 36,
    height: 36,
    borderRadius: radiusTokens.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255, 255, 255, 0.06)",
  },
  navIconBadgeDestructive: {
    backgroundColor: "rgba(239, 68, 68, 0.12)",
  },
  navLabel: {
    flex: 1,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: "600",
    color: textTokens.primary,
  },
  navLabelDestructive: {
    color: semantic.error,
  },
  toastWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: spacing.xl,
    paddingHorizontal: spacing.md,
  },

  // Your brands rows ----------------------------------------------------
  brandRowsCol: {
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radiusTokens.lg,
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
  },
  brandAvatar: {
    width: 40,
    height: 40,
    borderRadius: radiusTokens.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: accent.tint,
    borderWidth: 1,
    borderColor: accent.border,
  },
  brandInitial: {
    fontSize: typography.body.fontSize,
    fontWeight: "700",
    color: accent.warm,
  },
  brandTextCol: {
    flex: 1,
    minWidth: 0,
  },
  brandName: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: "600",
    color: textTokens.primary,
  },
  brandEventCount: {
    marginTop: 2,
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: typography.caption.fontWeight,
    color: textTokens.secondary,
  },
});
