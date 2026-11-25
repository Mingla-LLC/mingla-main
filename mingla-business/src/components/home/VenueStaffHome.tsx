import React, { Suspense, useMemo } from "react";
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
  radius,
  color,
  space,
  type,
} from "../../constants/designSystem";
import { useVenueListings } from "../../hooks/useVenueListings";
import {
  listVenueStaffVenues,
  venueStaffCardIcon,
  venueStaffCardType,
} from "./venueStaffHomeModel";
import type { Brand } from "../../store/currentBrandStore";

import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { TopBar } from "../ui/TopBar";
import { Toast } from "../ui/Toast";

// #3355 — the switcher loads when the member opens it, as on Home (#3493).
const LazyBrandSwitcherSheet = React.lazy(async () => {
  const mod = await import("../brand/BrandSwitcherSheet");
  return { default: mod.BrandSwitcherSheet };
});

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
        {mode === "resolving" ? <ActivityIndicator color={color.text2} /> : null}
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
      {switcherVisible ? (
        <Suspense fallback={null}>
          <LazyBrandSwitcherSheet
            visible
            onClose={onSwitcherClose}
            onBrandCreated={onBrandCreated}
            onDefaultBrandSaveError={onDefaultBrandSaveError}
            onRequestDeleteBrand={onRequestDeleteBrand}
          />
        </Suspense>
      ) : null}
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
  // #4490 (08-O3 fix 2): every venue the member holds a grant at, any type.
  const venues = useMemo(
    () => listVenueStaffVenues(venuesQuery.data),
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
          { paddingBottom: space[9] * 3 + insets.bottom },
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
            <ActivityIndicator color={color.text2} />
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
            <Icon name="shield" size={24} color={color.text3} />
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
                    name={venueStaffCardIcon(venue)}
                    size={20}
                    color={color.text1}
                  />
                </View>
                <View style={styles.cardCopy}>
                  <Text style={styles.cardTitle}>{venue.name}</Text>
                  <Text style={styles.cardMeta}>
                    {venueStaffCardType(venue)}
                    {venue.city ? ` · ${venue.city}` : ""}
                  </Text>
                </View>
                <Icon name="chevR" size={18} color={color.text3} />
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
  topBarWrap: { paddingHorizontal: space[4] },
  content: { padding: space[4], gap: space[7] },
  intro: { gap: space[1] },
  eyebrow: { fontSize: 11, letterSpacing: 1.2, fontWeight: "800", color: color.text1 },
  title: { ...type.title, color: color.text1 },
  helper: { ...type.small, color: color.text2, lineHeight: 20 },
  sectionTitle: { fontSize: 11, letterSpacing: 1, fontWeight: "800", color: color.text3 },
  list: { gap: space[2] },
  card: { minHeight: 76, padding: space[4], borderWidth: StyleSheet.hairlineWidth, borderColor: color.line, borderRadius: radius.lg, backgroundColor: color.fill.inset, flexDirection: "row", alignItems: "center", gap: space[4] },
  cardPressed: { opacity: 0.76 },
  cardIcon: { width: 40, height: 40, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: color.fill.tabOn },
  cardCopy: { flex: 1, minWidth: 0 },
  cardTitle: { ...type.body, color: color.text1, fontWeight: "700" },
  cardMeta: { ...type.small, color: color.text2, marginTop: 3 },
  state: { padding: space[7], borderWidth: StyleSheet.hairlineWidth, borderColor: color.line, borderRadius: radius.lg, backgroundColor: color.fill.inset, alignItems: "center", gap: space[2] },
  stateTitle: { ...type.h1, color: color.text1, textAlign: "center" },
  roleGate: { flex: 1, alignItems: "center", justifyContent: "center", padding: space[7], gap: space[2] },
  roleGateTitle: { ...type.h1, color: color.text1, textAlign: "center" },
  roleGateBody: { ...type.small, color: color.text2, textAlign: "center", maxWidth: 420 },
  roleGateActions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: space[2] },
  toastWrap: { ...StyleSheet.absoluteFillObject, justifyContent: "flex-end", alignItems: "center", padding: space[4] },
});
