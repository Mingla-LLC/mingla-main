import { supabase } from "./supabase";

export interface ExperienceFeedback {
  card_id: string;
  experience_title: string;
  rating: number;
  feedback_text?: string;
  did_not_attend?: boolean;
}

export const experienceFeedbackService = {
  /**
   * Submit feedback after an experience
   */
  async submitFeedback(
    userId: string,
    feedback: ExperienceFeedback,
  ): Promise<void> {
    const { error } = await supabase.from("experience_feedback").insert({
      user_id: userId,
      card_id: feedback.card_id,
      experience_title: feedback.experience_title,
      rating: feedback.rating,
      feedback_text: feedback.feedback_text || null,
      did_not_attend: feedback.did_not_attend || false,
    });

    if (error) {
      console.error("Error submitting experience feedback:", error);
      throw error;
    }
  },

  /**
   * Get feedback for a specific card
   */
  async getFeedbackForCard(
    userId: string,
    cardId: string,
  ) {
    const { data, error } = await supabase
      .from("experience_feedback")
      .select("*")
      .eq("user_id", userId)
      .eq("card_id", cardId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== "PGRST116") {
      console.error("Error fetching experience feedback:", error);
      throw error;
    }

    return data;
  },

  /**
   * Get calendar entries whose scheduled_at is in the past and haven't been reviewed yet.
   * Used to prompt the user for a review when they return to the app.
   */
  async getPendingReviewEntries(userId: string) {
    const now = new Date().toISOString();

    // Fetch calendar entries that are scheduled in the past
    const { data: entries, error: entryErr } = await supabase
      .from("calendar_entries")
      .select("id, card_id, card_data, scheduled_at, status")
      .eq("user_id", userId)
      .in("status", ["pending", "confirmed"])
      .lt("scheduled_at", now)
      .is("archived_at", null)
      .is("feedback_status", null)
      .order("scheduled_at", { ascending: false })
      .limit(10);

    if (entryErr || !entries || entries.length === 0) return [];

    // Check which ones already have feedback
    const cardIds = entries
      .map((e: any) => e.card_id)
      .filter(Boolean) as string[];

    if (cardIds.length === 0) return [];

    const { data: existingFeedback } = await supabase
      .from("experience_feedback")
      .select("card_id")
      .eq("user_id", userId)
      .in("card_id", cardIds);

    const reviewedCardIds = new Set(
      (existingFeedback || []).map((f: any) => f.card_id),
    );

    return entries.filter(
      (e: any) => e.card_id && !reviewedCardIds.has(e.card_id),
    );
  },
};
