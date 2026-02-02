import { supabase } from "./supabase";

export type ActivityType = "saved_card" | "scheduled_card" | "joined_board";
export type ReferenceType = "experience" | "board";

export interface UserActivityRecord {
  id: string;
  user_id: string;
  activity_type: ActivityType;
  title: string;
  tag: string | null;
  reference_id: string | null;
  reference_type: ReferenceType | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface RecordActivityParams {
  activity_type: ActivityType;
  title: string;
  tag?: string | null;
  reference_id?: string | null;
  reference_type?: ReferenceType | null;
  metadata?: Record<string, unknown>;
}

export const userActivityService = {
  async recordActivity(
    userId: string,
    params: RecordActivityParams
  ): Promise<UserActivityRecord | null> {
    try {
      const { error, data } = await supabase
        .from("user_activity")
        .insert({
          user_id: userId,
          activity_type: params.activity_type,
          title: params.title || "Activity",
          tag: params.tag ?? null,
          reference_id: params.reference_id ?? null,
          reference_type: params.reference_type ?? null,
          metadata: params.metadata ?? {},
        })
        .select("*")
        .single();

      if (error) {
        console.error("Error recording user activity:", error);
        return null;
      }
      return data as UserActivityRecord;
    } catch (e) {
      console.error("Error recording user activity:", e);
      return null;
    }
  },

  async fetchRecentActivity(
    userId: string,
    limit: number = 20
  ): Promise<UserActivityRecord[]> {
    const { data, error } = await supabase
      .from("user_activity")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      console.error("Error fetching recent activity:", error);
      return [];
    }
    return (data as UserActivityRecord[]) || [];
  },
};
