/**
 * TripCreatorStep1Basics — Step 1 of TripCreatorWizard. Captures title +
 * dates + destination (Google Places autocomplete) into
 * events.title + events.theme.business_trip.
 *
 * Tr2 (ORCH-0859). Per SPEC §4.8 Step 1.
 *
 * ORCH-0859 REWORK 2 (operator smoke #5): replaced free-form date text
 * inputs with native DateTimePicker (iOS modal + Android dialog + web
 * <input type="date">). Start date min = today; end date min =
 * max(startAt, today). Prevents past dates and parsing errors from raw
 * text entry. Mirrors the picker pattern in CreatorStep2When.tsx.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
// #4334 — from its own file: the package index would pull the address field into this screen.
import { precisionFromPlaceDetails } from "@mingla/location-input/src/placesService";
import {
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  radius as radiusTokens,
  color,
  space,
  type,
} from "../../constants/designSystem";
import { Button } from "../ui/Button";
import { useBrand } from "../../hooks/useBrands";
import { ThemeControlRow } from "../theme/ThemeControlRow";
import { ThemeSheet } from "../theme/ThemeSheetLazy";
// The shared address picker (Google behind the proxy since #4334).
// place.placeId is the picked Google place id, stored in
// theme.business_trip.{departure,destination}PlaceId; places-coordinate-refresh
// renews the coordinates by that id. The Host search is filter-free, so venue
// names resolve.
import { AddressInput } from "../location/AddressInput";
import {
  advanceLocationRequestGeneration,
  isFreeTextResolveStale,
  isLocationRequestGenerationCurrent,
  resolveFreeTextLocation,
} from "../../utils/resolveApproxLocation";
import type { LocationSelectionState } from "@mingla/location-input";
import { HostDateRangeField } from "../ui/HostDateRangeField";
import {
  calendarDateToInputValue,
  inputValueToCalendarIso,
} from "../../utils/calendarDate";
import { describeTripLength, todayInZoneDay } from "./tripBuilderV2Model";
// ORCH-1118 — trip location must have a confirmed automatically resolved
// coordinate before publish/save.
import {
  departureLocationValidated,
  destinationLocationValidated,
  TRIP_DEPARTURE_PICK_ERROR,
  TRIP_DESTINATION_PICK_ERROR,
} from "./tripLocationValidated";
import { type CoverPatch } from "../ui/CoverPicker";
import { CoverPickerSheet } from "../ui/LazyCoverPickerSheet";
import { EventCoverMedia } from "../ui/EventCoverMedia";
import type { EventCoverMediaType } from "../../store/draftEventStore";
import type { ThemeInput, OfferingGalleryImage } from "@mingla/offering-rendering";

export interface Step1Draft {
  title: string;
  /** #4522 — trip description (the 4-step builder's step 1); absent on older drafts. */
  description?: string;
  startAt: string | null; // ISO 8601 (e.g. "2026-03-12T00:00:00.000Z")
  endAt: string | null;
  destinationPlaceId: string | null;
  destinationLocationText: string | null;
  destinationLat: number | null;
  destinationLng: number | null;
  destinationCity: string | null;
  destinationCountryCode: string | null;
  // ORCH-1016 — DEPARTURE/origin city ("where travelers leave from"). Mirrors
  // the destination* family. Optional — never gates publish (NG-3 sparse data).
  departurePlaceId: string | null;
  departureLocationText: string | null;
  departureLat: number | null;
  departureLng: number | null;
  departureCity: string | null;
  departureCountryCode: string | null;
  // Issue #1363 — legacy values may be "exact"; selected-address coordinates
  // are "approximate"; null means unset. Carried into
  // theme.business_trip.{departure,destination}CoordinatePrecision at publish.
  destinationCoordinatePrecision?: "exact" | "approximate" | null;
  departureCoordinatePrecision?: "exact" | "approximate" | null;
  /**
   * ORCH-0876 — cover media for the trip (mirror of the events table
   * cover_media_* column family). Wired through CoverPicker at the bottom
   * of Step 1. autosaveStep1 persists `coverMediaUrl` + `coverMediaType`
   * via updateTripBasics (the other 5 metadata fields are non-essential
   * at create time; full 7-field support lives on EditPublishedTripScreen
   * via the biz_update_live_trip RPC).
   */
  coverMediaUrl: string | null;
  coverMediaPosterUrl?: string | null;
  coverMediaType: EventCoverMediaType | null;
  /** issue #868 [cover-gallery] — ADDITIONAL image/GIF items (default []). */
  coverGallery?: OfferingGalleryImage[];
  /**
   * #1022 — the offering's raw theme override. null = fully inherited from
   * the brand. Persisted to the events theme_*_override COLUMNS by
   * autosaveStep1 (never into the `theme` JSONB, which updateTripBasics
   * read-modify-writes across two round-trips).
   */
  themeOverrides: ThemeInput | null;
}

export interface TripCreatorStep1BasicsProps {
  draft: Step1Draft;
  onChange: (patch: Partial<Step1Draft>) => void;
  disabled?: boolean;
  /**
   * ORCH-0876 — trip context required by CoverPicker. brandId + tripEventId
   * pin the storage path; without these the picker can't upload.
   */
  brandId: string;
  tripEventId: string;
  onShowToast?: (msg: string) => void;
  // ORCH-1118 — when true, reveal the inline "pick from suggestions" error on a
  // departure/destination field that is empty or typed-but-unvalidated. The
  // wizard flips this on a blocked publish attempt. Default false.
  showAddressErrors?: boolean;
  /**
   * Issue #3291 — the trip's IANA zone, the last source of the rank-only
   * proximity hint for both address fields. Absent → the device's zone.
   */
  timeZone?: string | null;
  /**
   * Issue #3801 — the cover picker reports whether a cover video is still
   * uploading or processing. The wizard uses it to never save cover fields
   * over a video the server is about to apply.
   */
  onCoverVideoProcessingChange?: (isProcessing: boolean) => void;
  /**
   * #4522 — the 4-step builder: shows the Description field under the title and
   * focuses the title or description when a checklist item jumps here.
   */
  builderV2?: boolean;
  focusField?: "title" | "description" | null;
  /** #4522 — published editing reuses this body but owns the full cover patch. */
  showCoverPicker?: boolean;
  /** Published editing does not currently persist offering theme overrides. */
  showThemeControl?: boolean;
  // ORCH-0892-A: legacy wizard-scroll-ref prop removed. CoverPicker now
  // uses the keyboard-controller library's KAV wrap instead.
}

const INPUT_BORDER = color.lineStrong;
const INPUT_BG = color.fill.inset;

// Issue #3801 — trip start/end are CALENDAR DATES stored at UTC. The range field
// below reads and writes them as `YYYY-MM-DD` through utils/calendarDate, so the
// day is the same in every device timezone. (#4522 / #4523: one calendar, no
// browser date input and no native date spinner.)

export const TripCreatorStep1Basics: React.FC<TripCreatorStep1BasicsProps> = ({
  draft,
  onChange,
  disabled,
  brandId,
  tripEventId,
  onShowToast,
  showAddressErrors = false,
  timeZone,
  onCoverVideoProcessingChange,
  builderV2 = false,
  focusField = null,
  showCoverPicker = true,
  showThemeControl = true,
}) => {
  const titleInputRef = useRef<TextInput | null>(null);
  const descriptionInputRef = useRef<TextInput | null>(null);
  useEffect(() => {
    if (focusField === "title") titleInputRef.current?.focus();
    else if (focusField === "description") descriptionInputRef.current?.focus();
  }, [focusField]);
  const [departureSelectionState, setDepartureSelectionState] =
    useState<LocationSelectionState>(
      draft.departureLocationText?.trim() &&
          draft.departureLat !== null &&
          draft.departureLng !== null
        ? "selected"
        : "editing",
    );
  const [destinationSelectionState, setDestinationSelectionState] =
    useState<LocationSelectionState>(
      draft.destinationLocationText?.trim() &&
          draft.destinationLat !== null &&
          draft.destinationLng !== null
        ? "selected"
        : "editing",
    );
  // Issue #1363 P3-2 — latest-wins guards: the text currently committed to each
  // field, so a superseded free-text geocode can't patch a stale coordinate.
  const committedDepartureRef = useRef(draft.departureLocationText ?? "");
  const committedDestinationRef = useRef(draft.destinationLocationText ?? "");
  const departureRequestGenerationRef = useRef(0);
  const destinationRequestGenerationRef = useRef(0);
  const departureContextRef = useRef<{
    city: string | null;
    countryCode: string | null;
  }>({ city: null, countryCode: null });
  const destinationContextRef = useRef<{
    city: string | null;
    countryCode: string | null;
  }>({ city: null, countryCode: null });

  const resolveDeparture = useCallback(
    (rawLabel: string): void => {
      const generation = advanceLocationRequestGeneration(
        departureRequestGenerationRef,
      );
      committedDepartureRef.current = rawLabel;
      setDepartureSelectionState("resolving");
      onChange({
        departureLocationText: rawLabel,
        departurePlaceId: null,
        departureLat: null,
        departureLng: null,
        departureCity: null,
        departureCountryCode: null,
        departureCoordinatePrecision: null,
      });
      void (async () => {
        try {
          const resolution = await resolveFreeTextLocation(
            rawLabel,
            departureContextRef.current,
          );
          if (
            !isLocationRequestGenerationCurrent(
              departureRequestGenerationRef,
              generation,
            ) ||
            isFreeTextResolveStale(rawLabel, committedDepartureRef.current)
          ) return;
          if (resolution.status === "needs_context") {
            setDepartureSelectionState("needs_context");
            return;
          }
          const approx = resolution.location;
          onChange({
            departureLat: approx.lat,
            departureLng: approx.lng,
            departureCity: approx.city,
            departureCountryCode: approx.countryCode,
            departureCoordinatePrecision: "approximate",
            // #4334 — the place the typed address resolved to; saved with the pin.
            departurePlaceId: approx.placeId,
          });
          departureContextRef.current = {
            city: approx.city,
            countryCode: approx.countryCode,
          };
          setDepartureSelectionState("selected");
        } catch {
          if (
            isLocationRequestGenerationCurrent(
              departureRequestGenerationRef,
              generation,
            ) &&
            !isFreeTextResolveStale(rawLabel, committedDepartureRef.current)
          ) {
            setDepartureSelectionState("error");
          }
        }
      })();
    },
    [onChange],
  );

  const resolveDestination = useCallback(
    (rawLabel: string): void => {
      const generation = advanceLocationRequestGeneration(
        destinationRequestGenerationRef,
      );
      committedDestinationRef.current = rawLabel;
      setDestinationSelectionState("resolving");
      onChange({
        destinationLocationText: rawLabel,
        destinationPlaceId: null,
        destinationLat: null,
        destinationLng: null,
        destinationCity: null,
        destinationCountryCode: null,
        destinationCoordinatePrecision: null,
      });
      void (async () => {
        try {
          const resolution = await resolveFreeTextLocation(
            rawLabel,
            destinationContextRef.current,
          );
          if (
            !isLocationRequestGenerationCurrent(
              destinationRequestGenerationRef,
              generation,
            ) ||
            isFreeTextResolveStale(rawLabel, committedDestinationRef.current)
          ) return;
          if (resolution.status === "needs_context") {
            setDestinationSelectionState("needs_context");
            return;
          }
          const approx = resolution.location;
          onChange({
            destinationLat: approx.lat,
            destinationLng: approx.lng,
            destinationCity: approx.city,
            destinationCountryCode: approx.countryCode,
            destinationCoordinatePrecision: "approximate",
            // #4334 — the place the typed address resolved to; saved with the pin.
            destinationPlaceId: approx.placeId,
          });
          destinationContextRef.current = {
            city: approx.city,
            countryCode: approx.countryCode,
          };
          setDestinationSelectionState("selected");
        } catch {
          if (
            isLocationRequestGenerationCurrent(
              destinationRequestGenerationRef,
              generation,
            ) &&
            !isFreeTextResolveStale(rawLabel, committedDestinationRef.current)
          ) {
            setDestinationSelectionState("error");
          }
        }
      })();
    },
    [onChange],
  );

  // ORCH-1118 — inline "pick from suggestions" errors. Revealed only after a
  // blocked publish attempt (showAddressErrors). Empty OR dirty → error.
  const departureError =
    showAddressErrors &&
    !departureLocationValidated(
      draft.departureLocationText,
      draft.departurePlaceId,
      draft.departureLat,
      draft.departureLng,
    )
      ? TRIP_DEPARTURE_PICK_ERROR
      : undefined;
  const destinationError =
    showAddressErrors &&
    !destinationLocationValidated(
      draft.destinationLocationText,
      draft.destinationPlaceId,
      draft.destinationLat,
      draft.destinationLng,
    )
      ? TRIP_DESTINATION_PICK_ERROR
      : undefined;
  const handleCoverChange = useCallback(
    (patch: CoverPatch): void => {
      onChange({
        coverMediaUrl: patch.coverMediaUrl,
        coverMediaPosterUrl: patch.coverMediaPosterUrl,
        coverMediaType: patch.coverMediaType,
        // issue #868 [cover-gallery] — carry the ADDITIONAL photos into the draft.
        coverGallery: patch.coverGallery ?? [],
      });
    },
    [onChange],
  );
  const handleCoverToast = useCallback(
    (msg: string): void => {
      if (onShowToast !== undefined) onShowToast(msg);
    },
    [onShowToast],
  );
  // #1022 A/F-13 — ONE discriminated sheet state, never two booleans.
  const [activeSheet, setActiveSheet] = useState<"none" | "cover" | "theme">("none");
  const coverPickerVisible = activeSheet === "cover";

  // C-2 — brand theme so the row reports inheritance truthfully.
  const brandQuery = useBrand(brandId ?? null);
  // Issue #3291 — rank-only proximity for both address fields: brand → a point
  // already picked on this trip (the field's own first) → the trip's zone.
  const departurePoint = { lat: draft.departureLat, lng: draft.departureLng };
  const destinationPoint = {
    lat: draft.destinationLat,
    lng: draft.destinationLng,
  };
  const brandThemeStatus = brandQuery.isLoading
    ? ("loading" as const)
    : brandQuery.isError
      ? ("error" as const)
      : ("ready" as const);

  const handleThemeChange = useCallback(
    (next: ThemeInput | null): void => {
      onChange({ themeOverrides: next });
    },
    [onChange],
  );

  // B-13 — a theme write during publish could land inside handleConfirmPublish's
  // 1200ms window, so an open sheet is force-closed the moment submitting starts.
  useEffect(() => {
    if (disabled && activeSheet === "theme") setActiveSheet("none");
  }, [disabled, activeSheet]);
  const tripZone = timeZone ?? "UTC";
  const startDay = calendarDateToInputValue(draft.startAt);
  const endDay = calendarDateToInputValue(draft.endAt);
  const tripLength = describeTripLength(startDay, endDay);

  return (
    <View style={styles.host}>
      <Text style={styles.helper}>The basics. You can edit anything later.</Text>

      {/* Title */}
      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Trip title</Text>
        <TextInput
          value={draft.title}
          onChangeText={(v) => onChange({ title: v })}
          placeholder="e.g. Tulum Yoga Retreat"
          placeholderTextColor={color.text3}
          editable={!disabled}
          accessibilityLabel="Trip title"
          style={styles.textInput}
          testID="trip-step1-title"
          ref={titleInputRef}
        />
      </View>

      {/* #4522 — description (4-step builder). A buyer-facing paragraph; the
          publish checklist asks for 20+ characters. */}
      {builderV2 ? (
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Description</Text>
          <TextInput
            ref={descriptionInputRef}
            value={draft.description ?? ""}
            onChangeText={(v) => onChange({ description: v })}
            placeholder="What is this trip, who is it for, and what will travelers remember?"
            placeholderTextColor={color.text3}
            editable={!disabled}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
            accessibilityLabel="Trip description"
            style={[styles.textInput, styles.descriptionInput]}
            testID="trip-step1-description"
          />
          <Text style={styles.descriptionCount}>
            {(draft.description ?? "").trim().length} characters · 20 or more to publish
          </Text>
        </View>
      ) : null}

      {/* Dates — one range calendar (#4523); nights counted for the host. */}
      <View style={styles.fieldGroup}>
        <HostDateRangeField
          label="Trip dates"
          accessibilityLabel="Trip dates"
          value={{ start: startDay, end: endDay }}
          onChangeValue={(range) => {
            const start = inputValueToCalendarIso(range.start, false);
            const end = inputValueToCalendarIso(range.end, true);
            if (start === null || end === null) return;
            onChange({ startAt: start, endAt: end });
          }}
          min={todayInZoneDay(tripZone)}
          timeZone={tripZone}
          disabled={disabled}
          placeholder="Choose start and end dates"
          // #4523 — a day trip ends on the day it starts.
          allowSameDay
          testID="trip-step1-dates"
        />
        {tripLength !== null ? (
          <Text style={styles.descriptionCount} testID="trip-step1-dates-length">
            {tripLength}
          </Text>
        ) : null}
      </View>

      {/* ORCH-1016 — Departing from (origin city) via the address picker
          (ORCH-1079). Sits ABOVE Destination: the mental model is "leave here →
          go there". Optional. */}
      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Departing from</Text>
        <AddressInput
          value={draft.departureLocationText ?? ""}
          accessibilityLabel="Departing from"
          allowFreeText
          selectionState={departureSelectionState}
          selectedLabel={draft.departureLocationText ?? ""}
          proximitySources={{
            brandPoint: brandQuery.data,
            draftPoint: [departurePoint, destinationPoint],
            timeZone,
          }}
          // Issue #1363 — typing nulls the structured fields until the selected
          // address resolves automatically.
          onChangeText={(v) =>
            onChange({
              departureLocationText: v,
              departurePlaceId: null,
              departureLat: null,
              departureLng: null,
              departureCity: null,
              departureCountryCode: null,
              departureCoordinatePrecision: (
                advanceLocationRequestGeneration(departureRequestGenerationRef),
                (departureContextRef.current = {
                  city: null,
                  countryCode: null,
                }),
                null
              ),
            })
          }
          onFreeText={resolveDeparture}
          onPick={(place, selectedLabel) => {
            advanceLocationRequestGeneration(departureRequestGenerationRef);
            // Compatibility note: departureLocationText: place.formattedAddress
            // was the old mapping; the selected row label now wins when supplied.
            const label = selectedLabel ?? place.formattedAddress;
            committedDepartureRef.current = label;
            onChange({
              departurePlaceId: place.placeId,
              departureLocationText: label,
              departureLat: place.location.lat,
              departureLng: place.location.lng,
              departureCity: place.city,
              departureCountryCode: place.countryCode,
              // Issue #1629 — real pick: read the pick's feature type, do not assert.
              departureCoordinatePrecision: precisionFromPlaceDetails(place),
            });
            departureContextRef.current = {
              city: place.city,
              countryCode: place.countryCode,
            };
            setDepartureSelectionState("selected");
          }}
          onChangeSelected={() => {
            advanceLocationRequestGeneration(departureRequestGenerationRef);
            departureContextRef.current = { city: null, countryCode: null };
            committedDepartureRef.current = draft.departureLocationText ?? "";
            setDepartureSelectionState("editing");
            onChange({
              departurePlaceId: null,
              departureLat: null,
              departureLng: null,
              departureCity: null,
              departureCountryCode: null,
              departureCoordinatePrecision: null,
            });
          }}
          onClear={() => {
            advanceLocationRequestGeneration(departureRequestGenerationRef);
            departureContextRef.current = { city: null, countryCode: null };
            committedDepartureRef.current = "";
            setDepartureSelectionState("editing");
            onChange({
              departurePlaceId: null,
              departureLocationText: null,
              departureLat: null,
              departureLng: null,
              departureCity: null,
              departureCountryCode: null,
              departureCoordinatePrecision: null,
            });
          }}
          error={departureError}
          placeholder="e.g. Washington, DC, USA"
        />
      </View>

      {/* Destination via the address picker (ORCH-1079) */}
      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Destination</Text>
        <AddressInput
          value={draft.destinationLocationText ?? ""}
          accessibilityLabel="Destination"
          allowFreeText
          selectionState={destinationSelectionState}
          selectedLabel={draft.destinationLocationText ?? ""}
          proximitySources={{
            brandPoint: brandQuery.data,
            draftPoint: [destinationPoint, departurePoint],
            timeZone,
          }}
          // Issue #1363 — coordinate comes from automatic hierarchy resolution.
          onChangeText={(v) =>
            onChange({
              destinationLocationText: v,
              destinationPlaceId: null,
              destinationLat: null,
              destinationLng: null,
              destinationCity: null,
              destinationCountryCode: null,
              destinationCoordinatePrecision: (
                advanceLocationRequestGeneration(destinationRequestGenerationRef),
                (destinationContextRef.current = {
                  city: null,
                  countryCode: null,
                }),
                null
              ),
            })
          }
          onFreeText={resolveDestination}
          onPick={(place, selectedLabel) => {
            advanceLocationRequestGeneration(destinationRequestGenerationRef);
            // Compatibility note: destinationLocationText: place.formattedAddress
            // was the old mapping; the selected row label now wins when supplied.
            const label = selectedLabel ?? place.formattedAddress;
            committedDestinationRef.current = label;
            onChange({
              destinationPlaceId: place.placeId,
              destinationLocationText: label,
              destinationLat: place.location.lat,
              destinationLng: place.location.lng,
              destinationCity: place.city,
              destinationCountryCode: place.countryCode,
              // Issue #1629 — real pick: read the pick's feature type, do not assert.
              destinationCoordinatePrecision: precisionFromPlaceDetails(place),
            });
            destinationContextRef.current = {
              city: place.city,
              countryCode: place.countryCode,
            };
            setDestinationSelectionState("selected");
          }}
          onChangeSelected={() => {
            advanceLocationRequestGeneration(destinationRequestGenerationRef);
            destinationContextRef.current = { city: null, countryCode: null };
            committedDestinationRef.current = draft.destinationLocationText ?? "";
            setDestinationSelectionState("editing");
            onChange({
              destinationPlaceId: null,
              destinationLat: null,
              destinationLng: null,
              destinationCity: null,
              destinationCountryCode: null,
              destinationCoordinatePrecision: null,
            });
          }}
          onClear={() => {
            advanceLocationRequestGeneration(destinationRequestGenerationRef);
            destinationContextRef.current = { city: null, countryCode: null };
            committedDestinationRef.current = "";
            setDestinationSelectionState("editing");
            onChange({
              destinationPlaceId: null,
              destinationLocationText: null,
              destinationLat: null,
              destinationLng: null,
              destinationCity: null,
              destinationCountryCode: null,
              destinationCoordinatePrecision: null,
            });
          }}
          error={destinationError}
          placeholder="e.g. Tulum, Quintana Roo, Mexico"
        />
      </View>

      {/* Issue #3801 — there is no trip-level capacity field. Spots are set
          per package on the Pricing step; the trip total is their sum. The
          field that used to sit here was never saved. */}

      {/* Cover (ORCH-0989 — unified CoverPickerSheet; gallery-first tabs +
          video now ENABLED on trips. Step 1 persists url + type via
          updateTripBasics; EditPublishedTripScreen handles the full 7-field
          patch via biz_update_live_trip.) */}
      {showCoverPicker ? (
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Cover</Text>
          <View style={styles.coverPreview}>
            <EventCoverMedia
              hue={0}
              mediaUrl={draft.coverMediaUrl}
              mediaType={draft.coverMediaType}
              radius={12}
              label="trip cover"
              height={180}
              muted={true}
              showAudioControl={draft.coverMediaType === "video"}
            />
          </View>
          <Button
            label={
              typeof draft.coverMediaUrl === "string" && draft.coverMediaUrl.length > 0
                ? "Change cover"
                : "Add cover"
            }
            leadingIcon="upload"
            variant="secondary"
            size="md"
            shape="square"
            onPress={() => setActiveSheet("cover")}
            disabled={disabled}
            accessibilityLabel="Add cover photo, GIF, or video"
          />
        </View>
      ) : null}

      {/* #1022 M4 — direct child of styles.host (gap: space[4] = 16pt),
          NOT inside the cover fieldGroup (gap: space[1] = 4pt, wrong).
          The cover field is the LAST laid-out field group in this step, so
          the row lands at the end exactly like Event/RSVP. Step 1 already
          overflows its viewport, so the step scrolls and the row is reached
          by scrolling — that is expected, not a defect. */}
      {showThemeControl ? (
        <ThemeControlRow
          value={draft.themeOverrides}
          onChange={handleThemeChange}
          scope="offering"
          brandTheme={brandQuery.data?.theme ?? null}
          brandThemeStatus={brandThemeStatus}
          disabled={disabled}
          onPress={() => setActiveSheet("theme")}
          testID="trip-theme-control-row"
        />
      ) : null}

      {/* ORCH-0989 — unified cover sheet, JSX child of this host
          (I-SUB-SHEET-INSIDE-PARENT). Video ENABLED on trips. */}
      {showCoverPicker ? (
        <CoverPickerSheet
          visible={coverPickerVisible}
          onClose={() => setActiveSheet("none")}
          target={{
            kind: "trip",
            brandId,
            eventRowId: tripEventId,
            coverMediaApplyMode: "draft_auto",
          }}
          initial={{
            coverMediaUrl: draft.coverMediaUrl,
            coverMediaPosterUrl: draft.coverMediaPosterUrl ?? null,
            coverMediaType: draft.coverMediaType,
            coverMediaProvider: null,
            coverMediaSourceUrl: null,
            coverMediaCredit: null,
            coverMediaCreditUrl: null,
            coverMediaAlt: null,
            // issue #868 [cover-gallery] — seed the manager from the trip draft.
            coverGallery: draft.coverGallery ?? [],
          }}
          onCoverChange={handleCoverChange}
          onShowToast={handleCoverToast}
          onCoverVideoProcessingChange={onCoverVideoProcessingChange}
          disabled={disabled}
          // issue #3319 — `handleCoverChange` saves `coverGallery` into the trip draft.
          galleryEnabled
        />
      ) : null}

      {/* I-SUB-SHEET-INSIDE-PARENT — last JSX child of the host root View. */}
      {showThemeControl ? (
        <ThemeSheet
          visible={activeSheet === "theme"}
          onClose={() => setActiveSheet("none")}
          value={draft.themeOverrides}
          onChange={handleThemeChange}
          scope="offering"
          brandTheme={brandQuery.data?.theme ?? null}
          testID="trip-theme-sheet"
        />
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    gap: space[4],
    paddingTop: space[2],
  },
  helper: {
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
    color: color.text2,
  },
  fieldGroup: {
    gap: space[1],
  },
  coverPreview: {
    borderRadius: 12,
    overflow: "hidden",
  },
  fieldLabel: {
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
    fontWeight: "600",
    color: color.text2,
  },
  // Issue #1363 — non-silent inline hint on a failed free-text geocode (rule 3).
  locationHint: {
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
    color: color.warning,
  },
  textInput: {
    height: 48,
    paddingHorizontal: 14,
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    backgroundColor: INPUT_BG,
    borderWidth: 1,
    borderColor: INPUT_BORDER,
    color: color.text1,
    fontSize: type.body.fontSize,
  },
  descriptionInput: {
    height: undefined,
    minHeight: 112,
    paddingTop: 12,
    paddingBottom: 12,
  },
  descriptionCount: {
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
    color: color.text3,
  },
});

export default TripCreatorStep1Basics;
