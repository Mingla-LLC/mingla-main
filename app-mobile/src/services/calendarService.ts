import { supabase } from "./supabase";

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
    const payload = {
      user_id: userId,
      card_id: card.id ?? null,
      board_card_id: card.source === "collaboration" && card.sessionId ? card.sessionId : null,
      source: (card.source as "solo" | "collaboration") || "solo",
      card_data: {
        ...card,
      },
      status: "pending" as const,
      scheduled_at: scheduledAtIso,
    };

    const { data, error } = await supabase
      .from("calendar_entries")
      .insert(payload)
      .select("*")
      .single();

    if (error) {
      console.error("Error inserting calendar entry:", error);
      throw error;
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


