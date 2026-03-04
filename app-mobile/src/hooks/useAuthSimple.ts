import { useState, useEffect } from "react";
import { Alert, Platform } from "react-native";
import Constants from "expo-constants";
import {
  GoogleSignin,
  statusCodes,
} from "@react-native-google-signin/google-signin";
import * as AppleAuthentication from "expo-apple-authentication";
import { supabase } from "../services/supabase";
import { useAppStore } from "../store/appStore";
import { User } from "../types";

// Configure Google Sign-In
const webClientId =
  Constants.expoConfig?.extra?.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ||
  Constants.expoConfig?.extra?.googleWebClientId ||
  process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;

const iosClientId =
  Constants.expoConfig?.extra?.IOS_CLIENT_ID ||
  process.env.EXPO_PUBLIC_IOS_CLIENT_ID;

if (webClientId) {
  GoogleSignin.configure({
    webClientId,
    iosClientId: Platform.OS === "ios" ? iosClientId : undefined,
    offlineAccess: true,
    forceCodeForRefreshToken: true,
  });
} else {
  console.warn(
    "EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID is not set. Google Sign-In may not work."
  );
}

export const useAuthSimple = () => {
  const [loading, setLoading] = useState(true);
  const { user, setAuth, setProfile, clearUserData } = useAppStore();

  // Add timeout to prevent infinite loading
  useEffect(() => {
    const timer = setTimeout(() => {
      setLoading(false);
    }, 8000); // 8 second timeout

    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    let mounted = true;

    const initializeAuth = async () => {
      try {
        // Get initial session
        const {
          data: { session },
          error,
        } = await supabase.auth.getSession();

        if (error) {
          console.error("Error getting session:", error);
          if (mounted) setLoading(false);
          return;
        }

        if (session?.user) {
          setAuth(session.user as User);

          // Load profile
          try {
            const { data: profile, error: profileError } = await supabase
              .from("profiles")
              .select("*")
              .eq("id", session.user.id)
              .single();

            if (profileError) {
              console.error("Error loading profile:", profileError);
              console.error("Profile error details:", {
                code: profileError.code,
                message: profileError.message,
                details: profileError.details,
                hint: profileError.hint,
              });

              // If profile doesn't exist (PGRST116), check if user actually exists
              // User might have been deleted from Supabase but session still cached
              if (profileError.code === "PGRST116") {
                // Validate that user actually exists by trying to get user info
                const {
                  data: { user: authUser },
                  error: userError,
                } = await supabase.auth.getUser();

                if (userError || !authUser || authUser.id !== session.user.id) {
                  // User was deleted or session is invalid - sign out and clear
                  await supabase.auth.signOut();
                  setAuth(null);
                  clearUserData();
                  if (mounted) setLoading(false);
                  return;
                }

                // User exists but profile doesn't - create one
                try {
                  const emailName = session.user.email?.split("@")[0] || "User";
                  const { data: newProfile, error: createError } =
                    await supabase
                      .from("profiles")
                      .insert({
                        id: session.user.id,
                        email: session.user.email,
                        display_name: emailName,
                        first_name: emailName,
                        last_name: "",
                        username: emailName,
                        profile_image: null,
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString(),
                      })
                      .select()
                      .single();

                  if (createError) {
                    console.error("Error creating profile:", createError);
                  } else {
                    setProfile(newProfile);
                  }
                } catch (createError) {
                  console.error("Error creating profile:", createError);
                }
              }
            } else if (profile) {
              setProfile(profile);
            }
          } catch (profileError) {
            console.error("Error loading profile:", profileError);
          }
        } else {
          setAuth(null);
        }

        if (mounted) {
          setLoading(false);
        }
      } catch (error) {
        console.error("Auth initialization error:", error);
        if (mounted) {
          setLoading(false);
        }
      }
    };

    initializeAuth();

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session?.user) {
        setAuth(session.user as User);

        // Load profile
        try {
          const { data: profile, error: profileError } = await supabase
            .from("profiles")
            .select("*")
            .eq("id", session.user.id)
            .single();

          if (profileError) {
            console.error("Error loading profile:", profileError);

            // If profile not found, validate user still exists
            if (profileError.code === "PGRST116") {
              const {
                data: { user: authUser },
                error: userError,
              } = await supabase.auth.getUser();

              if (userError || !authUser || authUser.id !== session.user.id) {
                await supabase.auth.signOut();
                setAuth(null);
                clearUserData();
              }
            }
          } else if (profile) {
            setProfile(profile);
          }
        } catch (profileError) {
          console.error("Error loading profile:", profileError);
        }
      } else {
        setAuth(null);
        clearUserData();
      }

      if (mounted) {
        setLoading(false);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        Alert.alert(
          "Sign Out Error",
          error.message || "Failed to sign out. Please try again."
        );
        throw error;
      }
      return { error: null };
    } catch (error: any) {
      return { error };
    }
  };

  const updateProfile = async (updates: Partial<User>) => {
    if (!user) {
      Alert.alert("Error", "You must be logged in to update your profile.");
      return { error: new Error("No user logged in") };
    }

    try {
      const { data, error } = await supabase
        .from("profiles")
        .update(updates)
        .eq("id", user.id)
        .select()
        .single();

      if (error) {
        Alert.alert(
          "Update Failed",
          error.message || "Failed to update profile. Please try again."
        );
        throw error;
      }

      if (data) {
        setProfile(data);
      }

      return { data, error: null };
    } catch (error: any) {
      return { data: null, error };
    }
  };

  const signInWithGoogle = async () => {
    try {
      // Check if Google Sign-In is configured
      const webClientId =
        Constants.expoConfig?.extra?.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ||
        Constants.expoConfig?.extra?.googleWebClientId ||
        process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;

      console.log("signInWithGoogle - Web Client ID:", webClientId);

      if (!webClientId) {
        Alert.alert(
          "Configuration Error",
          "Google Sign-In is not configured. Please set EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID in your environment variables."
        );
        return {
          data: null,
          error: { message: "Google Sign-In not configured" },
        };
      }

      // Check if Google Play Services are available (Android only)
      if (Platform.OS === "android") {
        await GoogleSignin.hasPlayServices({
          showPlayServicesUpdateDialog: true,
        });
      }

      // Check if there's a previous Google sign-in and sign out to force account picker
      const hasPreviousSignIn = await GoogleSignin.hasPreviousSignIn();
      if (hasPreviousSignIn) {
        // Sign out from Google (not from your app) to force account picker on next sign-in
        await GoogleSignin.signOut();
      }

      // Sign in with Google - this will now show the account picker
      const googleUser = await GoogleSignin.signIn();

      // Get the ID token from the current user
      const tokens = await GoogleSignin.getTokens();

      if (!tokens.idToken) {
        throw new Error("Failed to get ID token from Google");
      }

      // Get user email from Google user data
      // The structure might be googleUser.data.user.email or googleUser.user.email
      let googleEmail: string | undefined;
      try {
        if (googleUser?.data?.user?.email) {
          googleEmail = googleUser.data.user.email.toLowerCase().trim();
        } else if (googleUser?.user?.email) {
          googleEmail = googleUser.user.email.toLowerCase().trim();
        }
      } catch (e) {
        console.warn(
          "Could not extract email from Google sign-in response:",
          e
        );
      }

      // If we couldn't get email from the response, we'll check after Supabase sign-in

      // Check if user with this email already exists in profiles
      let existingUser = null;
      if (googleEmail) {
        const { data: existingProfile } = await supabase
          .from("profiles")
          .select("id, email")
          .ilike("email", googleEmail)
          .maybeSingle();

        if (existingProfile) {
          existingUser = existingProfile;
        }
      }

      // Sign in to Supabase with the ID token
      // Supabase should automatically sign in existing users if email matches
      let { data, error } = await supabase.auth.signInWithIdToken({
        provider: "google",
        token: tokens.idToken,
      });

      // Handle case where user already exists
      let isExistingUserError = false;
      if (error) {
        // Check if error is related to user already existing
        isExistingUserError =
          error.message?.includes("already registered") ||
          error.message?.includes("already exists") ||
          error.message?.includes("Database error saving new user") ||
          error.message?.includes("duplicate key") ||
          error.message?.includes("violates") ||
          (existingUser && error.message?.includes("user"));

        if (isExistingUserError) {
          console.log("User already exists, checking for session...");

          // Wait a bit for Supabase to process the sign-in
          // Sometimes the session is created even if there's a database error
          // Try multiple times with increasing delays
          let sessionFound = false;
          for (let attempt = 0; attempt < 3; attempt++) {
            await new Promise((resolve) =>
              setTimeout(resolve, 500 * (attempt + 1))
            );

            const { data: sessionData } = await supabase.auth.getSession();

            if (sessionData?.session && sessionData.session.user) {
              // Session was created successfully, ignore the error
              data = {
                session: sessionData.session,
                user: sessionData.session.user,
              };
              error = null;
              sessionFound = true;
              console.log("Successfully signed in existing user via Google");
              break;
            }
          }

          if (!sessionFound) {
            // No session found after waiting
            // The user exists but Supabase didn't create a session
            // This might mean the Google provider isn't linked to their account
            // For now, let's try one more time with the OAuth flow
            console.log("No session found, retrying OAuth sign-in...");

            const retryResult = await supabase.auth.signInWithIdToken({
              provider: "google",
              token: tokens.idToken,
            });

            if (!retryResult.error && retryResult.data?.session) {
              // Success on retry
              data = retryResult.data;
              error = null;
              console.log("Successfully signed in existing user on retry");
            } else {
              // Still no session - Supabase might need account linking
              // But the user should be able to sign in, so let's check one more time
              await new Promise((resolve) => setTimeout(resolve, 1000));
              const { data: finalSessionData } =
                await supabase.auth.getSession();

              if (finalSessionData?.session && finalSessionData.session.user) {
                data = {
                  session: finalSessionData.session,
                  user: finalSessionData.session.user,
                };
                error = null;
                console.log("Session found on final check");
              } else {
                // No session - the account needs to be linked
                // But instead of throwing an error, let's proceed and see if Supabase handles it
                console.warn(
                  "Could not create session for existing user, but continuing..."
                );
                // Don't throw error - let the flow continue
                // The error might be from the trigger, but Supabase might handle it
              }
            }
          }
        } else {
          // Some other error occurred
          throw error;
        }
      }

      // If we still don't have a session after all retries, check one more time
      if (!data?.session) {
        // Final check for session
        const { data: finalCheck } = await supabase.auth.getSession();
        if (finalCheck?.session) {
          data = { session: finalCheck.session, user: finalCheck.session.user };
          error = null;
        } else if (error && isExistingUserError) {
          // User exists but no session - this shouldn't happen, but if it does,
          // we need to inform the user
          throw new Error(
            "Unable to sign in with Google. An account with this email already exists. " +
              "Please sign in with your email and password, then link Google in settings."
          );
        } else if (error) {
          // Some other error
          throw error;
        } else {
          throw new Error("Failed to create session");
        }
      }

      // Load profile after successful sign-in
      if (data.session.user) {
        await new Promise((r) => setTimeout(r, 500));
        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", data.session.user.id)
          .single();

        if (!profileError && profile) {
          setProfile(profile);
        }
      }

      return { data: data.session, error: null };
    } catch (error: any) {
      /*   console.error("Google sign-in error:", error); */

      // Handle specific error cases
      if (error.code === statusCodes.SIGN_IN_CANCELLED) {
        return { data: null, error: { message: "Sign-in cancelled" } };
      } else if (error.code === statusCodes.IN_PROGRESS) {
        return {
          data: null,
          error: { message: "Sign-in already in progress" },
        };
      } else if (error.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        Alert.alert(
          "Google Play Services Required",
          "Google Play Services is not available. Please install it from the Play Store."
        );
        return {
          data: null,
          error: { message: "Google Play Services not available" },
        };
      }

      Alert.alert(
        "Google Sign-In Failed",
        error.message || "Unable to sign in with Google. Please try again."
      );
      return { data: null, error };
    }
  };

  const signInWithApple = async () => {
    try {
      // Check if Apple Authentication is available (iOS 13+)
      if (Platform.OS !== "ios") {
        Alert.alert(
          "Not Available",
          "Apple Sign-In is only available on iOS devices."
        );
        return {
          data: null,
          error: { message: "Apple Sign-In only available on iOS" },
        };
      }

      const isAvailable = await AppleAuthentication.isAvailableAsync();
      if (!isAvailable) {
        Alert.alert(
          "Not Available",
          "Apple Sign-In is not available on this device. Please use iOS 13 or later."
        );
        return {
          data: null,
          error: { message: "Apple Sign-In not available" },
        };
      }

      // Request Apple authentication
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });

      if (!credential.identityToken) {
        throw new Error("Failed to get identity token from Apple");
      }

      // Sign in to Supabase with the identity token
      const { data, error } = await supabase.auth.signInWithIdToken({
        provider: "apple",
        token: credential.identityToken,
      });

      if (error) {
        throw error;
      }

      if (!data.session) {
        throw new Error("Failed to create session");
      }

      // Load profile after successful sign-in
      if (data.session.user) {
        await new Promise((r) => setTimeout(r, 500));
        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", data.session.user.id)
          .single();

        if (!profileError && profile) {
          // Update profile with Apple user info if available (first time only)
          const updates: Record<string, string> = {};

          // Apple only provides name/email on first sign-in
          if (credential.fullName) {
            if (credential.fullName.givenName && !profile.first_name) {
              updates.first_name = credential.fullName.givenName;
            }
            if (credential.fullName.familyName && !profile.last_name) {
              updates.last_name = credential.fullName.familyName;
            }
            if (
              credential.fullName.givenName &&
              credential.fullName.familyName &&
              !profile.display_name
            ) {
              updates.display_name = `${credential.fullName.givenName} ${credential.fullName.familyName}`;
            }
          }

          if (Object.keys(updates).length > 0) {
            const { error: updateError } = await supabase
              .from("profiles")
              .update(updates)
              .eq("id", profile.id);

            if (!updateError) {
              // Reload profile with updated info
              const { data: updatedProfile } = await supabase
                .from("profiles")
                .select("*")
                .eq("id", profile.id)
                .single();

              if (updatedProfile) {
                setProfile(updatedProfile);
              }
            } else {
              console.error("Error updating profile:", updateError);
              setProfile(profile);
            }
          } else {
            setProfile(profile);
          }
        }
      }

      return { data: data.session, error: null };
    } catch (error: any) {
      console.error("Apple sign-in error:", error);

      // Handle specific error cases
      if (error.code === "ERR_REQUEST_CANCELED") {
        return { data: null, error: { message: "Sign-in cancelled" } };
      }

      Alert.alert(
        "Apple Sign-In Failed",
        error.message || "Unable to sign in with Apple. Please try again."
      );
      return { data: null, error };
    }
  };

  return {
    user,
    loading,
    signOut,
    updateProfile,
    signInWithGoogle,
    signInWithApple,
  };
};
