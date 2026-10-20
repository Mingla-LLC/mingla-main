import { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { normalizeAccess } from "../lib/access";
import { runSignOutCleanup } from "../lib/signOutCleanup";

const AuthContext = createContext(null);

/**
 * localStorage key tracking whether the full 2FA flow (password + OTP) completed.
 *
 * Why this exists:
 * - signInWithPassword creates a Supabase session (stored in localStorage by the SDK).
 * - We immediately signOut after password verification, but if the page refreshes
 *   between signInWithPassword and signOut, getSession finds the leftover session.
 * - Without this flag, that session would grant full dashboard access — bypassing 2FA.
 * - This flag is ONLY set after verifyOtp succeeds (or after an invited person
 *   finishes choosing their password). It's checked on every session acceptance
 *   (both getSession on mount AND onAuthStateChange during runtime).
 */
const FULL_AUTH_KEY = "mingla_2fa_complete";

const INVITE_WAITING_MESSAGE =
  "Your invite is waiting. Open the link in your invite email to finish setting up. If you can't find it, ask the person who invited you to send a new one.";
const INVITE_EXPIRED_MESSAGE =
  "This invite link has expired. Ask the person who invited you to send a new one.";
const ACCESS_REMOVED_MESSAGE = "Your access was removed.";

/**
 * Issue #3802 — what the signed-in person may open, read from the server.
 * This is the ONE place the app learns a person's role and areas; every
 * component reads `useAuth().access`, none keeps its own copy.
 *
 * Returns { ok: true, access } (access is null when the person has no team
 * membership) or { ok: false } when the answer could not be fetched.
 */
async function loadAccess() {
  try {
    const [teamResult, operationalResult] = await Promise.all([
      supabase.rpc("admin_team_my_access"),
      supabase.rpc("admin_team_my_operational_areas"),
    ]);
    const error = teamResult.error || operationalResult.error;
    if (error) {
      console.error("[AuthContext] access check failed:", error.message);
      return { ok: false };
    }
    const access = normalizeAccess(teamResult.data);
    if (!access) return { ok: true, access };
    const operationalAreas = Array.isArray(operationalResult.data)
      ? operationalResult.data.filter((area) => typeof area === "string")
      : [];
    return {
      ok: true,
      access: { ...access, areas: [...new Set([...access.areas, ...operationalAreas])] },
    };
  } catch (err) {
    console.error("[AuthContext] access check failed:", err?.message || err);
    return { ok: false };
  }
}

function sameAccess(a, b) {
  return (
    !!a && !!b &&
    a.email === b.email && a.role === b.role && a.status === b.status &&
    a.areas.length === b.areas.length && a.areas.every((x, i) => x === b.areas[i])
  );
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  /**
   * Issue #3802 — { email, role, status, areas } for the signed-in person, or null.
   */
  const [access, setAccess] = useState(null);

  /**
   * True when a session exists but the access check could not be reached. The
   * app then shows a retry screen: never the dashboard, never a blank page.
   */
  const [accessError, setAccessError] = useState(false);

  /**
   * A one-off message for the sign-in screen, set whenever this context signs
   * somebody out on its own, so nobody is signed out without being told why.
   */
  const [authNotice, setAuthNotice] = useState("");

  /**
   * Holds the session for an invited person who opened their invite link.
   * When set, the app shows the password setup screen instead of login or dashboard.
   */
  const [inviteSetup, setInviteSetup] = useState(null);

  /**
   * Suppresses onAuthStateChange during verifyPassword and completeInviteSetup.
   *
   * Why: verifyPassword calls signInWithPassword (fires onAuthStateChange with
   * a valid session) then signOut (fires it with null). Without suppression,
   * React would briefly render the dashboard between those two events.
   */
  const suppressSessionRef = useRef(false);

  /**
   * Set to true synchronously BEFORE calling supabase.auth.verifyOtp().
   *
   * Why: verifyOtp creates a session, and onAuthStateChange fires during the
   * await resolution — BEFORE localStorage.setItem(FULL_AUTH_KEY) executes
   * on the next line. Without this ref, the handler would see a valid session
   * but no FULL_AUTH_KEY flag, and reject it.
   *
   * The ref bridges the gap: set it true before the call, so the handler
   * accepts the session, then set FULL_AUTH_KEY in localStorage for persistence.
   * If verifyOtp fails, the ref is reset to false.
   */
  const otpVerifiedRef = useRef(false);

  /**
   * Gates the onAuthStateChange handler until init() completes. init() handles
   * the initial session itself, so the handler can safely skip until then.
   */
  const initCompleteRef = useRef(false);

  /** Only the most recently started resolveSession may apply its result. */
  const requestSeqRef = useRef(0);
  /** The session waiting on a failed access check, for retryAccess(). */
  const pendingSessionRef = useRef(null);
  /** User id of the session currently accepted into the app, or null. */
  const acceptedUserIdRef = useRef(null);
  const mountedRef = useRef(true);

  const clearAll = useCallback(() => {
    acceptedUserIdRef.current = null;
    pendingSessionRef.current = null;
    setSession(null);
    setAccess(null);
    setInviteSetup(null);
    setAccessError(false);
    // Remembered lists outside React state go with the person (rule 6).
    runSignOutCleanup();
  }, []);

  /**
   * Signs out a session this app will not accept, and says why on the sign-in
   * screen when there is something to say.
   */
  const rejectSession = useCallback(async (notice) => {
    localStorage.removeItem(FULL_AUTH_KEY);
    otpVerifiedRef.current = false;
    if (notice) setAuthNotice(notice);
    clearAll();
    try {
      const { error } = await supabase.auth.signOut();
      if (error) await supabase.auth.signOut({ scope: "local" });
    } catch (err) {
      console.error("[AuthContext] sign out failed:", err?.message || err);
    }
  }, [clearAll]);

  /**
   * The one decision procedure for "there is (or is not) a Supabase session",
   * used by init() and by the auth listener.
   */
  const resolveSession = useCallback(async (sess) => {
    const seq = ++requestSeqRef.current;
    const isLatest = () => mountedRef.current && seq === requestSeqRef.current;

    // 1. No session.
    if (!sess) {
      localStorage.removeItem(FULL_AUTH_KEY);
      clearAll();
      return;
    }

    const twoFA = !!localStorage.getItem(FULL_AUTH_KEY) || otpVerifiedRef.current;

    const loaded = await loadAccess();
    if (!isLatest()) return;

    // 2. Could not find out. Hold the session and offer a retry.
    if (!loaded.ok) {
      pendingSessionRef.current = sess;
      setAccessError(true);
      return;
    }

    let next = loaded.access;

    // 3. Signed in, but not on the team.
    if (!next) {
      await rejectSession("");
      return;
    }

    if (next.status === "invited") {
      // 4. Invited, link opened, password not chosen yet: the setup screen.
      if (!twoFA) {
        pendingSessionRef.current = null;
        setAccess(next);
        setAccessError(false);
        setInviteSetup(sess);
        return;
      }
      // 5. Invited and fully signed in: finish joining.
      let activated;
      try {
        const { data, error } = await supabase.rpc("admin_team_activate_self");
        if (error) throw error;
        activated = normalizeAccess(data);
      } catch (err) {
        console.error("[AuthContext] activation failed:", err?.message || err);
        if (!isLatest()) return;
        pendingSessionRef.current = sess;
        setAccessError(true);
        return;
      }
      if (!isLatest()) return;
      if (!activated || activated.status !== "active") {
        await rejectSession(INVITE_WAITING_MESSAGE);
        return;
      }
      next = activated;
    }

    // 7. A session without the second sign-in step is never accepted.
    if (!twoFA) {
      await rejectSession("");
      return;
    }

    // 6. On the team, fully signed in.
    pendingSessionRef.current = null;
    acceptedUserIdRef.current = sess.user?.id ?? null;
    setAccess(next);
    setInviteSetup(null);
    setAccessError(false);
    setSession(sess);
  }, [clearAll, rejectSession]);

  /**
   * A token refresh for the person already in the app: keep them in, then
   * re-read what they may open. Removed access signs them out with a message;
   * a changed role updates the menu.
   */
  const refreshAccess = useCallback(async (sess) => {
    const loaded = await loadAccess();
    if (!mountedRef.current) return;
    if (!loaded.ok) return; // keep what we have; every request is still checked server-side
    if (acceptedUserIdRef.current !== (sess.user?.id ?? null)) return;
    if (!loaded.access || loaded.access.status !== "active") {
      await rejectSession(ACCESS_REMOVED_MESSAGE);
      return;
    }
    setAccess((prev) => (sameAccess(prev, loaded.access) ? prev : loaded.access));
  }, [rejectSession]);

  const refreshCurrentAccess = useCallback(async () => {
    const { data, error } = await supabase.auth.getSession();
    const currentSession = data?.session ?? null;
    if (error || !currentSession || acceptedUserIdRef.current !== currentSession.user?.id) return;
    await refreshAccess(currentSession);
  }, [refreshAccess]);

  useEffect(() => {
    // `mounted` belongs to THIS run of the effect (React runs it twice in
    // development); mountedRef is what the callbacks above look at.
    let mounted = true;
    mountedRef.current = true;

    const init = async () => {
      const { data, error } = await supabase.auth.getSession();
      if (!mounted) return;
      if (error) {
        console.error("Auth session error:", error.message);
        setLoading(false);
        initCompleteRef.current = true;
        return;
      }

      await resolveSession(data.session);
      if (!mounted) return;

      setLoading(false);
      initCompleteRef.current = true;
    };

    init();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!mounted) return;

      // During password verification and invite set-up, ignore all auth state changes.
      if (suppressSessionRef.current) return;

      // Skip until init() has handled the initial session.
      if (!initCompleteRef.current) return;

      // This callback stays synchronous: no Supabase call is awaited inside it.
      // The work is deferred so the auth client has finished its own update.
      setTimeout(() => {
        if (!mounted || suppressSessionRef.current) return;
        if (
          newSession &&
          acceptedUserIdRef.current &&
          acceptedUserIdRef.current === newSession.user?.id
        ) {
          setSession(newSession);
          void refreshAccess(newSession);
          return;
        }
        void resolveSession(newSession);
      }, 0);
    });

    return () => {
      mounted = false;
      mountedRef.current = false;
      subscription.unsubscribe();
    };
  }, [resolveSession, refreshAccess]);

  // Operational grants and revocations take effect without signing out. Focus
  // and visibility changes refresh immediately; the light interval covers a
  // user who keeps the Admin tab open continuously.
  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refreshCurrentAccess();
    };
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    const intervalId = window.setInterval(refreshWhenVisible, 30_000);
    return () => {
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.clearInterval(intervalId);
    };
  }, [refreshCurrentAccess]);

  /**
   * "Try again" on the retry screen: re-run the access check for the session
   * that is waiting (or whatever session the client currently holds).
   */
  const retryAccess = useCallback(async () => {
    let sess = pendingSessionRef.current;
    if (!sess) {
      const { data } = await supabase.auth.getSession();
      sess = data?.session ?? null;
    }
    await resolveSession(sess);
  }, [resolveSession]);

  const clearAuthNotice = useCallback(() => setAuthNotice(""), []);

  /**
   * Opens a one-time invite link. Called from the invite screen when the person
   * presses Continue (never on page load).
   *
   * Returns { state }: "ok" when a session now exists for the invited address
   * (the auth listener then shows the password setup screen), otherwise the
   * state to show: used | expired | invalid | account_conflict | try_again | offline.
   *
   * It never marks the session as fully signed in: that happens only once the
   * person has chosen their password.
   */
  const acceptInvite = async (token) => {
    let data;
    try {
      const res = await supabase.functions.invoke("admin-team-accept-invite", {
        body: { token },
      });
      if (res.error) {
        // The request left the browser but something on the way answered with
        // an error: nothing was used up. No answer at all: offline.
        return { state: res.error.name === "FunctionsFetchError" ? "offline" : "try_again" };
      }
      data = res.data;
    } catch {
      return { state: "offline" };
    }

    if (!data || data.state !== "ok") {
      // An address that cannot take team access: the function names the
      // invited address, so the screen can say which one needs a new invite.
      if (data?.state === "account_conflict" && typeof data.email === "string") {
        return { state: "account_conflict", email: data.email };
      }
      return { state: typeof data?.state === "string" ? data.state : "invalid" };
    }

    // A flag left behind by an earlier sign-in on this browser must not let the
    // new session skip choosing a password.
    localStorage.removeItem(FULL_AUTH_KEY);
    otpVerifiedRef.current = false;

    const { error } = await supabase.auth.verifyOtp({
      token_hash: data.token_hash,
      type: data.type,
    });
    if (error) {
      console.error("[AuthContext] invite sign-in failed:", error.message);
      return { state: "try_again" };
    }
    return { state: "ok" };
  };

  /**
   * Completes the invite setup flow.
   * Called after an invited person sets their password via the setup screen.
   * Sets the password on their account, signs their other sessions out,
   * activates their membership and accepts the session.
   */
  const completeInviteSetup = async (password) => {
    if (!inviteSetup) throw new Error("No invite setup session");

    // This flow drives the state itself; cancel anything in flight.
    suppressSessionRef.current = true;
    requestSeqRef.current += 1;
    try {
      // Set the password on their account. Pressing the button again after a
      // dropped connection sends the same password: that is not a failure.
      const { error: pwError } = await supabase.auth.updateUser({ password });
      if (pwError && pwError.code !== "same_password") throw pwError;

      // Any session this account had elsewhere ends here. Best effort.
      try {
        const { error: othersError } = await supabase.auth.signOut({ scope: "others" });
        if (othersError) {
          console.error("[AuthContext] could not sign out other sessions:", othersError.message);
        }
      } catch (err) {
        console.error("[AuthContext] could not sign out other sessions:", err?.message || err);
      }

      const { data, error: activateErr } = await supabase.rpc("admin_team_activate_self");
      if (activateErr) {
        console.error("[AuthContext] activation failed:", activateErr.message);
        throw new Error("Couldn't finish setting up your access. Check your connection and try again.");
      }
      const next = normalizeAccess(data);

      if (!next || next.status !== "active") {
        // The 24 hours to finish ran out, or the invite was replaced or withdrawn.
        localStorage.removeItem(FULL_AUTH_KEY);
        otpVerifiedRef.current = false;
        setAuthNotice(INVITE_EXPIRED_MESSAGE);
        try {
          const { error } = await supabase.auth.signOut();
          if (error) await supabase.auth.signOut({ scope: "local" });
        } catch (err) {
          console.error("[AuthContext] sign out failed:", err?.message || err);
        }
        clearAll();
        throw new Error(INVITE_EXPIRED_MESSAGE);
      }

      // Accept the session as fully authenticated
      localStorage.setItem(FULL_AUTH_KEY, "true");
      const { data: current } = await supabase.auth.getSession();
      const accepted = current?.session ?? inviteSetup;
      acceptedUserIdRef.current = accepted.user?.id ?? null;
      setAccess(next);
      setAccessError(false);
      setSession(accepted);
      setInviteSetup(null);
    } finally {
      suppressSessionRef.current = false;
    }
  };

  /**
   * Step 1 of 2FA: verify password.
   * Does NOT create a persistent session — signs out immediately after verifying.
   * The suppressSessionRef prevents onAuthStateChange from flashing the dashboard.
   *
   * Whether this email is on the team is read from the server WHILE the
   * temporary session exists (no lookup happens before sign-in).
   */
  const verifyPassword = async (email, password) => {
    suppressSessionRef.current = true;
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (signInError) throw signInError;

      const loaded = await loadAccess();

      // Password verified. Sign out so no session persists until OTP is complete.
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) {
        // Critical: if signOut fails, we have a live session without OTP verification.
        // Retry once to prevent session leak.
        console.error("SignOut after password verification failed, retrying:", signOutError.message);
        await supabase.auth.signOut({ scope: "local" }).catch(() => {});
      }

      if (!loaded.ok) {
        throw new Error("Couldn't check your access. Check your connection and try again.");
      }
      if (!loaded.access) {
        throw new Error("Access denied. This email is not authorized.");
      }
      if (loaded.access.status === "invited") {
        // Checked before any code is emailed.
        throw new Error(INVITE_WAITING_MESSAGE);
      }
    } finally {
      suppressSessionRef.current = false;
    }
  };

  /**
   * Step 2a of 2FA: send OTP code to email.
   */
  const sendOtp = async (email) => {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    });
    if (error) throw error;
  };

  /**
   * Step 2b of 2FA: verify the OTP code. Creates the real session.
   *
   * IMPORTANT timing: otpVerifiedRef is set BEFORE the Supabase call because
   * onAuthStateChange fires during the await (before the next line executes).
   * The ref ensures the handler accepts the new session immediately.
   * localStorage is then set for persistence across page refreshes.
   */
  const verifyOtp = async (email, token) => {
    // Set ref BEFORE the call so onAuthStateChange accepts the session.
    otpVerifiedRef.current = true;

    try {
      const { error } = await supabase.auth.verifyOtp({
        email,
        token,
        type: "email",
      });
      if (error) {
        // OTP failed — reset the ref so no session is accepted.
        otpVerifiedRef.current = false;
        throw error;
      }

      // OTP succeeded. Persist the flag for page refresh resilience.
      localStorage.setItem(FULL_AUTH_KEY, "true");
      // Session is now set via onAuthStateChange (which checked otpVerifiedRef).
    } catch (err) {
      otpVerifiedRef.current = false;
      throw err;
    }
  };

  const signOut = async () => {
    // Clear everything BEFORE signing out, so if onAuthStateChange fires
    // synchronously, neither flag is present to accept the session.
    localStorage.removeItem(FULL_AUTH_KEY);
    otpVerifiedRef.current = false;
    setInviteSetup(null);
    const { error } = await supabase.auth.signOut();
    if (error) {
      // The server could not be reached: still end the session on this device.
      const { error: localError } = await supabase.auth.signOut({ scope: "local" });
      if (localError) throw localError;
    }
    // The auth listener clears the rest; when the access check never passed
    // there is no accepted session for it to act on, so clear here as well.
    requestSeqRef.current += 1;
    clearAll();
  };

  return (
    <AuthContext.Provider value={{
      session,
      loading,
      inviteSetup,
      access,
      accessError,
      retryAccess,
      refreshCurrentAccess,
      authNotice,
      clearAuthNotice,
      verifyPassword,
      sendOtp,
      verifyOtp,
      acceptInvite,
      signOut,
      completeInviteSetup,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
