/**
 * Ve1 wizard — Step 1: Address (Mapbox proxy, ORCH-1079).
 *
 * Issue #1363 [three-tier address] — the address field is now pick → free-text →
 * pin-drop. Free typing can be COMMITTED as the display address (Tier 2, a
 * background forward-geocode derives coarse coords), and an un-indexed place
 * (e.g. Nigeria) can be located exactly by dropping a pin (Tier 3). The client
 * gate + the DB `location_required` guard are UNCHANGED — a real coordinate is
 * still required; the field simply provides two new non-pick ways to supply it.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { parseVenuePlaceResult } from "../../utils/parseVenuePlaceResult";
import {
  isFreeTextResolveStale,
  resolveFreeTextLocation,
  resolvePinLocation,
} from "../../utils/resolveApproxLocation";
import { useDraftVenueStore } from "../../store/draftVenueStore";
import { MapboxAddressInput } from "../location/MapboxAddressInput";
import { PinDropSheet } from "../location/PinDropSheet";
import type { PlaceDetails } from "../../services/mapboxGeocodeService";

export interface VenueStep1AddressProps {
  showErrors: boolean;
}

export const VenueStep1Address: React.FC<VenueStep1AddressProps> = ({
  showErrors,
}) => {
  const formattedAddress = useDraftVenueStore((s) => s.formattedAddress);
  const lat = useDraftVenueStore((s) => s.lat);
  const lng = useDraftVenueStore((s) => s.lng);
  const patch = useDraftVenueStore((s) => s.patch);

  const [pinVisible, setPinVisible] = React.useState(false);
  // Issue #1363 — non-silent inline hint when a free-text forward-geocode finds
  // nothing (rule 3): the coordinate stays null and the brand is pointed at the
  // persistent "drop a pin" row. Cleared on any successful resolve/pick/clear.
  const [locationHint, setLocationHint] = React.useState<string | null>(null);
  // Issue #1363 P3-2 — latest-wins guard: tracks the address text currently
  // committed to the field so a slow, superseded free-text forward-geocode can
  // never patch a stale coordinate after the brand re-typed / picked / cleared.
  const committedAddrRef = React.useRef(formattedAddress);

  const error =
    showErrors &&
    formattedAddress.trim().length === 0
      ? "Address is required."
      : undefined;

  return (
    <View style={styles.host}>
      <Text style={styles.title}>Where is your venue?</Text>
      <Text style={styles.helper}>
        Start typing and choose a result — or use what you typed and drop a pin.
      </Text>
      <MapboxAddressInput
        value={formattedAddress}
        allowFreeText
        onChangeText={(t) => {
          setLocationHint(null);
          // ORCH-1079 LOCKED dedup guard: null the address/geo but NEVER
          // `googlePlaceId`. Issue #1363 adds coordinatePrecision to the reset.
          committedAddrRef.current = t;
          patch({ formattedAddress: t, lat: null, lng: null, city: null, countryCode: null, coordinatePrecision: null });
        }}
        onFreeText={(t) => {
          // Tier 2 — accept the typed text as the display address, then derive
          // coarse coords in the background. NEVER touch googlePlaceId (ORCH-1079).
          setLocationHint(null);
          committedAddrRef.current = t;
          patch({ formattedAddress: t });
          void (async () => {
            const approx = await resolveFreeTextLocation(t);
            // Issue #1363 P3-2 — drop a superseded resolve (brand re-typed /
            // picked / cleared while this geocode was in flight).
            if (isFreeTextResolveStale(t, committedAddrRef.current)) return;
            if (approx !== null) {
              patch({
                lat: approx.lat,
                lng: approx.lng,
                city: approx.city,
                countryCode: approx.countryCode,
                coordinatePrecision: "approximate",
              });
            } else {
              // rule 3 — non-silent: coordinate stays null; point at the pin.
              patch({ lat: null, lng: null, coordinatePrecision: null });
              setLocationHint(
                "We couldn't find that address. Drop a pin to set the exact spot.",
              );
            }
          })();
        }}
        onOpenPinDrop={() => setPinVisible(true)}
        onPick={(details: PlaceDetails): void => {
          const p = parseVenuePlaceResult(details);
          setLocationHint(null);
          committedAddrRef.current = p.formattedAddress;
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
            // Issue #1363 — a Mapbox pick is an exact coordinate.
            coordinatePrecision: "exact",
          });
        }}
        onClear={(): void => {
          // ORCH-1079 LOCKED (§3.C): clearing the field MUST NOT null
          // `googlePlaceId` — that would wipe the pool-derived dedup key on the
          // claim path. Only address/geo reset.
          setLocationHint(null);
          committedAddrRef.current = "";
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
      {locationHint !== null ? (
        <Text style={styles.locationHint} accessibilityLiveRegion="polite">
          {locationHint}
        </Text>
      ) : null}

      <PinDropSheet
        visible={pinVisible}
        initialLat={lat}
        initialLng={lng}
        onCancel={() => setPinVisible(false)}
        onConfirm={(pinLat, pinLng) => {
          setPinVisible(false);
          setLocationHint(null);
          void (async () => {
            const resolved = await resolvePinLocation(pinLat, pinLng);
            if (resolved === null) return;
            // The pin supplies the coordinate + city; the brand's typed label
            // WINS — only fall back to the reverse-geocoded formatted address
            // when the field is empty (never clobber a non-empty brand label).
            // NEVER touch googlePlaceId (ORCH-1079).
            const keepTyped = formattedAddress.trim().length > 0;
            patch({
              lat: resolved.lat,
              lng: resolved.lng,
              city: resolved.city,
              countryCode: resolved.countryCode,
              coordinatePrecision: "exact",
              ...(keepTyped || resolved.formattedAddress === null
                ? {}
                : { formattedAddress: resolved.formattedAddress }),
            });
          })();
        }}
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
  locationHint: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: semantic.warning,
  },
});

export default VenueStep1Address;
