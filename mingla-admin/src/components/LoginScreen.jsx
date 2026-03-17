import { useState, useRef, useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import {
  validatePassword,
  checkLockout,
  recordFailedAttempt,
  resetLockout,
} from "../lib/authHelpers";
import {
  ShieldCheck,
  LogIn,
  Mail,
  ArrowLeft,
  Lock,
  Eye,
  EyeOff,
  AlertCircle,
  Check,
  Loader2,
  KeyRound,
} from "lucide-react";
import minglaLogo from "../assets/mingla-logo.png";

/* ═══════════════════════════════════════════════════════════════
   INLINE STYLE CONSTANTS — bulletproof, no Tailwind variable issues
   ═══════════════════════════════════════════════════════════════ */
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
  warmGlow: "rgba(249, 115, 22, 0.08)",
};

/* ── Shared styles ──────────────────────────────────────────── */
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

// ── OTP Digit Input ───────────────────────────────────────────
function OtpInput({ value, onChange, disabled }) {
  const inputRefs = useRef([]);
  const digits = value.padEnd(6, " ").split("").slice(0, 6);

  const focusInput = (index) => {
    if (inputRefs.current[index]) inputRefs.current[index].focus();
  };

  const handleChange = (index, e) => {
    const val = e.target.value.replace(/\D/g, "");
    if (!val) return;
    const char = val[val.length - 1];
    const newDigits = [...digits];
    newDigits[index] = char;
    onChange(newDigits.join("").replace(/ /g, ""));
    if (index < 5) focusInput(index + 1);
  };

  const handleKeyDown = (index, e) => {
    if (e.key === "Backspace") {
      e.preventDefault();
      const newDigits = [...digits];
      if (digits[index] && digits[index] !== " ") {
        newDigits[index] = " ";
        onChange(newDigits.join("").replace(/ /g, ""));
      } else if (index > 0) {
        newDigits[index - 1] = " ";
        onChange(newDigits.join("").replace(/ /g, ""));
        focusInput(index - 1);
      }
    } else if (e.key === "ArrowLeft" && index > 0) {
      focusInput(index - 1);
    } else if (e.key === "ArrowRight" && index < 5) {
      focusInput(index + 1);
    }
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    onChange(pasted);
    focusInput(Math.min(pasted.length, 5));
  };

  const [focusedIndex, setFocusedIndex] = useState(-1);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 8, width: "100%" }}>
      {digits.map((digit, i) => {
        const filled = digit && digit !== " ";
        const focused = focusedIndex === i;
        return (
          <input
            key={i}
            ref={(el) => (inputRefs.current[i] = el)}
            type="text"
            inputMode="numeric"
            maxLength={1}
            value={digit === " " ? "" : digit}
            onChange={(e) => handleChange(i, e)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            onPaste={i === 0 ? handlePaste : undefined}
            onFocus={(e) => { e.target.select(); setFocusedIndex(i); }}
            onBlur={() => setFocusedIndex(-1)}
            disabled={disabled}
            autoFocus={i === 0}
            autoComplete={i === 0 ? "one-time-code" : "off"}
            aria-label={`Digit ${i + 1}`}
            style={{
              width: "100%",
              height: 42,
              textAlign: "center",
              fontSize: 18,
              fontWeight: 700,
              fontFamily: "inherit",
              color: COLORS.text,
              backgroundColor: COLORS.cardBg,
              border: `1.5px solid ${focused ? COLORS.borderFocus : filled ? COLORS.borderFocus : COLORS.border}`,
              borderRadius: 8,
              outline: "none",
              boxShadow: focused ? `0 0 0 3px ${COLORS.focusRing}` : "none",
              transition: "border-color 0.2s, box-shadow 0.2s",
              opacity: disabled ? 0.5 : 1,
              cursor: disabled ? "not-allowed" : "text",
              boxSizing: "border-box",
              padding: 0,
            }}
          />
        );
      })}
    </div>
  );
}

// ── Password Strength Bar ──────────────────────────────────────
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
      {/* Bar + label */}
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
      {/* Rules — single line, dot-separated */}
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

// ── Step Indicator ─────────────────────────────────────────────
function StepIndicator({ currentStep }) {
  const steps = [
    { key: "password", label: "Credentials", icon: Lock },
    { key: "otp", label: "Verify", icon: KeyRound },
  ];

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
      {steps.map((s, i) => {
        const isActive = s.key === currentStep;
        const isDone = currentStep === "otp" && s.key === "password";

        return (
          <div key={s.key} style={{ display: "flex", alignItems: "center" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 99,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: isDone ? COLORS.successGreen : isActive ? COLORS.brandOrange : "var(--gray-100)",
                  color: isDone || isActive ? "#ffffff" : COLORS.textMuted,
                  boxShadow: isActive ? `0 0 0 3px ${COLORS.focusRing}` : "none",
                  transition: "all 0.3s ease",
                }}
              >
                {isDone ? <Check style={{ width: 13, height: 13 }} /> : <s.icon style={{ width: 13, height: 13 }} />}
              </div>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  marginTop: 4,
                  color: isActive || isDone ? COLORS.text : COLORS.textMuted,
                  transition: "color 0.2s",
                }}
              >
                {s.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div
                style={{
                  width: 36,
                  height: 2,
                  borderRadius: 99,
                  margin: "0 8px",
                  marginBottom: 16,
                  backgroundColor: isDone ? COLORS.successGreen : "var(--gray-200)",
                  transition: "background-color 0.5s ease",
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Alert Block ──────────────────────────────────────────────
function AlertBlock({ children, shake = true }) {
  return (
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
        animation: shake ? "loginShake 400ms ease-out" : undefined,
      }}
    >
      <AlertCircle style={{ width: 15, height: 15, color: COLORS.errorRed, flexShrink: 0, marginTop: 1 }} />
      {children}
    </div>
  );
}

// ── Focus-aware Input ──────────────────────────────────────────
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

// ── Main Login Screen ──────────────────────────────────────────
export function LoginScreen() {
  const { verifyPassword, sendOtp, verifyOtp, verifyInviteOtp } = useAuth();

  const [step, setStep] = useState("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [error, setError] = useState("");
  const [passwordIssues, setPasswordIssues] = useState([]);
  const [loading, setLoading] = useState(false);
  const [lockoutMsg, setLockoutMsg] = useState("");
  const [transitioning, setTransitioning] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteOtp, setInviteOtp] = useState("");
  const stepTimerRef = useRef(null);

  // Clean up step transition timer on unmount
  useEffect(() => () => clearTimeout(stepTimerRef.current), []);

  const goToStep = (nextStep) => {
    setTransitioning(true);
    stepTimerRef.current = setTimeout(() => {
      setStep(nextStep);
      setTransitioning(false);
    }, 200);
  };

  // ── Step 1: Password ──────────────────────────────────────
  const handlePasswordSubmit = async (e) => {
      e.preventDefault();
      setError("");
      setPasswordIssues([]);
      setLockoutMsg("");

      const lockout = checkLockout();
      if (lockout.locked) { setLockoutMsg(lockout.message); return; }

      const trimmedEmail = email.trim().toLowerCase();
      if (!trimmedEmail || !password) { setError("Please enter both email and password."); return; }

      // Email authorization is checked dynamically by AuthContext.verifyPassword
      // (checks both hardcoded ALLOWED_ADMIN_EMAILS and admin_users table).

      const { valid, failures } = validatePassword(password);
      if (!valid) { setPasswordIssues(failures); return; }

      setLoading(true);
      try {
        await verifyPassword(trimmedEmail, password);
        await sendOtp(trimmedEmail);
        resetLockout();
        goToStep("otp");
      } catch (err) {
        recordFailedAttempt();
        const newLockout = checkLockout();
        if (newLockout.locked) { setLockoutMsg(newLockout.message); }
        else { setError(err.message || "Sign in failed. Check your credentials."); }
      } finally {
        setLoading(false);
      }
  };

  // ── Step 2: OTP ───────────────────────────────────────────
  const handleOtpSubmit = async (e) => {
      e.preventDefault();
      setError("");
      setLockoutMsg("");

      const lockout = checkLockout();
      if (lockout.locked) { setLockoutMsg(lockout.message); goToStep("password"); return; }

      const code = otpCode.trim();
      if (!code || code.length !== 6) { setError("Please enter the 6-digit code from your email."); return; }

      setLoading(true);
      try {
        await verifyOtp(email.trim().toLowerCase(), code);
      } catch (err) {
        recordFailedAttempt();
        const newLockout = checkLockout();
        if (newLockout.locked) { setLockoutMsg(newLockout.message); goToStep("password"); setOtpCode(""); }
        else { setError("Invalid or expired code. Please try again."); }
      } finally {
        setLoading(false);
      }
  };

  const handleBackToPassword = () => { goToStep("password"); setOtpCode(""); setError(""); setLockoutMsg(""); };

  // ── Invite OTP ────────────────────────────────────────────
  const handleInviteSubmit = async (e) => {
    e.preventDefault();
    setError("");

    const trimmedEmail = inviteEmail.trim().toLowerCase();
    const code = inviteOtp.trim();
    if (!trimmedEmail) { setError("Please enter your email."); return; }
    if (!code || code.length !== 6) { setError("Please enter the 6-digit code from your invite email."); return; }

    setLoading(true);
    try {
      await verifyInviteOtp(trimmedEmail, code);
      // onAuthStateChange will detect the invited user and show InviteSetupScreen
    } catch (err) {
      setError(err.message || "Invalid or expired code. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleBackFromInvite = () => { goToStep("password"); setInviteEmail(""); setInviteOtp(""); setError(""); };

  const handleResendCode = async () => {
    setError("");
    setLoading(true);
    try { await sendOtp(email.trim().toLowerCase()); }
    catch (err) {
      console.error("[LoginScreen] Resend OTP failed:", err?.message || err);
      setError("Failed to resend code. Please try again.");
    }
    finally { setLoading(false); }
  };

  // ── Render ────────────────────────────────────────────────
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
      {/* Background decorative elements */}
      <div className="login-bg-pattern" />
      <div className="login-bg-glow" />

      {/* Card wrapper */}
      <div
        style={{
          width: "100%",
          maxWidth: 360,
          position: "relative",
          zIndex: 10,
          animation: "loginCardIn 500ms cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      >
        {/* Card */}
        <div
          style={{
            backgroundColor: COLORS.cardBg,
            border: `1px solid ${COLORS.borderLight}`,
            borderRadius: 14,
            boxShadow: "0 4px 24px rgba(0,0,0,0.06), 0 1px 4px rgba(0,0,0,0.04)",
            padding: "24px 24px 20px",
          }}
        >
          {/* Logo + Subtitle */}
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
            <p style={{ fontSize: 12, color: COLORS.textSecondary, margin: 0 }}>
              Sign in to the admin dashboard
            </p>
          </div>

          {/* Step Indicator */}
          <div style={{ animation: "loginFadeIn 400ms ease-out 200ms both" }}>
            <StepIndicator currentStep={step} />
          </div>

          {/* Alerts */}
          {lockoutMsg && (
            <AlertBlock>
              <div>
                <p style={{ fontSize: 12, fontWeight: 600, color: COLORS.errorText, margin: 0 }}>Account locked</p>
                <p style={{ fontSize: 11, color: "#d92d20", margin: "3px 0 0" }}>{lockoutMsg}</p>
              </div>
            </AlertBlock>
          )}

          {error && !lockoutMsg && (
            <AlertBlock>
              <p style={{ fontSize: 12, color: COLORS.errorText, margin: 0 }}>{error}</p>
            </AlertBlock>
          )}

          {passwordIssues.length > 0 && (
            <AlertBlock>
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
            </AlertBlock>
          )}

          {/* Form container with transition */}
          <div
            style={{
              transition: "opacity 0.2s ease, transform 0.2s ease",
              opacity: transitioning ? 0 : 1,
              transform: transitioning ? "translateY(8px)" : "translateY(0)",
            }}
          >
            {/* ── Step 1: Password Form ── */}
            {step === "password" && (
              <form onSubmit={handlePasswordSubmit} style={{ animation: "loginFadeIn 300ms ease-out" }}>
                {/* Email */}
                <div style={{ marginBottom: 14 }}>
                  <label htmlFor="login-email" style={labelStyle}>
                    Email
                  </label>
                  <FocusInput
                    id="login-email"
                    type="email"
                    icon={Mail}
                    placeholder="you@usemingla.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    autoFocus
                    disabled={!!lockoutMsg}
                  />
                </div>

                {/* Password */}
                <div style={{ marginBottom: 16 }}>
                  <label htmlFor="login-password" style={labelStyle}>
                    Password
                  </label>
                  <FocusInput
                    id="login-password"
                    type={showPassword ? "text" : "password"}
                    icon={Lock}
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    disabled={!!lockoutMsg}
                    style={{ paddingRight: 40 }}
                    rightElement={
                      <button
                        type="button"
                        tabIndex={-1}
                        onClick={() => setShowPassword(!showPassword)}
                        aria-label={showPassword ? "Hide password" : "Show password"}
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
                        onMouseEnter={(e) => (e.currentTarget.style.color = COLORS.textSecondary)}
                        onMouseLeave={(e) => (e.currentTarget.style.color = COLORS.textMuted)}
                      >
                        {showPassword ? <EyeOff style={{ width: 15, height: 15 }} /> : <Eye style={{ width: 15, height: 15 }} />}
                      </button>
                    }
                  />
                  <PasswordStrength password={password} />
                </div>

                {/* Submit */}
                <button
                  type="submit"
                  disabled={loading || !!lockoutMsg}
                  style={{
                    ...btnStyle,
                    opacity: loading || lockoutMsg ? 0.5 : 1,
                    cursor: loading || lockoutMsg ? "not-allowed" : "pointer",
                  }}
                  onMouseEnter={(e) => {
                    if (!loading && !lockoutMsg) {
                      e.currentTarget.style.transform = "translateY(-1px)";
                      e.currentTarget.style.boxShadow = "0 4px 16px rgba(235,120,37,0.35)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = "translateY(0)";
                    e.currentTarget.style.boxShadow = "none";
                  }}
                  onMouseDown={(e) => {
                    if (!loading && !lockoutMsg) {
                      e.currentTarget.style.transform = "translateY(0) scale(0.98)";
                    }
                  }}
                  onMouseUp={(e) => {
                    if (!loading && !lockoutMsg) {
                      e.currentTarget.style.transform = "translateY(-1px)";
                    }
                  }}
                >
                  {loading ? <Loader2 style={{ width: 16, height: 16, animation: "spin 1s linear infinite" }} /> : <ShieldCheck style={{ width: 16, height: 16 }} />}
                  {loading ? "Verifying..." : "Continue with Verification"}
                </button>

                {/* Invite link */}
                <div style={{ textAlign: "center", marginTop: 14 }}>
                  <button
                    type="button"
                    onClick={() => { goToStep("invite"); setError(""); setPasswordIssues([]); setLockoutMsg(""); }}
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: COLORS.brandOrange,
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      padding: 0,
                      fontFamily: "inherit",
                      transition: "color 0.15s",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = "#d6691f")}
                    onMouseLeave={(e) => (e.currentTarget.style.color = COLORS.brandOrange)}
                  >
                    I have an invite code
                  </button>
                </div>
              </form>
            )}

            {/* ── Step 2: OTP Form ── */}
            {step === "otp" && (
              <form onSubmit={handleOtpSubmit} style={{ animation: "loginFadeIn 300ms ease-out" }}>
                {/* Sent-to notice */}
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    textAlign: "center",
                    gap: 4,
                    padding: "12px 16px",
                    borderRadius: 8,
                    backgroundColor: COLORS.warmGlow,
                    border: "1px solid rgba(235,120,37,0.12)",
                    marginBottom: 16,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <Mail style={{ width: 14, height: 14, color: COLORS.brandOrange, flexShrink: 0 }} />
                    <span style={{ fontSize: 12, fontWeight: 600, color: COLORS.text }}>Code sent!</span>
                  </div>
                  <p style={{ fontSize: 11, color: COLORS.textSecondary, margin: 0, wordBreak: "break-all" }}>
                    Check <span style={{ fontWeight: 600, color: COLORS.text }}>{email.trim()}</span> for a 6-digit code
                  </p>
                </div>

                {/* OTP Input */}
                <div style={{ marginBottom: 14 }}>
                  <label style={{ ...labelStyle, textAlign: "center", marginBottom: 8 }}>
                    Enter verification code
                  </label>
                  <OtpInput value={otpCode} onChange={setOtpCode} disabled={loading} />
                </div>

                {/* Submit */}
                <button
                  type="submit"
                  disabled={loading || otpCode.length !== 6}
                  style={{
                    ...btnStyle,
                    opacity: loading || otpCode.length !== 6 ? 0.5 : 1,
                    cursor: loading || otpCode.length !== 6 ? "not-allowed" : "pointer",
                    marginBottom: 14,
                  }}
                  onMouseEnter={(e) => {
                    if (!loading && otpCode.length === 6) {
                      e.currentTarget.style.transform = "translateY(-1px)";
                      e.currentTarget.style.boxShadow = "0 4px 16px rgba(235,120,37,0.35)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = "translateY(0)";
                    e.currentTarget.style.boxShadow = "none";
                  }}
                >
                  {loading ? <Loader2 style={{ width: 16, height: 16, animation: "spin 1s linear infinite" }} /> : <LogIn style={{ width: 16, height: 16 }} />}
                  {loading ? "Verifying..." : "Verify & Sign In"}
                </button>

                {/* Actions */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <button
                    type="button"
                    onClick={handleBackToPassword}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
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
                    onMouseEnter={(e) => (e.currentTarget.style.color = COLORS.text)}
                    onMouseLeave={(e) => (e.currentTarget.style.color = COLORS.textSecondary)}
                  >
                    <ArrowLeft style={{ width: 12, height: 12 }} />
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={handleResendCode}
                    disabled={loading}
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: COLORS.brandOrange,
                      background: "none",
                      border: "none",
                      cursor: loading ? "not-allowed" : "pointer",
                      padding: 0,
                      opacity: loading ? 0.5 : 1,
                      transition: "color 0.15s",
                      fontFamily: "inherit",
                    }}
                    onMouseEnter={(e) => { if (!loading) e.currentTarget.style.color = "#d6691f"; }}
                    onMouseLeave={(e) => (e.currentTarget.style.color = COLORS.brandOrange)}
                  >
                    Resend code
                  </button>
                </div>
              </form>
            )}
            {/* ── Invite OTP Form ── */}
            {step === "invite" && (
              <form onSubmit={handleInviteSubmit} style={{ animation: "loginFadeIn 300ms ease-out" }}>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    textAlign: "center",
                    gap: 4,
                    padding: "12px 16px",
                    borderRadius: 8,
                    backgroundColor: COLORS.warmGlow,
                    border: "1px solid rgba(235,120,37,0.12)",
                    marginBottom: 16,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <Mail style={{ width: 14, height: 14, color: COLORS.brandOrange, flexShrink: 0 }} />
                    <span style={{ fontSize: 12, fontWeight: 600, color: COLORS.text }}>Invited Admin Setup</span>
                  </div>
                  <p style={{ fontSize: 11, color: COLORS.textSecondary, margin: 0 }}>
                    Enter your email and the 6-digit code from your invite email
                  </p>
                </div>

                {/* Email */}
                <div style={{ marginBottom: 14 }}>
                  <label htmlFor="invite-email" style={labelStyle}>Email</label>
                  <FocusInput
                    id="invite-email"
                    type="email"
                    icon={Mail}
                    placeholder="you@usemingla.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    autoComplete="email"
                    autoFocus
                  />
                </div>

                {/* OTP */}
                <div style={{ marginBottom: 14 }}>
                  <label style={{ ...labelStyle, textAlign: "center", marginBottom: 8 }}>Invite code</label>
                  <OtpInput value={inviteOtp} onChange={setInviteOtp} disabled={loading} />
                </div>

                {/* Submit */}
                <button
                  type="submit"
                  disabled={loading || inviteOtp.length !== 6}
                  style={{
                    ...btnStyle,
                    opacity: loading || inviteOtp.length !== 6 ? 0.5 : 1,
                    cursor: loading || inviteOtp.length !== 6 ? "not-allowed" : "pointer",
                    marginBottom: 14,
                  }}
                  onMouseEnter={(e) => {
                    if (!loading && inviteOtp.length === 6) {
                      e.currentTarget.style.transform = "translateY(-1px)";
                      e.currentTarget.style.boxShadow = "0 4px 16px rgba(235,120,37,0.35)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = "translateY(0)";
                    e.currentTarget.style.boxShadow = "none";
                  }}
                >
                  {loading ? <Loader2 style={{ width: 16, height: 16, animation: "spin 1s linear infinite" }} /> : <LogIn style={{ width: 16, height: 16 }} />}
                  {loading ? "Verifying..." : "Verify Invite Code"}
                </button>

                {/* Back */}
                <div style={{ textAlign: "center" }}>
                  <button
                    type="button"
                    onClick={handleBackFromInvite}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
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
                    onMouseEnter={(e) => (e.currentTarget.style.color = COLORS.text)}
                    onMouseLeave={(e) => (e.currentTarget.style.color = COLORS.textSecondary)}
                  >
                    <ArrowLeft style={{ width: 12, height: 12 }} />
                    Back to login
                  </button>
                </div>
              </form>
            )}
          </div>
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
