/**
 * Ve1 wizard — Step 1: Address (Google Places proxy).
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { parseGooglePlaceResult } from "../../utils/parseGooglePlaceResult";
import { useDraftVenueStore } from "../../store/draftVenueStore";
import { AddressAutocompleteInput } from "../event/AddressAutocompleteInput";
import type { PlaceDetails } from "../../services/googlePlacesService";

export interface VenueStep1AddressProps {
  showErrors: boolean;
}

export const VenueStep1Address: React.FC<VenueStep1AddressProps> = ({
  showErrors,
}) => {
  const formattedAddress = useDraftVenueStore((s) => s.formattedAddress);
  const googlePlaceId = useDraftVenueStore((s) => s.googlePlaceId);
  const patch = useDraftVenueStore((s) => s.patch);

  const error =
    showErrors &&
    (googlePlaceId === null || googlePlaceId.trim() === "")
      ? "Pick your venue address from the suggestions."
      : undefined;

  return (
    <View style={styles.host}>
      <Text style={styles.title}>Where is your venue?</Text>
      <Text style={styles.helper}>
        Start typing — choose a result so we can verify the location.
      </Text>
      <AddressAutocompleteInput
        value={formattedAddress}
        onChangeText={(t) => patch({ formattedAddress: t })}
        onPick={(details: PlaceDetails): void => {
          const p = parseGooglePlaceResult(details);
          patch({
            formattedAddress: p.formattedAddress,
            googlePlaceId: p.googlePlaceId,
            lat: p.lat,
            lng: p.lng,
            city: p.city,
            countryCode: p.countryCode,
          });
        }}
        onClear={(): void => {
          patch({
            formattedAddress: "",
            googlePlaceId: null,
            lat: null,
            lng: null,
            city: null,
            countryCode: null,
          });
        }}
        error={error}
        placeholder="Search address"
      />
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  title: {
    fontSize: typography.h3.fontSize,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
  },
  helper: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.secondary,
    marginBottom: spacing.xs,
  },
});

export default VenueStep1Address;
