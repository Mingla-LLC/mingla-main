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
import { logger } from "../utils/logger";

// Module-level flag — shared across ALL instances of useAuthSimple.
// Prevents duplicate SIGNED_OUT handling when multiple hook instances are mounted.
// Placed after imports so ESLint import/first rule is satisfied.
let _isHandlingSignOut = false;

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
        logger.auth('Initializing — fetching session...');
        // RELIABILITY: Enter 401 grace period BEFORE getSession() on cold start.
        // Android stored tokens are often expired. getSession() returns them as-is,
        // queries fire with expired JWT, get 401s. The grace period prevents the
        // 3-strike zombie auth handler from force-signing-out during the refresh window.
        const { enterAuth401GracePeriod } = require('../config/queryClient');
        enterAuth401GracePeriod(5000);

        // Get initial session
        const {
          data: { session },
          error,
        } = await supabase.auth.getSession();

        if (error) {
          logger.error('Failed to get session', { message: error.message });
          console.error("Error getting session:", error);
          if (mounted) setLoading(false);
          return;
        }

        if (session?.user) {
          logger.auth('Session found', { userId: session.user.id, email: session.user.email });
          if (mounted) {
            setAuth(session.user as User);
            // Clear loading immediately once we have a valid session.
            // Profile loads in the background — no need to block navigation.
            setLoading(false);
          }
          // Warm edge function isolates so first card load is fast.
          // Fire-and-forget — failure is harmless, success saves 2-5s.
          supabase.functions.invoke('keep-warm').catch(() => {});

          // Seed map location so friends can see this user on the map.
          // Fire-and-forget — uses last known GPS or skips if unavailable.
          import('expo-location').then(async (Location) => {
            try {
              const { status } = await Location.getForegroundPermissionsAsync();
              if (status === 'granted') {
                const loc = await Location.getLastKnownPositionAsync();
                if (loc) {
                  supabase.functions.invoke('update-map-location', {
                    body: { lat: loc.coords.latitude, lng: loc.coords.longitude },
                  }).catch(() => {});
                }
              }
            } catch {}
          }).catch(() => {});

          // Load profile (non-blocking — user sees home while this completes)
          try {
            const { data: profile, error: profileError } = await supabase
              .from("profiles")
              .select("*")
              .eq("id", session.user.id)
              .single();

            if (profileError) {
              logger.error('Profile load failed', { code: profileError.code, message: profileError.message });
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
                logger.auth('Profile not found (PGRST116) — validating user exists');
                // Validate that user actually exists by trying to get user info
                const {
                  data: { user: authUser },
                  error: userError,
                } = await supabase.auth.getUser();

                if (userError || !authUser || authUser.id !== session.user.id) {
                  logger.auth('User deleted or session invalid — signing out');
                  // User was deleted or session is invalid - sign out and clear
                  await supabase.auth.signOut();
                  if (mounted) {
                    setAuth(null);
                    clearUserData();
                    setLoading(false);
                  }
                  return;
                }

                // User exists but profile doesn't - create one
                logger.auth('User exists but no profile — creating new profile');
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
                    if (mounted) setProfile(newProfile);
                  }
                } catch (createError) {
                  console.error("Error creating profile:", createError);
                }
              }
            } else if (profile) {
              logger.auth('Profile loaded', { displayName: profile.display_name, onboarding: profile.has_completed_onboarding });
              if (mounted) setProfile(profile);
            }
          } catch (profileError) {
            logger.error('Profile load exception', { error: String(profileError) });
            console.error("Error loading profile:", profileError);
          }
        } else {
          logger.auth('No session — user not authenticated');
          if (mounted) setAuth(null);
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
      logger.auth(`Auth state change: ${event}`, { hasSession: !!session, userId: session?.user?.id });

      // RELIABILITY: On TOKEN_REFRESHED, invalidate ALL React Query queries so they
      // refetch with the new valid JWT. Without this, Android cold-start with expired
      // token leaves all queries in permanent error state (they exhausted retry:1 with
      // the old token and never retry). Also reset 401 counter since those 401s were
      // from the expired token, not zombie auth.
      // See: LAUNCH_READINESS_TRACKER — "Token refresh / expiry handling"
      if (event === 'TOKEN_REFRESHED') {
        const { queryClient, resetAuth401Counter } = require('../config/queryClient');
        resetAuth401Counter();
        queryClient.invalidateQueries({
          predicate: (query) => query.state.status === 'error',
        });
        // Fresh JWT — warm edge functions before invalidated queries refetch
        supabase.functions.invoke('keep-warm').catch(() => {});
      }

      if (session?.user) {
        if (mounted) {
          setAuth(session.user as User);
          // Clear loading immediately — don't wait for profile fetch
          setLoading(false);
        }

        try {
          const { data: profile, error: profileError } = await supabase
            .from("profiles")
            .select("*")
            .eq("id", session.user.id)
            .single();

          if (profileError) {
            console.error("Error loading profile:", profileError);

            if (profileError.code === "PGRST116") {
              const {
                data: { user: authUser },
                error: userError,
              } = await supabase.auth.getUser();

              if (userError || !authUser || authUser.id !== session.user.id) {
                await supabase.auth.signOut();
                if (mounted) {
                  setAuth(null);
                  clearUserData();
                }
              }
            }
          } else if (profile) {
            if (mounted) setProfile(profile);
          }
        } catch (profileError) {
          console.error("Error loading profile:", profileError);
        }
      } else {
        // SIGNED_OUT — guard against multiple instances firing simultaneously
        if (_isHandlingSignOut) return;
        _isHandlingSignOut = true;
        if (mounted) {
          setAuth(null);
          clearUserData();
        }
        // Reset after a tick so re-login within the same session works correctly
        setTimeout(() => { _isHandlingSignOut = false; }, 1000);
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
      logger.auth('Sign out requested');
      const { error } = await supabase.auth.signOut();
      if (error) {
        Alert.alert(
          "Sign Out Error",
          error.message || "Failed to sign out. Please try again."
        );
        throw error;
      }
      return { error: null };
    } catch (err: unknown) {
      return { error: err instanceof Error ? err : new Error(String(err)) };
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
    } catch (err: unknown) {
      return { data: null, error: err instanceof Error ? err : new Error(String(err)) };
    }
  };

  const signInWithGoogle = async () => {
    try {
      logger.auth('Google sign-in started');
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

          // Existing user — session is usually available immediately.
          // One short delay + one check is sufficient.
          await new Promise((resolve) => setTimeout(resolve, 200));
          const { data: sessionData } = await supabase.auth.getSession();

          if (sessionData?.session && sessionData.session.user) {
            data = {
              session: sessionData.session,
              user: sessionData.session.user,
            };
            error = null;
            console.log("Successfully signed in existing user via Google");
          } else {
            // Session not available — retry the OAuth call once
            const retryResult = await supabase.auth.signInWithIdToken({
              provider: "google",
              token: tokens.idToken,
            });

            if (!retryResult.error && retryResult.data?.session) {
              data = retryResult.data;
              error = null;
              console.log("Successfully signed in existing user on retry");
            } else {
              // Final session check after retry
              const { data: finalSessionData } = await supabase.auth.getSession();
              if (finalSessionData?.session && finalSessionData.session.user) {
                data = {
                  session: finalSessionData.session,
                  user: finalSessionData.session.user,
                };
                error = null;
              } else {
                console.warn(
                  "Could not create session for existing user, but continuing..."
                );
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

      // Profile loading is handled by onAuthStateChange listener.
      // Do not fetch here — it causes double queries and double re-renders.

      logger.auth('Google sign-in completed successfully');
      return { data: data.session, error: null };
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      const code = (err as { code?: unknown })?.code;
      logger.error('Google sign-in failed', { code, message: error.message });
      console.error("Google sign-in error:", code, error.message, err);

      // Handle specific error cases
      if (code === statusCodes.SIGN_IN_CANCELLED) {
        return { data: null, error: { message: "Sign-in cancelled" } };
      } else if (code === statusCodes.IN_PROGRESS) {
        return {
          data: null,
          error: { message: "Sign-in already in progress" },
        };
      } else if (code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
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
      logger.auth('Apple sign-in started');
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

      // Profile loading is handled by onAuthStateChange listener.
      // Apple name update: if Apple provided name data, fire-and-forget the update.
      // The onAuthStateChange listener will pick up the final profile state.
      if (data.session.user && credential.fullName) {
        const updates: Record<string, string> = {};
        if (credential.fullName.givenName) {
          updates.first_name = credential.fullName.givenName;
        }
        if (credential.fullName.familyName) {
          updates.last_name = credential.fullName.familyName;
        }
        if (credential.fullName.givenName && credential.fullName.familyName) {
          updates.display_name = `${credential.fullName.givenName} ${credential.fullName.familyName}`;
        }

        if (Object.keys(updates).length > 0) {
          // Fire-and-forget: update only if fields are empty (server-side).
          // Use a single update+select instead of fetch+update+re-fetch (CF-003).
          supabase
            .from("profiles")
            .update(updates)
            .eq("id", data.session.user.id)
            .is("first_name", null)
            .then(({ error }) => {
              if (error) console.error("Apple name update failed:", error);
            });
        }
      }

      logger.auth('Apple sign-in completed successfully');
      return { data: data.session, error: null };
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      const code = (err as { code?: unknown })?.code;
      logger.error('Apple sign-in failed', { code, message: error.message });
      console.error("Apple sign-in error:", err);

      // Handle specific error cases
      if (code === "ERR_REQUEST_CANCELED") {
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
