import { supabase } from "./supabase";
import { useAppStore } from "../store/appStore";

export interface UserProfile {
  id: string;
  email: string;
  username?: string;
  display_name?: string;
  first_name?: string;
  last_name?: string;
  avatar_url?: string | null;
  bio?: string;
  location?: string;
  active?: boolean;
  show_activity?: boolean;
  visibility_mode?: "public" | "friends" | "private";
  photos?: string[];
  country?: string;
  currency?: string;
  measurement_system?: string;
  created_at: string;
  updated_at: string;
}

class AuthService {
  private appStore = useAppStore.getState();

  // signOut() intentionally removed — the sole sign-out path is
  // handleSignOut() in AppStateManager.tsx, which handles SDK cleanup
  // (OneSignal, RevenueCat, Mixpanel), AsyncStorage sweep, React Query
  // clear, and Supabase session revocation in one place. (ORCH-0004)

  async getCurrentUser() {
    try {
      // Add timeout to prevent hanging
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error("Auth timeout")), 5000);
      });

      const authPromise = supabase.auth.getUser();
      const {
        data: { user },
        error,
      } = (await Promise.race([authPromise, timeoutPromise])) as any;

      // Handle missing session gracefully - this is normal when user is not signed in
      if (error && error.message.includes("Auth session missing")) {
        return { user: null, error: null };
      }

      if (error) {
        console.error("Get current user error:", error);
        return { user: null, error };
      }

      if (user) {
        await this.loadUserProfile(user.id);
        this.appStore.setAuth(user as any);
      }

      return { user, error: null };
    } catch (error) {
      console.error("Get current user error:", error);
      return { user: null, error };
    }
  }

  async loadUserProfile(userId: string) {
    try {
      const { data: profile, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .single();

      if (error) {
        console.error("Error loading user profile:", error);
        return null;
      }

      this.appStore.setProfile(profile);
      return profile;
    } catch (error) {
      console.error("Error loading user profile:", error);
      return null;
    }
  }

  async createUserProfile(userId: string, profileData: Partial<UserProfile>) {
    try {
      const { data, error } = await supabase
        .from("profiles")
        .insert({
          id: userId,
          ...profileData,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error("Error creating user profile:", error);
      throw error;
    }
  }

  async updateUserProfile(userId: string, updates: Partial<UserProfile>) {
    try {
      console.log("🔄 Updating user profile...", { userId, updates });

      // Only update fields that are provided
      const updateData: any = { ...updates };
      
      // Always set updated_at (removed from here since trigger handles it, but we can add explicitly)
      if (!updateData.updated_at) {
        updateData.updated_at = new Date().toISOString();
      }

      const { data, error } = await supabase
        .from("profiles")
        .update(updateData)
        .eq("id", userId)
        .select()
        .single();

      if (error) {
        console.error("❌ Profile update error:", error);
        console.error("   Error details:", {
          message: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint,
        });
        throw error;
      }

      console.log("✅ Profile updated successfully");

      this.appStore.setProfile(data);
      return data;
    } catch (error: any) {
      console.error("❌ Error updating user profile:", error);
      console.error("   Full error object:", error);
      throw error;
    }
  }

  async uploadAvatar(userId: string, file: File) {
    try {
      const fileExt = file.name.split(".").pop();
      const fileName = `${userId}-${Date.now()}.${fileExt}`;
      const filePath = `avatars/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const {
        data: { publicUrl },
      } = supabase.storage.from("avatars").getPublicUrl(filePath);

      // Update profile with new avatar URL
      await this.updateUserProfile(userId, { avatar_url: publicUrl });

      return { url: publicUrl, error: null };
    } catch (error) {
      console.error("Error uploading avatar:", error);
      return { url: null, error };
    }
  }

  /**
   * Upload profile photo from React Native (using image URI)
   * @param userId - User ID
   * @param imageUri - Local file URI from image picker
   * @returns Public URL of uploaded image or null if error
   */
  async uploadProfilePhoto(
    userId: string,
    imageUri: string
  ): Promise<string | null> {
    try {
      // Extract file extension from URI or default to jpg
      const fileExt = imageUri.split(".").pop()?.toLowerCase() || "jpg";
      const fileName = `${userId}_${Date.now()}.${fileExt}`;
      const filePath = `avatars/${fileName}`;

      console.log("📸 Starting profile photo upload...", { userId, filePath });

      // Create FormData for React Native
      const formData = new FormData();
      formData.append("file", {
        uri: imageUri,
        type: `image/${
          fileExt === "jpg" || fileExt === "jpeg" ? "jpeg" : fileExt
        }`,
        name: fileName,
      } as any);

      // Upload to Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(filePath, formData, {
          contentType: `image/${
            fileExt === "jpg" || fileExt === "jpeg" ? "jpeg" : fileExt
          }`,
          upsert: false,
        });

      if (uploadError) {
        console.error("❌ Storage upload error:", uploadError);
        throw uploadError;
      }

      console.log("✅ File uploaded to storage successfully");

      // Get public URL
      const {
        data: { publicUrl },
      } = supabase.storage.from("avatars").getPublicUrl(filePath);

      console.log("📝 Public URL generated:", publicUrl);

      // Update profile with new avatar URL
      console.log("🔄 Updating profile with avatar_url...", { userId, avatarUrl: publicUrl });
      
      // First, try to update without select to isolate the issue
      const { error: updateError } = await supabase
        .from("profiles")
        .update({ 
          avatar_url: publicUrl,
          updated_at: new Date().toISOString()
        })
        .eq("id", userId);

      if (updateError) {
        console.error("❌ Profile update error:", updateError);
        console.error("   Update error details:", {
          message: updateError.message,
          code: updateError.code,
          details: updateError.details,
          hint: updateError.hint,
          userId,
          avatarUrl: publicUrl
        });
        throw updateError;
      }

      console.log("✅ Profile updated successfully with avatar_url");

      // Now fetch the updated profile separately
      const { data: updatedProfile, error: selectError } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .single();

      if (selectError) {
        console.warn("⚠️ Could not fetch updated profile:", selectError);
      } else if (updatedProfile) {
        console.log("✅ Fetched updated profile:", { updatedProfile });
        this.appStore.setProfile(updatedProfile);
      }

      return publicUrl;
    } catch (error: any) {
      console.error("❌ Error uploading profile photo:", error);
      console.error("   Error details:", {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
      });
      return null;
    }
  }

  async updateBio(userId: string, bio: string): Promise<void> {
    const { error } = await supabase
      .from("profiles")
      .update({ bio })
      .eq("id", userId);
    if (error) throw new Error(error.message);
    await this.loadUserProfile(userId);
  }

  // onAuthStateChange() intentionally removed — the sole auth state
  // listener is in useAuthSimple.ts (INV-A01: single auth instance). (ORCH-0004)
}

export const authService = new AuthService();
