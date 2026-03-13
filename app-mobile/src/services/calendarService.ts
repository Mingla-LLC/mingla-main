import { supabase } from "./supabase";
import { userActivityService } from "./userActivityService";

export interface CalendarEntryRecord {
  id: string;
  user_id: string;
  card_id: string | null; // TEXT - can be UUID, Google Places ID, or any string identifier
  board_card_id: string | null;
  source: "solo" | "collaboration";
  card_data: any;
  status: "pending" | "confirmed" | "completed" | "cancelled";
  scheduled_at: string;
  duration_minutes?: number | null;
  purchase_option_id?: string | null;
  price_paid?: number | null;
  qr_code?: string | null;
  notes?: string | null;
  created_at: string;
  updated_at: string;
  archived_at?: string | null;
}

export class CalendarService {
  static async fetchUserCalendarEntries(userId: string): Promise<CalendarEntryRecord[]> {
    const { data, error } = await supabase
      .from("calendar_entries")
      .select("*")
      .eq("user_id", userId)
      .order("scheduled_at", { ascending: false });

    if (error) {
      console.error("Error fetching calendar entries:", error);
      throw error;
    }

    return (data as CalendarEntryRecord[]) || [];
  }

  static async addEntryFromSavedCard(
    userId: string,
    card: any,
    scheduledAtIso: string
  ): Promise<CalendarEntryRecord> {
    // Sanitize card_data: only allow known, serializable, display-relevant fields.
    // This prevents non-serializable values (Date objects, functions, React internals)
    // from being dumped into the JSONB column and causing INSERT failures.
    const allowedCardFields = [
      "id", "placeId", "title", "category", "categoryIcon", "description",
      "fullDescription", "image", "images", "rating", "reviewCount",
      "priceRange", "priceTier", "distance", "travelTime", "address",
      "openingHours", "phone", "website", "highlights", "tags",
      "matchScore", "location",
      "cardType", "tagline", "stops", "totalPriceMin", "totalPriceMax",
      "estimatedDurationMinutes", "experienceType", "pairingKey",
      "shoppingList", "strollData", "picnicData", "nightOutData",
      "tip", "sessionName",
    ];
    const sanitizedCardData: Record<string, unknown> = {};
    for (const key of allowedCardFields) {
      if (key in card && card[key] !== undefined) {
        sanitizedCardData[key] = card[key];
      }
    }

    const payload = {
      user_id: userId,
      card_id: card.id ?? null,
      board_card_id: card.source === "collaboration" && card.sessionId ? card.sessionId : null,
      source: (card.source as "solo" | "collaboration") || "solo",
      card_data: sanitizedCardData,
      status: "pending" as const,
      scheduled_at: scheduledAtIso,
    };

    if (__DEV__) {
      console.log("[CalendarService] INSERT payload:", {
        user_id: payload.user_id,
        card_id: payload.card_id,
        board_card_id: payload.board_card_id,
        source: payload.source,
        card_data_keys: Object.keys(sanitizedCardData),
        scheduled_at: payload.scheduled_at,
      });
    }

    const { data, error } = await supabase
      .from("calendar_entries")
      .insert(payload)
      .select("*")
      .single();

    if (error) {
      console.error("[CalendarService] INSERT failed:", {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      });
      throw error;
    }

    await userActivityService.recordActivity(userId, {
      activity_type: "scheduled_card",
      title: card.title || "Saved experience",
      tag: "Scheduled",
      reference_id: card.id ?? null,
      reference_type: "experience",
      metadata: { scheduled_at: scheduledAtIso },
    });

    // Increment engagement counters (fire-and-forget)
    supabase.rpc('increment_user_engagement', {
      p_user_id: userId,
      p_field: 'total_cards_scheduled',
      p_amount: 1,
    }).catch(() => {});

    // Increment place-level schedules counter
    const placeId = card.placeId || card.id;
    if (placeId) {
      supabase.rpc('increment_place_engagement', {
        p_google_place_id: placeId,
        p_field: 'total_schedules',
        p_amount: 1,
      }).catch(() => {});
    }

    return data as CalendarEntryRecord;
  }

  static async updateEntry(
    entryId: string,
    userId: string,
    updates: {
      scheduled_at?: string;
      status?: "pending" | "confirmed" | "completed" | "cancelled";
      duration_minutes?: number;
      notes?: string;
    }
  ): Promise<CalendarEntryRecord> {
    const { data, error } = await supabase
      .from("calendar_entries")
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq("id", entryId)
      .eq("user_id", userId) // Ensure user can only update their own entries
      .select("*")
      .single();

    if (error) {
      console.error("Error updating calendar entry:", error);
      throw error;
    }

    return data as CalendarEntryRecord;
  }

  static async deleteEntry(entryId: string, userId: string): Promise<boolean> {
    const { error } = await supabase
      .from("calendar_entries")
      .delete()
      .eq("id", entryId)
      .eq("user_id", userId); // Ensure user can only delete their own entries

    if (error) {
      console.error("Error deleting calendar entry:", error);
      throw error;
    }

    return true;
  }
}


