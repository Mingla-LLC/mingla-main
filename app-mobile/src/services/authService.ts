import { supabase } from "./supabase";
import { useAppStore } from "../store/appStore";

export interface UserProfile {
  id: string;
  email: string;
  username?: string;
  display_name?: string;
  first_name?: string;
  last_name?: string;
  avatar_url?: string;
  bio?: string;
  location?: string;
  active?: boolean;
  created_at: string;
  updated_at: string;
}

class AuthService {
  private appStore = useAppStore.getState();

  async signIn(email: string, password: string) {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;

      if (data.user) {
        await this.loadUserProfile(data.user.id);
        this.appStore.setAuth(data.user as any);
      }

      return { user: data.user, error: null };
    } catch (error) {
      console.error("Sign in error:", error);
      return { user: null, error };
    }
  }

  async signUp(
    email: string,
    password: string,
    userData?: Partial<UserProfile>
  ) {
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: userData,
        },
      });

      if (error) throw error;

      if (data.user) {
        // Create user profile
        await this.createUserProfile(data.user.id, {
          email: data.user.email!,
          ...userData,
        });

        await this.loadUserProfile(data.user.id);
        this.appStore.setAuth(data.user as any);
      }

      return { user: data.user, error: null };
    } catch (error) {
      console.error("Sign up error:", error);
      return { user: null, error };
    }
  }

  async signOut() {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;

      // Clear all user data including session state
      this.appStore.clearUserData();

      // Clear any AsyncStorage session data (for safety)
      try {
        const AsyncStorage = (
          await import("@react-native-async-storage/async-storage")
        ).default;
        await AsyncStorage.removeItem("mingla_active_session");
        await AsyncStorage.removeItem("mingla_current_mode");
      } catch (storageError) {
        console.warn("Error clearing AsyncStorage on sign out:", storageError);
      }

      return { error: null };
    } catch (error) {
      console.error("Sign out error:", error);
      return { error };
    }
  }

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
      const { data, error } = await supabase
        .from("profiles")
        .update({
          ...updates,
          updated_at: new Date().toISOString(),
        })
        .eq("id", userId)
        .select()
        .single();

      if (error) throw error;

      this.appStore.setProfile(data);
      return data;
    } catch (error) {
      console.error("Error updating user profile:", error);
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
        console.error("Error uploading profile photo:", uploadError);
        throw uploadError;
      }

      // Get public URL
      const {
        data: { publicUrl },
      } = supabase.storage.from("avatars").getPublicUrl(filePath);

      // Update profile with new avatar URL
      await this.updateUserProfile(userId, { avatar_url: publicUrl });

      return publicUrl;
    } catch (error) {
      console.error("Error uploading profile photo:", error);
      return null;
    }
  }

  // Listen for auth state changes
  onAuthStateChange(callback: (user: any) => void) {
    return supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session?.user) {
        this.loadUserProfile(session.user.id);
        this.appStore.setAuth(session.user as any);
        callback(session.user);
      } else if (event === "SIGNED_OUT") {
        this.appStore.clearUserData();
        callback(null);
      }
    });
  }
}

export const authService = new AuthService();
