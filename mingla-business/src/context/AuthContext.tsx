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

const webClientId =
  Constants.expoConfig?.extra?.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ||
  process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;

const iosClientId =
  Constants.expoConfig?.extra?.IOS_CLIENT_ID ||
  process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;

if (webClientId) {
  GoogleSignin.configure({
    webClientId,
    iosClientId: Platform.OS === "ios" && iosClientId ? iosClientId : undefined,
    offlineAccess: true,
    forceCodeForRefreshToken: true,
  });
} else {
  console.warn(
    "[mingla-business] EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID is not set — Google Sign-In will not work."
  );
}

type AuthContextValue = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signInWithGoogle: () => Promise<{ error: Error | null }>;
  signInWithApple: () => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

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
      }
      setLoading(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signInWithGoogle = useCallback(async (): Promise<{ error: Error | null }> => {
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

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    try {
      if (await GoogleSignin.hasPreviousSignIn()) {
        await GoogleSignin.signOut();
      }
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo(
    () => ({
      user,
      session,
      loading,
      signInWithGoogle,
      signInWithApple,
      signOut,
    }),
    [user, session, loading, signInWithGoogle, signInWithApple, signOut]
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
