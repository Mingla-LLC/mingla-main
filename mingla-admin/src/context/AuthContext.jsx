import { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { ALLOWED_ADMIN_EMAILS } from "../lib/constants";

const AuthContext = createContext(null);

/**
 * localStorage key tracking whether the full 2FA flow (password + OTP) completed.
 *
 * Why this exists:
 * - signInWithPassword creates a Supabase session (stored in localStorage by the SDK).
 * - We immediately signOut after password verification, but if the page refreshes
 *   between signInWithPassword and signOut, getSession finds the leftover session.
 * - Without this flag, that session would grant full dashboard access — bypassing 2FA.
 * - This flag is ONLY set after verifyOtp succeeds. It's checked on every session
 *   acceptance (both getSession on mount AND onAuthStateChange during runtime).
 */
const FULL_AUTH_KEY = "mingla_2fa_complete";

/**
 * Checks whether an email is in the allowed admin list.
 * Checks both the hardcoded fallback array AND the dynamic list from Supabase.
 */
function isEmailAllowed(email, dynamicEmails) {
  if (!email) return false;
  const lower = email.toLowerCase();
  if (ALLOWED_ADMIN_EMAILS.some((e) => e.toLowerCase() === lower)) return true;
  if (dynamicEmails.some((e) => e.toLowerCase() === lower)) return true;
  return false;
}

/**
 * Checks whether a session should be accepted as fully authenticated.
 * A session is only valid if:
 *   1. It exists
 *   2. The email is in the allowlist (hardcoded or dynamic)
 *   3. The FULL_AUTH_KEY flag is set (proving OTP was completed)
 *      OR the otpVerifiedRef is true (set synchronously before verifyOtp call)
 */
function shouldAcceptSession(session, otpVerifiedRef, dynamicEmails) {
  if (!session) return false;
  if (!isEmailAllowed(session.user?.email, dynamicEmails)) return false;
  if (localStorage.getItem(FULL_AUTH_KEY)) return true;
  if (otpVerifiedRef?.current) return true;
  return false;
}

/**
 * Checks if an email belongs to an invited admin (not yet active).
 * Used to detect magic link logins from invited admins.
 */
async function checkIsInvitedAdmin(email) {
  try {
    const { data } = await supabase
      .from("admin_users")
      .select("status")
      .eq("email", email.toLowerCase())
      .eq("status", "invited")
      .maybeSingle();
    return !!data;
  } catch {
    return false;
  }
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  /**
   * Holds the session for an invited admin who clicked a magic link.
   * When set, the app shows the password setup screen instead of login or dashboard.
   */
  const [inviteSetup, setInviteSetup] = useState(null);

  /**
   * Dynamic admin emails fetched from the admin_users table.
   * Stored in a ref so it's available synchronously in callbacks.
   * Includes emails with status 'active' or 'invited' (not 'revoked').
   */
  const dynamicEmailsRef = useRef([]);

  /**
   * Suppresses onAuthStateChange during verifyPassword.
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
   * Gates the onAuthStateChange handler until init() completes.
   *
   * Why: onAuthStateChange fires INITIAL_SESSION immediately on registration,
   * before fetchDynamicAdmins() resolves. If the user's email is only in the
   * dynamic admin list (not hardcoded), shouldAcceptSession fails because
   * dynamicEmailsRef is still empty — causing handleUnverifiedSession to
   * destroy the valid session. init() handles the initial session itself
   * after loading the dynamic list, so the handler can safely skip until then.
   */
  const initCompleteRef = useRef(false);

  /**
   * Fetches the dynamic admin list from the admin_users table.
   * Returns an array of email strings. Falls back to empty array on failure.
   */
  const fetchDynamicAdmins = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("admin_users")
        .select("email, status")
        .in("status", ["active", "invited"]);
      if (error) {
        // Table may not exist yet — that's OK, fall back to hardcoded list
        if (error.code !== "42P01" && !error.message?.includes("does not exist")) {
          console.error("Failed to fetch admin_users:", error.message);
        }
        return [];
      }
      return (data || []).map((a) => a.email);
    } catch (err) {
      console.error("Failed to fetch admin_users:", err.message);
      return [];
    }
  }, []);

  /**
   * Handles a session that exists but doesn't have FULL_AUTH_KEY.
   * If the user is an invited admin (came via magic link), enter invite setup mode.
   * Otherwise, sign them out (leaked session without 2FA).
   */
  const handleUnverifiedSession = useCallback(async (sess) => {
    console.log("session: ", sess);
    const email = sess.user?.email;
    if (!email) return;

    const isInvited = await checkIsInvitedAdmin(email);
    console.log("isInvited: ", isInvited);
    if (isInvited) {
      // Magic link invite — show password setup screen
      setInviteSetup(sess);
    } else {
      // Not an invited admin — leaked session without 2FA, sign out
      supabase.auth.signOut();
      setSession(null);
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    const init = async () => {
      // 1. Fetch dynamic admin list from Supabase
      const dynamicEmails = await fetchDynamicAdmins();
      if (!mounted) return;
      dynamicEmailsRef.current = dynamicEmails;

      // 2. Check existing session
      const { data, error } = await supabase.auth.getSession();
      if (!mounted) return;
      if (error) {
        console.error("Auth session error:", error.message);
        setLoading(false);
        return;
      }

      const sess = data.session;

      if (shouldAcceptSession(sess, otpVerifiedRef, dynamicEmailsRef.current)) {
        setSession(sess);
      } else if (sess) {
        // Session exists but no 2FA flag — check if invited admin or sign out.
        await handleUnverifiedSession(sess);
      }

      setLoading(false);
      initCompleteRef.current = true;
    };

    init();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!mounted) return;

      // During password verification, ignore all auth state changes.
      if (suppressSessionRef.current) return;

      // Skip until init() has loaded the dynamic admin list and handled
      // the initial session. Prevents race where INITIAL_SESSION fires
      // before dynamicEmailsRef is populated.
      if (!initCompleteRef.current) return;

      if (newSession) {
        if (shouldAcceptSession(newSession, otpVerifiedRef, dynamicEmailsRef.current)) {
          setSession(newSession);
        } else {
          // Session exists but no 2FA — check if invited admin or sign out.
          handleUnverifiedSession(newSession);
        }
      } else {
        // SIGNED_OUT — always clear.
        setSession(null);
        setInviteSetup(null);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [fetchDynamicAdmins, handleUnverifiedSession]);

  /**
   * Refreshes the dynamic admin list from Supabase.
   * Called by the AdminPage after inviting/revoking admins.
   */
  const refreshAdminList = useCallback(async () => {
    const dynamicEmails = await fetchDynamicAdmins();
    dynamicEmailsRef.current = dynamicEmails;
  }, [fetchDynamicAdmins]);

  /**
   * Completes the invite setup flow.
   * Called after an invited admin sets their password via the setup screen.
   * Sets the password on their Supabase Auth account, activates them in admin_users,
   * and creates the full session.
   */
  const completeInviteSetup = async (password) => {
    if (!inviteSetup) throw new Error("No invite setup session");

    // Set the password on their Supabase Auth account
    const { error: pwError } = await supabase.auth.updateUser({ password });
    if (pwError) throw pwError;

    // Activate in admin_users
    const email = inviteSetup.user?.email;
    if (email) {
      try {
        await supabase
          .from("admin_users")
          .update({ status: "active", accepted_at: new Date().toISOString() })
          .eq("email", email.toLowerCase())
          .eq("status", "invited");
      } catch (activateErr) {
        console.error("Auto-activate admin failed:", activateErr.message);
      }
    }

    // Accept the session as fully authenticated
    localStorage.setItem(FULL_AUTH_KEY, "true");
    setSession(inviteSetup);
    setInviteSetup(null);

    // Refresh dynamic admin list
    await refreshAdminList();
  };

  /**
   * Step 1 of 2FA: verify password.
   * Does NOT create a persistent session — signs out immediately after verifying.
   * The suppressSessionRef prevents onAuthStateChange from flashing the dashboard.
   */
  const verifyPassword = async (email, password) => {
    if (!isEmailAllowed(email, dynamicEmailsRef.current)) {
      throw new Error("Access denied. This email is not authorized.");
    }

    suppressSessionRef.current = true;
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (signInError) throw signInError;

      // Password verified. Sign out so no session persists until OTP is complete.
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) {
        // Critical: if signOut fails, we have a live session without OTP verification.
        // Retry once to prevent session leak.
        console.error("SignOut after password verification failed, retrying:", signOutError.message);
        await supabase.auth.signOut().catch(() => {});
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
   *
   * Also auto-activates invited admins on first successful login.
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

      // Auto-activate invited admins on successful login
      try {
        await supabase
          .from("admin_users")
          .update({ status: "active", accepted_at: new Date().toISOString() })
          .eq("email", email.toLowerCase())
          .eq("status", "invited");
      } catch (activateErr) {
        // Non-critical — don't break login if this fails
        console.error("Auto-activate admin failed:", activateErr.message);
      }
    } catch (err) {
      otpVerifiedRef.current = false;
      throw err;
    }
  };

  /**
   * Verify an invite OTP code. Unlike verifyOtp, this does NOT set the full
   * auth flags — so onAuthStateChange routes through handleUnverifiedSession,
   * which detects the invited admin and shows the password setup screen.
   */
  const verifyInviteOtp = async (email, token) => {
    const { error } = await supabase.auth.verifyOtp({
      email,
      token,
      type: "email",
    });
    if (error) throw error;
    // Session is created → onAuthStateChange fires → handleUnverifiedSession
    // detects invited status → sets inviteSetup → App renders InviteSetupScreen.
  };

  const signOut = async () => {
    // Clear everything BEFORE signing out, so if onAuthStateChange fires
    // synchronously, neither flag is present to accept the session.
    localStorage.removeItem(FULL_AUTH_KEY);
    otpVerifiedRef.current = false;
    setInviteSetup(null);
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  };

  return (
    <AuthContext.Provider value={{
      session,
      loading,
      inviteSetup,
      verifyPassword,
      sendOtp,
      verifyOtp,
      verifyInviteOtp,
      signOut,
      refreshAdminList,
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
