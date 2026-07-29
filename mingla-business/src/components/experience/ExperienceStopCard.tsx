/**
 * META-ORCH-1059 [experiences-business-parity] — memoized single stop card.
 *
 * PERFORMANCE FIX (operator bug #2 "screen freeze when typing in a stop / adding
 * a photo / GIF / Pexels"): previously every stop was rendered inline inside
 * ExperienceStopsStep via `stops.map(...)`. A keystroke called updateStop →
 * setStops (new array + new object) → re-rendered the WHOLE step, which re-ran
 * every stop card's <GlassCard> + <MapboxAddressInput> + <Input>s + <Image>s.
 * Device profiling on a physical Galaxy A72 (R58R54YV7JT) showed 70% janky
 * frames typing into a single field with only 2 stops; with 5 stops + photos it
 * compounds into the visible freeze.
 *
 * This component is wrapped in React.memo with stable, clientId-keyed callbacks
 * (see ExperienceStopsStep) so that editing ONE stop re-renders ONLY that card.
 * The other stop cards bail out of re-render (props referentially unchanged).
 */

import React from "react";
import { Image, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

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
import { PinDropSheet } from "../location/PinDropSheet";
import {
  isFreeTextResolveStale,
  resolveFreeTextLocation,
  resolvePinLocation,
  resolvePinSeed,
} from "../../utils/resolveApproxLocation";
import type { PlaceDetails } from "../../services/mapboxGeocodeService";
import {
  labelForIndex,
  stopHasValidatedLocation,
  MAX_STOP_DESCRIPTION,
  type ExperienceLocationMode,
  type ExperiencePricingMode,
  type ExperienceStopDraft,
} from "./experienceWizardTypes";

const STOP_THUMB = 64;

export interface ExperienceStopCardProps {
  stop: ExperienceStopDraft;
  index: number;
  total: number;
  locationMode: ExperienceLocationMode;
  pricingMode: ExperiencePricingMode;
  currencySymbol: string;
  showErrors: boolean;
  /** All handlers are CLIENTID-stable (created once per clientId in the parent). */
  onPatch: (clientId: string, patch: Partial<ExperienceStopDraft>) => void;
  onMoveUp: (clientId: string) => void;
  onMoveDown: (clientId: string) => void;
  onRemove: (clientId: string) => void;
  onRemovePhoto: (clientId: string, photoIdx: number) => void;
  onOpenPhotoSheet: (clientId: string) => void;
}

const ExperienceStopCardImpl: React.FC<ExperienceStopCardProps> = ({
  stop,
  index: i,
  total: n,
  locationMode,
  pricingMode,
  currencySymbol,
  showErrors,
  onPatch,
  onMoveUp,
  onMoveDown,
  onRemove,
  onRemovePhoto,
  onOpenPhotoSheet,
}) => {
  const cid = stop.clientId;
  const isFirst = i === 0;
  const isLast = i === n - 1;
  const showAddress = locationMode === "per_stop" || i === 0;
  // Issue #1363 [three-tier address] — per-card pin-drop host + non-silent hint.
  // Local state is fine here: only the card being edited re-renders (memoized).
  const [pinVisible, setPinVisible] = React.useState(false);
  // Issue #1363 (CHANGE 2 — pin auto-center): coarse center the pin opens over,
  // seeded from this stop's coord or a forward-geocode of the typed address.
  const [pinSeed, setPinSeed] = React.useState<{
    lat: number | null;
    lng: number | null;
  }>({ lat: null, lng: null });
  const [addrHint, setAddrHint] = React.useState<string | null>(null);
  // Issue #1363 P3-2 — latest-wins guard: the stop address currently committed,
  // so a superseded free-text geocode can't patch a stale coord for this stop.
  const committedAddrRef = React.useRef(stop.address);
  const nameError = showErrors && stop.placeName.trim().length === 0;
  const descError =
    showErrors && stop.description.trim().length === 0
      ? "Add a short description for this stop."
      : undefined;
  const addrError =
    showErrors && showAddress && !stopHasValidatedLocation(stop)
      ? "Pick this stop's address from the suggestions."
      : undefined;
  const priceError =
    showErrors && pricingMode === "per_stop" && stop.priceMajor.trim().length === 0
      ? "Set a price for this stop (or 0 for free)."
      : undefined;

  return (
    <GlassCard variant="elevated" padding={spacing.md}>
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
            <IconBtn icon="chevU" onPress={() => onMoveUp(cid)} disabled={isFirst} label="Move stop up" />
            <IconBtn icon="chevD" onPress={() => onMoveDown(cid)} disabled={isLast} label="Move stop down" />
            <IconBtn
              icon="trash"
              onPress={() => onRemove(cid)}
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
          onChangeText={(v) => onPatch(cid, { placeName: v })}
          placeholder="e.g. Rooftop welcome drinks"
          accessibilityLabel={`Stop ${i + 1} name`}
          clearable
        />
        {nameError ? <Text style={styles.inlineError}>Name this stop.</Text> : null}

        {/* Stop description (compulsory — CHANGE 3) */}
        <Text style={styles.fieldLabel}>Description</Text>
        <TextInput
          value={stop.description}
          onChangeText={(v) => onPatch(cid, { description: v.slice(0, MAX_STOP_DESCRIPTION) })}
          placeholder="What happens at this stop? Sets the scene for buyers."
          placeholderTextColor={textTokens.quaternary}
          accessibilityLabel={`Stop ${i + 1} description`}
          multiline
          style={[styles.descArea, descError !== undefined && styles.descAreaError]}
        />
        {descError !== undefined ? (
          <Text style={styles.inlineError}>{descError}</Text>
        ) : (
          <Text style={styles.helper}>
            {`${stop.description.trim().length}/${MAX_STOP_DESCRIPTION} — shows on the deck card.`}
          </Text>
        )}

        {/* Address (single mode: only stop 1 shows the picker) */}
        {showAddress ? (
          <>
            <Text style={styles.fieldLabel}>
              {locationMode === "single" ? "Location (shared by all stops)" : "Address"}
            </Text>
            <MapboxAddressInput
              value={stop.address}
              accessibilityLabel={`Stop ${i + 1} address`}
              allowFreeText
              onChangeText={(v) => {
                setAddrHint(null);
                committedAddrRef.current = v;
                onPatch(cid, {
                  address: v,
                  placeId: null,
                  city: null,
                  region: null,
                  countryCode: null,
                  lat: null,
                  lng: null,
                  coordinatePrecision: null,
                });
              }}
              onFreeText={(v) => {
                // Tier 2 — accept the typed text, then forward-geocode coarse
                // coords. placeId stays null (a real coordinate satisfies the
                // loosened stop gate).
                setAddrHint(null);
                committedAddrRef.current = v;
                onPatch(cid, { address: v });
                void (async () => {
                  const approx = await resolveFreeTextLocation(v);
                  // Issue #1363 P3-2 — drop a superseded resolve.
                  if (isFreeTextResolveStale(v, committedAddrRef.current)) return;
                  if (approx !== null) {
                    onPatch(cid, {
                      city: approx.city,
                      region: approx.region,
                      countryCode: approx.countryCode,
                      lat: approx.lat,
                      lng: approx.lng,
                      coordinatePrecision: "approximate",
                    });
                  } else {
                    onPatch(cid, { lat: null, lng: null, coordinatePrecision: null });
                    setAddrHint(
                      "We couldn't find that. Drop a pin to set the exact spot.",
                    );
                  }
                })();
              }}
              onOpenPinDrop={() => {
                // CHANGE 2 — seed the pin center from the typed stop address.
                void (async () => {
                  const seed = await resolvePinSeed(
                    stop.lat,
                    stop.lng,
                    stop.address,
                  );
                  setPinSeed(seed);
                  setPinVisible(true);
                })();
              }}
              onPick={(d: PlaceDetails) => {
                setAddrHint(null);
                committedAddrRef.current = d.formattedAddress;
                onPatch(cid, {
                  address: d.formattedAddress,
                  placeId: d.placeId,
                  city: d.city,
                  region: d.region,
                  countryCode: d.countryCode,
                  lat: d.location.lat,
                  lng: d.location.lng,
                  coordinatePrecision: "exact",
                });
              }}
              onClear={() => {
                setAddrHint(null);
                committedAddrRef.current = "";
                onPatch(cid, {
                  address: "",
                  placeId: null,
                  city: null,
                  region: null,
                  countryCode: null,
                  lat: null,
                  lng: null,
                  coordinatePrecision: null,
                });
              }}
              error={addrError}
            />
            {addrHint !== null ? (
              <Text style={styles.inlineError}>{addrHint}</Text>
            ) : null}
            <PinDropSheet
              visible={pinVisible}
              initialLat={pinSeed.lat}
              initialLng={pinSeed.lng}
              accentHex={accent.warm}
              onCancel={() => setPinVisible(false)}
              onConfirm={(pinLat, pinLng) => {
                setPinVisible(false);
                setAddrHint(null);
                void (async () => {
                  const resolved = await resolvePinLocation(pinLat, pinLng);
                  if (resolved === null) return;
                  onPatch(cid, {
                    city: resolved.city,
                    region: resolved.region,
                    countryCode: resolved.countryCode,
                    lat: resolved.lat,
                    lng: resolved.lng,
                    placeId: null,
                    coordinatePrecision: "exact",
                    ...(stop.address.trim().length === 0 &&
                    resolved.formattedAddress !== null
                      ? { address: resolved.formattedAddress }
                      : {}),
                  });
                })();
              }}
            />
          </>
        ) : (
          <Text style={styles.inheritHint}>Shares the location set on Stop 1.</Text>
        )}

        {/* Photos */}
        <Text style={styles.fieldLabel}>Photos</Text>
        <View style={styles.thumbStrip}>
          {stop.imageUrls.map((uri, p) => (
            <View key={`${cid}-${p}`} style={styles.thumbWrap}>
              <Pressable
                onPress={() => onRemovePhoto(cid, p)}
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
              onPress={() => onOpenPhotoSheet(cid)}
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
          onChangeText={(v) => onPatch(cid, { startTime: v.trim().length > 0 ? v : null })}
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
              onChangeText={(v) => onPatch(cid, { priceMajor: v })}
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
};

/**
 * Memoize so editing one stop does not re-render the others. With clientId-stable
 * handlers from the parent, the only props that change for an UNEDITED card are
 * `index`/`total`/`showErrors`/`*Mode` on structural changes — the default
 * shallow compare correctly re-renders those and skips pure keystroke churn on
 * sibling cards.
 */
export const ExperienceStopCard = React.memo(ExperienceStopCardImpl);
ExperienceStopCard.displayName = "ExperienceStopCard";

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
  descArea: {
    minHeight: 72,
    padding: spacing.md,
    borderRadius: radius.md,
    overflow: "hidden",
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    color: textTokens.primary,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    textAlignVertical: "top",
  },
  descAreaError: { borderColor: semantic.error },
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
  inlineError: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: semantic.error,
    marginTop: spacing.xxs,
  },
  pressed: { opacity: 0.7 },
});

export default ExperienceStopCard;
