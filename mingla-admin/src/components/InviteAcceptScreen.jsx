import { useEffect, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { acceptBody, acceptCopy } from "../lib/inviteLink";
import { AlertCircle, Loader2, MailOpen, ShieldCheck, Lock } from "lucide-react";
import minglaLogo from "../../../packages/brand-assets/mingla-wordmark.png";

// Issue #3802 — the screen an invited person lands on from their one-time
// invite link. Same card and tokens as the password setup screen that follows.
//
// Nothing is sent when this screen loads: the first request is the button
// press. Every state says what happened and offers exactly one next step.

const COLORS = {
  cardBg: "var(--color-background-primary, #ffffff)",
  borderLight: "var(--gray-200, #e4e7ec)",
  text: "var(--color-text-primary, #101828)",
  textSecondary: "var(--color-text-secondary, #475467)",
  textMuted: "var(--color-text-muted, #98a2b3)",
  brandOrange: "#eb7825",
  brandGradStart: "#FF7043",
  brandGradEnd: "#ea580c",
  errorRed: "#ef4444",
};

const btnStyle = {
  width: "100%",
  height: 38,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  fontSize: 13,
  fontWeight: 600,
  color: "#ffffff",
  background: `linear-gradient(135deg, ${COLORS.brandGradStart}, ${COLORS.brandGradEnd})`,
  border: "none",
  borderRadius: 10,
  cursor: "pointer",
  transition: "transform 0.15s, box-shadow 0.15s, opacity 0.15s",
  fontFamily: "inherit",
};

// States that mean "this did not work" get the alert icon.
const PROBLEM_STATES = ["used", "expired", "invalid", "account_conflict", "try_again", "offline"];

// How long to wait for the password screen after a successful open before
// offering a retry instead of leaving the person on a spinner.
const HANDOVER_MS = 10000;

export function InviteAcceptScreen({ token, onDone }) {
  const { session, acceptInvite, signOut } = useAuth();

  // Decided once, at first paint: is somebody already signed in on this browser?
  const [view, setView] = useState(() => (session ? "signed_in_other" : "ready"));
  const [signedInEmail] = useState(() => session?.user?.email || "");
  const [busy, setBusy] = useState(false);
  const titleRef = useRef(null);
  const handoverRef = useRef(null);
  // True once the link was opened and the password screen is about to take over.
  const openedRef = useRef(false);
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  // Move focus to the title whenever the state changes, so a screen reader
  // announces what happened.
  useEffect(() => {
    titleRef.current?.focus();
  }, [view]);

  // When this screen goes away because the link was opened (the password
  // screen replaced it), the link is spent: tell the app to forget it, so this
  // screen does not come back once the password is chosen.
  useEffect(() => () => {
    clearTimeout(handoverRef.current);
    if (openedRef.current) onDoneRef.current();
  }, []);

  const copy = acceptCopy(view);
  const working = view === "working";

  const openInvite = async () => {
    setBusy(true);
    setView("working");
    const result = await acceptInvite(token);
    if (result.state === "ok") {
      // The password screen replaces this one as soon as the new session is
      // recognised. If that never happens, say so and offer the button again.
      openedRef.current = true;
      handoverRef.current = setTimeout(() => {
        openedRef.current = false;
        setBusy(false);
        setView("try_again");
      }, HANDOVER_MS);
      return;
    }
    setBusy(false);
    setView(result.state);
  };

  const signOutThenContinue = async () => {
    setBusy(true);
    try {
      await signOut();
      setView("ready");
    } catch (err) {
      console.error("Sign out failed:", err?.message || err);
      setView("offline");
    } finally {
      setBusy(false);
    }
  };

  const handleAction = () => {
    if (busy) return;
    const kind = copy.action.kind;
    if (kind === "go_sign_in") {
      onDone();
    } else if (kind === "sign_out") {
      signOutThenContinue();
    } else if (view === "offline" && session) {
      // The sign-out did not go through: try that again first.
      signOutThenContinue();
    } else {
      openInvite();
    }
  };

  const isProblem = PROBLEM_STATES.includes(view) || !["ready", "signed_in_other", "working", "ok"].includes(view);
  const Icon = isProblem ? AlertCircle : MailOpen;

  return (
    <div
      className="login-screen-bg"
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px 20px",
        overflowY: "auto",
        fontFamily: '"Geist Sans", system-ui, -apple-system, sans-serif',
      }}
    >
      <div className="login-bg-pattern" />
      <div className="login-bg-glow" />

      <div
        style={{
          width: "100%",
          maxWidth: 360,
          position: "relative",
          zIndex: 10,
          animation: "loginCardIn 500ms cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      >
        <div
          style={{
            backgroundColor: COLORS.cardBg,
            border: `1px solid ${COLORS.borderLight}`,
            borderRadius: 14,
            boxShadow: "0 4px 24px rgba(0,0,0,0.06), 0 1px 4px rgba(0,0,0,0.04)",
            padding: "24px 24px 20px",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              marginBottom: 16,
            }}
          >
            <div style={{ position: "relative", marginBottom: 10 }}>
              <div
                style={{
                  position: "absolute",
                  inset: -6,
                  borderRadius: 14,
                  backgroundColor: COLORS.brandOrange,
                  opacity: 0.12,
                  filter: "blur(12px)",
                }}
              />
              <img
                src={minglaLogo}
                alt="Mingla"
                style={{ position: "relative", width: 36, height: 36, borderRadius: 8, objectFit: "contain" }}
              />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
              {working ? (
                <Loader2
                  aria-hidden="true"
                  style={{ width: 16, height: 16, color: COLORS.brandOrange, animation: "spin 1s linear infinite" }}
                />
              ) : (
                <Icon
                  aria-hidden="true"
                  style={{ width: 16, height: 16, color: isProblem ? COLORS.errorRed : COLORS.brandOrange }}
                />
              )}
              <h1
                ref={titleRef}
                tabIndex={-1}
                style={{ fontSize: 14, fontWeight: 700, color: COLORS.text, margin: 0, outline: "none" }}
              >
                {copy.title}
              </h1>
            </div>
            <p
              aria-live="polite"
              style={{ fontSize: 12, lineHeight: "18px", color: COLORS.textSecondary, margin: 0, textAlign: "center" }}
            >
              {acceptBody(view, { email: signedInEmail })}
            </p>
          </div>

          <button
            type="button"
            onClick={handleAction}
            disabled={busy}
            aria-busy={busy}
            style={{
              ...btnStyle,
              opacity: busy ? 0.5 : 1,
              cursor: busy ? "not-allowed" : "pointer",
            }}
          >
            {busy && (
              <Loader2 aria-hidden="true" style={{ width: 16, height: 16, animation: "spin 1s linear infinite" }} />
            )}
            {working ? "Checking..." : copy.action.label}
          </button>
        </div>

        <div
          style={{
            marginTop: 16,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 4,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12, color: COLORS.textMuted }}>
            <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10 }}>
              <ShieldCheck style={{ width: 11, height: 11 }} />
              <span>2FA Protected</span>
            </div>
            <span style={{ width: 2, height: 2, borderRadius: 99, backgroundColor: "var(--gray-300)" }} />
            <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10 }}>
              <Lock style={{ width: 11, height: 11 }} />
              <span>End-to-end Encrypted</span>
            </div>
          </div>
          <p style={{ fontSize: 10, color: COLORS.textMuted, margin: 0 }}>
            &copy; {new Date().getFullYear()} Mingla &middot; Admin Dashboard
          </p>
        </div>
      </div>
    </div>
  );
}
