import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  color,
  radius,
  space,
} from "../../constants/designSystem";
import type {
  VenueAccessGrant,
  VenueAccessProfile,
  VenueCapability,
} from "../../services/brandInvitationsService";
import type { VenueListing } from "../../services/venueListingsService";
import { Icon } from "../ui/Icon";
import {
  capabilityOptionsFor,
  isVenueAccessAssignable,
  profileOptionsFor,
  TILL_DEVICE_EXPLAINER,
  VENUE_ACCESS_PROFILES,
} from "./venueAccessOptions";

export {
  isVenueAccessAssignable,
  VENUE_ACCESS_PROFILES,
} from "./venueAccessOptions";

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
        const applicable = capabilityOptionsFor(venue.venueCategory);
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
                color={grant ? color.text1 : color.text3}
              />
            </Pressable>
            {grant ? (
              <View style={styles.grantBody}>
                <View style={styles.profileRow}>
                  {profileOptionsFor(venue.venueCategory).map((option) => (
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
                {grant.profile === "till_device" ? (
                  // #4490 spec 08 O5 (§2 screen 14): what a Till device login is.
                  <Text style={styles.helper} testID="venue-access-till-device-explainer">
                    {TILL_DEVICE_EXPLAINER}
                  </Text>
                ) : null}
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
                        color={checked ? color.text1 : color.text4}
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
  host: { marginBottom: space[4] },
  heading: { fontSize: 15, fontWeight: "700", color: color.text1 },
  helper: { fontSize: 13, lineHeight: 18, color: color.text2, marginTop: 3, marginBottom: space[2] },
  empty: { padding: space[4], borderRadius: radius.sm, backgroundColor: color.fill.inset },
  emptyText: { fontSize: 13, color: color.text2 },
  card: { borderWidth: 1, borderColor: color.line, borderRadius: radius.md, marginBottom: space[2], overflow: "hidden", backgroundColor: color.fill.inset },
  cardSelected: { borderColor: color.paper },
  venueHeader: { minHeight: 58, paddingHorizontal: space[4], paddingVertical: space[2], flexDirection: "row", alignItems: "center", gap: space[2] },
  venueText: { flex: 1, minWidth: 0 },
  venueName: { fontSize: 15, fontWeight: "700", color: color.text1 },
  venueCategory: { fontSize: 12, color: color.text3, marginTop: 2 },
  grantBody: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line, padding: space[4], gap: space[1] },
  profileRow: { flexDirection: "row", flexWrap: "wrap", gap: space[1], marginBottom: space[2] },
  profileChip: { borderWidth: 1, borderColor: color.line, borderRadius: radius.full, paddingHorizontal: space[2], paddingVertical: 7 },
  profileChipSelected: { borderColor: color.paper, backgroundColor: color.fill.tabOn },
  profileText: { fontSize: 12, color: color.text2, fontWeight: "600" },
  profileTextSelected: { color: color.text1 },
  capabilityRow: { minHeight: 42, flexDirection: "row", alignItems: "center", gap: space[2] },
  capabilityText: { flex: 1, fontSize: 13, color: color.text1 },
});
