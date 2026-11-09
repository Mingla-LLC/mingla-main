/**
 * #3355 P7 — the address picker on Ari's "Where is it?" event card.
 *
 * The owner types the venue name and picks the address from the SAME Host
 * address search the event wizard's Where step uses (`AddressInput`),
 * so the city and point are structured exactly as the Host publish check
 * needs. Nothing is sent until an address is picked from the suggestions;
 * typed text alone is never an answer. The pick travels to the server as a
 * bound flow answer (`values.place`), never as words in the owner's name.
 */

import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import type { AriFlowPlaceValue } from "../../services/agentChatService";
import type { AriFlowPlaceMode } from "./ariFlowCards";
import {
  AddressInput,
  type PlaceDetails,
} from "../location/AddressInput";
import { useCurrentBrand } from "../../hooks/useCurrentBrand";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";

export interface AriFlowPlaceCardProps {
  /** Offline, sending, or not the current card. */
  disabled: boolean;
  onSubmit: (place: AriFlowPlaceValue) => void;
  /**
   * #3355 P8 — "city": a trip's departure or destination. No venue name;
   * the picked place's own name stands in for it. Default "venue".
   */
  mode?: AriFlowPlaceMode;
}

/** The place a picked place describes, or null when it has no city. */
export function placeFromPick(
  details: PlaceDetails,
  venueName: string,
): AriFlowPlaceValue | null {
  const city = details.city?.trim();
  const address = details.formattedAddress?.trim();
  if (!city || !address) return null;
  return {
    venue_name: venueName.trim(),
    address,
    city,
    country_code: details.countryCode ?? null,
    lat: details.location.lat,
    lng: details.location.lng,
    feature_type: details.featureType ?? null,
    // #3355 P9 — the pick's own id (an experience stop needs it to publish).
    ...(details.placeId ? { place_id: details.placeId } : {}),
  };
}

export const AriFlowPlaceCard: React.FC<AriFlowPlaceCardProps> = ({
  disabled,
  onSubmit,
  mode = "venue",
}) => {
  const city = mode === "city";
  // #3355 P9 — "address" (an experience stop, a venue): no name box either;
  // the name has its own card.
  const noName = mode !== "venue";
  const [venueName, setVenueName] = useState("");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<PlaceDetails | null>(null);
  const brand = useCurrentBrand();
  const place = picked ? placeFromPick(picked, venueName) : null;
  const ready = place !== null && venueName.trim().length > 0;

  return (
    <View style={styles.card}>
      {noName ? null : (
        <Input
          value={venueName}
          onChangeText={setVenueName}
          placeholder="Venue name, e.g. Shoreditch Town Hall"
          accessibilityLabel="Venue name"
          disabled={disabled}
          testID="ari-flow-place-venue"
        />
      )}
      <AddressInput
        value={query}
        // Issue #3291 — rank-only: the brand's saved point first, else its
        // country (shared resolver), like every Host address field.
        proximitySources={{ brandPoint: brand ?? undefined, draftPoint: null }}
        onChangeText={(next) => {
          setQuery(next);
          setPicked(null);
        }}
        onPick={(details, selectedLabel) => {
          // Like every Host address field: the picker's label first, the
          // retrieved address second (#3291) — the tapped street is kept.
          const label = selectedLabel ?? details.formattedAddress;
          setPicked({ ...details, formattedAddress: label });
          setQuery(label);
          if (noName) {
            // The place the owner picked names itself ("Lagos").
            setVenueName(
              selectedLabel?.split(",")[0]?.trim() || details.city || "",
            );
          } else if (!venueName.trim() && details.featureType === "poi") {
            setVenueName(selectedLabel?.split(",")[0]?.trim() ?? "");
          }
        }}
        onClear={() => {
          setQuery("");
          setPicked(null);
        }}
        placeholder={city ? "Search for a city or address" : "Search the address"}
        accessibilityLabel={
          city ? "Trip place" : mode === "address" ? "Address" : "Venue address"
        }
      />
      <Text style={styles.note}>
        {city
          ? "Pick the place from the suggestions so travellers know where it is."
          : "Pick the address from the suggestions so guests can find it."}
      </Text>
      <Button
        label="Use this place"
        variant="primary"
        size="md"
        onPress={() => {
          if (place && ready) onSubmit(place);
        }}
        disabled={disabled || !ready}
        accessibilityLabel="Use this place"
        accessibilityHint="Ari checks the place before anything is saved"
        testID="ari-flow-place-submit"
      />
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    gap: spacing.sm,
    marginTop: spacing.sm,
    alignSelf: "stretch",
  },
  note: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
});
