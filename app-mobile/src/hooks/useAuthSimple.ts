import { useState, useEffect } from "react";
import { Alert } from "react-native";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { supabase } from "../services/supabase";
import { useAppStore } from "../store/appStore";
import { User } from "../types";

// Complete web browser session properly for OAuth
WebBrowser.maybeCompleteAuthSession();

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

  const signUp = async (
    email: string,
    password: string,
    displayName?: string,
    firstName?: string,
    lastName?: string,
    username?: string,
    accountType?: string
  ) => {
    try {
      // Sign up user - this will send OTP email automatically if configured in Supabase
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: undefined, // Mobile app doesn't need redirect
          data: {
            display_name: displayName || email.split("@")[0],
            first_name: firstName || displayName?.split(" ")[0] || "",
            last_name:
              lastName || displayName?.split(" ").slice(1).join(" ") || "",
            username: username || email.split("@")[0],
            account_type: accountType || undefined, // Include account_type in metadata
          },
        },
      });

      if (error) {
        Alert.alert(
          "Sign Up Failed",
          error.message || "An error occurred during sign up. Please try again."
        );
        throw error;
      }

      // Send OTP email immediately after signup for email verification
      // Use signInWithOtp to send OTP code (not magic link) since email template is configured for OTP
      if (data.user && data.user.email) {
        try {
          const { error: otpError } = await supabase.auth.signInWithOtp({
            email: data.user.email,
            options: {
              shouldCreateUser: false, // User already created by signUp
              emailRedirectTo: undefined, // Mobile app doesn't need redirect
            },
          });

          if (otpError) {
            console.error("Error sending OTP:", otpError);
            Alert.alert(
              "OTP Email Error",
              otpError.message ||
                "Failed to send verification email. You can request a new code from the verification screen."
            );
          } else {
          }
        } catch (otpErr: any) {
          console.error("Exception sending OTP:", otpErr);
          Alert.alert(
            "OTP Email Error",
            otpErr?.message ||
              "Failed to send verification email. You can request a new code from the verification screen."
          );
          // Continue even if OTP send fails
        }
      }

      // Profile will be automatically created by database trigger
      // Check if we have a session (user might need email confirmation)
      if (data.user) {

        // Use session from signUp response, or get current session
        let session = data.session;
        if (!session) {
          const {
            data: { session: currentSession },
          } = await supabase.auth.getSession();
          session = currentSession;
        }

        if (session) {
          // Session exists, wait for trigger and load profile
          await new Promise((resolve) => setTimeout(resolve, 500));

          // Try to load the profile that was created by the trigger
          const { data: profile, error: profileError } = await supabase
            .from("profiles")
            .select("*")
            .eq("id", data.user.id)
            .single();

          if (profileError) {
            console.error("Error loading profile after signup:", profileError);
            // Don't fail signup if profile loading fails - trigger should have created it
          } else if (profile) {
            setProfile(profile);
          }
        } else {
          // No session - email confirmation might be required
          // The onAuthStateChange listener will handle loading the profile when user confirms email
        }
      }

      return { data, error: null };
    } catch (error: any) {
      Alert.alert(
        "Sign Up Failed",
        error.message || "An error occurred during sign up. Please try again."
      );
      return { data: null, error };
    }
  };

  // Verify email OTP code
  const verifyEmailOTP = async (email: string, token: string) => {
    try {
      const { data, error } = await supabase.auth.verifyOtp({
        email,
        token,
        type: "email",
      });

      if (error) {
        Alert.alert(
          "Verification Failed",
          error.message ||
            "Invalid or expired verification code. Please try again."
        );
        throw error;
      }

      // After successful OTP verification, update email_verified in profile
      if (data.user) {
        const { error: updateError } = await supabase
          .from("profiles")
          .update({ email_verified: true })
          .eq("id", data.user.id);

        if (updateError) {
          console.error("Error updating email_verified:", updateError);
          Alert.alert(
            "Update Error",
            "Email verified but failed to update profile. Please refresh the app."
          );
        }

        // Reload profile to get updated email_verified status
        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", data.user.id)
          .single();

        if (!profileError && profile) {
          setProfile(profile);
        }
      }

      return { data, error: null };
    } catch (error: any) {
      return { data: null, error };
    }
  };

  // Resend OTP email
  const resendEmailOTP = async (email: string) => {
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: false,
          emailRedirectTo: undefined,
        },
      });

      if (error) {
        Alert.alert(
          "Failed to Resend Code",
          error.message ||
            "Unable to send a new verification code. Please try again later."
        );
        throw error;
      }

      Alert.alert(
        "Code Sent",
        "A new verification code has been sent to your email."
      );
      return { error: null };
    } catch (error: any) {
      return { error };
    }
  };

  const signIn = async (email: string, password: string) => {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        Alert.alert(
          "Sign In Failed",
          error.message ||
            "Invalid email or password. Please check your credentials and try again."
        );
        throw error;
      }
      return { data, error: null };
    } catch (error: any) {
      return { data: null, error };
    }
  };

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

  const signUpWithPhone = async (
    phone: string,
    password: string,
    username: string,
    accountType?: string
  ) => {
    try {
      // Send OTP to phone number
      // Store password, username, and account_type in metadata for later use
      const { data, error } = await supabase.auth.signInWithOtp({
        phone,
        options: {
          data: {
            username: username,
            temp_password: password, // Store temporarily in metadata
            account_type: accountType || undefined, // Include account_type in metadata
          },
        },
      });

      if (error) {
        Alert.alert(
          "Failed to Send Code",
          error.message ||
            "Unable to send verification code to your phone. Please try again."
        );
        throw error;
      }

      return { data, error: null };
    } catch (error: any) {
      return { data: null, error };
    }
  };

  const verifyPhoneOTP = async (phone: string, otp: string) => {
    try {
      // Verify OTP
      const { data, error } = await supabase.auth.verifyOtp({
        phone,
        token: otp,
        type: "sms",
      });

      if (error) {
        Alert.alert(
          "Verification Failed",
          error.message ||
            "Invalid or expired verification code. Please try again."
        );
        throw error;
      }

      // If verification successful, user should have a session
      if (data.user) {
        // Set password if it was stored in metadata
        const tempPassword = data.user.user_metadata?.temp_password;
        if (tempPassword) {
          try {
            const { error: passwordError } = await supabase.auth.updateUser({
              password: tempPassword,
            });
            if (passwordError) {
              console.error("Error setting password:", passwordError);
              Alert.alert(
                "Password Setup Warning",
                "Your account was created but password setup failed. You can set it later in settings."
              );
              // Continue anyway - user can set password later
            }
          } catch (err: any) {
            console.error("Error setting password:", err);
            Alert.alert(
              "Password Setup Warning",
              "Your account was created but password setup failed. You can set it later in settings."
            );
          }
        }

        // Wait for trigger to create profile
        await new Promise((resolve) => setTimeout(resolve, 500));

        // Try to load the profile
        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", data.user.id)
          .single();

        if (profileError) {
          console.error(
            "Error loading profile after phone verification:",
            profileError
          );
          Alert.alert(
            "Profile Loading Error",
            "Account created but profile loading failed. Please refresh the app."
          );
        } else if (profile) {
          setProfile(profile);
        }
      }

      return { data, error: null };
    } catch (error: any) {
      return { data: null, error };
    }
  };

  const resendPhoneOTP = async (phone: string) => {
    try {
      const { data, error } = await supabase.auth.signInWithOtp({
        phone,
      });

      if (error) {
        Alert.alert(
          "Failed to Resend Code",
          error.message ||
            "Unable to send a new verification code. Please try again later."
        );
        throw error;
      }

      Alert.alert(
        "Code Sent",
        "A new verification code has been sent to your phone."
      );
      return { data, error: null };
    } catch (error: any) {
      return { data: null, error };
    }
  };

  const signInWithGoogle = async () => {
    try {
      // Get the redirect URL for this app using Expo Linking
      // Supabase will automatically handle account linking if email matches
      const redirectUrl = Linking.createURL("/");


      // Initiate OAuth sign-in
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: redirectUrl,
        },
      });

      if (error) throw error;

      // Open the OAuth URL in browser
      if (data?.url) {
        const result = await WebBrowser.openAuthSessionAsync(
          data.url,
          redirectUrl
        );


        // Handle the OAuth callback
        // Supabase OAuth redirects contain tokens in the URL hash fragment
        if (result.type === "success" && result.url) {

          // Parse the callback URL - tokens are in hash fragment for Supabase
          const url = new URL(result.url);
          const hashParams = new URLSearchParams(url.hash.substring(1)); // Remove # and parse
          const accessToken =
            hashParams.get("access_token") ||
            url.searchParams.get("access_token");
          const refreshToken =
            hashParams.get("refresh_token") ||
            url.searchParams.get("refresh_token");

          if (accessToken && refreshToken) {
            // Set the session with the tokens
            const { data: sessionData, error: sessionError } =
              await supabase.auth.setSession({
                access_token: accessToken,
                refresh_token: refreshToken,
              });

            if (sessionError) throw sessionError;

            // Wait for profile to be created/loaded by trigger
            if (sessionData.session?.user) {
              await new Promise((resolve) => setTimeout(resolve, 500));

              // Load profile
              const { data: profile, error: profileError } = await supabase
                .from("profiles")
                .select("*")
                .eq("id", sessionData.session.user.id)
                .single();

              if (profileError) {
                console.error(
                  "Error loading profile after Google sign-in:",
                  profileError
                );
              } else if (profile) {
                setProfile(profile);
              }
            }
          } else {
            // If tokens not in URL, Supabase's onAuthStateChange will handle it
            // The onAuthStateChange listener will automatically handle the session
          }
        } else if (result.type === "cancel") {
          return { data: null, error: { message: "Sign-in cancelled" } };
        }
      }

      return { data, error: null };
    } catch (error: any) {
      console.error("Google sign-in error:", error);
      Alert.alert(
        "Google Sign-In Failed",
        error.message || "Unable to sign in with Google. Please try again."
      );
      return { data: null, error };
    }
  };

  return {
    user,
    loading,
    signUp,
    signIn,
    signOut,
    updateProfile,
    verifyEmailOTP,
    resendEmailOTP,
    signUpWithPhone,
    verifyPhoneOTP,
    resendPhoneOTP,
    signInWithGoogle,
  };
};
