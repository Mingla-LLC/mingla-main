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
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  accent,
  glass,
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { Icon } from "../ui/Icon";
import { ExperienceStopPhotoSheet } from "./ExperienceStopPhotoSheet";
import { ExperienceStopCard } from "./ExperienceStopCard";
import {
  emptyStop,
  type ExperienceLocationMode,
  type ExperiencePricingMode,
  type ExperienceStopDraft,
} from "./experienceWizardTypes";

const MAX_STOPS = 5;

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

  // META-ORCH-1059 perf (bug #2): ALL stop mutations are keyed by clientId, not
  // index, so the handlers are referentially STABLE across renders ([setStops]
  // only). Combined with React.memo on ExperienceStopCard, editing one stop
  // re-renders ONLY that card — the other cards bail out (props unchanged).
  const patchStop = useCallback(
    (clientId: string, patch: Partial<ExperienceStopDraft>): void => {
      setStops((prev) =>
        prev.map((s) => (s.clientId === clientId ? { ...s, ...patch } : s)),
      );
    },
    [setStops],
  );

  const addStop = useCallback((): void => {
    setStops((prev) => (prev.length >= MAX_STOPS ? prev : [...prev, emptyStop()]));
  }, [setStops]);

  const removeStop = useCallback(
    (clientId: string): void => {
      setStops((prev) =>
        prev.length <= 2 ? prev : prev.filter((s) => s.clientId !== clientId),
      );
    },
    [setStops],
  );

  const moveStopBy = useCallback(
    (clientId: string, dir: -1 | 1): void => {
      setStops((prev) => {
        const i = prev.findIndex((s) => s.clientId === clientId);
        if (i < 0) return prev;
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
  const moveStopUp = useCallback(
    (clientId: string): void => moveStopBy(clientId, -1),
    [moveStopBy],
  );
  const moveStopDown = useCallback(
    (clientId: string): void => moveStopBy(clientId, 1),
    [moveStopBy],
  );

  // clientId of the stop whose photo sheet is open (null = closed).
  const [photoSheetClientId, setPhotoSheetClientId] = React.useState<string | null>(null);
  const openPhotoSheet = useCallback((clientId: string): void => {
    setPhotoSheetClientId(clientId);
  }, []);

  const appendPhotoToStop = useCallback(
    (clientId: string, url: string): void => {
      setStops((prev) =>
        prev.map((s) =>
          s.clientId === clientId
            ? { ...s, imageUrls: [...s.imageUrls, url].slice(0, 5) }
            : s,
        ),
      );
    },
    [setStops],
  );

  const removePhoto = useCallback(
    (clientId: string, photoIdx: number): void => {
      setStops((prev) =>
        prev.map((s) =>
          s.clientId === clientId
            ? { ...s, imageUrls: s.imageUrls.filter((_, p) => p !== photoIdx) }
            : s,
        ),
      );
    },
    [setStops],
  );

  const photoSheetStop =
    photoSheetClientId !== null
      ? stops.find((s) => s.clientId === photoSheetClientId) ?? null
      : null;

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

      {stops.map((stop, i) => (
        <ExperienceStopCard
          key={stop.clientId}
          stop={stop}
          index={i}
          total={n}
          locationMode={locationMode}
          pricingMode={pricingMode}
          currencySymbol={currencySymbol}
          showErrors={showErrors}
          onPatch={patchStop}
          onMoveUp={moveStopUp}
          onMoveDown={moveStopDown}
          onRemove={removeStop}
          onRemovePhoto={removePhoto}
          onOpenPhotoSheet={openPhotoSheet}
        />
      ))}

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
        visible={photoSheetClientId !== null}
        onClose={() => setPhotoSheetClientId(null)}
        brandId={brandId}
        currentCount={photoSheetStop?.imageUrls.length ?? 0}
        onAddPhoto={(url) => {
          if (photoSheetClientId !== null) appendPhotoToStop(photoSheetClientId, url);
        }}
        onShowToast={onToast}
      />
    </View>
  );
};

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
  // NOTE: per-stop-card styles (badge / fields / thumbnails / etc.) moved to
  // ExperienceStopCard.tsx with the memoized card extraction (perf bug #2).
  helper: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
  },
  helperError: { color: semantic.error },
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
