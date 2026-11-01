/**
 * BrandEditAddressField — #3355 P5 (C3) structured address search on Brand Edit.
 *
 * Brand Edit used to take the address as free text with no city or country, so
 * moving the address there left the brand's city/country (and every readiness
 * check built on them) stale with no form to fix it. This reuses the SAME
 * search the brand-creation flow uses — the Host `MapboxAddressInput` wrapper
 * over `@mingla/location-input`, `parseVenuePlaceResult` for a picked place,
 * and `resolveFreeTextLocation` for "use what you typed" — and writes the
 * address, city, country, latitude and longitude together. Like creation
 * (ORCH-1079), a Mapbox id is never written into `google_place_id`.
 *
 * Typing without picking keeps the old city/country (the hint says so); a
 * pick or a placed free-text address replaces them.
 *
 * #3355 — behaves like every other Host address field: the SAME map preview
 * the event "Where" step shows (`AddressMapPreview`, the brand's saved or
 * newly picked point), and ranking falls back to the brand's country when it
 * has no saved point (shared `proximitySources`, rank-only).
 */
import React, { useCallback, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { LocationSelectionState } from "@mingla/location-input";

import {
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import type { PlaceDetails } from "../../services/mapboxGeocodeService";
import {
  brandAddressPatchFromLocation,
  brandAddressPatchFromPlace,
  brandCityCountryLine,
  type BrandAddressPatch,
} from "../../utils/brandAddressPatch";
import {
  advanceLocationRequestGeneration,
  isFreeTextResolveStale,
  isLocationRequestGenerationCurrent,
  resolveFreeTextLocation,
} from "../../utils/resolveApproxLocation";
import { AddressMapPreview } from "../location/AddressMapPreview";
import { MapboxAddressInput } from "../location/MapboxAddressInput";

export interface BrandEditAddressFieldProps {
  address: string | null | undefined;
  city: string | undefined;
  countryCode: string | undefined;
  lat: number | undefined;
  lng: number | undefined;
  onChange: (patch: BrandAddressPatch) => void;
  testID?: string;
}

export const BrandEditAddressField: React.FC<BrandEditAddressFieldProps> = ({
  address,
  city,
  countryCode,
  lat,
  lng,
  onChange,
  testID,
}) => {
  const text = address ?? "";
  const [selectionState, setSelectionState] = useState<LocationSelectionState>(
    text.trim().length > 0 ? "selected" : "editing",
  );
  // Issue #1363 — latest-wins guard, exactly as brand creation uses it.
  const committedRef = useRef(text);
  const generationRef = useRef(0);
  // Issue #1363 parity — a point placed from free text is approximate, so the
  // preview zooms out and says so. A saved or picked point renders precise.
  const [approximate, setApproximate] = useState(false);

  const handleFreeText = useCallback(
    (rawLabel: string): void => {
      const generation = advanceLocationRequestGeneration(generationRef);
      committedRef.current = rawLabel;
      onChange({ address: rawLabel.length === 0 ? null : rawLabel });
      setSelectionState("resolving");
      void (async () => {
        try {
          const resolution = await resolveFreeTextLocation(rawLabel, {
            city: city ?? null,
            countryCode: countryCode ?? null,
          });
          if (
            !isLocationRequestGenerationCurrent(generationRef, generation) ||
            isFreeTextResolveStale(rawLabel, committedRef.current)
          ) {
            return;
          }
          if (resolution.status === "needs_context") {
            setSelectionState("needs_context");
            return;
          }
          onChange(brandAddressPatchFromLocation(rawLabel, resolution.location));
          setApproximate(true);
          setSelectionState("selected");
        } catch (error) {
          if (
            isLocationRequestGenerationCurrent(generationRef, generation) &&
            !isFreeTextResolveStale(rawLabel, committedRef.current)
          ) {
            console.warn("[BrandEditAddressField] could not place address:", error);
            setSelectionState("error");
          }
        }
      })();
    },
    [city, countryCode, onChange],
  );

  return (
    <View testID={testID}>
      <MapboxAddressInput
        value={text}
        allowFreeText
        selectionState={selectionState}
        selectedLabel={text.length > 0 ? text : null}
        accessibilityLabel="Address (optional)"
        placeholder="Search for your address"
        // Issue #3291 — rank-only: the brand's saved point first; #3355 —
        // with no point, the brand's country ranks (shared resolver).
        proximitySources={{
          brandPoint: { lat, lng, countryCode },
          draftPoint: null,
        }}
        onChangeText={(next) => {
          advanceLocationRequestGeneration(generationRef);
          committedRef.current = next;
          setSelectionState("editing");
          onChange({ address: next.length === 0 ? null : next });
        }}
        onFreeText={handleFreeText}
        onPick={(details: PlaceDetails, selectedLabel?: string): void => {
          advanceLocationRequestGeneration(generationRef);
          // Like every Host address field: the picker's label first, the
          // retrieved address second (#3291).
          const label = selectedLabel ?? details.formattedAddress;
          const patch = brandAddressPatchFromPlace(details, label);
          committedRef.current = patch.address ?? "";
          onChange(patch);
          setApproximate(false);
          setSelectionState("selected");
        }}
        onChangeSelected={() => {
          advanceLocationRequestGeneration(generationRef);
          committedRef.current = text;
          setSelectionState("editing");
        }}
        onClear={(): void => {
          advanceLocationRequestGeneration(generationRef);
          committedRef.current = "";
          setSelectionState("editing");
          onChange({ address: null });
        }}
      />
      <Text
        style={styles.cityCountry}
        testID={testID !== undefined ? `${testID}-city-country` : undefined}
      >
        {brandCityCountryLine(city, countryCode)}
      </Text>
      <View style={styles.mapGap}>
        {/* A cleared address shows the empty state, never the old pin. */}
        <AddressMapPreview
          lat={text.length > 0 ? lat : null}
          lng={text.length > 0 ? lng : null}
          approximate={approximate}
          accessibilityLabel={`Map of ${text.length > 0 ? text : "your address"}`}
          testID={testID !== undefined ? `${testID}-map` : undefined}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  mapGap: {
    marginTop: spacing.sm,
  },
  cityCountry: {
    marginTop: spacing.xs,
    fontSize: typography.caption.fontSize,
    color: textTokens.secondary,
  },
});

export default BrandEditAddressField;
