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
import { precisionFromPlaceDetails } from "@mingla/location-input";
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";

import {
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { Button } from "../ui/Button";
import { useBrand } from "../../hooks/useBrands";
import { ThemeControlRow } from "../theme/ThemeControlRow";
import { ThemeSheet } from "../theme/ThemeSheet";
// ORCH-1079 [Business-venue Google→Mapbox sweep] — swapped the legacy Google
// address autocomplete for the shared Mapbox picker (drop-in, same props).
// place.placeId now carries an opaque mapbox_id, stored in the SAME
// theme.business_trip.{departure,destination}PlaceId keys (no downstream
// consumer reads it as a Google id). Mapbox Search Box /suggest returns POIs
// by name (no `types` filter): https://docs.mapbox.com/api/search/search-box/#get-suggestions
import { MapboxAddressInput } from "../location/MapboxAddressInput";
import {
  advanceLocationRequestGeneration,
  isFreeTextResolveStale,
  isLocationRequestGenerationCurrent,
  resolveFreeTextLocation,
} from "../../utils/resolveApproxLocation";
import type { LocationSelectionState } from "@mingla/location-input";
import {
  calendarDateToInputValue,
  calendarDateToPickerDate,
  formatCalendarDate,
  inputValueToCalendarIso,
  pickerDateToCalendarIso,
  pickerDateToInputValue,
  todayInputValue,
} from "../../utils/calendarDate";
// ORCH-1118 — trip location must have a confirmed automatically resolved
// coordinate before publish/save.
import {
  departureLocationValidated,
  destinationLocationValidated,
  TRIP_DEPARTURE_PICK_ERROR,
  TRIP_DESTINATION_PICK_ERROR,
} from "./tripLocationValidated";
import { type CoverPatch } from "../ui/CoverPicker";
import { CoverPickerSheet } from "../ui/CoverPickerSheet";
import { EventCoverMedia } from "../ui/EventCoverMedia";
import type { EventCoverMediaType } from "../../store/draftEventStore";
import type { ThemeInput, OfferingGalleryImage } from "@mingla/offering-rendering";

export interface Step1Draft {
  title: string;
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
  // ORCH-0892-A: legacy wizard-scroll-ref prop removed. CoverPicker now
  // uses the keyboard-controller library's KAV wrap instead.
}

const INPUT_BORDER = "rgba(255, 255, 255, 0.12)";
const INPUT_BG = "rgba(255, 255, 255, 0.04)";

// Issue #3801 — trip start/end are CALENDAR DATES stored at UTC. Every read
// and write below goes through utils/calendarDate so the day is the same in
// every device timezone. These used to read the stored instant with the
// device's local clock, which showed 12 November as 11 November in New York
// and, on native, wrote the shifted day back when the host tapped Done.
function isoToHtml5Date(iso: string | null): string {
  return calendarDateToInputValue(iso);
}

function htmlDateToIso(value: string, isEnd: boolean): string | null {
  return inputValueToCalendarIso(value, isEnd);
}

function formatDateDisplay(iso: string | null): string {
  return formatCalendarDate(iso);
}

/** The local day to open a native picker on when no date is stored yet. */
function todayPickerDate(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0);
}

/** True when the stored end day falls before the given calendar day. */
function endIsBefore(endIso: string | null, day: string): boolean {
  const end = calendarDateToInputValue(endIso);
  return end.length > 0 && end < day;
}

type PickerMode = "start" | "end" | null;

export const TripCreatorStep1Basics: React.FC<TripCreatorStep1BasicsProps> = ({
  draft,
  onChange,
  disabled,
  brandId,
  tripEventId,
  onShowToast,
  showAddressErrors = false,
  timeZone,
}) => {
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
  const [pickerMode, setPickerMode] = useState<PickerMode>(null);
  const [tempPickerValue, setTempPickerValue] = useState<Date | null>(null);

  const handleOpenPicker = useCallback(
    (mode: "start" | "end"): void => {
      if (disabled === true) return;
      // Seed the picker with the STORED calendar day, as a local day. Tapping
      // Done without touching the wheel must leave the stored day unchanged.
      const current =
        mode === "start"
          ? calendarDateToPickerDate(draft.startAt)
          : calendarDateToPickerDate(draft.endAt);
      const fallback =
        mode === "end"
          ? (calendarDateToPickerDate(draft.startAt) ?? todayPickerDate())
          : todayPickerDate();
      setTempPickerValue(current ?? fallback);
      setPickerMode(mode);
    },
    [disabled, draft.startAt, draft.endAt],
  );

  // Write the LOCAL day the picker returned as that calendar day at UTC (the
  // same value the web date input writes). Picking a start after the current
  // end moves the end to the same day.
  const commitPickedDay = useCallback(
    (picked: Date, mode: "start" | "end"): void => {
      const iso = pickerDateToCalendarIso(picked, mode === "end");
      if (iso === null) return;
      if (mode === "end") {
        onChange({ endAt: iso });
        return;
      }
      const pickedDay = pickerDateToInputValue(picked);
      if (endIsBefore(draft.endAt, pickedDay)) {
        onChange({ startAt: iso, endAt: pickerDateToCalendarIso(picked, true) });
      } else {
        onChange({ startAt: iso });
      }
    },
    [draft.endAt, onChange],
  );

  const handlePickerChange = useCallback(
    (event: DateTimePickerEvent, selected?: Date): void => {
      // Android: 'set' commits + auto-dismisses; 'dismissed' cancels.
      // iOS spinner emits 'set' on every wheel-stop; we commit on Done tap.
      if (Platform.OS === "android") {
        if (event.type === "dismissed") {
          setPickerMode(null);
          setTempPickerValue(null);
          return;
        }
        if (selected !== undefined && pickerMode !== null) {
          commitPickedDay(selected, pickerMode);
        }
        setPickerMode(null);
        setTempPickerValue(null);
        return;
      }
      // iOS: just store the wheel value; commit on Done press.
      if (selected !== undefined) setTempPickerValue(selected);
    },
    [commitPickedDay, pickerMode],
  );

  const handleIosCommit = useCallback((): void => {
    if (tempPickerValue !== null && pickerMode !== null) {
      commitPickedDay(tempPickerValue, pickerMode);
    }
    setPickerMode(null);
    setTempPickerValue(null);
  }, [commitPickedDay, pickerMode, tempPickerValue]);

  const pickerMinDate =
    pickerMode === "end"
      ? (calendarDateToPickerDate(draft.startAt) ?? todayPickerDate())
      : todayPickerDate();

  return (
    <View style={styles.host}>
      <Text style={styles.helper}>The basics. You can edit anything later.</Text>

      {/* Title */}
      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Trip title</Text>
        <TextInput
          value={draft.title}
          onChangeText={(v) => onChange({ title: v })}
          placeholder="e.g. Tulum Yoga Retreat — March 2026"
          placeholderTextColor={textTokens.tertiary}
          editable={!disabled}
          accessibilityLabel="Trip title"
          style={styles.textInput}
          testID="trip-step1-title"
        />
      </View>

      {/* Dates */}
      <View style={styles.dateRow}>
        <View style={[styles.fieldGroup, styles.dateField]}>
          <Text style={styles.fieldLabel}>Start date</Text>
          {Platform.OS === "web" ? (
            React.createElement("input" as any, {
              type: "date",
              value: isoToHtml5Date(draft.startAt),
              min: todayInputValue(),
              disabled: disabled,
              onChange: (
                e: { target: { value: string } },
              ) => {
                const v = e.target.value;
                const iso = htmlDateToIso(v, false);
                if (iso === null) return;
                if (endIsBefore(draft.endAt, v)) {
                  onChange({ startAt: iso, endAt: htmlDateToIso(v, true) });
                } else {
                  onChange({ startAt: iso });
                }
              },
              "data-testid": "trip-step1-start-web",
              style: webDateInputStyle,
            })
          ) : (
            <Pressable
              onPress={() => handleOpenPicker("start")}
              disabled={disabled}
              style={styles.dateButton}
              accessibilityRole="button"
              accessibilityLabel="Pick start date"
              testID="trip-step1-start"
            >
              <Text
                style={
                  draft.startAt === null
                    ? styles.dateButtonPlaceholder
                    : styles.dateButtonValue
                }
              >
                {draft.startAt === null
                  ? "Tap to pick"
                  : formatDateDisplay(draft.startAt)}
              </Text>
            </Pressable>
          )}
        </View>
        <View style={[styles.fieldGroup, styles.dateField]}>
          <Text style={styles.fieldLabel}>End date</Text>
          {Platform.OS === "web" ? (
            React.createElement("input" as any, {
              type: "date",
              value: isoToHtml5Date(draft.endAt),
              min:
                draft.startAt !== null
                  ? isoToHtml5Date(draft.startAt)
                  : todayInputValue(),
              disabled: disabled,
              onChange: (e: { target: { value: string } }) => {
                const v = e.target.value;
                const iso = htmlDateToIso(v, true);
                if (iso !== null) onChange({ endAt: iso });
              },
              "data-testid": "trip-step1-end-web",
              style: webDateInputStyle,
            })
          ) : (
            <Pressable
              onPress={() => handleOpenPicker("end")}
              disabled={disabled}
              style={styles.dateButton}
              accessibilityRole="button"
              accessibilityLabel="Pick end date"
              testID="trip-step1-end"
            >
              <Text
                style={
                  draft.endAt === null
                    ? styles.dateButtonPlaceholder
                    : styles.dateButtonValue
                }
              >
                {draft.endAt === null
                  ? "Tap to pick"
                  : formatDateDisplay(draft.endAt)}
              </Text>
            </Pressable>
          )}
        </View>
      </View>

      {/* ORCH-1016 — Departing from (origin city) via the Mapbox picker
          (ORCH-1079). Sits ABOVE Destination: the mental model is "leave here →
          go there". Optional. */}
      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Departing from</Text>
        <MapboxAddressInput
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
              // Issue #1629 — real pick: read Mapbox's feature_type, do not assert.
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

      {/* Destination via the Mapbox picker (ORCH-1079) */}
      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Destination</Text>
        <MapboxAddressInput
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
              // Issue #1629 — real pick: read Mapbox's feature_type, do not assert.
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

      {/* #1022 M4 — direct child of styles.host (gap: spacing.md = 16pt),
          NOT inside the cover fieldGroup (gap: spacing.xs = 4pt, wrong).
          The cover field is the LAST laid-out field group in this step, so
          the row lands at the end exactly like Event/RSVP. Step 1 already
          overflows its viewport, so the step scrolls and the row is reached
          by scrolling — that is expected, not a defect. */}
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

      {/* ORCH-0989 — unified cover sheet, JSX child of this host
          (I-SUB-SHEET-INSIDE-PARENT). Video ENABLED on trips. */}
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
        disabled={disabled}
        // issue #3319 — `handleCoverChange` saves `coverGallery` into the trip draft.
        galleryEnabled
      />

      {/* iOS picker modal */}
      {Platform.OS === "ios" && pickerMode !== null && tempPickerValue !== null ? (
        <Modal
          transparent
          animationType="fade"
          visible={pickerMode !== null}
          onRequestClose={handleIosCommit}
        >
          <View style={styles.iosModalBackdrop}>
            <View style={styles.iosPickerSheet}>
              <View style={styles.iosPickerDoneRow}>
                <Button
                  label="Done"
                  variant="primary"
                  size="md"
                  onPress={handleIosCommit}
                />
              </View>
              <View style={styles.iosPickerWrap}>
                <DateTimePicker
                  value={tempPickerValue}
                  mode="date"
                  display="spinner"
                  onChange={handlePickerChange}
                  minimumDate={pickerMinDate}
                  themeVariant="dark"
                  textColor="#FFFFFF"
                  style={styles.iosPicker}
                />
              </View>
            </View>
          </View>
        </Modal>
      ) : null}

      {/* Android dialog */}
      {Platform.OS === "android" && pickerMode !== null && tempPickerValue !== null ? (
        <DateTimePicker
          value={tempPickerValue}
          mode="date"
          display="default"
          onChange={handlePickerChange}
          minimumDate={pickerMinDate}
        />
      ) : null}

      {/* I-SUB-SHEET-INSIDE-PARENT — last JSX child of the host root View. */}
      <ThemeSheet
        visible={activeSheet === "theme"}
        onClose={() => setActiveSheet("none")}
        value={draft.themeOverrides}
        onChange={handleThemeChange}
        scope="offering"
        brandTheme={brandQuery.data?.theme ?? null}
        testID="trip-theme-sheet"
      />
    </View>
  );
};

const webDateInputStyle = {
  height: 48,
  paddingLeft: 14,
  paddingRight: 14,
  borderRadius: 8,
  backgroundColor: INPUT_BG,
  borderWidth: 1,
  borderColor: INPUT_BORDER,
  borderStyle: "solid" as const,
  color: "#FFFFFF",
  fontSize: 16,
  width: "100%",
  boxSizing: "border-box" as const,
};

const styles = StyleSheet.create({
  host: {
    gap: spacing.md,
    paddingTop: spacing.sm,
  },
  helper: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
  },
  fieldGroup: {
    gap: spacing.xs,
  },
  coverPreview: {
    borderRadius: 12,
    overflow: "hidden",
  },
  fieldLabel: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: "600",
    color: textTokens.secondary,
  },
  // Issue #1363 — non-silent inline hint on a failed free-text geocode (rule 3).
  locationHint: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: semantic.warning,
  },
  textInput: {
    height: 48,
    paddingHorizontal: 14,
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    backgroundColor: INPUT_BG,
    borderWidth: 1,
    borderColor: INPUT_BORDER,
    color: textTokens.primary,
    fontSize: typography.body.fontSize,
  },
  dateRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  dateField: {
    flex: 1,
  },
  dateButton: {
    height: 48,
    paddingHorizontal: 14,
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    backgroundColor: INPUT_BG,
    borderWidth: 1,
    borderColor: INPUT_BORDER,
    justifyContent: "center",
  },
  dateButtonPlaceholder: {
    fontSize: typography.body.fontSize,
    color: textTokens.tertiary,
  },
  dateButtonValue: {
    fontSize: typography.body.fontSize,
    color: textTokens.primary,
    fontWeight: "500",
  },
  iosModalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "flex-end",
  },
  iosPickerSheet: {
    backgroundColor: "#16181d",
    borderTopLeftRadius: radiusTokens.lg,
    borderTopRightRadius: radiusTokens.lg,
    paddingBottom: spacing.xl,
    paddingTop: spacing.md,
  },
  iosPickerDoneRow: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    alignItems: "flex-end",
  },
  iosPickerWrap: {
    height: 220,
    alignItems: "center",
    justifyContent: "center",
  },
  iosPicker: {
    height: 220,
    width: "100%",
  },
});

export default TripCreatorStep1Basics;
