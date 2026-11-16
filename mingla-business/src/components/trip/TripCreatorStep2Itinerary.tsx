/**
 * TripCreatorStep2Itinerary — Step 2 of TripCreatorWizard. Manages the
 * day-by-day itinerary list. Stacked cards via TripDayEditor + add-day +
 * reorder via swap-buttons.
 *
 * Tr2 (ORCH-0859). Per SPEC §4.8 Step 2.
 */

import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  radius as radiusTokens,
  color,
  space,
  type,
} from "../../constants/designSystem";
import { Icon } from "../ui/Icon";
import { TripDayEditor, type TripDayDraft } from "./TripDayEditor";
import { TripDayMediaSheet } from "./TripDayMediaSheet";
import { tripDayMediaKey } from "./tripDayTileModel";
import type { TripDayMedia } from "../../services/tripsService";
import { MAX_TRIP_DAY_MEDIA } from "../../services/tripDayMediaService";

export interface TripCreatorStep2ItineraryProps {
  days: TripDayDraft[];
  onChange: (days: TripDayDraft[]) => void;
  disabled?: boolean;
  // ORCH-1119 — when ALL of brandId/eventId/onShowToast are present, the per-day
  // media gallery (add/reorder/remove + picker sheet) is enabled. The public
  // buyer surfaces never author, so these stay optional.
  brandId?: string;
  eventId?: string;
  onShowToast?: (msg: string) => void;
  /**
   * ORCH-0876 — present when the operator is editing a published trip with
   * confirmed bookings. The server's refund-gate rejects day-count drops
   * with `days_dropped_with_sales`; the editor remains writable so authors
   * can re-word narratives (additive), and the parent surface owns the
   * pre-flight UX rejection.
   */
  editMode?: {
    totalConfirmedOrders: number;
  };
}

export const TripCreatorStep2Itinerary: React.FC<TripCreatorStep2ItineraryProps> = ({
  days,
  onChange,
  disabled,
  brandId,
  eventId,
  onShowToast,
}) => {
  // ORCH-1119 — index of the day whose media picker is open (null = closed).
  const [mediaSheetDayIndex, setMediaSheetDayIndex] = useState<number | null>(
    null,
  );
  const mediaEnabled =
    brandId !== undefined && eventId !== undefined && onShowToast !== undefined;

  const handleAddDay = (): void => {
    const nextOrdinal = days.length === 0 ? 1 : days[days.length - 1].ordinal + 1;
    onChange([...days, { ordinal: nextOrdinal, title: "", narrative: "", media: [] }]);
  };

  const handleDayChange = (index: number, patch: Partial<TripDayDraft>): void => {
    const next = [...days];
    next[index] = { ...next[index], ...patch };
    onChange(next);
  };

  // ORCH-1119 — media mutations on a specific day (immutable).
  // REWORK: takes the FULL batch of chosen media and appends them all in ONE
  // onChange. The sheet previously called this once per asset inside a tight
  // synchronous loop; because onChange rebuilds the day from the same
  // render-time `days`, every pick but the last was clobbered (multi-select
  // selections were silently lost). A single batched append is clobber-proof.
  // The cap is re-enforced here (slice to MAX_TRIP_DAY_MEDIA) as a backstop.
  const handleAddMediaToDay = (
    dayIndex: number,
    media: TripDayMedia[],
  ): void => {
    if (media.length === 0) return;
    const next = [...days];
    const current = next[dayIndex].media ?? [];
    const appended = [...current, ...media].slice(0, MAX_TRIP_DAY_MEDIA);
    next[dayIndex] = { ...next[dayIndex], media: appended };
    onChange(next);
  };
  const handleRemoveMediaFromDay = (
    dayIndex: number,
    mediaIndex: number,
  ): void => {
    const next = [...days];
    const current = next[dayIndex].media ?? [];
    next[dayIndex] = {
      ...next[dayIndex],
      media: current.filter((_, i) => i !== mediaIndex),
    };
    onChange(next);
  };
  const handleReorderMediaInDay = (
    dayIndex: number,
    from: number,
    to: number,
  ): void => {
    const next = [...days];
    const current = [...(next[dayIndex].media ?? [])];
    if (
      from < 0 ||
      to < 0 ||
      from >= current.length ||
      to >= current.length
    ) {
      return;
    }
    const [moved] = current.splice(from, 1);
    current.splice(to, 0, moved);
    next[dayIndex] = { ...next[dayIndex], media: current };
    onChange(next);
  };

  const handleDelete = (index: number): void => {
    const next = days.filter((_, i) => i !== index);
    // Re-number ordinals so they stay 1-based sequential
    onChange(next.map((d, i) => ({ ...d, ordinal: i + 1 })));
  };

  const handleSwap = (a: number, b: number): void => {
    if (a < 0 || b < 0 || a >= days.length || b >= days.length) return;
    const next = [...days];
    [next[a], next[b]] = [next[b], next[a]];
    onChange(next.map((d, i) => ({ ...d, ordinal: i + 1 })));
  };

  return (
    <View style={styles.host}>
      <Text style={styles.helper}>
        Add a card per day. Travelers see this on the public trip page.
      </Text>

      {days.length === 0 ? (
        <View style={styles.emptyState}>
          <Icon name="calendar" size={32} color={color.text3} />
          <Text style={styles.emptyText}>No days yet. Add your first day below.</Text>
        </View>
      ) : (
        <View style={styles.daysList}>
          {days.map((day, index) => (
            <TripDayEditor
              key={`day-${index}-${day.ordinal}`}
              day={day}
              index={index}
              total={days.length}
              onChange={(patch) => handleDayChange(index, patch)}
              onDelete={() => handleDelete(index)}
              onMoveUp={() => handleSwap(index, index - 1)}
              onMoveDown={() => handleSwap(index, index + 1)}
              disabled={disabled}
              testID={`trip-step2-day-${index}`}
              brandId={mediaEnabled ? brandId : undefined}
              eventId={mediaEnabled ? eventId : undefined}
              onAddMedia={
                mediaEnabled ? () => setMediaSheetDayIndex(index) : undefined
              }
              onRemoveMedia={
                mediaEnabled
                  ? (mi) => handleRemoveMediaFromDay(index, mi)
                  : undefined
              }
              onReorderMedia={
                mediaEnabled
                  ? (from, to) => handleReorderMediaInDay(index, from, to)
                  : undefined
              }
            />
          ))}
        </View>
      )}

      <Pressable
        onPress={handleAddDay}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel="Add a day"
        accessibilityState={{ disabled: disabled === true }}
        style={[styles.addBtn, disabled === true && styles.addBtnDisabled]}
        testID="trip-step2-add-day"
      >
        <Icon name="plus" size={16} color={color.accent} />
        <Text style={styles.addBtnText}>Add a day</Text>
      </Pressable>

      {/* ORCH-1119 — per-day media picker. Rendered as a JSX child of the parent
          host (I-SUB-SHEET-INSIDE-PARENT). One sheet instance keyed to the
          active day index; chosen media appends to that day's gallery. */}
      {mediaEnabled && mediaSheetDayIndex !== null ? (
        <TripDayMediaSheet
          visible
          onClose={() => setMediaSheetDayIndex(null)}
          brandId={brandId as string}
          eventId={eventId as string}
          currentCount={(days[mediaSheetDayIndex]?.media ?? []).length}
          onAddMedia={(media) => handleAddMediaToDay(mediaSheetDayIndex, media)}
          onShowToast={onShowToast as (msg: string) => void}
          // #3040 B-C12 — the day these items belong to: part of each video's
          // resume key, so the same file on the same day continues its upload.
          dayKey={tripDayMediaKey(days[mediaSheetDayIndex], mediaSheetDayIndex)}
        />
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    paddingTop: space[2],
    paddingBottom: space[6],
    gap: space[4],
  },
  helper: {
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
    color: color.text2,
  },
  emptyState: {
    padding: space[6],
    alignItems: "center",
    gap: space[2],
    borderRadius: radiusTokens.lg,
    backgroundColor: color.fill.tableHead,
    borderStyle: "dashed",
    borderWidth: 1,
    borderColor: color.line,
  },
  emptyText: {
    fontSize: type.small.fontSize,
    color: color.text2,
    textAlign: "center",
  },
  daysList: {
    gap: space[4],
  },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space[1],
    paddingVertical: space[4],
    borderRadius: radiusTokens.md,
    backgroundColor: color.accentTint,
    borderWidth: 1,
    borderColor: color.accentLine,
    borderStyle: "dashed",
  },
  addBtnDisabled: {
    opacity: 0.4,
  },
  addBtnText: {
    fontSize: type.small.fontSize,
    fontWeight: "600",
    color: color.accent,
  },
});

export default TripCreatorStep2Itinerary;
