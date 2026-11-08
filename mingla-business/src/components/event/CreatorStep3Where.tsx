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
import { precisionFromPlaceDetails } from "@mingla/location-input";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  accent,
  glass,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
  typography,
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

export const CreatorStep3Where: React.FC<StepBodyProps> = ({
  draft,
  updateDraft,
  errors,
  showErrors,
  scrollToBottom,
  brandLocation,
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

  return (
    <View
      style={
        intelCityHighlight
          ? {
              borderColor: accent.warm,
              borderWidth: 2,
              borderRadius: radiusTokens.md,
              padding: spacing.xs,
            }
          : undefined
      }
    >
      {showInPerson ? (
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
            padding={spacing.md}
            style={styles.infoCard}
          >
            <View style={styles.infoRow}>
              <View style={styles.infoIconWrap}>
                <Icon name="location" size={14} color={accent.warm} />
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
      <TurnoutForecastCard surface="where" />
    </View>
  );
};

const styles = StyleSheet.create({
  field: {
    marginBottom: spacing.md,
  },
  fieldLabel: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: "500",
    color: textTokens.secondary,
    marginBottom: spacing.xs,
  },
  helperError: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: semantic.error,
    marginTop: spacing.xs,
  },
  helperHint: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
    marginTop: spacing.xs,
  },
  // Issue #1363 — non-silent inline hint on a failed free-text geocode (rule 3).
  addrHint: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: semantic.warning,
    marginTop: spacing.xs,
  },
  inputError: {
    borderColor: semantic.error,
    borderWidth: 1,
  },
  onlineSpacer: {
    marginTop: spacing.md,
  },

  // Hide-address toggle (matches Step 6 ToggleRow visual) ---------------
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    marginBottom: spacing.md,
  },
  toggleLabelCol: {
    flex: 1,
    marginRight: spacing.sm,
  },
  toggleLabel: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "500",
    color: textTokens.primary,
  },
  toggleSub: {
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
    marginTop: 2,
  },
  toggleTrack: {
    width: 44,
    height: 26,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.16)",
    padding: 3,
  },
  toggleTrackOn: {
    backgroundColor: accent.warm,
  },
  toggleThumb: {
    width: 20,
    height: 20,
    borderRadius: 999,
    backgroundColor: "#fff",
  },
  toggleThumbOff: {
    transform: [{ translateX: 0 }],
  },
  toggleThumbOn: {
    transform: [{ translateX: 18 }],
  },

  // Info card ----------------------------------------------------------
  infoCard: {
    marginBottom: spacing.md,
  },
  infoRow: {
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "flex-start",
  },
  infoIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 999,
    backgroundColor: accent.tint,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  infoText: {
    flex: 1,
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight * 1.4,
    color: textTokens.secondary,
  },
});
