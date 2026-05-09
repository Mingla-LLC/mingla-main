import type {
  EditableLiveEventFields,
  LiveEvent,
  UpdateLiveEventRejection,
} from "../store/liveEventStore";
import type { SoldCountContext } from "../store/orderStoreHelpers";
import { computeDroppedDates } from "./scheduleDateExpansion";

export type LiveEventFieldValidationResult =
  | { ok: true; trimmedReason: string }
  | {
      ok: false;
      reason: UpdateLiveEventRejection;
      tierIds?: string[];
      droppedDates?: string[];
      affectedOrderCount?: number;
      details?: string;
    };

export const validateLiveEventFieldUpdate = (
  event: LiveEvent | null,
  patch: Partial<EditableLiveEventFields>,
  context: SoldCountContext,
  reason: string,
): LiveEventFieldValidationResult => {
  const trimmedReason = reason.trim();
  if (trimmedReason.length === 0) {
    return { ok: false, reason: "missing_edit_reason" };
  }
  if (trimmedReason.length < 10 || trimmedReason.length > 200) {
    return { ok: false, reason: "invalid_edit_reason" };
  }
  if (event === null) {
    return { ok: false, reason: "event_not_found" };
  }

  const { soldCountByTier, soldCountForEvent } = context;
  const beforeSchedule = {
    whenMode: event.whenMode,
    date: event.date,
    recurrenceRule: event.recurrenceRule,
    multiDates: event.multiDates,
  };
  const afterSchedule = {
    whenMode: patch.whenMode ?? event.whenMode,
    date: patch.date !== undefined ? patch.date : event.date,
    recurrenceRule:
      patch.recurrenceRule !== undefined
        ? patch.recurrenceRule
        : event.recurrenceRule,
    multiDates: patch.multiDates !== undefined ? patch.multiDates : event.multiDates,
  };
  const droppedDates = computeDroppedDates(beforeSchedule, afterSchedule);

  if (droppedDates.length > 0 && soldCountForEvent > 0) {
    if (afterSchedule.whenMode !== beforeSchedule.whenMode) {
      return {
        ok: false,
        reason: "when_mode_drops_active_date",
        droppedDates,
        affectedOrderCount: soldCountForEvent,
      };
    }
    if (
      JSON.stringify(afterSchedule.recurrenceRule) !==
      JSON.stringify(beforeSchedule.recurrenceRule)
    ) {
      return {
        ok: false,
        reason: "recurrence_drops_occurrence",
        droppedDates,
        affectedOrderCount: soldCountForEvent,
      };
    }
    return {
      ok: false,
      reason: "multi_date_remove_with_sales",
      droppedDates,
      affectedOrderCount: soldCountForEvent,
    };
  }

  if (patch.tickets !== undefined) {
    const oldById = new Map(event.tickets.map((t) => [t.id, t]));
    const newIds = new Set(patch.tickets.map((t) => t.id));

    for (const oldT of event.tickets) {
      const sold = soldCountByTier[oldT.id] ?? 0;
      if (!newIds.has(oldT.id) && sold > 0) {
        return {
          ok: false,
          reason: "tier_delete_with_sales",
          tierIds: [oldT.id],
          affectedOrderCount: sold,
        };
      }
    }

    for (const newT of patch.tickets) {
      const oldT = oldById.get(newT.id);
      if (oldT === undefined) continue;
      const sold = soldCountByTier[newT.id] ?? 0;
      if (sold === 0) continue;

      if (newT.capacity !== null && newT.capacity < sold) {
        return {
          ok: false,
          reason: "capacity_below_sold",
          tierIds: [newT.id],
          affectedOrderCount: sold,
        };
      }
      if (newT.priceGbp !== oldT.priceGbp) {
        return {
          ok: false,
          reason: "tier_price_change_with_sales",
          tierIds: [newT.id],
          affectedOrderCount: sold,
        };
      }
      if (newT.isFree !== oldT.isFree) {
        return {
          ok: false,
          reason: "tier_free_toggle_with_sales",
          tierIds: [newT.id],
          affectedOrderCount: sold,
        };
      }
    }
  }

  return { ok: true, trimmedReason };
};
