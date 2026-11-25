/**
 * Wizard Step 3 — Where.
 *
 * Designer source: screens-creator.jsx lines 128-161 (CreatorStep3).
 * Render branches by draft.format:
 *   - in_person: venue name + address + map placeholder + privacy info
 *   - online: conferencing URL + privacy info
 *   - hybrid: BOTH in_person fields AND online URL
 *
 * Map preview is a solid striped placeholder. Real geocoding +
 * Google Places autocomplete land in B-cycle.
 *
 * Per Cycle 3 spec §3.9 Step 3.
 */

import React, { Suspense } from "react";
// #4334 — from its own file: the package index would pull the address field into this screen.
import { precisionFromPlaceDetails } from "@mingla/location-input/src/placesService";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  radius as radiusTokens,
  color,
  space,
  type,
} from "../../constants/designSystem";

import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";
import { Input } from "../ui/Input";
import { TurnoutForecastCard } from "../intel/TurnoutForecastCard";
import { useTurnoutFocusTarget } from "../intel/useTurnoutFocusTarget";
// ORCH-1047: the event Where step uses the shared address autocomplete
// (the address proxy + AddressInput; Google since #4334) — the legacy
// Google Places path was REQUEST_DENIED, leaving an empty suggestions dropdown.
// AddressInput is a drop-in for AddressAutocompleteInput (same props +
// the same PlaceDetails boundary: formattedAddress / city / location).
import { AddressInput } from "../location/AddressInput";
import {
  advanceLocationRequestGeneration,
  isFreeTextResolveStale,
  isLocationRequestGenerationCurrent,
  resolveFreeTextLocation,
} from "../../utils/resolveApproxLocation";
import type { PlaceDetails } from "../../services/placesService";
import type { LocationSelectionState } from "@mingla/location-input";
// ORCH-1186 [wizard-map-preview] — the static-map preview (vendor-neutral
// `static-map` proxy, honest empty state) now lives in the shared
// AddressMapPreview so Brand Edit renders the same one (#3355). It loads
// through its one lazy owner so it stays off the eager boot path (#3493).
import { LazyAddressMapPreview } from "../location/LazyAddressMapPreview";

import { errorForKey, type StepBodyProps } from "./types";

import { whereStepAddressCopy } from "./whereStepCopy";
import type { VenueLocation } from "../../services/venueFeaturesService";
import { venueTimezone } from "../../utils/eventVenueTimezone";

/**
 * #4490 — "Where: venue and space" (links the event to one of the brand's
 * venues and a space there). Lazy: it pulls the venue hooks and pickers.
 */
const LazyEventVenueSpacePicker = React.lazy(async () => {
  const mod = await import("../venue/features/EventVenueSpacePicker");
  return { default: mod.EventVenueSpacePicker };
});

export const CreatorStep3Where: React.FC<StepBodyProps> = ({
  draft,
  updateDraft,
  errors,
  showErrors,
  scrollToBottom,
  brandLocation,
  guestPackSlot,
}) => {
  const intelCityHighlight = useTurnoutFocusTarget("city");
  const venueError = showErrors ? errorForKey(errors, "venueName") : undefined;
  const addressError = showErrors ? errorForKey(errors, "address") : undefined;
  const onlineError = showErrors ? errorForKey(errors, "onlineUrl") : undefined;

  const [selectionState, setSelectionState] =
    React.useState<LocationSelectionState>(
      // A saved address without its pin (drafts hit by the autosave echo that
      // dropped locationGeo) opens editable, so the host re-picks it instead of
      // seeing a "selected" address over an empty map.
      draft.address?.trim() && draft.city && draft.locationGeo
        ? "selected"
        : "editing",
    );
  // Issue #1363 P3-2 — latest-wins guard: the address text currently committed
  // to the field, so a superseded free-text geocode can't patch a stale city.
  const committedAddrRef = React.useRef(draft.address ?? "");
  const requestGenerationRef = React.useRef(0);
  const savedCityRef = React.useRef(draft.city);

  const resolveCommittedText = React.useCallback(
    (rawLabel: string): void => {
      const generation = advanceLocationRequestGeneration(requestGenerationRef);
      committedAddrRef.current = rawLabel;
      setSelectionState("resolving");
      updateDraft({
        address: rawLabel,
        city: null,
        locationGeo: null,
        locationProviderPlaceId: null,
        coordinatePrecision: null,
      });
      void (async () => {
        try {
          const resolution = await resolveFreeTextLocation(rawLabel, {
            city: savedCityRef.current,
          });
          if (
            !isLocationRequestGenerationCurrent(
              requestGenerationRef,
              generation,
            ) ||
            isFreeTextResolveStale(rawLabel, committedAddrRef.current)
          )
            return;
          if (
            resolution.status === "needs_context" ||
            resolution.location.city === null
          ) {
            setSelectionState("needs_context");
            return;
          }
          const approx = resolution.location;
          updateDraft({
            city: approx.city,
            locationGeo: { lat: approx.lat, lng: approx.lng },
            // #4334 — the place the typed address resolved to; saved with the pin.
            locationProviderPlaceId: approx.placeId,
            coordinatePrecision: "approximate",
          });
          savedCityRef.current = approx.city;
          setSelectionState("selected");
        } catch {
          if (
            isLocationRequestGenerationCurrent(
              requestGenerationRef,
              generation,
            ) &&
            !isFreeTextResolveStale(rawLabel, committedAddrRef.current)
          ) {
            setSelectionState("error");
          }
        }
      })();
    },
    [updateDraft],
  );

  const showInPerson =
    draft.format === "in_person" || draft.format === "hybrid";
  const showOnline = draft.format === "online" || draft.format === "hybrid";
  // RSVP drafts (the RSVP wizard and the published-RSVP editor) have no
  // tickets, so the privacy copy speaks RSVP; the info card follows the toggle.
  const addressCopy = whereStepAddressCopy(
    draft.isRsvp === true,
    draft.hideAddressUntilTicket,
  );

  // #4490 fix 2 (N84) — a venue pick fills name, address, pin and time
  // zone; "Somewhere else" clears them for typing. A venue with no saved pin
  // keeps the address field open so the step can still be completed.
  const [venueIncomplete, setVenueIncomplete] = React.useState(false);
  const onVenuePlace = React.useCallback(
    (venue: VenueLocation | null): void => {
      advanceLocationRequestGeneration(requestGenerationRef);
      if (venue === null) {
        setVenueIncomplete(false);
        savedCityRef.current = null;
        committedAddrRef.current = "";
        setSelectionState("editing");
        updateDraft({
          venueName: null,
          address: null,
          city: null,
          locationGeo: null,
          locationProviderPlaceId: null,
          coordinatePrecision: null,
        });
        return;
      }
      const label = venue.address ?? venue.name;
      const complete = venue.city !== null && venue.lat !== null && venue.lng !== null;
      committedAddrRef.current = label;
      savedCityRef.current = venue.city;
      setSelectionState(complete ? "selected" : "editing");
      setVenueIncomplete(!complete);
      updateDraft({
        venueName: venue.name,
        address: label,
        city: venue.city,
        locationGeo: complete ? { lat: venue.lat as number, lng: venue.lng as number } : null,
        locationProviderPlaceId: venue.placeId,
        coordinatePrecision: complete ? "approximate" : null,
        timezone: venueTimezone(venue.countryCode, draft.timezone),
        // #4490 fix 3 (N103) — the venue's own page already shows its
        // address, so hiding it until a ticket is bought starts off.
        hideAddressUntilTicket: false,
      });
    },
    [draft.timezone, updateDraft],
  );

  const addressFields = (
    <>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Venue name</Text>
        <Input
          value={draft.venueName ?? ""}
          onChangeText={(v) => updateDraft({ venueName: v })}
          placeholder="e.g. Hidden Rooms"
          variant="text"
          accessibilityLabel="Venue name"
          style={venueError !== undefined ? styles.inputError : undefined}
        />
        {venueError !== undefined ? (
          <Text style={styles.helperError}>{venueError}</Text>
        ) : null}
      </View>

      {/* ORCH-0824: Google Places autocomplete replaces the plain
          <Input>. On pick, address + city + locationGeo are written
          atomically. Free typing without picking leaves city=null,
          which the validator rejects with "Pick the venue address
          from the suggestions." */}
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Address</Text>
        <AddressInput
          value={draft.address ?? ""}
          allowFreeText
          selectionState={selectionState}
          selectedLabel={draft.address ?? ""}
          // Issue #3291 — rank-only: brand → picked point → time zone.
          proximitySources={{
            brandPoint: brandLocation,
            draftPoint: draft.locationGeo,
            timeZone: draft.timezone,
          }}
          onChangeText={(v) => {
            advanceLocationRequestGeneration(requestGenerationRef);
            savedCityRef.current = null;
            committedAddrRef.current = v;
            updateDraft({
              address: v,
              city: null,
              locationGeo: null,
              locationProviderPlaceId: null,
              coordinatePrecision: null,
            });
          }}
          onFreeText={resolveCommittedText}
          onPick={(details: PlaceDetails, selectedLabel?: string): void => {
            advanceLocationRequestGeneration(requestGenerationRef);
            const label = selectedLabel ?? details.formattedAddress;
            committedAddrRef.current = label;
            updateDraft({
              address: label,
              city: details.city,
              locationGeo: details.location,
              // #4334 — the picked Google place id, saved in the same write.
              locationProviderPlaceId: details.placeId,
              // Issue #1629 — READ the precision from the pick's own feature type
              // instead of asserting it. This branch is a REAL PICK, so hardcoding
              // "approximate" made `exact` unreachable everywhere (0 rows in prod).
              coordinatePrecision: precisionFromPlaceDetails(details),
            });
            savedCityRef.current = details.city;
            setSelectionState("selected");
          }}
          onChangeSelected={() => {
            advanceLocationRequestGeneration(requestGenerationRef);
            savedCityRef.current = null;
            committedAddrRef.current = draft.address ?? "";
            setSelectionState("editing");
            updateDraft({
              city: null,
              locationGeo: null,
              locationProviderPlaceId: null,
              coordinatePrecision: null,
            });
          }}
          onClear={(): void => {
            advanceLocationRequestGeneration(requestGenerationRef);
            savedCityRef.current = null;
            committedAddrRef.current = "";
            setSelectionState("editing");
            updateDraft({
              address: null,
              city: null,
              locationGeo: null,
              locationProviderPlaceId: null,
              coordinatePrecision: null,
            });
          }}
          error={addressError}
        />
      </View>
    </>
  );

  return (
    <View
      style={
        intelCityHighlight
          ? {
              borderColor: color.lineStrong,
              borderWidth: 2,
              borderRadius: radiusTokens.md,
              padding: space[1],
            }
          : undefined
      }
    >
      {showInPerson ? (
        <>
          {/* #4490 fix 2 (N84) — with venues, Where opens on "At one of your
              venues" (venue → space; address and time zone fill in) or
              "Somewhere else" (the fields below). Without venues, or while
              the venues load, the fields show as before. */}
          <Suspense fallback={addressFields}>
            <LazyEventVenueSpacePicker
              brandId={draft.brandId}
              eventId={draft.id}
              noun="event"
              otherPlace={addressFields}
              hasOtherAddress={(draft.address ?? "").trim().length > 0}
              addressMissing={(draft.address ?? "").trim().length === 0 || draft.locationGeo === null}
              onPlace={onVenuePlace}
            />
          </Suspense>
          {venueIncomplete ? addressFields : null}

          {/* Hide-address toggle — replaces the static helper text from
              Cycle 3 v1. Default ON (matches prior behaviour). */}
          <Pressable
            onPress={() =>
              updateDraft({
                hideAddressUntilTicket: !draft.hideAddressUntilTicket,
              })
            }
            accessibilityRole="switch"
            accessibilityState={{ checked: draft.hideAddressUntilTicket }}
            accessibilityLabel={addressCopy.toggleTitle}
            style={styles.toggleRow}
          >
            <View style={styles.toggleLabelCol}>
              <Text style={styles.toggleLabel}>{addressCopy.toggleTitle}</Text>
              <Text style={styles.toggleSub}>{addressCopy.toggleSubtitle}</Text>
            </View>
            <View
              style={[
                styles.toggleTrack,
                draft.hideAddressUntilTicket && styles.toggleTrackOn,
              ]}
            >
              <View
                style={[
                  styles.toggleThumb,
                  draft.hideAddressUntilTicket
                    ? styles.toggleThumbOn
                    : styles.toggleThumbOff,
                ]}
              />
            </View>
          </Pressable>

          {/* ORCH-1186 [wizard-map-preview] — real static map for the picked
              coords, honest "pick an address" empty state otherwise, and
              (#1363) an approximate point at a lower zoom with a caption.
              #3355 — the shared AddressMapPreview, also used by Brand Edit. */}
          <Suspense fallback={null}>
            <LazyAddressMapPreview
              lat={draft.locationGeo?.lat ?? null}
              lng={draft.locationGeo?.lng ?? null}
              approximate={draft.coordinatePrecision === "approximate"}
              accessibilityLabel={`Map of ${draft.address ?? "the venue"}`}
            />
          </Suspense>

          {/* Privacy info card */}
          <GlassCard
            variant="base"
            padding={space[4]}
            style={styles.infoCard}
          >
            <View style={styles.infoRow}>
              <View style={styles.infoIconWrap}>
                <Icon name="location" size={14} color={color.text1} />
              </View>
              <Text style={styles.infoText}>{addressCopy.infoCard}</Text>
            </View>
          </GlassCard>
        </>
      ) : null}

      {showOnline ? (
        <View style={[styles.field, showInPerson && styles.onlineSpacer]}>
          <Text style={styles.fieldLabel}>Online conferencing link</Text>
          <Input
            value={draft.onlineUrl ?? ""}
            onChangeText={(v) => updateDraft({ onlineUrl: v })}
            // Online URL is the bottom-most field on Step 3 (when format
            // is online or hybrid). Same scroll-to-bottom pattern as
            // Step 1's Description: keyboard-rise-aware scroll lands
            // the field flush above the keyboard.
            onFocus={scrollToBottom}
            placeholder="https://..."
            variant="text"
            accessibilityLabel="Online conferencing link"
            style={onlineError !== undefined ? styles.inputError : undefined}
          />
          <Text style={styles.helperHint}>{addressCopy.onlineLinkHint}</Text>
          {onlineError !== undefined ? (
            <Text style={styles.helperError}>{onlineError}</Text>
          ) : null}
        </View>
      ) : null}
      {/* #4548 — the guest pack: ticket holders only, under the address. */}
      {guestPackSlot}
      <TurnoutForecastCard surface="where" />
    </View>
  );
};

const styles = StyleSheet.create({
  field: {
    marginBottom: space[4],
  },
  fieldLabel: {
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
    fontWeight: "500",
    color: color.text2,
    marginBottom: space[1],
  },
  helperError: {
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
    color: color.danger,
    marginTop: space[1],
  },
  helperHint: {
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
    color: color.text3,
    marginTop: space[1],
  },
  // Issue #1363 — non-silent inline hint on a failed free-text geocode (rule 3).
  addrHint: {
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
    color: color.warning,
    marginTop: space[1],
  },
  inputError: {
    borderColor: color.danger,
    borderWidth: 1,
  },
  onlineSpacer: {
    marginTop: space[4],
  },

  // Hide-address toggle (matches Step 6 ToggleRow visual) ---------------
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: space[4],
    paddingHorizontal: space[4],
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    backgroundColor: color.fill.inset,
    borderWidth: 1,
    borderColor: color.line,
    marginBottom: space[4],
  },
  toggleLabelCol: {
    flex: 1,
    marginRight: space[2],
  },
  toggleLabel: {
    fontSize: type.small.fontSize,
    fontWeight: "500",
    color: color.text1,
  },
  toggleSub: {
    fontSize: type.caption.fontSize,
    color: color.text3,
    marginTop: 2,
  },
  toggleTrack: {
    width: 44,
    height: 26,
    borderRadius: 999,
    backgroundColor: color.fill.step,
    padding: 3,
  },
  toggleTrackOn: {
    backgroundColor: color.paper,
  },
  toggleThumb: {
    width: 20,
    height: 20,
    borderRadius: 999,
    backgroundColor: color.text1,
  },
  toggleThumbOff: {
    backgroundColor: color.text1,
    transform: [{ translateX: 0 }],
  },
  toggleThumbOn: {
    backgroundColor: color.ink,
    transform: [{ translateX: 18 }],
  },

  // Info card ----------------------------------------------------------
  infoCard: {
    marginBottom: space[4],
  },
  infoRow: {
    flexDirection: "row",
    gap: space[2],
    alignItems: "flex-start",
  },
  infoIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 999,
    backgroundColor: color.fill.tabOn,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  infoText: {
    flex: 1,
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight * 1.4,
    color: color.text2,
  },
});
