import React, { useMemo } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  accent,
  glass,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { useVenueListings } from "../../hooks/useVenueListings";
import type { Brand } from "../../store/currentBrandStore";
import { BrandSwitcherSheet } from "../brand/BrandSwitcherSheet";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { TopBar } from "../ui/TopBar";
import { Toast } from "../ui/Toast";

export function VenueStaffHomeBoundary({
  mode,
  brandId,
  brandName,
  onBrandTap,
  onRoleRetry,
  switcherVisible,
  onSwitcherClose,
  onBrandCreated,
  onDefaultBrandSaveError,
  onRequestDeleteBrand,
  toastVisible,
  toastMessage,
  onToastDismiss,
}: {
  mode: "resolving" | "denied" | "staff";
  brandId: string;
  brandName: string;
  onBrandTap: () => void;
  onRoleRetry: () => void;
  switcherVisible: boolean;
  onSwitcherClose: () => void;
  onBrandCreated: (brand: Brand) => void;
  onDefaultBrandSaveError: (message: string) => void;
  onRequestDeleteBrand: (brand: Brand) => void;
  toastVisible: boolean;
  toastMessage: string;
  onToastDismiss: () => void;
}): React.ReactElement {
  const insets = useSafeAreaInsets();
  const content = mode === "staff" ? (
    <VenueStaffHome
      brandId={brandId}
      brandName={brandName}
      onBrandTap={onBrandTap}
    />
  ) : (
    <View style={[styles.host, { paddingTop: insets.top }]}>
      <View style={styles.topBarWrap}>
        <TopBar
          leftKind="brand"
          onBrandTap={onBrandTap}
          brandLoading={mode === "resolving"}
        />
      </View>
      <View style={styles.roleGate} testID="home-role-gate">
        {mode === "resolving" ? <ActivityIndicator color={accent.warm} /> : null}
        <Text style={styles.roleGateTitle}>
          {mode === "resolving" ? "Checking your access…" : "Brand access unavailable"}
        </Text>
        <Text style={styles.roleGateBody}>
          {mode === "resolving"
            ? "Mingla is loading your exact role and venue permissions."
            : "Your access may have changed. Retry or switch to another brand."}
        </Text>
        {mode === "denied" ? (
          <View style={styles.roleGateActions}>
            <Button label="Try again" onPress={onRoleRetry} variant="secondary" size="md" />
            <Button label="Switch brand" onPress={onBrandTap} variant="ghost" size="md" />
          </View>
        ) : null}
      </View>
    </View>
  );

  return (
    <>
      {content}
      <BrandSwitcherSheet
        visible={switcherVisible}
        onClose={onSwitcherClose}
        onBrandCreated={onBrandCreated}
        onDefaultBrandSaveError={onDefaultBrandSaveError}
        onRequestDeleteBrand={onRequestDeleteBrand}
      />
      <View style={styles.toastWrap} pointerEvents="box-none">
        <Toast
          visible={toastVisible}
          kind="info"
          message={toastMessage}
          onDismiss={onToastDismiss}
        />
      </View>
    </>
  );
}

export function VenueStaffHome({
  brandId,
  brandName,
  onBrandTap,
}: {
  brandId: string;
  brandName: string;
  onBrandTap: () => void;
}): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const venuesQuery = useVenueListings(brandId);
  const venues = useMemo(
    () => (venuesQuery.data ?? []).filter(
      (venue) => venue.venueCategory === "stay" || venue.venueCategory === "restaurant",
    ),
    [venuesQuery.data],
  );

  return (
    <View style={[styles.host, { paddingTop: insets.top }]} testID="venue-staff-home">
      <View style={styles.topBarWrap}>
        <TopBar
          leftKind="brand"
          onBrandTap={onBrandTap}
        />
      </View>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: spacing.xxl * 3 + insets.bottom },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.intro}>
          <Text style={styles.eyebrow}>VENUE OPERATIONS</Text>
          <Text style={styles.title}>{brandName}</Text>
          <Text style={styles.helper}>
            Open an assigned venue to see only the reservations, availability,
            dining, or ordering pages your manager approved.
          </Text>
        </View>

        {venuesQuery.isLoading ? (
          <View style={styles.state} accessibilityRole="progressbar">
            <ActivityIndicator color={accent.warm} />
            <Text style={styles.helper}>Loading assigned venues…</Text>
          </View>
        ) : venuesQuery.isError ? (
          <View style={styles.state} accessibilityLiveRegion="polite">
            <Text style={styles.stateTitle}>Assigned venues could not load</Text>
            <Text style={styles.helper}>Nothing changed. Check your connection and try again.</Text>
            <Button
              label="Try again"
              onPress={() => void venuesQuery.refetch()}
              variant="secondary"
              size="md"
            />
          </View>
        ) : venues.length === 0 ? (
          <View style={styles.state} testID="venue-staff-empty">
            <Icon name="shield" size={24} color={textTokens.tertiary} />
            <Text style={styles.stateTitle}>No venue access yet</Text>
            <Text style={styles.helper}>
              Ask a brand owner or admin to assign a Stay or restaurant to you.
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            <Text style={styles.sectionTitle}>YOUR VENUES</Text>
            {venues.map((venue) => (
              <Pressable
                key={venue.id}
                onPress={() => router.push(`/venue/${venue.id}` as never)}
                accessibilityRole="button"
                accessibilityLabel={`Open ${venue.name}`}
                style={({ pressed }) => [
                  styles.card,
                  pressed && styles.cardPressed,
                ]}
                testID={`venue-staff-open-${venue.id}`}
              >
                <View style={styles.cardIcon}>
                  <Icon
                    name={venue.venueCategory === "stay" ? "home" : "notebook"}
                    size={20}
                    color={accent.warm}
                  />
                </View>
                <View style={styles.cardCopy}>
                  <Text style={styles.cardTitle}>{venue.name}</Text>
                  <Text style={styles.cardMeta}>
                    {venue.venueCategory === "stay" ? "Stay" : "Restaurant"}
                    {venue.city ? ` · ${venue.city}` : ""}
                  </Text>
                </View>
                <Icon name="chevR" size={18} color={textTokens.tertiary} />
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  host: { flex: 1 },
  topBarWrap: { paddingHorizontal: spacing.md },
  content: { padding: spacing.md, gap: spacing.xl },
  intro: { gap: spacing.xs },
  eyebrow: { fontSize: 11, letterSpacing: 1.2, fontWeight: "800", color: accent.warm },
  title: { ...typography.h1, color: textTokens.primary },
  helper: { ...typography.bodySm, color: textTokens.secondary, lineHeight: 20 },
  sectionTitle: { fontSize: 11, letterSpacing: 1, fontWeight: "800", color: textTokens.tertiary },
  list: { gap: spacing.sm },
  card: { minHeight: 76, padding: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderColor: glass.border.profileBase, borderRadius: radius.lg, backgroundColor: glass.tint.profileBase, flexDirection: "row", alignItems: "center", gap: spacing.md },
  cardPressed: { opacity: 0.76 },
  cardIcon: { width: 40, height: 40, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(235, 120, 37, 0.12)" },
  cardCopy: { flex: 1, minWidth: 0 },
  cardTitle: { ...typography.body, color: textTokens.primary, fontWeight: "700" },
  cardMeta: { ...typography.bodySm, color: textTokens.secondary, marginTop: 3 },
  state: { padding: spacing.xl, borderWidth: StyleSheet.hairlineWidth, borderColor: glass.border.profileBase, borderRadius: radius.lg, backgroundColor: glass.tint.profileBase, alignItems: "center", gap: spacing.sm },
  stateTitle: { ...typography.h3, color: textTokens.primary, textAlign: "center" },
  roleGate: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.sm },
  roleGateTitle: { ...typography.h2, color: textTokens.primary, textAlign: "center" },
  roleGateBody: { ...typography.bodySm, color: textTokens.secondary, textAlign: "center", maxWidth: 420 },
  roleGateActions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: spacing.sm },
  toastWrap: { ...StyleSheet.absoluteFillObject, justifyContent: "flex-end", alignItems: "center", padding: spacing.md },
});
