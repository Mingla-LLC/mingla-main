import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Alert, Platform } from "react-native";
import Constants from "expo-constants";
import {
  GoogleSignin,
  statusCodes,
} from "@react-native-google-signin/google-signin";
import * as AppleAuthentication from "expo-apple-authentication";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "../services/supabase";
import { ensureCreatorAccount } from "../services/creatorAccount";
import { tryRecoverAccountIfDeleted } from "../hooks/useAccountDeletion";
import { clearAllStores } from "../utils/clearAllStores";

const webClientId =
  Constants.expoConfig?.extra?.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ||
  process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;

const iosClientId =
  Constants.expoConfig?.extra?.IOS_CLIENT_ID ||
  process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;

// Cycle 0b: GoogleSignin native SDK is iOS/Android-only ("web support is
// sponsor-only" — see D-IMPL-35). Calling configure() on web emits a
// runtime warning AND was the suspected cause of the WEB2 AuthProvider
// hang. Gate to non-web so the SDK is only touched where it works.
if (Platform.OS !== "web" && webClientId) {
  GoogleSignin.configure({
    webClientId,
    iosClientId: Platform.OS === "ios" && iosClientId ? iosClientId : undefined,
    offlineAccess: true,
    forceCodeForRefreshToken: true,
  });
} else if (Platform.OS !== "web" && !webClientId) {
  console.warn(
    "[mingla-business] EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID is not set — native Google Sign-In will not work."
  );
}

// Web auth uses Supabase OAuth-redirect (DEC-076 + DEC-081). The browser
// is redirected to Google/Apple, then back to `${origin}/auth/callback`
// where Supabase finalises the session via `detectSessionInUrl: true`.
const buildWebRedirectTo = (): string | undefined => {
  if (Platform.OS !== "web") return undefined;
  if (typeof window === "undefined") return undefined;
  return `${window.location.origin}/auth/callback`;
};

type AuthContextValue = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signInWithGoogle: () => Promise<{ error: Error | null }>;
  signInWithApple: () => Promise<{ error: Error | null }>;
  /**
   * Cycle 15 — additive email-OTP sign-in (DEC-097). Step 1: send
   * 6-digit code to email. Caller transitions UI to OTP-input mode
   * on success.
   */
  signInWithEmail: (email: string) => Promise<{ error: Error | null }>;
  /**
   * Cycle 15 — Step 2: verify 6-digit code. On success, SIGNED_IN
   * event fires + AuthContext listener handles ensureCreatorAccount
   * + tryRecoverAccountIfDeleted (I-35 gate per Cycle 14 v2).
   */
  verifyEmailOtp: (
    email: string,
    code: string,
  ) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  /**
   * Cycle 14 — set to a value when account recovery just fired on sign-in
   * (creator_accounts.deleted_at was non-null and got auto-cleared per
   * D-CYCLE14-FOR-6 + I-35). Consumer (account.tsx) reads + clears via
   * clearLastRecoveryEvent to show a one-time "Welcome back" toast.
   */
  lastRecoveryEvent: { recoveredAt: string } | null;
  clearLastRecoveryEvent: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  // Cycle 14 — D-CYCLE14-FOR-6 + I-35: recover-on-sign-in flag.
  const [lastRecoveryEvent, setLastRecoveryEvent] = useState<{
    recoveredAt: string;
  } | null>(null);
  const clearLastRecoveryEvent = useCallback((): void => {
    setLastRecoveryEvent(null);
  }, []);

  useEffect(() => {
    let mounted = true;

    const bootstrap = async () => {
      const {
        data: { session: s },
        error,
      } = await supabase.auth.getSession();
      if (!mounted) return;
      if (error) {
        console.warn("[auth] getSession", error.message);
        setLoading(false);
        return;
      }
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        await ensureCreatorAccount(s.user);
        // Cycle 14 — recover-on-sign-in auto-clear (D-CYCLE14-FOR-6 + I-35).
        // If creator_accounts.deleted_at is non-null, clear it and emit
        // recovery event so account.tsx shows "Welcome back" toast.
        const recovered = await tryRecoverAccountIfDeleted(s.user.id);
        if (recovered && mounted) {
          setLastRecoveryEvent({ recoveredAt: new Date().toISOString() });
        }
      }
      setLoading(false);
    };

    bootstrap();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, s) => {
      if (!mounted) return;
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        await ensureCreatorAccount(s.user);
        // Cycle 14 — recover-on-sign-in auto-clear (D-CYCLE14-FOR-6 + I-35).
        // GATE to SIGNED_IN only — TOKEN_REFRESHED + USER_UPDATED + INITIAL_SESSION
        // also fire with s.user, and would otherwise un-delete an account
        // mid-delete-flow (race between requestDeletion's deleted_at=now() write
        // and the next token-refresh tick). Bootstrap above handles cold-start
        // recovery; only true SIGNED_IN events should trigger recovery from
        // onAuthStateChange. Cycle 14 v2 fix Bug B.
        if (_event === "SIGNED_IN") {
          const recovered = await tryRecoverAccountIfDeleted(s.user.id);
          if (recovered && mounted) {
            setLastRecoveryEvent({ recoveredAt: new Date().toISOString() });
          }
        }
      } else if (_event === "SIGNED_OUT") {
        // Defensive Constitution #6 coverage — clears stores even when
        // signout happens server-side (token revoked, session expired)
        // without going through our signOut() button.
        clearAllStores();
      }
      setLoading(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signInWithGoogle = useCallback(async (): Promise<{ error: Error | null }> => {
    // Web: Supabase OAuth-redirect flow. Native Google Sign-In SDK is not
    // available on web; this path replaces the native call entirely.
    if (Platform.OS === "web") {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: buildWebRedirectTo(),
        },
      });
      if (error) {
        return { error: new Error(error.message) };
      }
      // Browser navigates away to Google — control does not return here.
      return { error: null };
    }

    try {
      if (!webClientId) {
        Alert.alert(
          "Configuration error",
          "Google Sign-In is not configured. Set EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID."
        );
        return { error: new Error("Google Sign-In not configured") };
      }

      if (Platform.OS === "android") {
        await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      }

      if (await GoogleSignin.hasPreviousSignIn()) {
        await GoogleSignin.signOut();
      }

      await GoogleSignin.signIn();
      const tokens = await GoogleSignin.getTokens();

      if (!tokens.idToken) {
        throw new Error("Failed to get ID token from Google");
      }

      let { data, error } = await supabase.auth.signInWithIdToken({
        provider: "google",
        token: tokens.idToken,
      });

      const isExistingUserError =
        error &&
        (error.message?.includes("already registered") ||
          error.message?.includes("already exists") ||
          error.message?.includes("Database error saving new user") ||
          error.message?.includes("duplicate key") ||
          error.message?.includes("violates"));

      if (error && isExistingUserError) {
        await new Promise((r) => setTimeout(r, 200));
        const { data: sessionData } = await supabase.auth.getSession();
        if (sessionData?.session?.user) {
          data = { session: sessionData.session, user: sessionData.session.user };
          error = null;
        } else {
          const retry = await supabase.auth.signInWithIdToken({
            provider: "google",
            token: tokens.idToken,
          });
          if (!retry.error && retry.data?.session) {
            data = retry.data;
            error = null;
          } else {
            const { data: final } = await supabase.auth.getSession();
            if (final?.session?.user) {
              data = { session: final.session, user: final.session.user };
              error = null;
            }
          }
        }
      } else if (error) {
        throw error;
      }

      if (!data?.session) {
        const { data: finalCheck } = await supabase.auth.getSession();
        if (finalCheck?.session) {
          data = { session: finalCheck.session, user: finalCheck.session.user };
        } else if (error) {
          throw error;
        } else {
          throw new Error("Failed to create session");
        }
      }

      return { error: null };
    } catch (err: unknown) {
      const e = err instanceof Error ? err : new Error(String(err));
      const code = (err as { code?: string })?.code;

      if (code === statusCodes.SIGN_IN_CANCELLED) {
        return { error: e };
      }
      if (code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        Alert.alert(
          "Google Play Services",
          "Google Play Services is required. Install or update it from the Play Store."
        );
        return { error: e };
      }

      if (!String(e.message).toLowerCase().includes("cancel")) {
        const msg = e.message || "Please try again.";
        const audienceHint =
          msg.includes("Unacceptable audience") || msg.includes("audience in id_token")
            ? "\n\nRegister every OAuth client this build uses (Web, iOS, Android) in Supabase → Authentication → Google → Client IDs, comma-separated, Web client first."
            : "";
        Alert.alert("Google Sign-In failed", `${msg}${audienceHint}`);
      }
      return { error: e };
    }
  }, []);

  const signInWithApple = useCallback(async (): Promise<{ error: Error | null }> => {
    // Web: Supabase OAuth-redirect flow with Apple provider.
    // Apple Developer + Supabase config completed pre-Cycle-0b dispatch
    // (Service ID com.sethogieva.minglabusiness.web, Team 782KVMY869,
    // Key 4F5MJ3G94D, JWT valid until ~2026-10-26).
    if (Platform.OS === "web") {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "apple",
        options: {
          redirectTo: buildWebRedirectTo(),
        },
      });
      if (error) {
        return { error: new Error(error.message) };
      }
      return { error: null };
    }

    try {
      if (Platform.OS !== "ios") {
        Alert.alert("Not available", "Apple Sign-In is only available on iOS.");
        return { error: new Error("Apple only on iOS") };
      }

      const available = await AppleAuthentication.isAvailableAsync();
      if (!available) {
        Alert.alert("Not available", "Apple Sign-In is not available on this device.");
        return { error: new Error("Apple not available") };
      }

      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });

      if (!credential.identityToken) {
        throw new Error("Failed to get identity token from Apple");
      }

      const { data, error } = await supabase.auth.signInWithIdToken({
        provider: "apple",
        token: credential.identityToken,
      });

      if (error) throw error;
      if (!data.session) throw new Error("Failed to create session");

      if (credential.fullName && data.session.user) {
        const gn = credential.fullName.givenName;
        const fn = credential.fullName.familyName;
        const display = gn && fn ? `${gn} ${fn}` : gn || fn;
        if (display) {
          await supabase
            .from("creator_accounts")
            .update({ display_name: display })
            .eq("id", data.session.user.id);
        }
      }

      return { error: null };
    } catch (err: unknown) {
      const e = err instanceof Error ? err : new Error(String(err));
      const code = (err as { code?: string })?.code;
      if (code === "ERR_REQUEST_CANCELED") {
        return { error: e };
      }
      Alert.alert("Apple Sign-In failed", e.message || "Please try again.");
      return { error: e };
    }
  }, []);

  // Cycle 15 — additive email + 6-digit OTP sign-in (DEC-097 + I-35).
  // Step 1 of 2-step flow: send the OTP code to email. Caller transitions
  // UI to OTP-input state on success; user pastes code → caller invokes
  // verifyEmailOtp() below. Works identically on iOS, Android, web —
  // signInWithOtp is platform-agnostic (no native SDK dependency).
  const signInWithEmail = useCallback(
    async (email: string): Promise<{ error: Error | null }> => {
      const trimmed = email.trim().toLowerCase();
      if (!trimmed) {
        return { error: new Error("Enter your email address.") };
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(trimmed)) {
        return { error: new Error("That doesn't look like a valid email.") };
      }
      const { error } = await supabase.auth.signInWithOtp({
        email: trimmed,
        options: {
          shouldCreateUser: true,
        },
      });
      if (error) {
        // Surface rate-limit error explicitly per D-CYCLE15-FOR-6 + DEC-097
        // D-15-8 ("Too many attempts. Wait a minute before trying again.").
        if (
          error.message.toLowerCase().includes("rate limit") ||
          error.message.toLowerCase().includes("too many")
        ) {
          return {
            error: new Error(
              "Too many attempts. Wait a minute before trying again.",
            ),
          };
        }
        return { error: new Error(error.message) };
      }
      return { error: null };
    },
    [],
  );

  // Cycle 15 — Step 2 of 2-step flow: verify the 6-digit OTP code.
  // type: "email" covers both magic-link and OTP-token modes; Supabase
  // project email template config determines which mode is active. On
  // success, Supabase fires onAuthStateChange(SIGNED_IN, session) which
  // the existing listener handles (ensureCreatorAccount + tryRecoverAccountIfDeleted
  // gated to SIGNED_IN per Cycle 14 v2 fix Bug B — preserves I-35 contract).
  const verifyEmailOtp = useCallback(
    async (
      email: string,
      code: string,
    ): Promise<{ error: Error | null }> => {
      const trimmedEmail = email.trim().toLowerCase();
      const trimmedCode = code.trim();
      if (!/^\d{6}$/.test(trimmedCode)) {
        return {
          error: new Error("Enter the 6-digit code from your email."),
        };
      }
      const { error } = await supabase.auth.verifyOtp({
        email: trimmedEmail,
        token: trimmedCode,
        type: "email",
      });
      if (error) {
        const msg = error.message.toLowerCase();
        if (msg.includes("expired") || msg.includes("invalid")) {
          return {
            error: new Error(
              "That code didn't match or has expired. Try again.",
            ),
          };
        }
        return { error: new Error(error.message) };
      }
      return { error: null };
    },
    [],
  );

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    // GoogleSignin native SDK is iOS/Android-only — gate per Cycle 0b.
    if (Platform.OS !== "web") {
      try {
        if (await GoogleSignin.hasPreviousSignIn()) {
          await GoogleSignin.signOut();
        }
      } catch {
        /* ignore */
      }
    }
    // Constitution #6 — clear all client-side persisted stores.
    // NEW Cycle 3 wire-up; before this, currentBrandStore + draftEventStore
    // survived signout (a pre-existing gap closed by Cycle 3 spec §3.11).
    clearAllStores();
  }, []);

  const value = useMemo(
    () => ({
      user,
      session,
      loading,
      signInWithGoogle,
      signInWithApple,
      signInWithEmail,
      verifyEmailOtp,
      signOut,
      lastRecoveryEvent,
      clearLastRecoveryEvent,
    }),
    [
      user,
      session,
      loading,
      signInWithGoogle,
      signInWithApple,
      signInWithEmail,
      verifyEmailOtp,
      signOut,
      lastRecoveryEvent,
      clearLastRecoveryEvent,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
