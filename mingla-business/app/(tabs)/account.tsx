/**
 * Account tab — Cycle 1 wiring on top of Cycle 0a placeholder.
 *
 * Cycle 0a: TopBar (brand chip → toast), GlassCard placeholder, sign-out
 * button, dev styleguide link.
 * Cycle 1: brand chip now opens BrandSwitcherSheet (per DEC-079 carve-out).
 * Two dev-only buttons added under __DEV__:
 *   - "Seed 4 stub brands" — populates store from STUB_BRANDS, sets current
 *     to Sunday Languor (so Home hero AC#3 fires immediately).
 *   - "Wipe brands" — clears store back to empty for AC#1 testing.
 * Both marked [TRANSITIONAL] — removed in B1 backend cycle.
 *
 * Cycle 14 lands real Account features (profile, settings, delete-flow).
 */

import React, { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BrandDeleteSheet } from "../../src/components/brand/BrandDeleteSheet";
import { BrandSwitcherSheet } from "../../src/components/brand/BrandSwitcherSheet";
import { Button } from "../../src/components/ui/Button";
import { GlassCard } from "../../src/components/ui/GlassCard";
import { Icon } from "../../src/components/ui/Icon";
import type { IconName } from "../../src/components/ui/Icon";
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
import {
  useBrandList,
  useCurrentBrandStore,
  type Brand,
} from "../../src/store/currentBrandStore";

interface ToastState {
  visible: boolean;
  message: string;
}

export default function AccountTab(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, signOut, lastRecoveryEvent, clearLastRecoveryEvent } = useAuth();
  const brands = useBrandList();
  const setCurrentBrand = useCurrentBrandStore((s) => s.setCurrentBrand);

  const [sheetVisible, setSheetVisible] = useState<boolean>(false);
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
        // eslint-disable-next-line no-console
        console.error("[AccountTab] signOut threw:", error);
      }
    }
  }, [signOut, router]);

  const handleOpenStyleguide = useCallback((): void => {
    router.push("/__styleguide" as never);
  }, [router]);

  // Cycle 14 — Settings hub navigation handlers per SPEC §4.7.1.
  const handleEditProfile = useCallback((): void => {
    router.push("/account/edit-profile" as never);
  }, [router]);

  const handleNotifications = useCallback((): void => {
    router.push("/account/notifications" as never);
  }, [router]);

  const handleDeleteAccount = useCallback((): void => {
    router.push("/account/delete" as never);
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
      const current = useCurrentBrandStore.getState().currentBrand;
      if (current !== null && current.id === deletedBrandId) {
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

  const emailLabel =
    user?.email ??
    (typeof user?.user_metadata?.email === "string"
      ? user.user_metadata.email
      : "creator");

  return (
    <View style={[styles.host, { paddingTop: insets.top }]}>
      <View style={styles.barWrap}>
        <TopBar leftKind="brand" onBrandTap={handleOpenSwitcher} />
      </View>
      <ScrollView contentContainerStyle={styles.scroll}>
        <GlassCard variant="elevated" padding={spacing.lg}>
          <Text style={styles.title}>Account</Text>
          <Text style={styles.email} numberOfLines={1}>
            Signed in as {emailLabel}
          </Text>
          <View style={styles.signOutRow}>
            <Button
              label="Sign out everywhere"
              onPress={handleSignOut}
              variant="secondary"
              size="md"
            />
          </View>
          <Text style={styles.signOutCaption}>
            Signs you out on every device.
          </Text>
          {__DEV__ ? (
            <View style={styles.styleguideRow}>
              <Button
                label="Open dev styleguide"
                onPress={handleOpenStyleguide}
                variant="ghost"
                size="md"
                leadingIcon="grid"
              />
            </View>
          ) : null}
        </GlassCard>

        {/* Cycle 14 — Settings hub: 3 sub-route nav rows per SPEC §4.7.1 + DEC-096 D-14-17. */}
        <GlassCard variant="elevated" padding={spacing.lg}>
          <Text style={styles.title}>Settings</Text>
          <Text style={styles.body}>
            Manage your profile, notifications, and account.
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
              icon="trash"
              label="Delete account"
              destructive
              onPress={handleDeleteAccount}
            />
          </View>
        </GlassCard>

        {brands.length > 0 ? (
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
                    <Text style={styles.brandSub} numberOfLines={1}>
                      {brand.stats.events} events ·{" "}
                      {brand.stats.followers.toLocaleString("en-GB")} followers
                    </Text>
                  </View>
                  <Icon name="chevR" size={16} color={textTokens.tertiary} />
                </Pressable>
              ))}
            </View>
          </GlassCard>
        ) : null}

        {/* Cycle 17e-A: dev-seed/wipe buttons removed per Decision 8 = C.
            Operators create real brands via BrandSwitcherSheet → useCreateBrand. */}
      </ScrollView>

      <BrandSwitcherSheet
        visible={sheetVisible}
        onClose={handleCloseSheet}
        onBrandCreated={handleBrandCreated}
        onRequestDeleteBrand={handleRequestDeleteBrand}
      />

      <BrandDeleteSheet
        visible={deleteSheetVisible}
        brand={brandPendingDelete}
        accountId={user?.id ?? null}
        onClose={handleCloseDeleteSheet}
        onDeleted={handleBrandDeleted}
      />

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
    paddingTop: spacing.sm,
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
  email: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: typography.caption.fontWeight,
    letterSpacing: typography.caption.letterSpacing,
    color: textTokens.tertiary,
    marginTop: spacing.md,
  },
  signOutRow: {
    flexDirection: "row",
    marginTop: spacing.lg,
  },
  signOutCaption: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: typography.caption.fontWeight,
    color: textTokens.tertiary,
    marginTop: spacing.xs,
  },
  styleguideRow: {
    flexDirection: "row",
    marginTop: spacing.sm,
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
  devBtnRow: {
    flexDirection: "row",
    marginTop: spacing.sm,
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
  brandSub: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
    marginTop: 2,
  },
});
