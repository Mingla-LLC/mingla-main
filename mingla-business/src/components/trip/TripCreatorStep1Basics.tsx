/**
 * TripCreatorStep1Basics — Step 1 of TripCreatorWizard. Captures title +
 * dates + destination (Google Places autocomplete) + capacity into
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
import { PinDropSheet } from "../location/PinDropSheet";
import {
  isFreeTextResolveStale,
  resolveFreeTextLocation,
  resolvePinLocation,
} from "../../utils/resolveApproxLocation";
// ORCH-1118 — trip location must be a confirmed pick/geocode/pin before
// publish/save (Issue #1363 loosened the placeId requirement to a coordinate).
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
  // ORCH-1016 — DEPARTURE/origin city ("where travelers leave from"). Mirrors
  // the destination* family. Optional — never gates publish (NG-3 sparse data).
  departurePlaceId: string | null;
  departureLocationText: string | null;
  departureLat: number | null;
  departureLng: number | null;
  // Issue #1363 [three-tier address] — how each coordinate was captured:
  // "exact" (pick/pin) | "approximate" (free-text) | null. Carried into
  // theme.business_trip.{departure,destination}CoordinatePrecision at publish.
  destinationCoordinatePrecision?: "exact" | "approximate" | null;
  departureCoordinatePrecision?: "exact" | "approximate" | null;
  capacity: number | null;
  /**
   * ORCH-0876 — cover media for the trip (mirror of the events table
   * cover_media_* column family). Wired through CoverPicker at the bottom
   * of Step 1. autosaveStep1 persists `coverMediaUrl` + `coverMediaType`
   * via updateTripBasics (the other 5 metadata fields are non-essential
   * at create time; full 7-field support lives on EditPublishedTripScreen
   * via the biz_update_live_trip RPC).
   */
  coverMediaUrl: string | null;
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
  // ORCH-0892-A: legacy wizard-scroll-ref prop removed. CoverPicker now
  // uses the keyboard-controller library's KAV wrap instead.
}

const INPUT_BORDER = "rgba(255, 255, 255, 0.12)";
const INPUT_BG = "rgba(255, 255, 255, 0.04)";

function isoToDate(iso: string | null): Date | null {
  if (iso === null) return null;
  try {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

function dateToIso(d: Date, isEnd: boolean): string {
  // Lock time to start-of-day or end-of-day UTC so trips render whole days.
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const time = isEnd ? "23:59:59" : "00:00:00";
  return new Date(`${yyyy}-${mm}-${dd}T${time}.000Z`).toISOString();
}

function isoToHtml5Date(iso: string | null): string {
  const d = isoToDate(iso);
  if (d === null) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function htmlDateToIso(value: string, isEnd: boolean): string | null {
  if (value.trim().length === 0) return null;
  const time = isEnd ? "23:59:59" : "00:00:00";
  try {
    return new Date(`${value}T${time}.000Z`).toISOString();
  } catch {
    return null;
  }
}

function formatDateDisplay(iso: string | null): string {
  const d = isoToDate(iso);
  if (d === null) return "";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function todayMidnight(): Date {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now;
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
}) => {
  // Issue #1363 [three-tier address] — one pin-drop host shared by both fields;
  // `pinTarget` names which field the confirmed coordinate lands on. Per-field
  // non-silent hints on a failed free-text geocode (rule 3).
  const [pinTarget, setPinTarget] = useState<"departure" | "destination" | null>(
    null,
  );
  const [departureHint, setDepartureHint] = useState<string | null>(null);
  const [destinationHint, setDestinationHint] = useState<string | null>(null);
  // Issue #1363 P3-2 — latest-wins guards: the text currently committed to each
  // field, so a superseded free-text geocode can't patch a stale coordinate.
  const committedDepartureRef = useRef(draft.departureLocationText ?? "");
  const committedDestinationRef = useRef(draft.destinationLocationText ?? "");

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
      const current =
        mode === "start" ? isoToDate(draft.startAt) : isoToDate(draft.endAt);
      const fallback =
        mode === "end"
          ? (isoToDate(draft.startAt) ?? todayMidnight())
          : todayMidnight();
      setTempPickerValue(current ?? fallback);
      setPickerMode(mode);
    },
    [disabled, draft.startAt, draft.endAt],
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
          const iso = dateToIso(selected, pickerMode === "end");
          if (pickerMode === "start") {
            onChange({ startAt: iso });
            // Bump end date if it precedes new start
            const endDate = isoToDate(draft.endAt);
            if (endDate !== null && endDate.getTime() < selected.getTime()) {
              onChange({ startAt: iso, endAt: dateToIso(selected, true) });
            }
          } else {
            onChange({ endAt: iso });
          }
        }
        setPickerMode(null);
        setTempPickerValue(null);
        return;
      }
      // iOS: just store the wheel value; commit on Done press.
      if (selected !== undefined) setTempPickerValue(selected);
    },
    [draft.endAt, onChange, pickerMode],
  );

  const handleIosCommit = useCallback((): void => {
    if (tempPickerValue !== null && pickerMode !== null) {
      const iso = dateToIso(tempPickerValue, pickerMode === "end");
      if (pickerMode === "start") {
        const endDate = isoToDate(draft.endAt);
        if (endDate !== null && endDate.getTime() < tempPickerValue.getTime()) {
          onChange({ startAt: iso, endAt: dateToIso(tempPickerValue, true) });
        } else {
          onChange({ startAt: iso });
        }
      } else {
        onChange({ endAt: iso });
      }
    }
    setPickerMode(null);
    setTempPickerValue(null);
  }, [draft.endAt, onChange, pickerMode, tempPickerValue]);

  const pickerMinDate =
    pickerMode === "end"
      ? (isoToDate(draft.startAt) ?? todayMidnight())
      : todayMidnight();

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
              min: isoToHtml5Date(todayMidnight().toISOString()),
              disabled: disabled,
              onChange: (
                e: { target: { value: string } },
              ) => {
                const v = e.target.value;
                const iso = htmlDateToIso(v, false);
                if (iso === null) return;
                const startDate = new Date(`${v}T00:00:00.000Z`);
                const endDate = isoToDate(draft.endAt);
                if (
                  endDate !== null &&
                  endDate.getTime() < startDate.getTime()
                ) {
                  onChange({ startAt: iso, endAt: dateToIso(startDate, true) });
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
              min: isoToHtml5Date(
                (draft.startAt ?? todayMidnight().toISOString()),
              ),
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
          // Issue #1363 — typing nulls the structured fields; the coordinate can
          // then come from a pick, free-text forward-geocode, or a dropped pin.
          onChangeText={(v) => {
            setDepartureHint(null);
            committedDepartureRef.current = v;
            onChange({
              departureLocationText: v,
              departurePlaceId: null,
              departureLat: null,
              departureLng: null,
              departureCoordinatePrecision: null,
            });
          }}
          onFreeText={(v) => {
            setDepartureHint(null);
            committedDepartureRef.current = v;
            onChange({ departureLocationText: v });
            void (async () => {
              const approx = await resolveFreeTextLocation(v);
              // Issue #1363 P3-2 — drop a superseded resolve.
              if (isFreeTextResolveStale(v, committedDepartureRef.current)) return;
              if (approx !== null) {
                onChange({
                  departureLat: approx.lat,
                  departureLng: approx.lng,
                  departureCoordinatePrecision: "approximate",
                });
              } else {
                onChange({
                  departureLat: null,
                  departureLng: null,
                  departureCoordinatePrecision: null,
                });
                setDepartureHint(
                  "We couldn't find that. Drop a pin to set the exact spot.",
                );
              }
            })();
          }}
          onOpenPinDrop={() => setPinTarget("departure")}
          onPick={(place) => {
            setDepartureHint(null);
            committedDepartureRef.current = place.formattedAddress;
            onChange({
              departurePlaceId: place.placeId,
              departureLocationText: place.formattedAddress,
              departureLat: place.location.lat,
              departureLng: place.location.lng,
              departureCoordinatePrecision: "exact",
            });
          }}
          onClear={() => {
            setDepartureHint(null);
            committedDepartureRef.current = "";
            onChange({
              departurePlaceId: null,
              departureLocationText: null,
              departureLat: null,
              departureLng: null,
              departureCoordinatePrecision: null,
            });
          }}
          error={departureError}
          placeholder="e.g. Washington, DC, USA"
        />
        {departureHint !== null ? (
          <Text style={styles.locationHint}>{departureHint}</Text>
        ) : null}
      </View>

      {/* Destination via the Mapbox picker (ORCH-1079) */}
      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Destination</Text>
        <MapboxAddressInput
          value={draft.destinationLocationText ?? ""}
          accessibilityLabel="Destination"
          allowFreeText
          // Issue #1363 — coordinate from pick / free-text / pin.
          onChangeText={(v) => {
            setDestinationHint(null);
            committedDestinationRef.current = v;
            onChange({
              destinationLocationText: v,
              destinationPlaceId: null,
              destinationLat: null,
              destinationLng: null,
              destinationCoordinatePrecision: null,
            });
          }}
          onFreeText={(v) => {
            setDestinationHint(null);
            committedDestinationRef.current = v;
            onChange({ destinationLocationText: v });
            void (async () => {
              const approx = await resolveFreeTextLocation(v);
              // Issue #1363 P3-2 — drop a superseded resolve.
              if (isFreeTextResolveStale(v, committedDestinationRef.current)) return;
              if (approx !== null) {
                onChange({
                  destinationLat: approx.lat,
                  destinationLng: approx.lng,
                  destinationCoordinatePrecision: "approximate",
                });
              } else {
                onChange({
                  destinationLat: null,
                  destinationLng: null,
                  destinationCoordinatePrecision: null,
                });
                setDestinationHint(
                  "We couldn't find that. Drop a pin to set the exact spot.",
                );
              }
            })();
          }}
          onOpenPinDrop={() => setPinTarget("destination")}
          onPick={(place) => {
            setDestinationHint(null);
            committedDestinationRef.current = place.formattedAddress;
            onChange({
              destinationPlaceId: place.placeId,
              destinationLocationText: place.formattedAddress,
              destinationLat: place.location.lat,
              destinationLng: place.location.lng,
              destinationCoordinatePrecision: "exact",
            });
          }}
          onClear={() => {
            setDestinationHint(null);
            committedDestinationRef.current = "";
            onChange({
              destinationPlaceId: null,
              destinationLocationText: null,
              destinationLat: null,
              destinationLng: null,
              destinationCoordinatePrecision: null,
            });
          }}
          error={destinationError}
          placeholder="e.g. Tulum, Quintana Roo, Mexico"
        />
        {destinationHint !== null ? (
          <Text style={styles.locationHint}>{destinationHint}</Text>
        ) : null}
      </View>

      {/* Issue #1363 — shared pin-drop host; the confirmed coordinate lands on
          whichever field opened it (departure vs destination). */}
      <PinDropSheet
        visible={pinTarget !== null}
        initialLat={
          pinTarget === "destination" ? draft.destinationLat : draft.departureLat
        }
        initialLng={
          pinTarget === "destination" ? draft.destinationLng : draft.departureLng
        }
        onCancel={() => setPinTarget(null)}
        onConfirm={(pinLat, pinLng) => {
          const target = pinTarget;
          setPinTarget(null);
          if (target === null) return;
          void (async () => {
            const resolved = await resolvePinLocation(pinLat, pinLng);
            if (resolved === null) return;
            if (target === "departure") {
              setDepartureHint(null);
              onChange({
                departureLat: resolved.lat,
                departureLng: resolved.lng,
                departurePlaceId: null,
                departureCoordinatePrecision: "exact",
                ...((draft.departureLocationText ?? "").trim().length === 0 &&
                resolved.formattedAddress !== null
                  ? { departureLocationText: resolved.formattedAddress }
                  : {}),
              });
            } else {
              setDestinationHint(null);
              onChange({
                destinationLat: resolved.lat,
                destinationLng: resolved.lng,
                destinationPlaceId: null,
                destinationCoordinatePrecision: "exact",
                ...((draft.destinationLocationText ?? "").trim().length === 0 &&
                resolved.formattedAddress !== null
                  ? { destinationLocationText: resolved.formattedAddress }
                  : {}),
              });
            }
          })();
        }}
      />

      {/* Capacity */}
      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Capacity (max travelers)</Text>
        <TextInput
          value={draft.capacity === null ? "" : String(draft.capacity)}
          onChangeText={(v) => {
            const n = parseInt(v.replace(/[^0-9]/g, ""), 10);
            onChange({ capacity: Number.isFinite(n) && n > 0 ? n : null });
          }}
          placeholder="12"
          placeholderTextColor={textTokens.tertiary}
          keyboardType="number-pad"
          editable={!disabled}
          accessibilityLabel="Trip capacity"
          style={styles.textInput}
          testID="trip-step1-capacity"
        />
      </View>

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
