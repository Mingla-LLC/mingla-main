/**
 * Ve1 wizard — Step 1: Address (Mapbox proxy, ORCH-1079).
 *
 * Issue #1363 — suggestion or raw free text becomes a selected address while a
 * safe approximate coordinate is resolved automatically.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { spacing, text as textTokens, typography } from "../../constants/designSystem";
import { parseVenuePlaceResult } from "../../utils/parseVenuePlaceResult";
import {
  isFreeTextResolveStale,
  resolveFreeTextLocation,
} from "../../utils/resolveApproxLocation";
import { useDraftVenueStore } from "../../store/draftVenueStore";
import { MapboxAddressInput } from "../location/MapboxAddressInput";
import type { PlaceDetails } from "../../services/mapboxGeocodeService";
import type { LocationSelectionState } from "@mingla/location-input";

export interface VenueStep1AddressProps {
  showErrors: boolean;
}

export const VenueStep1Address: React.FC<VenueStep1AddressProps> = ({
  showErrors,
}) => {
  const formattedAddress = useDraftVenueStore((s) => s.formattedAddress);
  const lat = useDraftVenueStore((s) => s.lat);
  const lng = useDraftVenueStore((s) => s.lng);
  const city = useDraftVenueStore((s) => s.city);
  const countryCode = useDraftVenueStore((s) => s.countryCode);
  const patch = useDraftVenueStore((s) => s.patch);

  const [selectionState, setSelectionState] =
    React.useState<LocationSelectionState>(
      formattedAddress.trim() && lat !== null && lng !== null
        ? "selected"
        : "editing",
    );
  // Issue #1363 P3-2 — latest-wins guard: tracks the address text currently
  // committed to the field so a slow, superseded free-text forward-geocode can
  // never patch a stale coordinate after the brand re-typed / picked / cleared.
  const committedAddrRef = React.useRef(formattedAddress);
  const savedContextRef = React.useRef({ city, countryCode });

  const resolveCommittedText = React.useCallback(
    (rawLabel: string): void => {
      setSelectionState("resolving");
      committedAddrRef.current = rawLabel;
      patch({
        formattedAddress: rawLabel,
        lat: null,
        lng: null,
        city: null,
        countryCode: null,
        coordinatePrecision: null,
      });
      void (async () => {
        try {
          const resolution = await resolveFreeTextLocation(
            rawLabel,
            savedContextRef.current,
          );
          if (isFreeTextResolveStale(rawLabel, committedAddrRef.current)) return;
          if (resolution.status === "needs_context") {
            setSelectionState("needs_context");
            return;
          }
          const approx = resolution.location;
          patch({
            lat: approx.lat,
            lng: approx.lng,
            city: approx.city,
            countryCode: approx.countryCode,
            coordinatePrecision: "approximate",
          });
          savedContextRef.current = {
            city: approx.city,
            countryCode: approx.countryCode,
          };
          setSelectionState("selected");
        } catch {
          if (!isFreeTextResolveStale(rawLabel, committedAddrRef.current)) {
            setSelectionState("error");
          }
        }
      })();
    },
    [patch],
  );

  const error =
    showErrors &&
    formattedAddress.trim().length === 0
      ? "Address is required."
      : undefined;

  return (
    <View style={styles.host}>
      <Text style={styles.title}>Where is your venue?</Text>
      <Text style={styles.helper}>
        Start typing and choose a result, or use what you typed.
      </Text>
      <MapboxAddressInput
        value={formattedAddress}
        allowFreeText
        selectionState={selectionState}
        selectedLabel={formattedAddress}
        onChangeText={(t) => {
          // ORCH-1079 LOCKED dedup guard: null the address/geo but NEVER
          // `googlePlaceId`. Issue #1363 adds coordinatePrecision to the reset.
          committedAddrRef.current = t;
          patch({ formattedAddress: t, lat: null, lng: null, city: null, countryCode: null, coordinatePrecision: null });
        }}
        onFreeText={resolveCommittedText}
        onPick={(details: PlaceDetails, selectedLabel?: string): void => {
          const p = parseVenuePlaceResult(details);
          const label = selectedLabel ?? p.formattedAddress;
          committedAddrRef.current = label;
          // ORCH-1079 LOCKED dedup guard (§3.C): patch ONLY the address/geo —
          // NEVER `googlePlaceId`. On the CLAIM path the pool-derived Google id
          // (set by prefillDraftFromPoolMatch) MUST survive a Step-1 address
          // re-pick so `biz_create_venue_brand_authoring` doesn't throw
          // `place_pool_google_place_id_mismatch`. On the CREATE-NEW path the
          // store's default `googlePlaceId: null` is preserved → no mapbox_id
          // (`p.placeId`) ever reaches `brands.google_place_id`.
          patch({
            formattedAddress: label,
            lat: p.lat,
            lng: p.lng,
            city: p.city,
            countryCode: p.countryCode,
            coordinatePrecision: "approximate",
          });
          savedContextRef.current = {
            city: p.city,
            countryCode: p.countryCode,
          };
          setSelectionState("selected");
        }}
        onChangeSelected={() => {
          committedAddrRef.current = formattedAddress;
          setSelectionState("editing");
          patch({
            lat: null,
            lng: null,
            city: null,
            countryCode: null,
            coordinatePrecision: null,
          });
        }}
        onClear={(): void => {
          // ORCH-1079 LOCKED (§3.C): clearing the field MUST NOT null
          // `googlePlaceId` — that would wipe the pool-derived dedup key on the
          // claim path. Only address/geo reset.
          committedAddrRef.current = "";
          setSelectionState("editing");
          patch({
            formattedAddress: "",
            lat: null,
            lng: null,
            city: null,
            countryCode: null,
            coordinatePrecision: null,
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
