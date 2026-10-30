import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  accent,
  glass,
  radius,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";
import type {
  VenueAccessGrant,
  VenueAccessProfile,
  VenueCapability,
} from "../../services/brandInvitationsService";
import type { VenueListing } from "../../services/venueListingsService";
import { Icon } from "../ui/Icon";

type CapabilityOption = {
  capability: VenueCapability;
  label: string;
  categories: readonly string[];
};

export const VENUE_ACCESS_PROFILES: Record<
  Exclude<VenueAccessProfile, "custom">,
  readonly VenueCapability[]
> = {
  front_desk: [
    "stay.view_reservations",
    "stay.create_reservations",
    "stay.manage_reservations",
    "stay.view_availability",
  ],
  restaurant_manager: [
    "restaurant.view_orders",
    "restaurant.manage_orders",
    "restaurant.manage_menu",
    "restaurant.manage_qr",
    "restaurant.manage_reservations",
  ],
  kitchen_bar: ["restaurant.view_orders", "restaurant.manage_orders"],
};

const PROFILE_OPTIONS: readonly {
  id: VenueAccessProfile;
  label: string;
}[] = [
  { id: "front_desk", label: "Front desk" },
  { id: "restaurant_manager", label: "Restaurant manager" },
  { id: "kitchen_bar", label: "Kitchen / bar" },
  { id: "custom", label: "Custom" },
];

const CAPABILITY_OPTIONS: readonly CapabilityOption[] = [
  { capability: "stay.view_reservations", label: "View Stay reservations", categories: ["stay"] },
  { capability: "stay.create_reservations", label: "Create Stay reservations", categories: ["stay"] },
  { capability: "stay.manage_reservations", label: "Update or cancel Stay reservations", categories: ["stay"] },
  { capability: "stay.view_availability", label: "View Stay availability", categories: ["stay"] },
  { capability: "restaurant.view_orders", label: "View restaurant orders", categories: ["restaurant"] },
  { capability: "restaurant.manage_orders", label: "Manage restaurant orders", categories: ["restaurant"] },
  { capability: "restaurant.manage_menu", label: "Manage restaurant menu", categories: ["restaurant"] },
  { capability: "restaurant.manage_qr", label: "Manage QR ordering spots", categories: ["restaurant"] },
  { capability: "restaurant.manage_reservations", label: "Manage restaurant reservations", categories: ["restaurant"] },
];

export function isVenueAccessAssignable(venue: VenueListing): boolean {
  return venue.venueCategory === "stay" || venue.venueCategory === "restaurant";
}

function categoryLabel(category: string): string {
  return category.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export function VenueAccessEditor({
  venues,
  grants,
  onChange,
  disabled = false,
}: {
  venues: VenueListing[];
  grants: VenueAccessGrant[];
  onChange: (grants: VenueAccessGrant[]) => void;
  disabled?: boolean;
}): React.ReactElement {
  const assignableVenues = venues.filter(isVenueAccessAssignable);
  const update = (venue: VenueListing, profile: VenueAccessProfile): void => {
    const nextCapabilities = profile === "custom"
      ? grants.find((grant) => grant.venueId === venue.id)?.capabilities ?? []
      : [...VENUE_ACCESS_PROFILES[profile]];
    const next: VenueAccessGrant = {
      venueId: venue.id,
      profile,
      capabilities: nextCapabilities,
    };
    onChange([...grants.filter((grant) => grant.venueId !== venue.id), next]);
  };

  const toggleVenue = (venue: VenueListing): void => {
    const current = grants.find((grant) => grant.venueId === venue.id);
    if (current) {
      onChange(grants.filter((grant) => grant.venueId !== venue.id));
      return;
    }
    const defaultProfile: VenueAccessProfile = venue.venueCategory === "stay"
      ? "front_desk"
      : "restaurant_manager";
    update(venue, defaultProfile);
  };

  const toggleCapability = (
    venue: VenueListing,
    capability: VenueCapability,
  ): void => {
    const current = grants.find((grant) => grant.venueId === venue.id);
    if (!current) return;
    const capabilities = current.capabilities.includes(capability)
      ? current.capabilities.filter((item) => item !== capability)
      : [...current.capabilities, capability];
    onChange([
      ...grants.filter((grant) => grant.venueId !== venue.id),
      { ...current, profile: "custom", capabilities },
    ]);
  };

  if (assignableVenues.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>
          Create a venue before assigning venue-specific access.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.host} testID="venue-access-editor">
      <Text style={styles.heading}>Venue access</Text>
      <Text style={styles.helper}>
        This person will only see the selected venues and pages.
      </Text>
      {assignableVenues.map((venue) => {
        const grant = grants.find((item) => item.venueId === venue.id) ?? null;
        const applicable = CAPABILITY_OPTIONS.filter((option) =>
          option.categories.includes(venue.venueCategory),
        );
        return (
          <View key={venue.id} style={[styles.card, grant && styles.cardSelected]}>
            <Pressable
              onPress={() => toggleVenue(venue)}
              disabled={disabled}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: grant !== null }}
              accessibilityLabel={`Access to ${venue.name}`}
              style={styles.venueHeader}
              testID={`venue-access-${venue.id}`}
            >
              <View style={styles.venueText}>
                <Text style={styles.venueName}>{venue.name}</Text>
                <Text style={styles.venueCategory}>
                  {categoryLabel(venue.venueCategory)}
                </Text>
              </View>
              <Icon
                name={grant ? "check" : "plus"}
                size={18}
                color={grant ? accent.warm : textTokens.tertiary}
              />
            </Pressable>
            {grant ? (
              <View style={styles.grantBody}>
                <View style={styles.profileRow}>
                  {PROFILE_OPTIONS.filter((option) =>
                    option.id === "custom" ||
                    (venue.venueCategory === "stay"
                      ? option.id === "front_desk"
                      : option.id !== "front_desk"),
                  ).map((option) => (
                    <Pressable
                      key={option.id}
                      onPress={() => update(venue, option.id)}
                      disabled={disabled}
                      accessibilityRole="radio"
                      accessibilityLabel={option.label}
                      accessibilityState={{ selected: grant.profile === option.id }}
                      style={[
                        styles.profileChip,
                        grant.profile === option.id && styles.profileChipSelected,
                      ]}
                    >
                      <Text style={[
                        styles.profileText,
                        grant.profile === option.id && styles.profileTextSelected,
                      ]}>
                        {option.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                {applicable.map((option) => {
                  const checked = grant.capabilities.includes(option.capability);
                  return (
                    <Pressable
                      key={option.capability}
                      onPress={() => toggleCapability(venue, option.capability)}
                      disabled={disabled}
                      accessibilityRole="checkbox"
                      accessibilityLabel={option.label}
                      accessibilityState={{ checked }}
                      style={styles.capabilityRow}
                    >
                      <Icon
                        name={checked ? "check" : "plus"}
                        size={16}
                        color={checked ? accent.warm : textTokens.quaternary}
                      />
                      <Text style={styles.capabilityText}>{option.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  host: { marginBottom: spacing.md },
  heading: { fontSize: 15, fontWeight: "700", color: textTokens.primary },
  helper: { fontSize: 13, lineHeight: 18, color: textTokens.secondary, marginTop: 3, marginBottom: spacing.sm },
  empty: { padding: spacing.md, borderRadius: radius.md, backgroundColor: glass.tint.profileBase },
  emptyText: { fontSize: 13, color: textTokens.secondary },
  card: { borderWidth: 1, borderColor: glass.border.profileBase, borderRadius: radius.lg, marginBottom: spacing.sm, overflow: "hidden", backgroundColor: glass.tint.profileBase },
  cardSelected: { borderColor: accent.warm },
  venueHeader: { minHeight: 58, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  venueText: { flex: 1, minWidth: 0 },
  venueName: { fontSize: 15, fontWeight: "700", color: textTokens.primary },
  venueCategory: { fontSize: 12, color: textTokens.tertiary, marginTop: 2 },
  grantBody: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: glass.border.profileBase, padding: spacing.md, gap: spacing.xs },
  profileRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginBottom: spacing.sm },
  profileChip: { borderWidth: 1, borderColor: glass.border.profileBase, borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 7 },
  profileChipSelected: { borderColor: accent.warm, backgroundColor: "rgba(235, 120, 37, 0.12)" },
  profileText: { fontSize: 12, color: textTokens.secondary, fontWeight: "600" },
  profileTextSelected: { color: accent.warm },
  capabilityRow: { minHeight: 42, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  capabilityText: { flex: 1, fontSize: 13, color: textTokens.primary },
});
