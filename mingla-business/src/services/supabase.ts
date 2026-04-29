import { createClient } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";

const extra = Constants.expoConfig?.extra as Record<string, string | undefined> | undefined;

const supabaseUrl =
  extra?.EXPO_PUBLIC_SUPABASE_URL ||
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  "";

const supabaseAnonKey =
  extra?.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  "";

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    "[mingla-business] EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY missing — auth will fail until set in .env and app.config."
  );
}

// SSR-safe storage adapter. Expo Router 6 renders pages in Node during the
// web bundle pass — AsyncStorage's web shim assumes `window.localStorage`,
// so it crashes when `window` is undefined. The no-op fallback lets the
// Supabase client initialise without persistence during SSR; once the
// browser hydrates, `window` exists and AsyncStorage's localStorage shim
// works normally. On iOS/Android, `window` is provided by React Native, so
// AsyncStorage is used as before.
const ssrSafeStorage = {
  getItem: async (_key: string): Promise<string | null> => null,
  setItem: async (_key: string, _value: string): Promise<void> => undefined,
  removeItem: async (_key: string): Promise<void> => undefined,
};

const storage = typeof window === "undefined" ? ssrSafeStorage : AsyncStorage;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
