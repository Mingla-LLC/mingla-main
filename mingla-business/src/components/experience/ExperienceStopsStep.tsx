/**
 * META-ORCH-1059 [experiences-business-parity] · SUB-A · LAYER 5
 * Step 2 — STOPS (the stops builder).
 *
 * Authoritative design: DESIGN_META-ORCH-1059_WIZARD_STOPS_PRICING.md §2.
 * Builds 2–5 ordered stops, each = a Mapbox-validated address + name + 1–5
 * photos + OPTIONAL start time + OPTIONAL per-stop price (per_stop mode only).
 * A LOCATION MODE toggle (operator-locked) governs whether all stops share one
 * location (single, default) or each has its own (per_stop). Reorder via
 * chevrons recomputes the Start Here / Then / End With labels live.
 *
 * Reuse at the primitive level (design §0.3): MapboxAddressInput, GlassCard,
 * Input, Icon. Per-stop photos are added through the app's EXISTING media
 * picker surface — ExperienceStopPhotoSheet (Library + GIFs + Photos, NO video)
 * — which reuses the unified CoverPicker's GIPHY/Pexels services + the brand-
 * keyed device-upload path. No raw expo-image-picker single-photo path.
 * (META-ORCH-1059 Sub-A · FIX 1.)
 */

import React, { useCallback } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";

import {
  accent,
  glass,
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";
import { Input } from "../ui/Input";
import { MapboxAddressInput } from "../location/MapboxAddressInput";
import type { PlaceDetails } from "../../services/mapboxGeocodeService";
import { ExperienceStopPhotoSheet } from "./ExperienceStopPhotoSheet";
import {
  emptyStop,
  labelForIndex,
  stopHasValidatedLocation,
  type ExperienceLocationMode,
  type ExperiencePricingMode,
  type ExperienceStopDraft,
} from "./experienceWizardTypes";

const MAX_STOPS = 5;
const STOP_THUMB = 64; // 4px-grid multiple (16×4); matches MiniCard thumb convention.

export interface ExperienceStopsStepProps {
  brandId: string;
  currencySymbol: string;
  stops: ExperienceStopDraft[];
  setStops: React.Dispatch<React.SetStateAction<ExperienceStopDraft[]>>;
  locationMode: ExperienceLocationMode;
  setLocationMode: (m: ExperienceLocationMode) => void;
  pricingMode: ExperiencePricingMode;
  showErrors: boolean;
  onToast: (message: string) => void;
}

export const ExperienceStopsStep: React.FC<ExperienceStopsStepProps> = ({
  brandId,
  currencySymbol,
  stops,
  setStops,
  locationMode,
  setLocationMode,
  pricingMode,
  showErrors,
  onToast,
}) => {
  const n = stops.length;

  const updateStop = useCallback(
    (i: number, patch: Partial<ExperienceStopDraft>): void => {
      setStops((prev) =>
        prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)),
      );
    },
    [setStops],
  );

  const addStop = useCallback((): void => {
    setStops((prev) => (prev.length >= MAX_STOPS ? prev : [...prev, emptyStop()]));
  }, [setStops]);

  const removeStop = useCallback(
    (i: number): void => {
      setStops((prev) => (prev.length <= 2 ? prev : prev.filter((_, idx) => idx !== i)));
    },
    [setStops],
  );

  const moveStop = useCallback(
    (i: number, dir: -1 | 1): void => {
      setStops((prev) => {
        const j = i + dir;
        if (j < 0 || j >= prev.length) return prev;
        const next = [...prev];
        const tmp = next[i];
        next[i] = next[j];
        next[j] = tmp;
        return next;
      });
    },
    [setStops],
  );

  // Index of the stop whose photo sheet is open (null = closed).
  const [photoSheetIdx, setPhotoSheetIdx] = React.useState<number | null>(null);

  const appendPhotoToStop = useCallback(
    (i: number, url: string): void => {
      setStops((prev) =>
        prev.map((s, idx) =>
          idx === i ? { ...s, imageUrls: [...s.imageUrls, url].slice(0, 5) } : s,
        ),
      );
    },
    [setStops],
  );

  const removePhoto = useCallback(
    (i: number, photoIdx: number): void => {
      setStops((prev) =>
        prev.map((s, idx) =>
          idx === i
            ? { ...s, imageUrls: s.imageUrls.filter((_, p) => p !== photoIdx) }
            : s,
        ),
      );
    },
    [setStops],
  );

  const countHelper = (): { text: string; error: boolean } => {
    if (n === 0) return { text: "Add your first stop to get started.", error: false };
    if (n === 1)
      return {
        text: "Add at least 1 more — every experience needs 2–5 stops.",
        error: showErrors,
      };
    if (n >= MAX_STOPS) return { text: "Maximum 5 stops reached.", error: false };
    return { text: `${n} of 5 stops. Add more or continue.`, error: false };
  };
  const helper = countHelper();

  return (
    <View style={styles.stepBody}>
      <Text style={styles.title}>Build the itinerary</Text>
      <Text style={styles.body}>
        Add 2–5 stops. Reorder them — the order is the route your buyers follow.
      </Text>

      {/* LOCATION MODE toggle (operator-locked) */}
      <View style={styles.modeToggle} accessibilityRole="tablist">
        <Pressable
          onPress={() => setLocationMode("single")}
          accessibilityRole="tab"
          accessibilityState={{ selected: locationMode === "single" }}
          accessibilityLabel="One location for all stops"
          style={[styles.modeSeg, locationMode === "single" && styles.modeSegActive]}
        >
          <Text style={[styles.modeSegText, locationMode === "single" && styles.modeSegTextActive]}>
            One location for all stops
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setLocationMode("per_stop")}
          accessibilityRole="tab"
          accessibilityState={{ selected: locationMode === "per_stop" }}
          accessibilityLabel="Each stop has its own location"
          style={[styles.modeSeg, locationMode === "per_stop" && styles.modeSegActive]}
        >
          <Text style={[styles.modeSegText, locationMode === "per_stop" && styles.modeSegTextActive]}>
            Each stop its own location
          </Text>
        </Pressable>
      </View>

      {stops.map((stop, i) => {
        const isFirst = i === 0;
        const isLast = i === n - 1;
        const showAddress = locationMode === "per_stop" || i === 0;
        const nameError = showErrors && stop.placeName.trim().length === 0;
        const addrError =
          showErrors && showAddress && !stopHasValidatedLocation(stop)
            ? "Pick this stop's address from the suggestions."
            : undefined;
        const priceError =
          showErrors && pricingMode === "per_stop" && stop.priceMajor.trim().length === 0
            ? "Set a price for this stop (or 0 for free)."
            : undefined;

        return (
          <GlassCard key={stop.clientId} variant="elevated" padding={spacing.md}>
            <View style={styles.stopCardInner}>
              {/* Header: badge + label + controls */}
              <View style={styles.header}>
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{i + 1}</Text>
                </View>
                <View style={styles.labelCol}>
                  <Text style={styles.stopLabel}>{labelForIndex(i, n)}</Text>
                  <Text style={styles.stopHint}>{`Stop ${i + 1} of ${n}`}</Text>
                </View>
                <View style={styles.controls}>
                  <IconBtn
                    icon="chevU"
                    onPress={() => moveStop(i, -1)}
                    disabled={isFirst}
                    label="Move stop up"
                  />
                  <IconBtn
                    icon="chevD"
                    onPress={() => moveStop(i, 1)}
                    disabled={isLast}
                    label="Move stop down"
                  />
                  <IconBtn
                    icon="trash"
                    onPress={() => removeStop(i)}
                    disabled={n <= 2}
                    label="Remove stop"
                    tint={semantic.error}
                  />
                </View>
              </View>

              {/* Stop name */}
              <Text style={styles.fieldLabel}>Stop name</Text>
              <Input
                variant="text"
                value={stop.placeName}
                onChangeText={(v) => updateStop(i, { placeName: v })}
                placeholder="e.g. Rooftop welcome drinks"
                accessibilityLabel={`Stop ${i + 1} name`}
                clearable
              />
              {nameError ? <Text style={styles.inlineError}>Name this stop.</Text> : null}

              {/* Address (single mode: only stop 1 shows the picker) */}
              {showAddress ? (
                <>
                  <Text style={styles.fieldLabel}>
                    {locationMode === "single" ? "Location (shared by all stops)" : "Address"}
                  </Text>
                  <MapboxAddressInput
                    value={stop.address}
                    accessibilityLabel={`Stop ${i + 1} address`}
                    onChangeText={(v) =>
                      updateStop(i, {
                        address: v,
                        placeId: null,
                        city: null,
                        region: null,
                        countryCode: null,
                        lat: null,
                        lng: null,
                      })
                    }
                    onPick={(d: PlaceDetails) =>
                      updateStop(i, {
                        address: d.formattedAddress,
                        placeId: d.placeId,
                        city: d.city,
                        region: d.region,
                        countryCode: d.countryCode,
                        lat: d.location.lat,
                        lng: d.location.lng,
                      })
                    }
                    onClear={() =>
                      updateStop(i, {
                        address: "",
                        placeId: null,
                        city: null,
                        region: null,
                        countryCode: null,
                        lat: null,
                        lng: null,
                      })
                    }
                    error={addrError}
                  />
                </>
              ) : (
                <Text style={styles.inheritHint}>
                  Shares the location set on Stop 1.
                </Text>
              )}

              {/* Photos */}
              <Text style={styles.fieldLabel}>Photos</Text>
              <View style={styles.thumbStrip}>
                {stop.imageUrls.map((uri, p) => (
                  <View key={`${stop.clientId}-${p}`} style={styles.thumbWrap}>
                    <Pressable
                      onPress={() => removePhoto(i, p)}
                      accessibilityRole="button"
                      accessibilityLabel="Remove photo"
                      style={styles.thumbRemove}
                      hitSlop={6}
                    >
                      <Icon name="close" size={12} color={textTokens.inverse} />
                    </Pressable>
                    <Image
                      source={{ uri }}
                      style={styles.thumb}
                      accessibilityLabel={`Stop ${i + 1} photo ${p + 1}`}
                    />
                  </View>
                ))}
                {stop.imageUrls.length < 5 ? (
                  <Pressable
                    onPress={() => setPhotoSheetIdx(i)}
                    accessibilityRole="button"
                    accessibilityLabel={`Add photo to stop ${i + 1}`}
                    style={[styles.thumb, styles.addThumb]}
                  >
                    <Icon name="plus" size={20} color={accent.warm} />
                  </Pressable>
                ) : null}
              </View>
              <Text style={styles.helper}>First photo is the one buyers see first.</Text>

              {/* Optional start time */}
              <Text style={styles.fieldLabel}>Start time (optional)</Text>
              <Input
                variant="text"
                value={stop.startTime ?? ""}
                onChangeText={(v) => updateStop(i, { startTime: v.trim().length > 0 ? v : null })}
                placeholder="e.g. 19:00"
                accessibilityLabel={`Stop ${i + 1} start time`}
                leadingIcon="calendar"
              />

              {/* Per-stop price (per_stop pricing mode only) */}
              {pricingMode === "per_stop" ? (
                <>
                  <Text style={styles.fieldLabel}>This stop&apos;s price</Text>
                  <Input
                    variant="number"
                    value={stop.priceMajor}
                    onChangeText={(v) => updateStop(i, { priceMajor: v })}
                    placeholder="0.00"
                    accessibilityLabel={`Price for stop ${i + 1}`}
                    leadingIcon="ticket"
                  />
                  {priceError ? (
                    <Text style={styles.inlineError}>{priceError}</Text>
                  ) : (
                    <Text style={styles.helper}>{`Buyers see ${currencySymbol} prices.`}</Text>
                  )}
                </>
              ) : null}
            </View>
          </GlassCard>
        );
      })}

      {n < MAX_STOPS ? (
        <Pressable
          onPress={addStop}
          accessibilityRole="button"
          accessibilityLabel="Add stop"
          style={({ pressed }) => [styles.addStopCta, pressed && styles.pressed]}
        >
          <Icon name="plus" size={18} color={accent.warm} />
          <Text style={styles.addStopText}>Add stop</Text>
        </Pressable>
      ) : null}

      <Text style={[styles.helper, helper.error && styles.helperError]}>{helper.text}</Text>

      {/* Per-stop photo picker — Library + GIFs + Photos, NO video. Mounted as a
          JSX child of this host View (I-SUB-SHEET-INSIDE-PARENT). */}
      <ExperienceStopPhotoSheet
        visible={photoSheetIdx !== null}
        onClose={() => setPhotoSheetIdx(null)}
        brandId={brandId}
        currentCount={
          photoSheetIdx !== null ? (stops[photoSheetIdx]?.imageUrls.length ?? 0) : 0
        }
        onAddPhoto={(url) => {
          if (photoSheetIdx !== null) appendPhotoToStop(photoSheetIdx, url);
        }}
        onShowToast={onToast}
      />
    </View>
  );
};

interface IconBtnProps {
  icon: "chevU" | "chevD" | "trash";
  onPress: () => void;
  disabled?: boolean;
  label: string;
  tint?: string;
}

const IconBtn: React.FC<IconBtnProps> = ({ icon, onPress, disabled, label, tint }) => (
  <Pressable
    onPress={onPress}
    disabled={disabled}
    accessibilityRole="button"
    accessibilityLabel={label}
    accessibilityState={{ disabled: disabled === true }}
    hitSlop={8}
    style={({ pressed }) => [
      styles.iconBtn,
      pressed && !disabled && styles.pressed,
      disabled && styles.iconBtnDisabled,
    ]}
  >
    <Icon name={icon} size={18} color={tint ?? textTokens.secondary} />
  </Pressable>
);

const styles = StyleSheet.create({
  stepBody: { gap: spacing.md },
  title: {
    fontSize: typography.h2.fontSize,
    lineHeight: typography.h2.lineHeight,
    fontWeight: typography.h2.fontWeight,
    color: textTokens.primary,
  },
  body: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.secondary,
  },
  modeToggle: {
    flexDirection: "row",
    gap: spacing.xs,
    backgroundColor: glass.tint.profileBase,
    borderRadius: radius.md,
    padding: spacing.xxs,
  },
  modeSeg: {
    flex: 1,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
  },
  modeSegActive: {
    backgroundColor: accent.tint,
    borderWidth: 1,
    borderColor: accent.border,
  },
  modeSegText: {
    fontSize: typography.caption.fontSize,
    fontWeight: "600",
    color: textTokens.secondary,
    textAlign: "center",
  },
  modeSegTextActive: { color: textTokens.primary },
  stopCardInner: { gap: spacing.sm },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  badge: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    backgroundColor: accent.warm,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: {
    fontSize: typography.h3.fontSize,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.inverse,
  },
  labelCol: { flex: 1 },
  stopLabel: {
    fontSize: typography.labelCap.fontSize,
    fontWeight: typography.labelCap.fontWeight,
    letterSpacing: typography.labelCap.letterSpacing,
    color: accent.warm,
  },
  stopHint: {
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
    marginTop: 2,
  },
  controls: { flexDirection: "row", gap: spacing.xs },
  iconBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  iconBtnDisabled: { opacity: 0.32 },
  fieldLabel: {
    fontSize: typography.caption.fontSize,
    fontWeight: "500",
    color: textTokens.secondary,
    marginTop: spacing.xs,
  },
  inheritHint: {
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
    fontStyle: "italic",
  },
  thumbStrip: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  thumbWrap: { position: "relative" },
  thumb: {
    width: STOP_THUMB,
    height: STOP_THUMB,
    borderRadius: radius.md,
    overflow: "hidden",
    backgroundColor: glass.tint.profileElevated,
    alignItems: "center",
    justifyContent: "center",
  },
  addThumb: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: accent.border,
  },
  thumbRemove: {
    position: "absolute",
    top: -6,
    right: -6,
    zIndex: 2,
    width: 20,
    height: 20,
    borderRadius: radius.full,
    backgroundColor: semantic.error,
    alignItems: "center",
    justifyContent: "center",
  },
  helper: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
  },
  helperError: { color: semantic.error },
  inlineError: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: semantic.error,
    marginTop: spacing.xxs,
  },
  addStopCta: {
    minHeight: 56,
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: accent.border,
  },
  addStopText: {
    fontSize: typography.body.fontSize,
    fontWeight: "600",
    color: accent.warm,
  },
  pressed: { opacity: 0.7 },
});

export default ExperienceStopsStep;
