/**
 * Account tab — placeholder for Cycle 0a. Cycle 14 lands settings,
 * billing, brand management. For now, ports the sign-out flow from
 * the legacy `app/home.tsx` so users can verify the auth round-trip.
 *
 * Sign-out routes back to the welcome screen via the auth-gate at
 * `app/index.tsx` (the (tabs) group only mounts when authenticated).
 */

import React, { useCallback } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "../../src/components/ui/Button";
import { GlassCard } from "../../src/components/ui/GlassCard";
import { TopBar } from "../../src/components/ui/TopBar";
import {
  spacing,
  text as textTokens,
  typography,
} from "../../src/constants/designSystem";
import { useAuth } from "../../src/context/AuthContext";

export default function AccountTab(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, signOut } = useAuth();

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

  const emailLabel =
    user?.email ??
    (typeof user?.user_metadata?.email === "string"
      ? user.user_metadata.email
      : "creator");

  return (
    <View style={[styles.host, { paddingTop: insets.top }]}>
      <View style={styles.barWrap}>
        <TopBar leftKind="brand" />
      </View>
      <ScrollView contentContainerStyle={styles.scroll}>
        <GlassCard variant="elevated" padding={spacing.lg}>
          <Text style={styles.title}>Account</Text>
          <Text style={styles.body}>
            Cycle 14 lands settings here.
          </Text>
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
      </ScrollView>
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
});
