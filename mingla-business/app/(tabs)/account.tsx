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

import React, { useCallback, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BrandSwitcherSheet } from "../../src/components/brand/BrandSwitcherSheet";
import { Button } from "../../src/components/ui/Button";
import { GlassCard } from "../../src/components/ui/GlassCard";
import { Toast } from "../../src/components/ui/Toast";
import { TopBar } from "../../src/components/ui/TopBar";
import {
  spacing,
  text as textTokens,
  typography,
} from "../../src/constants/designSystem";
import { useAuth } from "../../src/context/AuthContext";
import { STUB_BRANDS, STUB_DEFAULT_BRAND_ID } from "../../src/store/brandList";
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
  const { user, signOut } = useAuth();
  const brands = useBrandList();
  const setBrands = useCurrentBrandStore((s) => s.setBrands);
  const setCurrentBrand = useCurrentBrandStore((s) => s.setCurrentBrand);
  const reset = useCurrentBrandStore((s) => s.reset);

  const [sheetVisible, setSheetVisible] = useState<boolean>(false);
  const [toast, setToast] = useState<ToastState>({ visible: false, message: "" });

  const handleSignOut = useCallback(async (): Promise<void> => {
    try {
      await signOut();
    } catch (error) {
      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.error("[AccountTab] signOut threw:", error);
      }
    }
  }, [signOut]);

  const handleOpenStyleguide = useCallback((): void => {
    router.push("/__styleguide" as never);
  }, [router]);

  const handleOpenSwitcher = useCallback((): void => {
    setSheetVisible(true);
  }, []);

  const handleCloseSheet = useCallback((): void => {
    setSheetVisible(false);
  }, []);

  const handleBrandCreated = useCallback((brand: Brand): void => {
    setToast({ visible: true, message: `${brand.displayName} is ready` });
  }, []);

  const handleDismissToast = useCallback((): void => {
    setToast((prev) => ({ ...prev, visible: false }));
  }, []);

  // [TRANSITIONAL] dev seed buttons — removed in B1 backend cycle when real
  // brand CRUD endpoints land. Existence gated by __DEV__ so production
  // builds never see these.
  const handleSeedStubs = useCallback((): void => {
    setBrands([...STUB_BRANDS]);
    const defaultBrand =
      STUB_BRANDS.find((b) => b.id === STUB_DEFAULT_BRAND_ID) ?? STUB_BRANDS[0] ?? null;
    setCurrentBrand(defaultBrand);
    setToast({ visible: true, message: "Seeded 4 stub brands" });
  }, [setBrands, setCurrentBrand]);

  const handleWipeBrands = useCallback((): void => {
    reset();
    setToast({ visible: true, message: "Brands wiped" });
  }, [reset]);

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
          <Text style={styles.body}>Cycle 14 lands settings here.</Text>
          <Text style={styles.email} numberOfLines={1}>
            Signed in as {emailLabel}
          </Text>
          <View style={styles.signOutRow}>
            <Button
              label="Sign out"
              onPress={handleSignOut}
              variant="secondary"
              size="md"
            />
          </View>
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

        {__DEV__ ? (
          <GlassCard variant="elevated" padding={spacing.lg}>
            <Text style={styles.title}>Dev tools</Text>
            <Text style={styles.body}>
              [TRANSITIONAL] Seed and wipe stub brands for testing Cycle 1
              flows. {brands.length} brand(s) currently in the store.
            </Text>
            <View style={styles.devBtnRow}>
              <Button
                label="Seed 4 stub brands"
                onPress={handleSeedStubs}
                variant="secondary"
                size="md"
                leadingIcon="plus"
              />
            </View>
            <View style={styles.devBtnRow}>
              <Button
                label="Wipe brands"
                onPress={handleWipeBrands}
                variant="ghost"
                size="md"
              />
            </View>
          </GlassCard>
        ) : null}
      </ScrollView>

      <BrandSwitcherSheet
        visible={sheetVisible}
        onClose={handleCloseSheet}
        onBrandCreated={handleBrandCreated}
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
  styleguideRow: {
    flexDirection: "row",
    marginTop: spacing.sm,
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
});
