import { useState, useEffect, useRef } from "react";
import { Alert, AppState, Platform } from "react-native";
import Constants from "expo-constants";
import {
  GoogleSignin,
  statusCodes,
} from "@react-native-google-signin/google-signin";
import * as AppleAuthentication from "expo-apple-authentication";
import { supabase } from "../services/supabase";
import { realtimeService } from "../services/realtimeService";
import { useAppStore } from "../store/appStore";
import { User } from "../types";
import { logger } from "../utils/logger";
import { mixpanelService } from "../services/mixpanelService";
// #1044 [auth-failure-sentry-capture] — Sentry-backed non-fatal reporting for
// the native sign-in catch blocks. Mirrors mingla-business's helper.
import { reportNonFatal } from "../diagnostics/reportNonFatal";
import { queryClient } from "../config/queryClient";
import { deckService, DeckResponse } from "../services/deckService";
import { buildDeckQueryKey } from "./useDeckCards";
import { normalizeCategoryArray } from "../utils/categoryUtils";
// ORCH-0640 ch09: experiencesService DELETED. getUserPreferences retained on preferencesService.
import { PreferencesService } from "../services/preferencesService";
import { performPrivateAuthCleanup, signOutWithPrivateCleanup, signOutWithoutPrivateCleanup } from "../utils/authCleanup";
// #1875 [transient-signin-failure] — user-facing sign-in failure copy is read
// from fixed i18n keys, never from a caught error's message. Non-hook accessor,
// same specifier depth as AppStateManager.tsx.
import i18n from "../i18n";


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

/**
 * #1044 [auth-failure-sentry-capture] — I-PROPOSED-1044-AUTH-FAILURE-REPORTED.
 * Mirror of the predicate in `mingla-business/src/context/AuthContext.tsx`.
 *
 * THE single decision point for whether a NATIVE sign-in failure reaches Sentry.
 * One named, greppable predicate per app, on purpose: the exclusion logic must
 * not get quietly re-scattered across the individual catch branches.
 *
 * Why it exists: #1038 broke Google sign-in for EVERY Play-Store organizer on
 * Mingla Business for months and monitoring never saw it, because the catch block
 * Alerted the user and discarded the error. This app has the same shape with an
 * extra illusion on top — `logger.error` LOOKS like production telemetry but its
 * breadcrumb buffer is `__DEV__`-only (`src/utils/breadcrumbs.ts`), and
 * `mixpanelService.trackLoginFailed` carries only the message string (no code, no
 * platform, no build). Sentry received nothing from auth in this app either.
 *
 * The exclusion set is not an optimisation. Picker cancels and double-taps are
 * normal user behaviour and are the highest-volume events on this path; reporting
 * them would bury the one signal that matters.
 *
 * ┌── DO NOT REORDER, DO NOT REMOVE ────────────────────────────────────────┐
 * The `typeof code !== "string"` statement MUST run FIRST. An error carrying no
 * `code` at all — `new Error("Failed to create session")`, `new Error("Failed to
 * get ID token from Google")`, a raw Supabase error — is exactly the class #1038
 * belonged to and MUST be reported. It also closes the F-7 trap: `statusCodes`
 * members are runtime native constants, and `NULL_PRESENTER` exists in
 * mingla-business's SDK (16.1.2) but NOT in this app's (16.0.0). Any bare
 * comparison against a possibly-`undefined` constant — including a `Set`/array
 * `.includes()` built from them — would match every codeless error and silently
 * drop it, recreating the exact bug this code exists to fix, inside its own fix.
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * `SIGN_IN_REQUIRED` is deliberately NOT excluded: this app never calls
 * `signInSilently()`, so after an interactive `signIn()` it is an anomaly worth
 * seeing (expected volume ~0). Do not "helpfully" add it.
 *
 * Exclusions reference the `statusCodes` object, NEVER a hardcoded integer — the
 * values are native constants that differ per platform (SIGN_IN_CANCELLED is
 * "12501" on Android and "-5" on iOS).
 */
const shouldReportAuthFailure = (code: unknown): boolean => {
  if (typeof code !== "string") return true;
  // BELT-AND-BRACES, NOT THE LIVE GUARD (#1044). The Google picker cancel is
  // handled at its ROOT, in signInWithGoogle's try block: SDK v16 RESOLVES
  // `{ type: "cancelled" }` rather than rejecting, so control returns early and
  // never reaches this predicate. This line is therefore unreachable for the
  // Google cancel path today. It is kept on purpose — it still fires if the SDK
  // ever reverts to a rejecting cancel, and it costs nothing. Do not read it as
  // the mechanism that stops cancels reaching Sentry; that is the early return.
  if (code === statusCodes.SIGN_IN_CANCELLED) return false;
  if (code === statusCodes.IN_PROGRESS) return false;
  if (code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) return false;
  if (code === "ERR_REQUEST_CANCELED") return false;
  return true;
};

/**
 * #1875 [transient-signin-failure] —
 * I-PROPOSED-1875-SIGNIN-FAILURE-CLASSIFIED-AND-OPAQUE.
 *
 * THE single decision point for whether a caught NATIVE sign-in failure is a
 * recoverable blip or a real, permanent fault. One named, greppable predicate,
 * deliberately mirroring shouldReportAuthFailure's idiom above: the transient /
 * permanent distinction must not get re-scattered across the catch branches.
 *
 * Why it exists: #1875 found that a one-second connectivity blip during
 * "Continue with Google" was handled exactly like a hard configuration fault —
 * no retry, no offline-aware copy — and the user was then shown the raw
 * `error.message`. For a 502/503/504 that message is `JSON.stringify(Response)`
 * (@supabase/auth-js's `_getErrorMessage` falls through to `JSON.stringify(err)`
 * for a `Response`), so the modal contained our Supabase project URL and a blob
 * id. Both halves of that are fixed here: classification drives a bounded retry,
 * and the copy is read from fixed i18n keys.
 *
 * ┌── DO NOT ── the F-7 trap, restated for THIS predicate ───────────────────┐
 * NEVER write `errCode === statusCodes.INTERNAL_ERROR` (or `.NETWORK_ERROR`, or
 * `.TIMEOUT`). This app ships @react-native-google-signin/google-signin 16.0.0,
 * whose `statusCodes` is frozen to exactly SIGN_IN_CANCELLED, IN_PROGRESS,
 * PLAY_SERVICES_NOT_AVAILABLE and SIGN_IN_REQUIRED. Those three names are
 * `undefined`, so the comparison evaluates `undefined === undefined` and matches
 * EVERY codeless error — the exact #1038 blind spot #1044 exists to close, this
 * time reproduced inside its own fix. Key on the numeric strings the native
 * bridge actually emits: ErrorDto.kt does `this.code = codeInt.toString()`,
 * where codeInt is ApiException.getStatusCode() — "7" NETWORK_ERROR,
 * "8" INTERNAL_ERROR, "15" TIMEOUT.
 *
 * Rule R6 — the DEFAULT — is "permanent". An unrecognised error is NEVER
 * retried. Anything you cannot name is a fault, not a blip. Widening R4 is a
 * decision that needs evidence, not a tidy-up: "14" (INTERRUPTED) and every iOS
 * kGIDSignInErrorCode (small negatives, where a network fault is
 * indistinguishable from a real one) are excluded ON PURPOSE.
 *
 * NEVER use `instanceof AuthRetryableFetchError`: Metro can resolve
 * @supabase/auth-js through more than one module instance, and the regression
 * suites execute this body via `new Function`, where the class is not in scope.
 * `name` is a plain string assigned by CustomAuthError's constructor and is
 * stable across both.
 *
 * NEVER read NetInfo / onlineManager / networkMonitor / offlineService here.
 * `AuthRetryableFetchError.status === 0` is an observation of THIS request
 * failing just now; `onlineManager`'s belief demonstrably goes stale (#1642
 * physical-device run: a paused write was still paused 60s after connectivity
 * returned).
 *
 * PURE: no I/O, no Date, no Math.random, no logging, no throwing. Same five
 * arguments in, same value out, always.
 * └─────────────────────────────────────────────────────────────────────────┘
 */
type AuthFailureClass =
  | "permanent"
  | "transient-transport-offline"
  | "transient-transport-remote"
  | "transient-provider";

/** Extra attempts BEYOND the first, so 3 total. Frozen; the loop bound. */
const TRANSPORT_RETRY_MAX_ATTEMPTS = 2;
/**
 * Fixed, no jitter — jitter buys nothing at n=2 and makes tests nondeterministic.
 * Length MUST equal TRANSPORT_RETRY_MAX_ATTEMPTS. Worst case adds 1600 ms of
 * waiting; a Google ID token is valid for ~1 hour, so staleness is not a concern.
 */
const TRANSPORT_RETRY_DELAYS_MS = Object.freeze([400, 1200]);

const classifyAuthFailure = (
  errName: unknown,
  errCode: unknown,
  errStatus: unknown,
  errMessage: unknown,
  platformOS: string,
): AuthFailureClass => {
  // R1 / R2 / R3 — @supabase/auth-js labels this class retryable itself, so
  // trust its label and do not guess beyond it. R1: status 0 (or absent) means
  // the request never received a response at all — device offline, DNS, TLS,
  // connection reset. R2: 502 / 503 / 504, auth-js's own NETWORK_ERROR_CODES,
  // which is the class of #1875's Event B. R3: any other status it chose to
  // wrap in this error.
  if (errName === "AuthRetryableFetchError") {
    if (errStatus === 0 || errStatus === undefined || errStatus === null) {
      return "transient-transport-offline";
    }
    return "transient-transport-remote";
  }
  // R4 — Google Play Services transient status codes, Android only. Numeric
  // strings from ErrorDto.kt; see the DO NOT banner above. Classified transient
  // for COPY purposes only — the provider leg is never auto-retried, because
  // re-invoking signIn() re-presents the account picker.
  if (
    platformOS === "android" &&
    typeof errCode === "string" &&
    (errCode === "7" || errCode === "8" || errCode === "15")
  ) {
    return "transient-provider";
  }
  // R5 — React Native's fetch polyfill rejection. EXACT equality, never
  // `includes`: a substring inside a serialized JSON blob or a locale-varying
  // message must never promote a permanent failure to transient.
  if (typeof errMessage === "string" && errMessage === "Network request failed") {
    return "transient-transport-offline";
  }
  // R6 — THE DEFAULT. Unrecognised means permanent, and permanent is never
  // retried. This catches "10" (DEVELOPER_ERROR, the #1038 certificate class),
  // "getTokens", "12500", "14", every iOS code, every AuthApiError, and every
  // codeless error.
  return "permanent";
};

export const useAuthSimple = () => {
  const [loading, setLoading] = useState(true);
  const { user, setAuth, setProfile } = useAppStore();
  // #1875 [transient-signin-failure] — cancellation checkpoint C1 for the
  // bounded transport retry. Flipped false in the auth effect's cleanup below,
  // alongside `mounted = false`. A retry must not keep running against a hook
  // that is gone, and it must not raise a modal for a screen nobody is on.
  const isMountedRef = useRef(true);

  // Add timeout to prevent infinite loading
  useEffect(() => {
    const timer = setTimeout(() => {
      setLoading(false);
    }, 8000); // 8 second timeout

    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    let mounted = true;
    // #1875 — re-arm on (re)mount. Fast Refresh and any future StrictMode
    // double-invoke run cleanup then re-run this effect; without this line the
    // ref would stay false for the rest of the process and permanently cancel
    // every retry and suppress every failure Alert.
    isMountedRef.current = true;

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
          // ORCH-0926: hand the user's JWT to realtime so postgres_changes events
          // on RLS-gated tables (collaboration_sessions, session_participants)
          // pass the SELECT policy and actually get delivered. Without this,
          // the websocket runs as the anon role and RLS silently drops every
          // event whose row predicate references auth.uid().
          if (session.access_token) {
            await supabase.realtime.setAuth(session.access_token);
          }
          if (mounted) {
            setAuth(session.user as User);
            // Clear loading immediately once we have a valid session.
            // Profile loads in the background — no need to block navigation.
            setLoading(false);
          }
          // Pre-warm edge function isolates so deck/curated calls hit warm Deno instances.
          // keep-warm sends warmPing:true which short-circuits immediately (no business logic,
          // no worker pool competition). Without this, first deck call hits cold isolates and
          // takes 5-10s instead of 1-2s. See ORCH-0342.
          supabase.functions.invoke('keep-warm').catch(() => {});

          // ── Deck prefetch for returning users (ORCH-0391) ─────────────
          // Fetch preferences + last-known GPS, then pre-seed deck cache.
          // Runs in parallel with profile loading. Fire-and-forget.
          // Skips new users (empty prefs → handled by ORCH-0386 onboarding).
          (async () => {
            try {
              const prefs = await PreferencesService.getUserPreferences(session.user.id);
              if (!prefs || !prefs.categories?.length) return; // New user or empty — skip

              // Pre-seed preferences cache (saves ~200ms re-fetch post-transition)
              queryClient.setQueryData(['userPreferences', session.user.id], prefs);

              // Get last-known GPS (fast — reads cached position, no new fix)
              const Location = await import('expo-location');
              const loc = await Location.getLastKnownPositionAsync();
              if (!loc) return; // No GPS cache — can't build deck key

              const coords = { lat: loc.coords.latitude, lng: loc.coords.longitude };
              const normalizedCategories = normalizeCategoryArray(prefs.categories);
              const normalizedIntents = prefs.intents ?? [];

              const deckQueryKey = buildDeckQueryKey({
                lat: coords.lat,
                lng: coords.lng,
                categories: normalizedCategories,
                intents: normalizedIntents,
                travelMode: prefs.travel_mode ?? 'walking',
                travelConstraintType: 'time',
                travelConstraintValue: prefs.travel_constraint_value ?? 30,
                datetimePref: prefs.datetime_pref ?? undefined,
                dateOption: prefs.date_option ?? 'today',
                batchSeed: 0,
                excludeCardIds: [],
              });

              const result = await deckService.fetchDeck({
                location: coords,
                categories: normalizedCategories,
                intents: normalizedIntents,
                travelMode: prefs.travel_mode ?? 'walking',
                travelConstraintType: 'time' as const,
                travelConstraintValue: prefs.travel_constraint_value ?? 30,
                datetimePref: prefs.datetime_pref ?? undefined,
                dateOption: prefs.date_option ?? 'today',
                batchSeed: 0,
                limit: 200,
                excludeCardIds: [],
              });

              // Guard: don't cache empty results — likely auth failure, not genuine empty pool.
              // The normal post-transition useDeckCards flow will retry with valid token. ORCH-0387.
              if (result.cards.length === 0) {
                if (__DEV__) console.warn('[Auth] Deck prefetch returned 0 cards — skipping cache (possible auth failure)');
              } else {
                queryClient.setQueryData(deckQueryKey, result);
                if (__DEV__) {
                  console.log(`[Auth] Deck prefetch complete: ${result.cards.length} cards cached`);
                }
              }
            } catch (err) {
              if (__DEV__) console.warn('[Auth] Deck prefetch failed (will use normal path):', err);
            }
          })();

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
                  await signOutWithPrivateCleanup('profile-missing-invalid-session', session.user.id);
                  if (mounted) {
                    setAuth(null);
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
              if (profile.explorer_deleted_at) {
                logger.auth('Explorer side deleted — signing out consumer session');
                await signOutWithPrivateCleanup(
                  "explorer-side-deleted",
                  session.user.id,
                );
                if (mounted) {
                  setAuth(null);
                  setProfile(null);
                  setLoading(false);
                }
                return;
              }
              logger.auth('Profile loaded', { displayName: profile.display_name, onboarding: profile.has_completed_onboarding });
              if (mounted) setProfile(profile);
            }
          } catch (profileError) {
            logger.error('Profile load exception', { error: String(profileError) });
            console.error("Error loading profile:", profileError);
          }
        } else {
          logger.auth('No session — user not authenticated');
          void performPrivateAuthCleanup({ reason: 'initial-no-session', currentUserId: null });
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
    // INVARIANT I-AUTH-CB-01: This callback is AWAITED by the Supabase SDK's
    // _notifyAllSubscribers() during initialization. Any `await` on a Supabase
    // client method (supabase.from(), .rpc(), .functions.invoke(), .auth.getUser(),
    // .auth.getSession()) will deadlock because those methods internally call
    // getSession() which awaits initializePromise — which is waiting for THIS
    // callback to complete. Only synchronous operations allowed here.
    // Profile loading is handled by initializeAuth() above.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
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
          predicate: (query: { state: { status: string } }) => query.state.status === 'error',
        });
      }

      if (session?.user) {
        // ORCH-0926: keep realtime auth in sync with the current access token
        // across sign-in, user-switch, and TOKEN_REFRESHED events, then rebind
        // RLS-gated postgres_changes channels on token-changing auth events so
        // the channel JOIN carries the current JWT.
        if (session.access_token) {
          void Promise.resolve(supabase.realtime.setAuth(session.access_token)).catch(() => {});
          if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
            void realtimeService.rebindAuthenticatedChannels();
          }
        }

        const previousUser = useAppStore.getState().user;
        if (previousUser?.id && previousUser.id !== session.user.id) {
          void performPrivateAuthCleanup({
            reason: 'auth-user-switch',
            previousUserId: previousUser.id,
            currentUserId: session.user.id,
            includeIntegrations: false,
          });
        }
        if (mounted) {
          setAuth(session.user as User);
          setLoading(false);
        }
        // Profile fetch deferred via setTimeout(0) to avoid deadlock.
        // The Supabase SDK's _notifyAllSubscribers() AWAITS this callback.
        // A direct `await supabase.from()` here would call getSession() which
        // awaits initializePromise — circular deadlock (see I-AUTH-CB-01 above).
        // setTimeout(0) breaks out of the await chain: by the time the deferred
        // function runs, _notifyAllSubscribers has already resolved this callback,
        // initializePromise has completed, and getSession() works normally.
        setTimeout(async () => {
          if (!mounted) return;
          try {
            const { data: profile } = await supabase
              .from("profiles")
              .select("*")
              .eq("id", session.user.id)
              .single();
            if (profile && mounted) setProfile(profile);
          } catch (e) {
            console.error("Profile load in auth callback failed:", e);
          }
        }, 0);
      } else {
        if (event === 'SIGNED_OUT') {
          // Guard against multiple instances firing simultaneously
          if (_isHandlingSignOut) return;
          _isHandlingSignOut = true;
          // ORCH-0926: drop the user JWT from realtime on sign-out so the
          // websocket reverts to anon (Constitutional #6: logout clears
          // everything). The next user's sign-in re-authenticates via the
          // session-restore branch above.
          void Promise.resolve(supabase.realtime.setAuth('')).catch(() => {});
          realtimeService.unsubscribeAll();
          void performPrivateAuthCleanup({ reason: 'auth-state-signed-out', currentUserId: null });
          if (mounted) {
            setAuth(null);
          }
          // Reset after a tick so re-login within the same session works correctly
          setTimeout(() => { _isHandlingSignOut = false; }, 1000);
        }
      }

      if (mounted) {
        setLoading(false);
      }
    });

    return () => {
      mounted = false;
      // #1875 — C1: stop any in-flight bounded transport retry.
      isMountedRef.current = false;
      subscription.unsubscribe();
    };
  }, []);

  const signOut = async (options?: { skipPrivateCleanup?: boolean }) => {
    try {
      logger.auth('Sign out requested');
      const { error } = options?.skipPrivateCleanup
        ? await signOutWithoutPrivateCleanup()
        : await signOutWithPrivateCleanup('useAuthSimple.signOut', user?.id);
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
    // #1875 [transient-signin-failure] — declared OUTSIDE the try so the catch
    // can read them. `transportRetryAttempts` selects the retry-exhausted copy;
    // `retryAbandoned` suppresses the Alert (and ONLY the Alert) when the user
    // walked away mid-retry.
    let transportRetryAttempts = 0;
    let retryAbandoned = false;
    // #1875 — cancellation checkpoints C1 (hook unmounted) and C2 (app
    // backgrounded), read FRESH on every call. C2 tests === "background" and NOT
    // !== "active": "inactive" is a normal iOS transition state while a system
    // sheet is up or Control Centre is pulled, and currentState can be null very
    // early in the process — both would cancel spuriously. A synchronous
    // property read: no listener, no subscription, no cleanup.
    //
    // ┌── DO NOT ── inline this back into the two checkpoints. TypeScript
    // narrows `AppState.currentState` after the first `=== "background"` test,
    // so the SECOND checkpoint — the one that matters, because it runs AFTER the
    // sleep, when the state genuinely can have changed — then fails to compile
    // as "no overlap". Reading through this closure keeps both checkpoints
    // honest without a cast or a suppression. Return type is inferred (boolean)
    // on purpose: the #1044 harnesses execute this body through `new Function`,
    // which compiles JS, and an annotation here would be a ReferenceError-class
    // syntax failure in a sliced body.
    // └──
    const retryCancelled = () =>
      !isMountedRef.current || AppState.currentState === "background";
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

      // #1044 [auth-failure-sentry-capture] / #1038 — HANDLE THE RESOLVED CANCEL.
      // google-signin v16 RESOLVES with `{ type: "cancelled", data: null }` when
      // the user backs out of the account picker; it does NOT reject with
      // `statusCodes.SIGN_IN_CANCELLED`. Verified in the installed SDK's own
      // types: `signIn(): Promise<SignInSuccessResponse | CancelledResponse>`
      // (node_modules/@react-native-google-signin/google-signin/lib/typescript/
      //  src/signIn/GoogleSignin.d.ts), identical in 16.0.0 and 16.1.2.
      //
      // Discarding this result sent control straight into getTokens(), which
      // throws `code: "getTokens"` — a code no exclusion covers — so every
      // picker cancel produced a Sentry capture AND a "Google Sign-In Failed"
      // Alert. Live-fired on the business twin of this code: three cancels,
      // three captures. Backing out of a picker is not a failure.
      //
      // Returning here — before getTokens() is ever called — is the root fix:
      // no capture, no Alert, no trackLoginFailed, and the catch block below is
      // never entered. The returned shape is identical to the pre-existing
      // `statusCodes.SIGN_IN_CANCELLED` branch in that catch. Do NOT "solve"
      // this by adding "getTokens" to shouldReportAuthFailure's exclusion set;
      // that would blind us to genuine token failures — the #1038 bug class.
      if (googleUser?.type === "cancelled") {
        return { data: null, error: { message: "Sign-in cancelled" } };
      }

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
        } else if ((googleUser as unknown as { user?: { email?: string } })?.user?.email) {
          googleEmail = (googleUser as unknown as { user: { email: string } }).user.email.toLowerCase().trim();
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

      // #1875 [transient-signin-failure] — bounded retry of the SUPABASE TOKEN
      // EXCHANGE ONLY. The Google ID token is already in hand, this is a plain
      // server round-trip, and no user-facing UI is re-presented — WelcomeScreen
      // set isGoogleSignInInProgress before awaiting this call and clears it in
      // finally, so its existing spinner and accessibilityState.busy simply stay
      // up for up to ~1.6s longer. No new UI, no new state.
      //
      // The provider leg is NEVER auto-retried: re-invoking GoogleSignin.signIn()
      // would shove the account picker back in the user's face, which is a worse
      // defect than the one being fixed. That is why "transient-provider" is
      // transient for COPY only and is not retry-eligible here.
      //
      // ┌── DO NOT ── the bound is a COUNTER against a frozen constant, never a
      // predicate over the error. `transportRetryAttempts` is incremented
      // unconditionally on every completed iteration, so even an error that
      // always classifies transient terminates after exactly two extra attempts.
      // A `while (isTransient(error))` without the counter would be a defect.
      // └──
      while (
        error &&
        transportRetryAttempts < TRANSPORT_RETRY_MAX_ATTEMPTS &&
        classifyAuthFailure(
          error.name,
          error.code,
          error.status,
          error.message,
          Platform.OS,
        ).startsWith("transient-transport")
      ) {
        if (retryCancelled()) {
          retryAbandoned = true;
          break;
        }
        await new Promise((resolve) =>
          setTimeout(resolve, TRANSPORT_RETRY_DELAYS_MS[transportRetryAttempts]),
        );
        if (retryCancelled()) {
          retryAbandoned = true;
          break;
        }
        transportRetryAttempts += 1;
        ({ data, error } = await supabase.auth.signInWithIdToken({
          provider: "google",
          token: tokens.idToken,
        }));
      }

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
          !!(existingUser && error.message?.includes("user"));

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

      // Profile loading is handled by a deferred fetch in the onAuthStateChange
      // callback (setTimeout(0) to avoid deadlock — see I-AUTH-CB-01).

      logger.auth('Google sign-in completed successfully');
      return { data: data.session, error: null };
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      const code = (err as { code?: unknown })?.code;
      // #1044 [auth-failure-sentry-capture] / #1038 — report to engineering
      // BEFORE any early return. Placed first on purpose: the SIGN_IN_CANCELLED /
      // IN_PROGRESS / PLAY_SERVICES_NOT_AVAILABLE branches below return, so a
      // capture placed after them would never see those codes and the exclusion
      // set would be dead code. The exclusion set exists so picker cancellations
      // and double-taps cannot drown the signal, and shouldReportAuthFailure's
      // `typeof code !== "string"` guard MUST run first (codeless errors are the
      // #1038 class). Additive ONLY — the logger/console/Mixpanel calls, the
      // branches, the Alerts and the return values below are all unchanged, and
      // reportNonFatal cannot throw or block (synchronous, try/catch-wrapped).
      if (shouldReportAuthFailure(code)) {
        const reportCode =
          typeof code === "string" || typeof code === "number"
            ? String(code)
            : "none";
        reportNonFatal(
          "auth.signInWithGoogle.native",
          error,
          {
            provider: "google",
            code: reportCode,
            platform: Platform.OS,
            osVersion: String(Platform.Version),
            // #1044 — identifies WHICH OAuth client this build was configured
            // against (the exact axis #1038 turned on) without publishing the
            // id. Slice the DISCRIMINATING segment: everything before the first
            // "." is the project number + client hash
            // ("169132274606-hp7cne780gsp7s6l1rrvbfktp6smrfs0"); everything
            // after it is the literal ".apps.googleusercontent.com", which every
            // Google client id on earth shares. A naive `.slice(-8)` of the WHOLE
            // id therefore returned the constant "tent.com" for every possible
            // client — proven live against a deliberately invalid id — so the
            // one axis this field exists for was not actually being captured.
            // Last 8 chars of the discriminating segment only: never the full
            // client id, never the Google account email available on the sign-in
            // response, never a token
            // (I-PROPOSED-1044-AUTH-FAILURE-REPORTED).
            webClientIdSuffix:
              typeof webClientId === "string" && webClientId.length > 0
                ? webClientId.split(".")[0].slice(-8)
                : "unset",
          },
          // Group by provider + code, never by message: Google's messages vary
          // by device locale and GMS version, so message grouping would shatter
          // one systemic outage into dozens of issues.
          ["auth-signin", "google", reportCode],
        );
      }
      logger.error('Google sign-in failed', { code, message: error.message });
      console.error("Google sign-in error:", code, error.message, err);
      mixpanelService.trackLoginFailed('google', error.message);

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

      // #1875 [transient-signin-failure] — F-4. The user NEVER sees a caught
      // error's value again. `error.message` here is whatever auth-js put in it;
      // for a 502/503/504 that is JSON.stringify(Response), carrying our Supabase
      // project URL and a blob id. Every string below is a fixed i18n key, never
      // an interpolation, never a concatenation. The full original message still
      // reaches Sentry via the #1044 capture above, unchanged.
      if (retryAbandoned) {
        // The user backgrounded the app or the screen went away mid-retry.
        // Suppress the modal ONLY — the capture, logger, console and Mixpanel
        // calls above all already fired, and the return value is unchanged.
        return { data: null, error };
      }
      const failure = classifyAuthFailure(
        error.name,
        code,
        (err as { status?: unknown })?.status,
        error.message,
        Platform.OS,
      );
      let alertTitleKey = "auth:welcome.sign_in_failed_title";
      let alertBodyKey = "auth:welcome.sign_in_permanent_body";
      if (failure !== "permanent") {
        if (transportRetryAttempts > 0) {
          alertTitleKey = "auth:welcome.sign_in_retry_exhausted_title";
          alertBodyKey = "auth:welcome.sign_in_retry_exhausted_body";
        } else if (failure === "transient-transport-offline") {
          alertTitleKey = "auth:welcome.sign_in_offline_title";
          alertBodyKey = "auth:welcome.sign_in_offline_body";
        } else {
          alertBodyKey = "auth:welcome.sign_in_failed_body";
        }
      }
      // Single button on purpose. Alert.alert is fire-and-forget, so
      // WelcomeScreen's finally has already re-enabled the button by the time
      // this renders — a "Try again" onPress would re-enter sign-in with no busy
      // state and no disabled button, inviting GMS IN_PROGRESS (12502). The
      // correctly-wired affordance is the Continue button itself, which every
      // string points the user back at.
      Alert.alert(i18n.t(alertTitleKey), i18n.t(alertBodyKey), [
        { text: i18n.t("auth:welcome.sign_in_failed_ok") },
      ]);
      return { data: null, error };
    }
  };

  const signInWithApple = async () => {
    // #1875 [transient-signin-failure] — same contract as signInWithGoogle. Apple
    // has no Google Play Services layer, so "transient-provider" is unreachable
    // here; the transport leg is byte-for-byte the same signInWithIdToken call
    // and therefore had the byte-for-byte same leak.
    let transportRetryAttempts = 0;
    let retryAbandoned = false;
    // #1875 — C1 / C2, identical contract to signInWithGoogle. See the banner
    // there for why this is a closure and not two inline reads.
    const retryCancelled = () =>
      !isMountedRef.current || AppState.currentState === "background";
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
      let { data, error } = await supabase.auth.signInWithIdToken({
        provider: "apple",
        token: credential.identityToken,
      });

      // #1875 [transient-signin-failure] — bounded retry of the SUPABASE TOKEN
      // EXCHANGE ONLY, identical contract to the Google path above. The Apple
      // identity token is already in hand; AppleAuthentication.signInAsync() is
      // never re-invoked, because that would re-present the Face ID sheet.
      // The bound is a counter against a frozen constant — see the Google banner.
      while (
        error &&
        transportRetryAttempts < TRANSPORT_RETRY_MAX_ATTEMPTS &&
        classifyAuthFailure(
          error.name,
          error.code,
          error.status,
          error.message,
          Platform.OS,
        ).startsWith("transient-transport")
      ) {
        if (retryCancelled()) {
          retryAbandoned = true;
          break;
        }
        await new Promise((resolve) =>
          setTimeout(resolve, TRANSPORT_RETRY_DELAYS_MS[transportRetryAttempts]),
        );
        if (retryCancelled()) {
          retryAbandoned = true;
          break;
        }
        transportRetryAttempts += 1;
        ({ data, error } = await supabase.auth.signInWithIdToken({
          provider: "apple",
          token: credential.identityToken,
        }));
      }

      if (error) {
        throw error;
      }

      if (!data.session) {
        throw new Error("Failed to create session");
      }

      // Profile loading is handled by a deferred fetch in the onAuthStateChange
      // callback (setTimeout(0) to avoid deadlock — see I-AUTH-CB-01).
      // Apple name update: if Apple provided name data, fire-and-forget the update.
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

      // #1044 [auth-failure-sentry-capture] / #1038 — report to engineering
      // BEFORE the ERR_REQUEST_CANCELED early return below, so the predicate
      // actually sees that code and the exclusion is provable. The exclusion set
      // exists so user cancellations cannot drown the signal, and
      // shouldReportAuthFailure's `typeof code !== "string"` guard MUST run first
      // (a codeless "Failed to create session" is the #1038 class). Additive
      // ONLY — the branch order, the Alert copy and every return value below are
      // unchanged, and reportNonFatal cannot throw or block.
      if (shouldReportAuthFailure(code)) {
        const reportCode =
          typeof code === "string" || typeof code === "number"
            ? String(code)
            : "none";
        reportNonFatal(
          "auth.signInWithApple.native",
          error,
          {
            provider: "apple",
            code: reportCode,
            platform: Platform.OS,
            osVersion: String(Platform.Version),
            // #1044 — NO `webClientIdSuffix` here, deliberately. That field
            // describes a GOOGLE OAuth client; an Apple Services-ID fault is not
            // described by it, and carrying it on this path was a misleading
            // field on every Apple event. Apple has no equivalent client id
            // available at this point, and Sentry's own `release`/`dist` already
            // identify the build, so this payload is FOUR keys, not five. Never
            // add Apple's identityToken / fullName / user identifier here
            // (I-PROPOSED-1044-AUTH-FAILURE-REPORTED).
          },
          ["auth-signin", "apple", reportCode],
        );
      }

      // Handle specific error cases
      if (code === "ERR_REQUEST_CANCELED") {
        if (__DEV__) logger.auth('Apple sign-in cancelled by user');
        return { data: null, error: { message: "Sign-in cancelled" } };
      }

      logger.error('Apple sign-in failed', { code, message: error.message });
      console.error("Apple sign-in error:", err);
      mixpanelService.trackLoginFailed('apple', error.message);

      // #1875 [transient-signin-failure] — F-4, Apple half. Same leak, same
      // signInWithIdToken leg, same fix. Copy is provider-neutral so both paths
      // share it. See the Google block above for the full rationale.
      if (retryAbandoned) {
        return { data: null, error };
      }
      const failure = classifyAuthFailure(
        error.name,
        code,
        (err as { status?: unknown })?.status,
        error.message,
        Platform.OS,
      );
      let alertTitleKey = "auth:welcome.sign_in_failed_title";
      let alertBodyKey = "auth:welcome.sign_in_permanent_body";
      if (failure !== "permanent") {
        if (transportRetryAttempts > 0) {
          alertTitleKey = "auth:welcome.sign_in_retry_exhausted_title";
          alertBodyKey = "auth:welcome.sign_in_retry_exhausted_body";
        } else if (failure === "transient-transport-offline") {
          alertTitleKey = "auth:welcome.sign_in_offline_title";
          alertBodyKey = "auth:welcome.sign_in_offline_body";
        } else {
          alertBodyKey = "auth:welcome.sign_in_failed_body";
        }
      }
      Alert.alert(i18n.t(alertTitleKey), i18n.t(alertBodyKey), [
        { text: i18n.t("auth:welcome.sign_in_failed_ok") },
      ]);
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
