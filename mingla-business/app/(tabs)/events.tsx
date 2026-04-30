/**
 * Events tab — placeholder for Cycle 0a. Cycle 9 lands the events list
 * + creation flow + Manage menu per BUSINESS_PRD §5.0.
 *
 * Cycle 2 J-A8 polish: brand-chip wired to BrandSwitcherSheet (matches
 * home.tsx + account.tsx pattern). Was previously firing the Cycle 0a
 * Toast fallback because `onBrandTap` was never passed.
 */

import React, { useCallback, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BrandSwitcherSheet } from "../../src/components/brand/BrandSwitcherSheet";
import { GlassCard } from "../../src/components/ui/GlassCard";
import { Toast } from "../../src/components/ui/Toast";
import { TopBar } from "../../src/components/ui/TopBar";
import {
  spacing,
  text as textTokens,
  typography,
} from "../../src/constants/designSystem";
import type { Brand } from "../../src/store/currentBrandStore";

interface ToastState {
  visible: boolean;
  message: string;
}

export default function EventsTab(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const [sheetVisible, setSheetVisible] = useState<boolean>(false);
  const [toast, setToast] = useState<ToastState>({ visible: false, message: "" });

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

  return (
    <View style={[styles.host, { paddingTop: insets.top }]}>
      <View style={styles.barWrap}>
        <TopBar leftKind="brand" onBrandTap={handleOpenSwitcher} />
      </View>
      <ScrollView contentContainerStyle={styles.scroll}>
        <GlassCard variant="elevated" padding={spacing.lg}>
          <Text style={styles.title}>Events</Text>
          <Text style={styles.body}>Cycle 9 lands content here.</Text>
        </GlassCard>
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
  toastWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: spacing.xl,
    paddingHorizontal: spacing.md,
  },
});
