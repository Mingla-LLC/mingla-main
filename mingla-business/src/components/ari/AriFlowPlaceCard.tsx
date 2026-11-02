/**
 * #3355 P7 — the address picker on Ari's "Where is it?" event card.
 *
 * The owner types the venue name and picks the address from the SAME Host
 * address search the event wizard's Where step uses (`MapboxAddressInput`),
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
import {
  MapboxAddressInput,
  type PlaceDetails,
} from "../location/MapboxAddressInput";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";

export interface AriFlowPlaceCardProps {
  /** Offline, sending, or not the current card. */
  disabled: boolean;
  onSubmit: (place: AriFlowPlaceValue) => void;
}

/** The place a Mapbox pick describes, or null when it has no city. */
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
  };
}

export const AriFlowPlaceCard: React.FC<AriFlowPlaceCardProps> = ({
  disabled,
  onSubmit,
}) => {
  const [venueName, setVenueName] = useState("");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<PlaceDetails | null>(null);
  const place = picked ? placeFromPick(picked, venueName) : null;
  const ready = place !== null && venueName.trim().length > 0;

  return (
    <View style={styles.card}>
      <Input
        value={venueName}
        onChangeText={setVenueName}
        placeholder="Venue name, e.g. Shoreditch Town Hall"
        accessibilityLabel="Venue name"
        disabled={disabled}
        testID="ari-flow-place-venue"
      />
      <MapboxAddressInput
        value={query}
        onChangeText={(next) => {
          setQuery(next);
          setPicked(null);
        }}
        onPick={(details, selectedLabel) => {
          setPicked(details);
          setQuery(selectedLabel ?? details.formattedAddress);
          if (!venueName.trim() && details.featureType === "poi") {
            setVenueName(selectedLabel?.split(",")[0]?.trim() ?? "");
          }
        }}
        onClear={() => {
          setQuery("");
          setPicked(null);
        }}
        placeholder="Search the address"
        accessibilityLabel="Venue address"
      />
      <Text style={styles.note}>
        Pick the address from the suggestions so guests can find it.
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
