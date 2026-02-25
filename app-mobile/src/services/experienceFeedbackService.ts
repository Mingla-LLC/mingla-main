import { supabase } from "./supabase";

export interface ExperienceFeedback {
  card_id: string;
  experience_title: string;
  rating: number;
  feedback_text?: string;
}

export const experienceFeedbackService = {
  /**
   * Submit feedback after scheduling an experience
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
};
