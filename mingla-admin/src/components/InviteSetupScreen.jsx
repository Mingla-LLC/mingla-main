import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { validatePassword } from "../lib/authHelpers";
import {
  ShieldCheck,
  Lock,
  Eye,
  EyeOff,
  AlertCircle,
  Loader2,
  PartyPopper,
} from "lucide-react";
import minglaLogo from "../assets/mingla-logo.png";

const COLORS = {
  bg: "var(--color-background-secondary, #f8f9fb)",
  cardBg: "var(--color-background-primary, #ffffff)",
  border: "var(--gray-300, #d0d5dd)",
  borderLight: "var(--gray-200, #e4e7ec)",
  borderFocus: "#eb7825",
  focusRing: "rgba(235, 120, 37, 0.15)",
  text: "var(--color-text-primary, #101828)",
  textSecondary: "var(--color-text-secondary, #475467)",
  textMuted: "var(--color-text-muted, #98a2b3)",
  brandOrange: "#eb7825",
  brandGradStart: "#FF7043",
  brandGradEnd: "#ea580c",
  successGreen: "#22c55e",
  errorRed: "#ef4444",
  errorBg: "var(--color-error-50, #fef3f2)",
  errorBorder: "rgba(239, 68, 68, 0.3)",
  errorText: "#dc2626",
};

const inputStyle = {
  width: "100%",
  height: 38,
  padding: "0 14px 0 36px",
  fontSize: 13,
  lineHeight: "18px",
  color: "var(--color-text-primary)",
  backgroundColor: "var(--color-background-primary)",
  border: "1.5px solid var(--gray-300)",
  borderRadius: 8,
  outline: "none",
  transition: "border-color 0.2s, box-shadow 0.2s",
  fontFamily: "inherit",
};

const inputFocusStyle = {
  borderColor: COLORS.borderFocus,
  boxShadow: `0 0 0 3px ${COLORS.focusRing}`,
};

const labelStyle = {
  display: "block",
  fontSize: 11,
  fontWeight: 600,
  color: COLORS.textSecondary,
  marginBottom: 5,
  letterSpacing: "0.03em",
  textTransform: "uppercase",
};

const iconBoxStyle = {
  position: "absolute",
  left: 11,
  top: "50%",
  transform: "translateY(-50%)",
  width: 14,
  height: 14,
  color: COLORS.textMuted,
  pointerEvents: "none",
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

function FocusInput({ icon: Icon, type = "text", id, rightElement, style: extraStyle, ...props }) {
  const [focused, setFocused] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <Icon style={iconBoxStyle} />
      <input
        id={id}
        type={type}
        {...props}
        onFocus={(e) => { setFocused(true); props.onFocus?.(e); }}
        onBlur={(e) => { setFocused(false); props.onBlur?.(e); }}
        style={{
          ...inputStyle,
          ...(focused ? inputFocusStyle : {}),
          ...extraStyle,
        }}
      />
      {rightElement}
    </div>
  );
}

function PasswordStrength({ password }) {
  if (!password) return null;

  const rules = [
    { test: (p) => p.length >= 12, label: "12+ chars" },
    { test: (p) => /[A-Z]/.test(p), label: "Uppercase" },
    { test: (p) => /[a-z]/.test(p), label: "Lowercase" },
    { test: (p) => /[0-9]/.test(p), label: "Number" },
    { test: (p) => /[^A-Za-z0-9]/.test(p), label: "Special" },
  ];

  const passed = rules.filter((r) => r.test(password)).length;
  const strength = passed / rules.length;

  const barColor =
    strength <= 0.4 ? COLORS.errorRed
    : strength <= 0.6 ? "#f59e0b"
    : strength <= 0.8 ? COLORS.brandOrange
    : COLORS.successGreen;

  const label =
    strength <= 0.4 ? "Weak"
    : strength <= 0.6 ? "Fair"
    : strength <= 0.8 ? "Good"
    : "Strong";

  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
        <div style={{ flex: 1, height: 3, borderRadius: 99, backgroundColor: "var(--gray-200)", overflow: "hidden" }}>
          <div
            style={{
              height: "100%",
              width: `${strength * 100}%`,
              borderRadius: 99,
              backgroundColor: barColor,
              transition: "width 0.3s ease, background-color 0.3s ease",
            }}
          />
        </div>
        <span style={{ fontSize: 10, fontWeight: 600, color: strength === 1 ? COLORS.successGreen : COLORS.textMuted }}>
          {label}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 0, flexWrap: "nowrap" }}>
        {rules.map((rule, i) => {
          const ok = rule.test(password);
          return (
            <span key={rule.label} style={{ display: "inline-flex", alignItems: "center", whiteSpace: "nowrap" }}>
              {i > 0 && <span style={{ margin: "0 5px", width: 2, height: 2, borderRadius: 99, backgroundColor: "var(--gray-300)", flexShrink: 0 }} />}
              <span style={{ fontSize: 9, color: ok ? COLORS.successGreen : COLORS.textMuted, transition: "color 0.15s" }}>
                {rule.label}
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

export function InviteSetupScreen() {
  const { inviteSetup, completeInviteSetup, signOut } = useAuth();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState("");
  const [passwordIssues, setPasswordIssues] = useState([]);
  const [loading, setLoading] = useState(false);

  const email = inviteSetup?.user?.email || "";

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setPasswordIssues([]);

    if (!password || !confirmPassword) {
      setError("Please fill in both password fields.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }

    const { valid, failures } = validatePassword(password);
    if (!valid) {
      setPasswordIssues(failures);
      return;
    }

    setLoading(true);
    try {
      await completeInviteSetup(password);
    } catch (err) {
      setError(err.message || "Failed to set password. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async () => {
    try {
      await signOut();
    } catch (err) {
      console.error("Sign out failed:", err.message);
    }
  };

  const eyeButton = (show, toggle) => (
    <button
      type="button"
      tabIndex={-1}
      onClick={toggle}
      aria-label={show ? "Hide password" : "Show password"}
      style={{
        position: "absolute",
        right: 12,
        top: "50%",
        transform: "translateY(-50%)",
        background: "none",
        border: "none",
        padding: 0,
        cursor: "pointer",
        color: COLORS.textMuted,
        transition: "color 0.15s",
        display: "flex",
        alignItems: "center",
      }}
    >
      {show ? <EyeOff style={{ width: 15, height: 15 }} /> : <Eye style={{ width: 15, height: 15 }} />}
    </button>
  );

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
          {/* Logo + Welcome */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              marginBottom: 16,
              animation: "loginFadeIn 400ms ease-out 100ms both",
            }}
          >
            <div style={{ position: "relative", marginBottom: 8 }}>
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
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
              <PartyPopper style={{ width: 16, height: 16, color: COLORS.brandOrange }} />
              <span style={{ fontSize: 14, fontWeight: 700, color: COLORS.text }}>Welcome to Mingla!</span>
            </div>
            <p style={{ fontSize: 12, color: COLORS.textSecondary, margin: 0, textAlign: "center" }}>
              You've been invited as an admin. Set your password to get started.
            </p>
          </div>

          {/* Email display */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "8px 12px",
              borderRadius: 8,
              backgroundColor: "rgba(235, 120, 37, 0.08)",
              border: "1px solid rgba(235, 120, 37, 0.12)",
              marginBottom: 16,
              animation: "loginFadeIn 400ms ease-out 200ms both",
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 600, color: COLORS.text }}>{email}</span>
          </div>

          {/* Error */}
          {error && (
            <div
              style={{
                marginBottom: 16,
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                padding: "10px 12px",
                borderRadius: 8,
                backgroundColor: COLORS.errorBg,
                border: `1px solid ${COLORS.errorBorder}`,
                animation: "loginShake 400ms ease-out",
              }}
            >
              <AlertCircle style={{ width: 15, height: 15, color: COLORS.errorRed, flexShrink: 0, marginTop: 1 }} />
              <p style={{ fontSize: 12, color: COLORS.errorText, margin: 0 }}>{error}</p>
            </div>
          )}

          {passwordIssues.length > 0 && (
            <div
              style={{
                marginBottom: 16,
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                padding: "10px 12px",
                borderRadius: 8,
                backgroundColor: COLORS.errorBg,
                border: `1px solid ${COLORS.errorBorder}`,
                animation: "loginShake 400ms ease-out",
              }}
            >
              <AlertCircle style={{ width: 15, height: 15, color: COLORS.errorRed, flexShrink: 0, marginTop: 1 }} />
              <div>
                <p style={{ fontSize: 12, fontWeight: 600, color: COLORS.errorText, margin: 0 }}>
                  Password requirements not met
                </p>
                <ul style={{ margin: "4px 0 0", padding: 0, listStyle: "none" }}>
                  {passwordIssues.map((issue, i) => (
                    <li key={i} style={{ fontSize: 11, color: "#d92d20", display: "flex", alignItems: "center", gap: 5, marginTop: 2 }}>
                      <span style={{ width: 4, height: 4, borderRadius: 99, backgroundColor: "#f97066", flexShrink: 0 }} />
                      {issue}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} style={{ animation: "loginFadeIn 300ms ease-out" }}>
            {/* Password */}
            <div style={{ marginBottom: 14 }}>
              <label htmlFor="setup-password" style={labelStyle}>
                New Password
              </label>
              <FocusInput
                id="setup-password"
                type={showPassword ? "text" : "password"}
                icon={Lock}
                placeholder="Create a strong password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                autoFocus
                disabled={loading}
                style={{ paddingRight: 40 }}
                rightElement={eyeButton(showPassword, () => setShowPassword(!showPassword))}
              />
              <PasswordStrength password={password} />
            </div>

            {/* Confirm Password */}
            <div style={{ marginBottom: 16 }}>
              <label htmlFor="setup-confirm" style={labelStyle}>
                Confirm Password
              </label>
              <FocusInput
                id="setup-confirm"
                type={showConfirm ? "text" : "password"}
                icon={Lock}
                placeholder="Re-enter your password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                disabled={loading}
                style={{ paddingRight: 40 }}
                rightElement={eyeButton(showConfirm, () => setShowConfirm(!showConfirm))}
              />
              {confirmPassword && password !== confirmPassword && (
                <p style={{ fontSize: 10, color: COLORS.errorRed, marginTop: 4 }}>Passwords don't match</p>
              )}
              {confirmPassword && password === confirmPassword && confirmPassword.length > 0 && (
                <p style={{ fontSize: 10, color: COLORS.successGreen, marginTop: 4 }}>Passwords match</p>
              )}
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={loading || !password || !confirmPassword}
              style={{
                ...btnStyle,
                opacity: loading || !password || !confirmPassword ? 0.5 : 1,
                cursor: loading || !password || !confirmPassword ? "not-allowed" : "pointer",
                marginBottom: 12,
              }}
              onMouseEnter={(e) => {
                if (!loading && password && confirmPassword) {
                  e.currentTarget.style.transform = "translateY(-1px)";
                  e.currentTarget.style.boxShadow = "0 4px 16px rgba(235,120,37,0.35)";
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "translateY(0)";
                e.currentTarget.style.boxShadow = "none";
              }}
            >
              {loading ? <Loader2 style={{ width: 16, height: 16, animation: "spin 1s linear infinite" }} /> : <ShieldCheck style={{ width: 16, height: 16 }} />}
              {loading ? "Setting up..." : "Set Password & Continue"}
            </button>

            {/* Cancel */}
            <div style={{ textAlign: "center" }}>
              <button
                type="button"
                onClick={handleCancel}
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: COLORS.textSecondary,
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                  transition: "color 0.15s",
                  fontFamily: "inherit",
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>

        {/* Footer */}
        <div
          style={{
            marginTop: 16,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 4,
            animation: "loginFadeIn 400ms ease-out 400ms both",
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
