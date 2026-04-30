/**
 * Wizard Step 4 — Cover.
 *
 * Designer source: screens-creator.jsx lines 163-184 (CreatorStep4).
 * Cycle 3 ships hue-only stub via EventCover primitive. Replace + Crop
 * buttons fire TRANSITIONAL Toasts (TRANS-CYCLE-3-1, TRANS-CYCLE-3-2)
 * pointing at B-cycle (real image upload + storage). The 6-tile "GIF
 * library" is hardcoded hues 25/100/180/220/290/320 covering warm-to-cool
 * spectrum; tap sets draft.coverHue.
 *
 * Per Cycle 3 spec §3.9 Step 4.
 */

import React, { useCallback } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  accent,
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";

import { EventCover } from "../ui/EventCover";

import { type StepBodyProps } from "./types";

const HUE_TILES: readonly number[] = [25, 100, 180, 220, 290, 320] as const;

export const CreatorStep4Cover: React.FC<StepBodyProps> = ({
  draft,
  updateDraft,
}) => {
  const handleSelectHue = useCallback(
    (hue: number): void => {
      updateDraft({ coverHue: hue });
    },
    [updateDraft],
  );

  return (
    <View>
      {/* Cover preview */}
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Cover</Text>
        <View style={styles.coverPreview}>
          <EventCover
            hue={draft.coverHue}
            radius={radiusTokens.lg}
            label="cover · 16:9"
            height={180}
          />
        </View>
      </View>

      {/* Cover style grid — hue-only stub for Cycle 3.
          Rework v3 (2026-04-30): removed Replace + Crop buttons (they
          fired TRANSITIONAL Toasts and served no purpose — Constitution
          #8 subtract before adding). Honest caption added below grid. */}
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Cover style</Text>
        <View style={styles.tileGrid}>
          {HUE_TILES.map((hue) => {
            const active = draft.coverHue === hue;
            return (
              <Pressable
                key={hue}
                onPress={() => handleSelectHue(hue)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`Cover hue ${hue}${active ? " (selected)" : ""}`}
                style={[styles.tile, active && styles.tileActive]}
              >
                <View style={styles.tileInner}>
                  <EventCover hue={hue} radius={radiusTokens.md} label="" />
                </View>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.comingSoonCaption}>
          Photo, video, and GIF uploads coming soon.
        </Text>
      </View>
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
  coverPreview: {
    borderRadius: radiusTokens.lg,
    overflow: "hidden",
    marginBottom: spacing.sm,
  },
  comingSoonCaption: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
    fontStyle: "italic",
    textAlign: "center",
    marginTop: spacing.md,
  },
  tileGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  tile: {
    width: "31%",
    aspectRatio: 1,
    padding: 2,
    borderRadius: radiusTokens.md + 2,
    borderWidth: 2,
    borderColor: "transparent",
  },
  tileActive: {
    borderColor: accent.warm,
  },
  tileInner: {
    flex: 1,
    borderRadius: radiusTokens.md,
    overflow: "hidden",
  },
});
