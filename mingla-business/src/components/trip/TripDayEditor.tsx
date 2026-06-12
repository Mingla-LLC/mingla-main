// orch-strict-grep-allow orch-0892 — the only react-native ScrollView here is the ORCH-1119 HORIZONTAL media-thumbnail strip (gallery), not a keyboard-avoiding vertical scroll; SmartScrollView/KeyboardAwareScrollView would wrongly hijack focus/scroll. No TextInput lives inside that ScrollView. (multiline import → gate matches file-top)
/**
 * TripDayEditor — single day card used inside TripCreatorStep2Itinerary.
 * Tr2 (ORCH-0859).
 *
 * Renders one day's editable title + narrative + ordinal display + delete
 * button. Stacked-cards UX (SPEC §4.8 Step 2). Reorder handled by parent
 * via swap-buttons (drag-reorder via react-native-draggable-flatlist
 * intentionally deferred to polish ORCH — adds a new dep + complexity not
 * worth Tr2 scope).
 */

import React from "react";
import {
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { EventCoverMedia } from "../ui/EventCoverMedia";

import {
  accent,
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { Icon } from "../ui/Icon";
import type { TripDayMedia } from "../../services/tripsService";
import { MAX_TRIP_DAY_MEDIA } from "../../services/tripDayMediaService";

export interface TripDayDraft {
  ordinal: number;
  title: string;
  narrative: string;
  // ORCH-1119 — optional ordered per-day media gallery (default []).
  media: TripDayMedia[];
}

export interface TripDayEditorProps {
  day: TripDayDraft;
  index: number;
  total: number;
  onChange: (patch: Partial<TripDayDraft>) => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  disabled?: boolean;
  testID?: string;
  // ORCH-1119 — per-day media gallery. When ALL of brandId/eventId/onAddMedia are
  // present the "+ Add media" tile + gallery render; absent (no media wiring) the
  // gallery section is omitted entirely (back-compat).
  brandId?: string;
  eventId?: string;
  onAddMedia?: () => void;
  onRemoveMedia?: (index: number) => void;
  onReorderMedia?: (from: number, to: number) => void;
}

const NARRATIVE_MAX = 1000;

// ORCH-1119 — opaque Android fill for gallery tiles (ANDROID_GLASS_USES_OPAQUE_FALLBACK).
const TILE_BG = Platform.select({
  android: "#1A1A1C",
  default: "rgba(255, 255, 255, 0.06)",
}) as string;

export const TripDayEditor: React.FC<TripDayEditorProps> = ({
  day,
  index,
  total,
  onChange,
  onDelete,
  onMoveUp,
  onMoveDown,
  disabled,
  testID,
  brandId,
  eventId,
  onAddMedia,
  onRemoveMedia,
  onReorderMedia,
}) => {
  const canMoveUp = !disabled && index > 0;
  const canMoveDown = !disabled && index < total - 1;
  // Gallery is enabled only when the upload wiring is threaded in.
  const mediaEnabled =
    brandId !== undefined &&
    eventId !== undefined &&
    onAddMedia !== undefined &&
    onRemoveMedia !== undefined;
  const media = day.media ?? [];
  const atMediaCap = media.length >= MAX_TRIP_DAY_MEDIA;

  return (
    <View style={styles.card} testID={testID}>
      <View style={styles.header}>
        <Text style={styles.ordinalLabel}>Day {day.ordinal}</Text>
        <View style={styles.headerActions}>
          <Pressable
            onPress={onMoveUp}
            disabled={!canMoveUp}
            accessibilityRole="button"
            accessibilityLabel={`Move day ${day.ordinal} up`}
            accessibilityState={{ disabled: !canMoveUp }}
            style={[styles.iconBtn, !canMoveUp && styles.iconBtnDisabled]}
            hitSlop={8}
          >
            <Icon name="chevU" size={16} color={textTokens.secondary} />
          </Pressable>
          <Pressable
            onPress={onMoveDown}
            disabled={!canMoveDown}
            accessibilityRole="button"
            accessibilityLabel={`Move day ${day.ordinal} down`}
            accessibilityState={{ disabled: !canMoveDown }}
            style={[styles.iconBtn, !canMoveDown && styles.iconBtnDisabled]}
            hitSlop={8}
          >
            <Icon name="chevD" size={16} color={textTokens.secondary} />
          </Pressable>
          <Pressable
            onPress={onDelete}
            disabled={disabled || total <= 1}
            accessibilityRole="button"
            accessibilityLabel={`Delete day ${day.ordinal}`}
            accessibilityState={{ disabled: disabled || total <= 1 }}
            style={[
              styles.iconBtn,
              (disabled || total <= 1) && styles.iconBtnDisabled,
            ]}
            hitSlop={8}
          >
            <Icon name="trash" size={16} color={textTokens.tertiary} />
          </Pressable>
        </View>
      </View>

      <Text style={styles.fieldLabel}>Day title</Text>
      <TextInput
        value={day.title}
        onChangeText={(v) => onChange({ title: v })}
        placeholder={`e.g. Day ${day.ordinal} — Arrival + sunset welcome dinner`}
        placeholderTextColor={textTokens.tertiary}
        editable={!disabled}
        accessibilityLabel={`Day ${day.ordinal} title`}
        style={styles.titleInput}
        testID={testID === undefined ? undefined : `${testID}-title`}
      />

      <Text style={styles.fieldLabel}>What happens</Text>
      <TextInput
        value={day.narrative}
        onChangeText={(v) => onChange({ narrative: v.slice(0, NARRATIVE_MAX) })}
        placeholder="Briefly describe what travelers will do on this day"
        placeholderTextColor={textTokens.tertiary}
        multiline
        numberOfLines={3}
        maxLength={NARRATIVE_MAX}
        editable={!disabled}
        accessibilityLabel={`Day ${day.ordinal} narrative`}
        style={styles.narrativeInput}
        textAlignVertical="top"
        testID={testID === undefined ? undefined : `${testID}-narrative`}
      />
      <Text style={styles.charCounter}>
        {day.narrative.length}/{NARRATIVE_MAX}
      </Text>

      {/* ORCH-1119 — optional per-day media gallery. Constitution #9: a day with
          NO media renders only the "+ Add" tile, never an empty frame. */}
      {mediaEnabled ? (
        <View
          style={styles.mediaSection}
          accessibilityLabel={`Day ${day.ordinal} media gallery`}
        >
          <Text style={styles.fieldLabel}>Photos &amp; videos</Text>
          {/* orch-strict-grep-allow orch-0892 — HORIZONTAL media-thumbnail strip, not a keyboard-avoiding vertical scroll; SmartScrollView (KeyboardAwareScrollView) would wrongly hijack focus/scroll. No TextInput inside. */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.mediaRow}
          >
            {media.map((m, mi) => (
              <View key={`${m.url}-${mi}`} style={styles.mediaTile}>
                {m.type === "video" ? (
                  <EventCoverMedia
                    mediaUrl={m.url}
                    mediaType="video"
                    autoplay={false}
                    playbackActive={false}
                    muted
                    loop={false}
                    radius={radiusTokens.md}
                    height="100%"
                    width="100%"
                  />
                ) : (
                  <Image
                    source={{ uri: m.url }}
                    style={styles.mediaImage}
                    resizeMode="cover"
                    accessibilityRole="image"
                    accessibilityLabel={`Day ${day.ordinal} media ${mi + 1}, image`}
                  />
                )}
                {m.type === "video" ? (
                  <View style={styles.videoBadge} pointerEvents="none">
                    <Icon name="play" size={10} color="#FFFFFF" />
                  </View>
                ) : null}
                {/* Reorder: move-left button on all but the first tile. */}
                {mi > 0 && onReorderMedia !== undefined && !disabled ? (
                  <Pressable
                    onPress={() => onReorderMedia(mi, mi - 1)}
                    accessibilityRole="button"
                    accessibilityLabel={`Move media ${mi + 1} earlier`}
                    hitSlop={8}
                    style={styles.reorderBtn}
                  >
                    <Icon name="chevU" size={12} color="#FFFFFF" />
                  </Pressable>
                ) : null}
                <Pressable
                  onPress={() => onRemoveMedia?.(mi)}
                  disabled={disabled}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove media ${mi + 1}`}
                  hitSlop={8}
                  style={styles.removeBtn}
                >
                  <Icon name="close" size={12} color="#FFFFFF" />
                </Pressable>
              </View>
            ))}
            {/* Add tile — disabled at cap. */}
            <Pressable
              onPress={onAddMedia}
              disabled={disabled || atMediaCap}
              accessibilityRole="button"
              accessibilityLabel={
                atMediaCap
                  ? `Day ${day.ordinal} media is full`
                  : `Add media to day ${day.ordinal}`
              }
              accessibilityState={{ disabled: disabled === true || atMediaCap }}
              style={[styles.addTile, (disabled || atMediaCap) && styles.addTileDisabled]}
            >
              <Icon name="plus" size={20} color={accent.warm} />
              <Text style={styles.addTileLabel}>
                {atMediaCap ? `${MAX_TRIP_DAY_MEDIA} max` : "Add"}
              </Text>
            </Pressable>
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
};

const INPUT_BORDER = "rgba(255, 255, 255, 0.12)";
const INPUT_BG = "rgba(255, 255, 255, 0.04)";

const styles = StyleSheet.create({
  card: {
    padding: spacing.md,
    borderRadius: radiusTokens.lg,
    backgroundColor: "rgba(255, 255, 255, 0.03)",
    borderWidth: 1,
    borderColor: INPUT_BORDER,
    gap: spacing.xs,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.xs,
  },
  ordinalLabel: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: "700",
    color: textTokens.secondary,
    letterSpacing: 0.5,
  },
  headerActions: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  iconBtn: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radiusTokens.sm,
  },
  iconBtnDisabled: {
    opacity: 0.35,
  },
  fieldLabel: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: "600",
    color: textTokens.secondary,
    marginTop: spacing.xs,
  },
  titleInput: {
    height: 44,
    paddingHorizontal: 12,
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    backgroundColor: INPUT_BG,
    borderWidth: 1,
    borderColor: INPUT_BORDER,
    color: textTokens.primary,
    fontSize: typography.body.fontSize,
  },
  narrativeInput: {
    minHeight: 72,
    maxHeight: 140,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    backgroundColor: INPUT_BG,
    borderWidth: 1,
    borderColor: INPUT_BORDER,
    color: textTokens.primary,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
  },
  charCounter: {
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
    alignSelf: "flex-end",
  },
  // ORCH-1119 — gallery
  mediaSection: {
    marginTop: spacing.xs,
    gap: spacing.xs,
  },
  mediaRow: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingVertical: 2,
  },
  mediaTile: {
    width: 88,
    height: 88,
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    backgroundColor: TILE_BG,
  },
  mediaImage: {
    width: "100%",
    height: "100%",
    borderRadius: radiusTokens.md,
  },
  videoBadge: {
    position: "absolute",
    left: 4,
    bottom: 4,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  removeBtn: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.7)",
  },
  reorderBtn: {
    position: "absolute",
    top: 4,
    left: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.7)",
  },
  addTile: {
    width: 88,
    height: 88,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: accent.border,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    backgroundColor: "rgba(235, 120, 37, 0.06)",
  },
  addTileDisabled: {
    opacity: 0.4,
  },
  addTileLabel: {
    fontSize: typography.caption.fontSize,
    fontWeight: "600",
    color: accent.warm,
  },
});

export default TripDayEditor;
