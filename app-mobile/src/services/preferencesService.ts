import { supabase } from "./supabase";

export interface UserPreferences {
  mode: string;
  budget_min: number;
  budget_max: number;
  people_count: number;
  categories: string[];
  intents?: string[];
  travel_mode: string;
  travel_constraint_type: string;
  travel_constraint_value: number;
  datetime_pref: string;
  date_option?: string | null;
  time_slot?: string | null;
  exact_time?: string | null;
}

export interface ProfileData {
  id: string;
  email?: string;
  display_name?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
  currency: string;
  measurement_system: string;
  share_location: boolean;
  share_budget: boolean;
  share_categories: boolean;
  share_date_time: boolean;
  created_at: string;
}

export class PreferencesService {
  /**
   * Get user preferences
   */
  static async getUserPreferences(
    userId: string
  ): Promise<UserPreferences | null> {
    try {
      const { data, error } = await supabase
        .from("preferences")
        .select("*")
        .eq("profile_id", userId)
        .maybeSingle();

      if (error) {
        console.error("Error fetching user preferences:", error);
        return null;
      }

      return data;
    } catch (error) {
      console.error("Failed to fetch user preferences:", error);
      return null;
    }
  }

  /**
   * Update user preferences
   */
  static async updateUserPreferences(
    userId: string,
    preferences: Partial<UserPreferences>
  ): Promise<boolean> {
    const SERVICE_TIMEOUT_MS = 12000;

    try {
      const payload = {
        profile_id: userId,
        ...preferences,
        updated_at: new Date().toISOString(),
      };

      const upsertPromise = supabase.from("preferences").upsert(payload);

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error('Preferences save timed out after 12s')),
          SERVICE_TIMEOUT_MS
        );
      });

      const result = await Promise.race([upsertPromise, timeoutPromise]);
      const { error } = result as { data: any; error: any };

      if (error) {
        throw error;
      }

      return true;
    } catch (error) {
      console.error("[PreferencesService] updateUserPreferences failed:", error);
      return false;
    }
  }

  /**
   * Get user profile
   */
  static async getUserProfile(userId: string): Promise<ProfileData | null> {
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .single();

      if (error) {
        console.error("Error fetching user profile:", error);
        return null;
      }

      return data;
    } catch (error) {
      console.error("Failed to fetch user profile:", error);
      return null;
    }
  }

  /**
   * Update user profile
   */
  static async updateUserProfile(
    userId: string,
    profileData: Partial<ProfileData>
  ): Promise<boolean> {
    try {
      const { error } = await supabase
        .from("profiles")
        .update(profileData)
        .eq("id", userId);

      if (error) {
        console.error("Error updating user profile:", error);
        throw error;
      }
      return true;
    } catch (error) {
      console.log("error", error);
      console.error("Failed to update user profile:", error);
      return false;
    }
  }

  /**
   * Create default preferences for new user
   */
  static async createDefaultPreferences(userId: string): Promise<boolean> {
    try {
      const defaultPreferences: UserPreferences = {
        mode: "explore",
        budget_min: 0,
        budget_max: 1000,
        people_count: 1,
        categories: ["Nature", "Casual Eats", "Drink"],
        travel_mode: "walking",
        travel_constraint_type: "time",
        travel_constraint_value: 30,
        datetime_pref: new Date().toISOString(),
      };

      const { error } = await supabase.from("preferences").insert({
        profile_id: userId,
        ...defaultPreferences,
      });

      if (error) {
        console.error("Error creating default preferences:", error);
        throw error;
      }

      return true;
    } catch (error) {
      console.error("Failed to create default preferences:", error);
      return false;
    }
  }

  /**
   * Get user's saved experiences
   */
  static async getSavedExperiences(userId: string): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .from("saves")
        .select(
          `
          experience_id,
          status,
          scheduled_at,
          created_at,
          experiences (*)
        `
        )
        .eq("profile_id", userId)
        .eq("status", "liked")
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Error fetching saved experiences:", error);
        throw error;
      }

      return (
        data?.map((item) => ({
          ...item.experiences,
          saved_at: item.created_at,
          scheduled_at: item.scheduled_at,
        })) || []
      );
    } catch (error) {
      console.error("Failed to fetch saved experiences:", error);
      return [];
    }
  }

  /**
   * Get user's interaction history
   */
  static async getUserInteractions(
    userId: string,
    limit: number = 50
  ): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .from("user_interactions")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) {
        console.error("Error fetching user interactions:", error);
        throw error;
      }

      return data || [];
    } catch (error) {
      console.error("Failed to fetch user interactions:", error);
      return [];
    }
  }

  /**
   * Get user's learned preferences
   */
  static async getLearnedPreferences(userId: string): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .from("user_preference_learning")
        .select("*")
        .eq("user_id", userId)
        .order("confidence", { ascending: false });

      if (error) {
        console.error("Error fetching learned preferences:", error);
        throw error;
      }

      return data || [];
    } catch (error) {
      console.error("Failed to fetch learned preferences:", error);
      return [];
    }
  }

  /**
   * Get user's location history
   */
  static async getLocationHistory(
    userId: string,
    limit: number = 100
  ): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .from("user_location_history")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) {
        console.error("Error fetching location history:", error);
        throw error;
      }

      return data || [];
    } catch (error) {
      console.error("Failed to fetch location history:", error);
      return [];
    }
  }

  /**
   * Update user's location
   */
  static async updateUserLocation(
    userId: string,
    latitude: number,
    longitude: number,
    accuracy?: number,
    locationType:
      | "current"
      | "home"
      | "work"
      | "frequent"
      | "visited_place" = "current"
  ): Promise<boolean> {
    try {
      const { error } = await supabase.from("user_location_history").insert({
        user_id: userId,
        latitude,
        longitude,
        accuracy,
        location_type: locationType,
      });

      if (error) {
        console.error("Error updating user location:", error);
        throw error;
      }

      return true;
    } catch (error) {
      console.error("Failed to update user location:", error);
      return false;
    }
  }

  /**
   * Get user's frequent locations
   */
  static async getFrequentLocations(
    userId: string,
    limit: number = 5
  ): Promise<any[]> {
    try {
      const { data, error } = await supabase.rpc(
        "get_user_frequent_locations",
        {
          user_uuid: userId,
          limit_count: limit,
        }
      );

      if (error) {
        console.error("Error fetching frequent locations:", error);
        throw error;
      }

      return data || [];
    } catch (error) {
      console.error("Failed to fetch frequent locations:", error);
      return [];
    }
  }
}
