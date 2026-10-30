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
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { TopBar } from "../ui/TopBar";

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
});
