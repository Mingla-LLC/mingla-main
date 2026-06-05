/**
 * Ve1 wizard — Step 1: Address (Mapbox proxy, ORCH-1079).
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { parseVenuePlaceResult } from "../../utils/parseVenuePlaceResult";
import { useDraftVenueStore } from "../../store/draftVenueStore";
import { MapboxAddressInput } from "../location/MapboxAddressInput";
import type { PlaceDetails } from "../../services/mapboxGeocodeService";

export interface VenueStep1AddressProps {
  showErrors: boolean;
}

export const VenueStep1Address: React.FC<VenueStep1AddressProps> = ({
  showErrors,
}) => {
  const formattedAddress = useDraftVenueStore((s) => s.formattedAddress);
  const patch = useDraftVenueStore((s) => s.patch);

  const error =
    showErrors &&
    formattedAddress.trim().length === 0
      ? "Address is required."
      : undefined;

  return (
    <View style={styles.host}>
      <Text style={styles.title}>Where is your venue?</Text>
      <Text style={styles.helper}>
        Start typing and choose a result when you see one.
      </Text>
      <MapboxAddressInput
        value={formattedAddress}
        onChangeText={(t) => patch({ formattedAddress: t })}
        onPick={(details: PlaceDetails): void => {
          const p = parseVenuePlaceResult(details);
          // ORCH-1079 LOCKED dedup guard (§3.C): patch ONLY the address/geo —
          // NEVER `googlePlaceId`. On the CLAIM path the pool-derived Google id
          // (set by prefillDraftFromPoolMatch) MUST survive a Step-1 address
          // re-pick so `biz_create_venue_brand_authoring` doesn't throw
          // `place_pool_google_place_id_mismatch`. On the CREATE-NEW path the
          // store's default `googlePlaceId: null` is preserved → no mapbox_id
          // (`p.placeId`) ever reaches `brands.google_place_id`.
          patch({
            formattedAddress: p.formattedAddress,
            lat: p.lat,
            lng: p.lng,
            city: p.city,
            countryCode: p.countryCode,
          });
        }}
        onClear={(): void => {
          // ORCH-1079 LOCKED (§3.C): clearing the field MUST NOT null
          // `googlePlaceId` — that would wipe the pool-derived dedup key on the
          // claim path. Only address/geo reset.
          patch({
            formattedAddress: "",
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
