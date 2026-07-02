import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
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
// ORCH-0808 — AppsFlyer identity binding + first-event fire.
import {
  setAppsFlyerUserId,
  clearAppsFlyerUserId,
  registerAppsFlyerDevice,
  resetAppsFlyerDeviceCache,
  logAppsFlyerEvent,
} from "../services/appsFlyerService";
// ORCH-0808-FOLLOWUP — Mixpanel identity binding.
import { reportNonFatal } from "../diagnostics/reportNonFatal";
import { mixpanelService } from "../services/mixpanelService";
// META-ORCH-1187 [Growth Analytics Hub] — PostHog identity bind + reset runs
// alongside Mixpanel/AppsFlyer (parallel run; do NOT remove them).
import { postHogService } from "../services/postHogService";
// ORCH-0808-FOLLOWUP — RevenueCat identity binding (install-only scope).
import { revenueCatService } from "../services/revenueCatService";
// ORCH-0808-FOLLOWUP — OneSignal identity binding (install-only scope).
import {
  loginToOneSignal,
  logoutOneSignal,
} from "../services/oneSignalService";
import {
  classifyBootSessionProbe,
  deriveBusinessAuthStatus,
  hasUsableBusinessSession,
  isBusinessAuthReady,
  type BusinessAuthStatus,
} from "../utils/authReadiness";
// ORCH-0740 Cycle 1: clear React Query cache on signOut (Constitutional #6).
// Companion to clearAllStores() — Zustand was previously the only layer reset
// on signOut, leaving React Query cache as a Constitutional #6 leak (HF-1
// from ORCH-0738). queryClient.clear() removes all cached query data without
// triggering refetches. Imports the singleton from the same location used by
// QueryClientProvider in app/_layout.tsx.
import { queryClient } from "../config/queryClient";
// ORCH-1251 (biz cold-start brands failure) — the auth-scoped query keys to
// reconcile the moment the Supabase client actually holds the access token. On a
// COLD native start, `isAuthReady` (the React flag) flips true a BEAT BEFORE
// supabase-js attaches the JWT to outgoing PostgREST requests, so the
// `enabled`-edge refetch in useBrands/useCreatorAccount can fire in the pre-token
// window — getBrands then THROWS BrandsAuthSessionNotAttachedError → React Query
// caches isError → "Couldn't load your brands." And because `enabled` never
// transitions again once the token attaches, nothing refetches. We drive the
// recovery off the REAL token-attach signal — the onAuthStateChange event — not
// the isAuthReady flag. brandKeys.all / creatorAccountKeys.all invalidate every
// per-account variant of those queries.
//
// Import from the STANDALONE keyless key modules (NOT the hook files) — the hooks
// import `useAuth` from this file, so importing the keys from them would create a
// require-cycle (AuthContext ↔ useBrands / AuthContext ↔ useCreatorAccount) that
// the I-PROPOSED-K require-cycles gate rejects. The keyless modules import
// nothing from AuthContext, so the cycle is broken (ORCH-0965 upcomingKeys pattern).
import { brandKeys } from "../hooks/brandKeys";
import { creatorAccountKeys } from "../hooks/creatorAccountKeys";
// META-ORCH-1235 (§5.1) — bound the boot getUser() probe so it cannot consume
// the full 7s ceiling; on timeout it throws → existing fail-OPEN catch keeps
// the user signed in.
import { withTimeout, AUTH_PROBE_TIMEOUT_MS } from "../utils/withTimeout";

// ORCH-0887-A [Auth getSession Promise.race timeout] — close indefinite
// loader hang on business-web. SPEC §2.1: constant inline at top of
// AuthContext.tsx, NO authConstants.ts extraction (single consumer).
// SPEC §2.3: 3000ms is generous upper bound (8x slower than expected
// worst case; catches stalled promises without false-positives on slow
// networks). I-AUTH-BOOTSTRAP-TIMEOUT (NEW invariant per ORCH-0887-A).
export const AUTH_BOOTSTRAP_TIMEOUT_MS = 3000;
// ORCH-1102 Wave 2 [bounded loading — never an infinite spinner] — hard
// wall-clock CEILING on the loading gate. The ORCH-0887-A Promise.race above
// normally flips `loading` false within 3s, but the ORCH-1100 web GoTrue lock
// (`navigatorLock`) can DEADLOCK in pathological contexts (orphaned-lock
// thrash / microtask starvation / a StrictMode unmount-bail that skips the
// race's setLoading(false)), leaving `loading` stuck true → an INFINITE
// spinner at `_layout`/`index`. Seth's hard rule: a user must NEVER be left
// hanging. This backstop is an INDEPENDENT setTimeout (NOT a Promise.race arm
// living inside the locked auth subsystem, so it can't be starved by the lock)
// that force-resolves `loading` false if bootstrap has not resolved by the
// ceiling. An unresolvable session is then treated as logged-out and the
// route gates send the user to the real sign-in screen — somewhere actionable,
// never a permanent spinner. The ceiling is deliberately well ABOVE the normal
// warm path + the 3s race + the 2.3s lock self-heal budget so it is a true
// LAST-RESORT backstop that NEVER pre-empts a real (slow) session and never
// causes a false logged-out flash. Web-only (native already resolves; the
// splash covers native boot — do not regress native).
export const AUTH_RESOLUTION_HARD_CEILING_MS = 7000;
const WEB_AUTH_STORAGE_KEY = "sb-gqnoajqerqhnvulmnyvv-auth-token";

// ORCH-1220 [business-reviewer-bypass] — the ONE email routed through the
// reviewer-signin edge function instead of the normal email-OTP send/verify.
// This is NOT a secret — it is the fixed App-Store / Play reviewer login
// address. The actual bypass is gated server-side by the secret
// REVIEWER_BYPASS_CODE (Supabase function secret). The reviewer types this
// email + the code (entered in the normal 6-digit code field) at the login
// screen; we never send a real email for it and never call verifyOtp for it.
const REVIEWER_EMAIL = "appreview@usemingla.com";
const isReviewerEmail = (email: string): boolean =>
  email.trim().toLowerCase() === REVIEWER_EMAIL;
// SPEC §2.1: Symbol sentinel (NOT { __timedOut: true } flag) —
// referentially unique, impossible to collide with any legitimate
// getSession() return shape.
const AUTH_BOOTSTRAP_TIMEOUT = Symbol("auth-bootstrap-timeout");
type AuthBootstrapTimeout = typeof AUTH_BOOTSTRAP_TIMEOUT;

const readStoredWebSession = (): Session | null => {
  if (Platform.OS !== "web" || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(WEB_AUTH_STORAGE_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Session;
    return hasUsableBusinessSession(parsed) ? parsed : null;
  } catch (_error) {
    return null;
  }
};

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
  authStatus: BusinessAuthStatus;
  isAuthReady: boolean;
  hasUsableSession: boolean;
  authError: Error | null;
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
  // ORCH-1204 [web-auth-bootstrap-lock]: web hydrates session/user/loading
  // SYNCHRONOUSLY from the valid persisted token so isAuthReady is true on first
  // paint — the gotrue Navigator-Locks lock contention (multi-tab + AuthProvider
  // remount) can make getSession() exceed the 3s bootstrap timeout, which
  // previously left isAuthReady false → useBrands disabled → "Loading brands…"
  // wedge. readStoredWebSession() is web-only + SSR-guarded so native is
  // byte-identical and prerender returns null. The lazy useState initializers
  // each run exactly once at mount (no render loop). The background bootstrap(),
  // the ORCH-0887-A 3s race, the ORCH-1102 7s ceiling, the ORCH-1106
  // revoked-session probe, and the ORCH-1004 late-adopt all still run to catch a
  // locally-valid-but-server-revoked token — they just no longer gate first
  // paint. I-PROPOSED-1204-WEB-AUTH-SYNC-HYDRATION.
  // DO NOT revert to useState(null/null/true).
  const initialStored = readStoredWebSession();
  const [session, setSession] = useState<Session | null>(() => initialStored);
  const [user, setUser] = useState<User | null>(() => initialStored?.user ?? null);
  const [loading, setLoading] = useState<boolean>(() => initialStored === null);
  const [authError, setAuthError] = useState<Error | null>(null);
  // Cycle 14 — D-CYCLE14-FOR-6 + I-35: recover-on-sign-in flag.
  const [lastRecoveryEvent, setLastRecoveryEvent] = useState<{
    recoveredAt: string;
  } | null>(null);
  const clearLastRecoveryEvent = useCallback((): void => {
    setLastRecoveryEvent(null);
  }, []);

  // ORCH-0808 — fires af_complete_registration / af_login at most once per
  // auth session lifecycle. Reset on SIGNED_OUT so the next sign-in re-fires.
  const afEventFiredRef = useRef(false);
  // ORCH-0887-A [Auth getSession Promise.race timeout] — set true when the
  // bootstrap Promise.race resolves to the timeout sentinel. SPEC §3.3 / §4
  // decision (b) ref-guarded skip. READ by the onAuthStateChange listener:
  // a late-arriving INITIAL_SESSION event after timeout is the original
  // getSession() Promise resolving against the live Supabase client; if we
  // honoured it we would flash anon→home and re-fire ensureCreatorAccount +
  // analytics-identities. Any subsequent non-INITIAL_SESSION event clears
  // the gate so the listener resumes normal processing.
  const bootstrapTimedOutRef = useRef(false);
  // ORCH-1106 [native authenticated, no-brand degraded shell] — run the
  // boot-time authenticated probe AT MOST ONCE per cold start. `getSession()`
  // trusts the cached token without server validation, so a server-revoked
  // (but locally-unexpired) session deserializes to a truthy `user` and
  // strands the app on a brand-less degraded shell with no `SIGNED_OUT`.
  // After a locally-trusted session resolves, we hit the server ONCE with
  // `getUser()`; on an explicit auth invalidation we sign out (which routes
  // to the sign-in screen). This ref prevents re-probing on later
  // onAuthStateChange echoes / re-renders (no #185-style loop).
  const bootSessionProbedRef = useRef(false);
  // ORCH-1251 [biz cold-start brands failure] — the user id we've already
  // reconciled the auth-scoped React Query cache for, once the Supabase client
  // holds the token. On a COLD start the auth-scoped reads (brands, creator
  // account) can fire in the window where `isAuthReady` is already true but the
  // JWT is NOT yet attached to outgoing requests → getBrands THROWS
  // BrandsAuthSessionNotAttachedError → React Query caches isError and never
  // refetches (the `enabled` edge does not transition again). This ref lets us
  // invalidate those keys EXACTLY ONCE per session, on the token-attach edge (an
  // onAuthStateChange event delivering a usable session for a NOT-yet-reconciled
  // user), so the cached pre-token error clears and the read re-runs authed.
  // Guarding on the user id means a plain TOKEN_REFRESHED that merely rotates the
  // token for an already-reconciled session does NOT re-invalidate everything
  // (no refetch storm, no #185 re-render loop — matches the sibling ref-guards).
  const reconciledAuthScopedForUserRef = useRef<string | null>(null);

  useEffect(() => {
    let mounted = true;

    // ORCH-1102 Wave 2 — bounded-loading hard ceiling (web only). Independent
    // wall-clock backstop: if neither the Promise.race timeout branch nor a
    // resolved getSession() has flipped `loading` false by the ceiling (a
    // GoTrue web-lock deadlock the race can't escape), force it false here so
    // the spinner can never be permanent. Treats an unresolvable session as
    // logged-out (the route gates redirect to sign-in). Cleared on unmount and
    // implicitly superseded by any real resolution (setLoading(false) is
    // idempotent; bootstrapTimedOutRef already gates late real sessions). Not
    // armed on native — native bootstrap resolves and the splash covers boot.
    let hardCeilingTimer: ReturnType<typeof setTimeout> | null = null;
    if (Platform.OS === "web") {
      hardCeilingTimer = setTimeout(() => {
        if (!mounted) return;
        console.warn(
          `[auth] resolution-hard-ceiling: auth did not resolve within ${AUTH_RESOLUTION_HARD_CEILING_MS}ms — releasing the loading gate (treating as logged-out so the user lands on sign-in, never an infinite spinner)`,
        );
        // Preserve any stored web session so a genuinely slow-but-valid session
        // still warms via a late SIGNED_IN/TOKEN_REFRESHED event; only the
        // spinner is released. With no stored session, user stays null and the
        // route gates send the user to the real sign-in screen.
        // ORCH-1204: the ceiling releases only `loading`; it MUST NOT clear
        // `user`/`session` — a synchronously-hydrated valid web session must
        // survive the ceiling (SC-4).
        bootstrapTimedOutRef.current = true;
        setLoading(false);
      }, AUTH_RESOLUTION_HARD_CEILING_MS);
    }

    const bootstrap = async () => {
      if (__DEV__) {
        console.info("[auth] bootstrap-start");
      }
      // ORCH-0887-A [Auth getSession Promise.race timeout] — close the
      // indefinite loader hang. SPEC §2.2: race getSession() against a
      // 3s timeout. On timeout, fall through as anon (silent — SPEC §3
      // Option A: NO toast, NO retry CTA, NO authError surfaced; user
      // sees BusinessWelcomeScreen and can sign in normally). The
      // console.warn satisfies I-NO-SILENT-FAILURES. SPEC §6: no
      // Platform.OS gate — timeout is universal (essentially never
      // fires on native; safety net only).
      type GetSessionResult = Awaited<
        ReturnType<typeof supabase.auth.getSession>
      >;
      const timeoutPromise = new Promise<AuthBootstrapTimeout>((resolve) => {
        setTimeout(() => resolve(AUTH_BOOTSTRAP_TIMEOUT), AUTH_BOOTSTRAP_TIMEOUT_MS);
      });
      const raceResult: GetSessionResult | AuthBootstrapTimeout =
        await Promise.race([supabase.auth.getSession(), timeoutPromise]);
      if (raceResult === AUTH_BOOTSTRAP_TIMEOUT) {
        console.warn(
          `[auth] bootstrap-timeout: getSession() did not resolve within ${AUTH_BOOTSTRAP_TIMEOUT_MS}ms — using stored web session when available`,
        );
        if (!mounted) return;
        // ORCH-1204: this timeout branch deliberately does NOT run the ORCH-1106
        // getUser() probe — the probe lives only in the getSession()-resolved
        // success branch below (gated by bootSessionProbedRef). The synchronous
        // hydration leaves bootSessionProbedRef untouched, so the probe still
        // fires exactly once when getSession() actually resolves, and never on
        // the timeout path. Do NOT add a probe here (would risk signing out a
        // valid user on a slow network — out of scope, dangerous).
        const storedWebSession = readStoredWebSession();
        bootstrapTimedOutRef.current = true;
        setAuthError(null);
        setSession(storedWebSession);
        setUser(storedWebSession?.user ?? null);
        setLoading(false);
        return;
      }
      const {
        data: { session: s },
        error,
      } = raceResult;
      if (!mounted) return;
      if (error) {
        console.warn("[auth] getSession", error.message);
        setAuthError(error);
        setLoading(false);
        return;
      }
      setAuthError(null);
      setSession(s);
      setUser(s?.user ?? null);
      if (__DEV__) {
        console.info(s?.user ? "[auth] bootstrap-ready" : "[auth] bootstrap-no-session");
      }
      if (s?.user) {
        // ORCH-1106 [native authenticated, no-brand degraded shell] — the
        // session above came from `getSession()`, a LOCAL read that trusts
        // the cached access token's `expires_at` without ever contacting the
        // server. A session killed server-side (revoked / signed-out-elsewhere
        // / password change) but whose cached token has not locally expired
        // deserializes here into a truthy `s.user`, so the app routes to Home,
        // the brand list comes back empty under the dead JWT, and the user is
        // stranded on a brand-less degraded shell — NO `SIGNED_OUT` ever fires.
        //
        // Validate the locally-trusted session with ONE real authenticated
        // network call (`getUser()` → `GET /user`). Run it AT MOST ONCE per
        // cold start (ref-guarded; onAuthStateChange echoes never re-probe).
        // De-gated: this runs on native AND web (web shares the same latent
        // stale-valid-session gap — its existing guards only handle "no user
        // at all", never a stale-but-present session).
        //
        // HARD GUARD: sign out ONLY on a POSITIVELY-identified auth/token
        // invalidation (401/403, session_not_found, AuthSessionMissingError,
        // bad_jwt, …). A network / offline / timeout / 5xx error MUST keep the
        // user signed in (classifier fails OPEN). We NEVER key the sign-out off
        // empty brand data — a legitimately brand-less new user with a VALID
        // session stays signed in and sees the normal "Create brand" home.
        if (!bootSessionProbedRef.current) {
          bootSessionProbedRef.current = true;
          try {
            // META-ORCH-1235 (§5.1) — per-probe deadline well under the 7s
            // ceiling. A hung GET /user now rejects with TimeoutError → caught
            // below as a transport failure (fail-OPEN, session kept).
            const { error: probeError } = await withTimeout(
              supabase.auth.getUser(),
              AUTH_PROBE_TIMEOUT_MS,
              "auth:getUser-probe",
            );
            if (!mounted) return;
            if (classifyBootSessionProbe(probeError) === "invalid_session") {
              console.warn(
                "[auth] boot-session-probe: stored session rejected by server",
                `(${probeError?.message ?? "auth error"})`,
                "— signing out and routing to sign-in (ORCH-1106)",
              );
              // signOut() clears stores + RQ cache and fires SIGNED_OUT, which
              // sets user=null so index.tsx lands on BusinessWelcomeScreen.
              await supabase.auth.signOut();
              if (!mounted) return;
              clearAllStores();
              queryClient.clear();
              clearAppsFlyerUserId();
              resetAppsFlyerDeviceCache();
              afEventFiredRef.current = false;
              mixpanelService.trackLogout();
              revenueCatService.logOut();
              logoutOneSignal();
              setAuthError(null);
              setSession(null);
              setUser(null);
              setLoading(false);
              return;
            }
            if (__DEV__) {
              console.info("[auth] boot-session-probe: session valid");
            }
          } catch (probeException) {
            // A thrown exception here is a transport-level failure (the auth-js
            // contract returns auth errors in `{ error }`, not by throwing).
            // Fail OPEN — keep the user signed in; the normal app paths retry.
            if (!mounted) return;
            console.warn(
              "[auth] boot-session-probe: probe threw (transport) — keeping session (ORCH-1106):",
              probeException instanceof Error
                ? probeException.message
                : String(probeException),
            );
          }
        }
        // ORCH-0743 / Note A: wrap ensureCreatorAccount so a creator_accounts
        // upsert error is surfaced (Const #3) without aborting auth bootstrap.
        // Mirrors the getSession error pattern above (line 119).
        try {
          await ensureCreatorAccount(s.user);
        } catch (ensureError) {
          reportNonFatal("auth.ensureCreatorAccount", ensureError, {
            userId: s.user.id,
          });
        }
        // Cycle 14 — recover-on-sign-in auto-clear (D-CYCLE14-FOR-6 + I-35).
        // If creator_accounts.deleted_at is non-null, clear it and emit
        // recovery event so account.tsx shows "Welcome back" toast.
        const recovered = await tryRecoverAccountIfDeleted(s.user.id);
        if (recovered && mounted) {
          setLastRecoveryEvent({ recoveredAt: new Date().toISOString() });
        }
        // ORCH-0808 — bind AppsFlyer identity on warm restore (cold-start
        // with persisted session). Idempotent. No first-event fire here —
        // that lives in the SIGNED_IN branch of onAuthStateChange so we
        // don't inflate af_login counts on every cold launch.
        setAppsFlyerUserId(s.user.id);
        registerAppsFlyerDevice(s.user.id);
        // ORCH-0808-FOLLOWUP — Mixpanel identity on warm restore. Idempotent.
        // No "Login" event fire on warm restore (mirrors AppsFlyer policy).
        mixpanelService.identify(s.user.id);
        // META-ORCH-1187 — PostHog identity on warm restore (SC-7). Idempotent.
        postHogService.identify(s.user.id);
        // ORCH-0808-FOLLOWUP — RevenueCat identity on warm restore. Idempotent.
        revenueCatService.identify(s.user.id);
        // ORCH-0808-FOLLOWUP — OneSignal identity on warm restore. Idempotent.
        loginToOneSignal(s.user.id);
      }
      setLoading(false);
    };

    bootstrap();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, s) => {
      if (!mounted) return;
      // ORCH-0887-A-2 [Late-resolution defense — expand to TOKEN_REFRESHED +
      // USER_UPDATED]: brutal Playwright test against live Chromium proved
      // Supabase v2 fires TOKEN_REFRESHED (not INITIAL_SESSION) when a hung
      // refresh-token request eventually succeeds after bootstrap-timeout.
      //
      // ORCH-1004 [Business web data reliability] — REVISION of the original
      // "ignore every late passive event" behavior. The v1/v2 logic discarded
      // the real session that finally resolved after the 3s bootstrap-timeout,
      // so on a slow cold start the app stayed anon (isAuthReady=false) and
      // every auth-scoped query stayed disabled until a manual refresh — the
      // exact RC-3 tail case in the ORCH-1004 investigation.
      //
      // New behavior: when a PASSIVE late event (INITIAL_SESSION /
      // TOKEN_REFRESHED / USER_UPDATED) arrives post-timeout WITH a usable
      // session, APPLY it (setSession / setUser, clear the timed-out gate) so
      // isAuthReady flips true and the gated queries fire — but DO NOT run the
      // SIGNED_IN-only recovery + first-event analytics block below (that
      // stays gated to `_event === "SIGNED_IN"`). Applying session state
      // without the SIGNED_IN side-effects preserves the ORCH-0887-A
      // anti-flash / no-duplicate-analytics protection the ignore was built
      // for (no ensureCreatorAccount re-run flash, no duplicate af_login /
      // Mixpanel Login). A passive late event with NO usable session is still
      // a stale echo of the failed bootstrap — keep ignoring it.
      if (bootstrapTimedOutRef.current) {
        const isPassiveLateEcho =
          _event === "INITIAL_SESSION" ||
          _event === "TOKEN_REFRESHED" ||
          _event === "USER_UPDATED";
        if (isPassiveLateEcho) {
          if (!hasUsableBusinessSession(s)) {
            if (__DEV__) {
              console.warn(
                `[auth] late ${_event} after bootstrap-timeout with no usable session — ignoring (ORCH-0887-A-2 / ORCH-1004)`,
              );
            }
            return;
          }
          // Late but REAL session — recover it without the SIGNED_IN
          // side-effects (ORCH-1004). Clear the gate, apply session state,
          // and fall through to the shared setSession/setUser writes below.
          // The SIGNED_IN recovery + analytics block stays gated to
          // `_event === "SIGNED_IN"`, so it does NOT fire for this passive
          // recovery — anti-flash / no-duplicate-analytics preserved.
          if (__DEV__) {
            console.warn(
              `[auth] late ${_event} after bootstrap-timeout WITH usable session — applying late session (ORCH-1004)`,
            );
          }
          bootstrapTimedOutRef.current = false;
        } else {
          // Explicit user-intent event (SIGNED_IN / SIGNED_OUT) — clear the
          // gate so the listener resumes normal processing.
          bootstrapTimedOutRef.current = false;
        }
      }
      if (__DEV__) {
        console.info("[auth] auth-event", {
          event: _event,
          hasSession: s !== null,
          hasUser: s?.user !== undefined,
        });
      }
      setAuthError(null);
      setSession(s);
      setUser(s?.user ?? null);
      // ORCH-1251 [biz cold-start brands failure] — token-attach reconciliation.
      // This handler fires with a USABLE session (INITIAL_SESSION / SIGNED_IN /
      // TOKEN_REFRESHED) exactly at the moment the Supabase client holds the
      // access token. That is the REAL token-attach signal — unlike the
      // `isAuthReady` React flag, which flips a beat EARLIER (before the JWT is
      // attached to outgoing PostgREST requests). On a cold start the auth-scoped
      // reads (brands list, creator account) can have already fired in that
      // pre-token window and cached an error (getBrands throws
      // BrandsAuthSessionNotAttachedError) or an anon-empty — and the `enabled`
      // edge never transitions again, so nothing refetches. Invalidate the
      // auth-scoped keys NOW that the token is attached so any query that
      // errored/emptied pre-token re-runs authed and the "Couldn't load your
      // brands." error clears without a force-quit.
      //
      // Ref-guarded to fire ONCE per session (keyed on user id): a later
      // TOKEN_REFRESHED that merely rotates the token for an ALREADY-reconciled
      // session is a no-op here (no invalidation storm, no #185-style re-render
      // loop). We invalidate ONLY the two auth-scoped key roots — NOT
      // queryClient.clear() (far too broad; would nuke public/anon caches too).
      // ORCH-1254 [GoTrue auth-lock deadlock] — supabase-js v2 serializes auth
      // operations behind a lock, and this onAuthStateChange callback runs WHILE
      // HOLDING that lock. Any Supabase-touching / query-invalidating work done
      // inline here holds the lock across its awaits, so a concurrent
      // supabase.auth.getSession() (e.g. the getBrands precheck fired by the very
      // invalidateQueries below) DEADLOCKS waiting on this callback to release —
      // it times out at AUTH_PROBE_TIMEOUT_MS (5s) → "Couldn't load your brands."
      // This is the documented supabase-js gotcha: do NOT call other Supabase
      // functions directly inside onAuthStateChange; DEFER them with setTimeout so
      // they run AFTER the callback returns and the lock releases. It is
      // reviewer-specific because setSession() + an immediate read hits the locked
      // window; Google's warm/OAuth flow does not.
      //
      // The SYNCHRONOUS state writes above (setAuthError/setSession/setUser and the
      // bootstrapTimedOutRef gate) do NOT call any Supabase API, so they stay inline
      // and update routing/isAuthReady promptly. The ORCH-1251 once-per-session
      // reconcile LATCH (reconciledAuthScopedForUserRef) is also decided
      // synchronously here so two events firing before the macrotask runs still
      // reconcile exactly once; only the token-attach invalidateQueries and the
      // s.user side-effects (ensureCreatorAccount / recovery / analytics identify)
      // are moved into the deferred macrotask below.
      const shouldReconcileAuthScoped =
        hasUsableBusinessSession(s) &&
        s?.user?.id !== undefined &&
        reconciledAuthScopedForUserRef.current !== s.user.id;
      if (shouldReconcileAuthScoped && s?.user?.id !== undefined) {
        reconciledAuthScopedForUserRef.current = s.user.id;
        if (__DEV__) {
          console.info(
            "[auth] token-attach reconcile — invalidating auth-scoped brand + creator-account queries (ORCH-1251, deferred out of the auth lock per ORCH-1254)",
          );
        }
      }
      const userForDeferred = s?.user ?? null;
      const eventForDeferred = _event;
      // ORCH-1254 — run all Supabase-touching side-effects on a macrotask so the
      // GoTrue auth lock this callback holds is RELEASED first. setTimeout(…, 0)
      // schedules AFTER the synchronous callback returns and the lock unwinds.
      setTimeout(() => {
        // The provider may have unmounted between scheduling and running.
        if (!mounted) return;
        void (async () => {
          // ORCH-1251 — token-attach reconciliation, deferred out of the lock.
          // brandKeys.all covers brandKeys.list(accountId) + detail + cascade;
          // creatorAccountKeys.all covers creatorAccountKeys.byId(userId).
          if (shouldReconcileAuthScoped) {
            void queryClient.invalidateQueries({ queryKey: brandKeys.all });
            void queryClient.invalidateQueries({
              queryKey: creatorAccountKeys.all,
            });
          }
          if (userForDeferred) {
            // ORCH-0743 / Note A: wrap ensureCreatorAccount so a creator_accounts
            // upsert error is surfaced (Const #3) without aborting the handler.
            try {
              await ensureCreatorAccount(userForDeferred);
            } catch (ensureError) {
              reportNonFatal("auth.ensureCreatorAccount", ensureError, {
                userId: userForDeferred.id,
              });
            }
            // Cycle 14 — recover-on-sign-in auto-clear (D-CYCLE14-FOR-6 + I-35).
            // GATE to SIGNED_IN only — TOKEN_REFRESHED + USER_UPDATED +
            // INITIAL_SESSION also fire with s.user, and would otherwise un-delete
            // an account mid-delete-flow (race between requestDeletion's
            // deleted_at=now() write and the next token-refresh tick). Bootstrap
            // above handles cold-start recovery; only true SIGNED_IN events should
            // trigger recovery from onAuthStateChange. Cycle 14 v2 fix Bug B.
            if (eventForDeferred === "SIGNED_IN") {
              const recovered = await tryRecoverAccountIfDeleted(
                userForDeferred.id,
              );
              if (recovered && mounted) {
                setLastRecoveryEvent({ recoveredAt: new Date().toISOString() });
              }
              // ORCH-0808 — AppsFlyer + Mixpanel identity + first-event fire (once
              // per session). first-time vs returning determined by
              // creator_accounts.created_at recency: ensureCreatorAccount above
              // just inserted-or-noop'd the row, so a created_at within the last 30
              // seconds means this sign-in is the creation event (first-time
              // creator). Otherwise the row pre-existed.
              setAppsFlyerUserId(userForDeferred.id);
              registerAppsFlyerDevice(userForDeferred.id);
              mixpanelService.identify(userForDeferred.id);
              // META-ORCH-1187 — PostHog identity bind on SIGNED_IN (SC-7).
              postHogService.identify(userForDeferred.id);
              revenueCatService.identify(userForDeferred.id);
              loginToOneSignal(userForDeferred.id);
              if (!afEventFiredRef.current) {
                afEventFiredRef.current = true;
                void (async () => {
                  try {
                    const provider =
                      (
                        userForDeferred.app_metadata as
                          | { provider?: string }
                          | undefined
                      )?.provider ?? "email";
                    const method =
                      provider === "google" || provider === "apple"
                        ? provider
                        : "email";
                    const { data: account } = await supabase
                      .from("creator_accounts")
                      .select("created_at, email, display_name")
                      .eq("id", userForDeferred.id)
                      .maybeSingle();
                    const createdAt = account?.created_at
                      ? new Date(account.created_at).getTime()
                      : null;
                    const isFirstTime =
                      createdAt !== null && Date.now() - createdAt < 30_000;
                    if (isFirstTime) {
                      logAppsFlyerEvent("af_complete_registration", {
                        af_registration_method: method,
                      });
                    } else {
                      logAppsFlyerEvent("af_login", {
                        af_login_method: method,
                      });
                    }
                    // Mixpanel bundled login: identify + profile + super properties + Login/Signup event.
                    mixpanelService.trackLogin({
                      id: userForDeferred.id,
                      email: account?.email ?? userForDeferred.email ?? null,
                      provider: method,
                      displayName: account?.display_name ?? null,
                      isFirstTime,
                    });
                    // META-ORCH-1187 — signup conversion (creator account created,
                    // first-time only — SC-6). Event-name identical to the consumer
                    // signup for a clean cross-surface funnel.
                    if (isFirstTime) {
                      postHogService.capture("signup_completed", {
                        method,
                        surface: "business_app",
                      });
                    }
                  } catch (e) {
                    console.warn(
                      "[AppsFlyer/Mixpanel] first-event fire failed:",
                      e,
                    );
                  }
                })();
              }
            }
          }
        })();
      }, 0);
      if (_event === "SIGNED_OUT") {
        // Defensive Constitution #6 coverage — clears stores even when
        // signout happens server-side (token revoked, session expired)
        // without going through our signOut() button.
        if (__DEV__) {
          console.info("[auth] signed-out-store-clear");
        }
        clearAllStores();
        // ORCH-1251 — reset the token-attach reconcile guard so the NEXT
        // sign-in re-reconciles the auth-scoped caches (each session gets one
        // reconcile on its token-attach edge).
        reconciledAuthScopedForUserRef.current = null;
        // ORCH-0740 Cycle 1: companion to clearAllStores() — also clear RQ
        // cache when signOut happens server-side (closes HF-1 from ORCH-0738).
        queryClient.clear();
        // ORCH-0808 — Constitution #6: clear AppsFlyer identity + dedup cache
        // so the next signed-in user is not attributed under the prior user's
        // customer_user_id, and the device-registration upsert re-runs fresh.
        clearAppsFlyerUserId();
        resetAppsFlyerDeviceCache();
        afEventFiredRef.current = false;
        // ORCH-0808-FOLLOWUP — Mixpanel: fire Logout event + reset distinct_id
        // so the next signed-in user is not attributed to the prior user.
        mixpanelService.trackLogout();
        // META-ORCH-1187 — PostHog reset on signout (SC-7 / Constitution #6) so
        // the next user is not attributed under the prior distinct_id.
        postHogService.reset();
        // ORCH-0808-FOLLOWUP — RevenueCat: reset to anonymous appUserID.
        revenueCatService.logOut();
        // ORCH-0808-FOLLOWUP — OneSignal: unlink device from user alias.
        logoutOneSignal();
      }
      setLoading(false);
    });

    return () => {
      mounted = false;
      if (hardCeilingTimer !== null) clearTimeout(hardCeilingTimer);
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
      // ORCH-1220 — reviewer bypass: SKIP the real OTP send so NO email goes
      // out. Return success so the UI advances to the 6-digit code-entry screen
      // (where the reviewer enters the secret bypass code; verifyEmailOtp routes
      // it to the reviewer-signin edge function). Non-reviewer emails are
      // unchanged below.
      if (isReviewerEmail(trimmed)) {
        return { error: null };
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
      // ORCH-1220 — reviewer bypass: route ONLY appreview@usemingla.com to the
      // reviewer-signin edge function (the bypass code is not a 6-digit OTP, so
      // this MUST run before the \d{6} guard below). The function gates on the
      // secret REVIEWER_BYPASS_CODE server-side and only mints a session for the
      // locked reviewer email. On any failure we surface the SAME "invalid code"
      // UX as a normal wrong OTP, so the bypass is indistinguishable from a
      // wrong-code attempt to anyone who doesn't already hold the secret.
      if (isReviewerEmail(trimmedEmail)) {
        try {
          const { data, error: fnError } = await supabase.functions.invoke(
            "reviewer-signin",
            { body: { email: trimmedEmail, code: trimmedCode } },
          );
          const accessToken = (data as { access_token?: string } | null)
            ?.access_token;
          const refreshToken = (data as { refresh_token?: string } | null)
            ?.refresh_token;
          if (fnError || !accessToken || !refreshToken) {
            return {
              error: new Error(
                "That code didn't match or has expired. Try again.",
              ),
            };
          }
          const { error: setError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (setError) {
            return {
              error: new Error(
                "That code didn't match or has expired. Try again.",
              ),
            };
          }
          // ORCH-1254 — a successful setSession() establishes the reviewer session
          // synchronously for state purposes (it fires SIGNED_IN → the
          // onAuthStateChange listener updates session/user). We DELIBERATELY do
          // NOT poll getSession() here: doing so right after setSession() reads the
          // GoTrue auth lock WHILE the SIGNED_IN onAuthStateChange callback is
          // still holding it, which CONTENDS/worsens the very deadlock this ORCH
          // fixes (the getBrands getSession() precheck then hangs to its 5s
          // timeout → "Couldn't load your brands."). The real cure is deferring the
          // callback's Supabase side-effects out of the lock (see onAuthStateChange
          // above); with that in place getSession() resolves normally and the
          // getBrands precheck works. Return success immediately after setSession.
          return { error: null };
        } catch {
          return {
            error: new Error(
              "That code didn't match or has expired. Try again.",
            ),
          };
        }
      }
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
    // ORCH-0740 Cycle 1: companion to clearAllStores() — also clear React
    // Query cache so cached query data doesn't survive signout (closes HF-1
    // from ORCH-0738).
    queryClient.clear();
    // ORCH-0808 — companion to clearAllStores() — clear AppsFlyer identity
    // + dedup cache so the next signed-in user is attributed correctly. The
    // SIGNED_OUT handler in onAuthStateChange also calls this defensively for
    // server-fired signouts (token revoked, etc.); explicit-signOut runs it
    // here for symmetry.
    clearAppsFlyerUserId();
    resetAppsFlyerDeviceCache();
    afEventFiredRef.current = false;
    // ORCH-0808-FOLLOWUP — Mixpanel: fire Logout event + reset distinct_id.
    mixpanelService.trackLogout();
    // META-ORCH-1187 — PostHog reset on explicit signout (SC-7 / Constitution #6).
    postHogService.reset();
    // ORCH-0808-FOLLOWUP — RevenueCat: reset to anonymous appUserID.
    revenueCatService.logOut();
    // ORCH-0808-FOLLOWUP — OneSignal: unlink device from user alias.
    logoutOneSignal();
  }, []);

  const authStatus = useMemo(
    () =>
      deriveBusinessAuthStatus({
        authError,
        loading,
        session,
        user,
      }),
    [authError, loading, session, user],
  );
  const hasUsableSession = useMemo(
    () => hasUsableBusinessSession(session),
    [session],
  );
  const isAuthReady = useMemo(
    () => isBusinessAuthReady(authStatus, session),
    [authStatus, session],
  );

  const value = useMemo(
    () => ({
      user,
      session,
      loading,
      authStatus,
      isAuthReady,
      hasUsableSession,
      authError,
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
      authStatus,
      isAuthReady,
      hasUsableSession,
      authError,
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
