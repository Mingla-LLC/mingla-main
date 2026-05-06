# SPEC — BIZ Cycle 15 (Organiser Login + Email-OTP)

**Cycle:** 15 (BIZ — email + 6-digit OTP additive sign-in)
**Date:** 2026-05-04 (final)
**Investigation:** [`reports/INVESTIGATION_BIZ_CYCLE_15_ORGANISER_LOGIN.md`](../reports/INVESTIGATION_BIZ_CYCLE_15_ORGANISER_LOGIN.md)
**Decision lock-in:** DEC-097 ✅ LOCKED 2026-05-04 (6 D-15-N decisions agreed batched)
**Estimated effort:** ~12-16 hrs
**Status:** **BINDING** (operator locked all 6 D-15-N decisions 2026-05-04 via DEC-097 "All agreed")

---

## 1 — Scope

### IN SCOPE
- Add a 3rd sign-in option to `BusinessWelcomeScreen.tsx` ("Continue with Email")
- Internal state machine in BusinessWelcomeScreen: `idle → email-input → otp-input → otp-verifying → (existing index gate routes to home)`
- 2 NEW AuthContext callbacks: `signInWithEmail(email)` + `verifyEmailOtp(email, code)`
- Email-OTP first-sign-in produces `creator_accounts` row via existing `ensureCreatorAccount` (no schema changes)
- Recovery on email-OTP sign-in via existing AuthContext SIGNED_IN gate (preserves I-35)
- Rate-limit error UX with explicit copy + countdown
- Resend OTP code action with 60s cooldown
- "Wrong email? Edit" back-navigation in OTP-input mode
- Keyboard discipline (memory rule `feedback_keyboard_never_blocks_input`) for both TextInput modes
- `/ui-ux-pro-max` pre-flight at IMPL Step 4 before component code

### OUT OF SCOPE
- Marketing landing page (J-L1..J-L4) — owned by `mingla-marketing/` (separate codebase, separate chat)
- Magic-link click-through mode — operator locked OTP-code paste-back (D-15-2)
- Email + password — explicitly rejected during operator clarification
- Separate `/login` web route — operator-recommended to extend BusinessWelcomeScreen (D-15-6)
- Resend SMTP wiring — Cycle 15 uses Supabase default email provider (D-15-3)
- Schema changes — `creator_accounts` and RLS already accept email-OTP-created users
- WEB2 fix — already shipped Cycle 0b (Apr 29)
- Native iOS/Android-only platform branching — `signInWithOtp` works identically on all platforms

### ASSUMPTIONS
- A1: Supabase project Auth → Email Templates → "Magic Link" template includes `{{ .Token }}` rendering the 6-digit code visibly. Pre-IMPL operator must verify (D-CYCLE15-FOR-3). If template is link-only, operator customizes the template before IMPL deploy.
- A2: Supabase project Auth → Providers → Email is enabled. Default-on; operator confirms.
- A3: Supabase project rate limits stay at default (4/hour per email, 30/hour per IP). Cycle 15 doesn't tune these.
- A4: `display_name = email-prefix` is acceptable initial fallback for first email-OTP sign-in (D-CYCLE15-FOR-4 + D-15-9). Operator can change in J-A1 post-sign-in.

---

## 2 — Non-goals (explicitly NOT addressed)

- Per-event roles or organiser teams (out of cycle scope)
- Email change flow (Cycle 14 J-A1 covers display_name + avatar; email change defers)
- Forgot-password / password reset (no passwords in this design)
- Two-factor / MFA beyond OTP itself (deferred)
- Account merge across providers (e.g., Google + email same address) — Supabase handles via auth.users.email matching; no special UI in Cycle 15
- Email deliverability monitoring (Resend webhooks defer to B-cycle)

---

## 3 — Layer-by-layer specification

### 3.1 — Database (no changes)

`creator_accounts` schema + RLS unchanged. Verified:
- INSERT RLS `auth.uid() = id` permits any authenticated user to create their own row
- `ensureCreatorAccount` upsert idempotent for OAuth + email-OTP

**File touches:** 0.

### 3.2 — Edge functions (no changes)

No edge functions involved. Supabase Auth handles `signInWithOtp` + `verifyOtp` server-side.

**File touches:** 0.

### 3.3 — Service layer (no changes)

`creatorAccount.ts` already handles email-OTP-created users via existing `ensureCreatorAccount` upsert. Verified D-CYCLE15-FOR-4: `display_name` falls back to `user.email.split('@')[0]` when `user_metadata.full_name` is empty (typical for email-OTP).

**File touches:** 0.

### 3.4 — AuthContext extension (`mingla-business/src/context/AuthContext.tsx`)

#### 3.4.1 — NEW callback: `signInWithEmail(email: string): Promise<{ error: Error | null }>`

**Verbatim shape:**
```ts
const signInWithEmail = useCallback(
  async (email: string): Promise<{ error: Error | null }> => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) {
      return { error: new Error("Enter your email address.") };
    }
    // Basic email regex — defer detailed validation to Supabase backend
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
      // Surface rate-limit error explicitly (Cycle 15 D-CYCLE15-FOR-6).
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
```

**Notes:**
- `shouldCreateUser: true` — first sign-in auto-creates auth.users row; matches OAuth pattern (Constitution #2: one owner per truth — auth.users + creator_accounts).
- Trim + lowercase: prevents drift between sign-in attempts (e.g., `Joe@Example.com` and `joe@example.com` resolve to same user).
- Email regex: client-side guard against typos; Supabase enforces real validation.

#### 3.4.2 — NEW callback: `verifyEmailOtp(email: string, code: string): Promise<{ error: Error | null }>`

**Verbatim shape:**
```ts
const verifyEmailOtp = useCallback(
  async (email: string, code: string): Promise<{ error: Error | null }> => {
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedCode = code.trim();
    if (!/^\d{6}$/.test(trimmedCode)) {
      return { error: new Error("Enter the 6-digit code from your email.") };
    }
    const { error } = await supabase.auth.verifyOtp({
      email: trimmedEmail,
      token: trimmedCode,
      type: "email",
    });
    if (error) {
      // Map Supabase error messages to friendly copy
      const msg = error.message.toLowerCase();
      if (msg.includes("expired") || msg.includes("invalid")) {
        return {
          error: new Error("That code didn't match or has expired. Try again."),
        };
      }
      return { error: new Error(error.message) };
    }
    // Success — onAuthStateChange fires SIGNED_IN, AuthContext listener handles
    // ensureCreatorAccount + tryRecoverAccountIfDeleted (I-35) + setUser.
    return { error: null };
  },
  [],
);
```

**Notes:**
- `type: "email"` — Supabase docs confirm this covers both magic-link and OTP-code flows; operator's project setting + email template determine which mode is active.
- 6-digit numeric guard: client-side; Supabase enforces real validation.
- On success, `onAuthStateChange(SIGNED_IN, session)` fires → existing AuthContext listener at lines 120-138 triggers `ensureCreatorAccount` + `tryRecoverAccountIfDeleted` (I-35 SIGNED_IN gate from Cycle 14 v2). Caller doesn't need to do anything else.

#### 3.4.3 — `AuthContextValue` type extension

```ts
type AuthContextValue = {
  // ... existing fields ...
  signInWithEmail: (email: string) => Promise<{ error: Error | null }>;
  verifyEmailOtp: (email: string, code: string) => Promise<{ error: Error | null }>;
};
```

#### 3.4.4 — `useMemo` value object extension

Add `signInWithEmail` + `verifyEmailOtp` to the returned value + the deps array.

**File touches:** AuthContext.tsx — +60 LOC.

### 3.5 — Component layer (`mingla-business/src/components/auth/BusinessWelcomeScreen.tsx`)

#### 3.5.1 — Props extension (additive, optional)

```ts
export interface BusinessWelcomeScreenProps {
  onGoogleSignIn: () => Promise<void>;
  onAppleSignIn: () => Promise<void>;
  onEmailSignIn: (email: string) => Promise<{ error: Error | null }>;     // NEW
  onVerifyEmailOtp: (email: string, code: string) => Promise<{ error: Error | null }>; // NEW
  onBack?: () => void;
}
```

`mingla-business/app/index.tsx` already passes `onGoogleSignIn` + `onAppleSignIn`. Add 2 wires for the new callbacks via `useAuth()`.

#### 3.5.2 — Internal state machine

```ts
type WelcomeMode = "idle" | "email-input" | "otp-input" | "otp-verifying";

const [mode, setMode] = useState<WelcomeMode>("idle");
const [emailInput, setEmailInput] = useState("");
const [otpInput, setOtpInput] = useState("");
const [submittingEmail, setSubmittingEmail] = useState(false);
const [submittingOtp, setSubmittingOtp] = useState(false);
const [resendCooldownEnd, setResendCooldownEnd] = useState<number | null>(null);
```

#### 3.5.3 — State transitions

| From | Trigger | To | Side effect |
|------|---------|-----|-------------|
| `idle` | Tap "Continue with Email" | `email-input` | Animate email TextInput in |
| `email-input` | Tap "Send code" with valid email | `otp-input` (success) | Call `onEmailSignIn(email)`; on error, stay in `email-input` + show toast |
| `email-input` | Tap "Back" | `idle` | Clear email input |
| `otp-input` | Type 6th digit | auto-submit → `otp-verifying` | Call `onVerifyEmailOtp(email, code)`; on success, redirect via index gate (no manual nav); on error, return to `otp-input` |
| `otp-input` | Tap "Wrong email? Edit" | `email-input` | Keep email pre-filled, clear OTP |
| `otp-input` | Tap "Resend code" | `otp-input` (cooldown) | Re-call `onEmailSignIn`; start 60s cooldown on Resend button |
| `otp-verifying` | Verify success | (index gate redirects) | AuthContext SIGNED_IN → ensureCreatorAccount → user state change → Index renders Home |
| `otp-verifying` | Verify error | `otp-input` | Show toast + clear OTP input |

#### 3.5.4 — Render branches

```
mode === "idle":
  Existing 3 buttons (Google, Apple if iOS|web, Email) + animations

mode === "email-input":
  Heading "What's your email?"
  TextInput (autoCapitalize=none, autoComplete=email, keyboardType=email-address)
  "Send code" button (disabled while submitting OR if email empty)
  "Back" link

mode === "otp-input":
  Heading "Check your inbox"
  Subtext "We sent a 6-digit code to {{email}}"
  TextInput (keyboardType=number-pad, maxLength=6, autoComplete=one-time-code)
  Verify button OR auto-submit on 6th digit
  "Resend code" button (disabled until cooldown ends; shows "Resend in N seconds")
  "Wrong email? Edit" link

mode === "otp-verifying":
  Spinner + "Signing you in..."
```

#### 3.5.5 — Keyboard discipline (memory rule)

Wrap `email-input` and `otp-input` action zones in:
- ScrollView with `keyboardShouldPersistTaps="handled"` + `automaticallyAdjustKeyboardInsets`
- `Keyboard` listener on iOS/Android adjusting `paddingBottom` dynamically per `feedback_keyboard_never_blocks_input`
- Web: rely on browser default (CSS layout handles input visibility on `position: absolute` action zones — verify in /ui-ux-pro-max pre-flight)

#### 3.5.6 — `/ui-ux-pro-max` pre-flight (mandatory before component code)

Query: `"saas auth login email otp 6-digit code passwordless professional clean dual-mode"` --domain product

Apply returned guidance to:
- Email TextInput + button visual treatment
- 6-digit code TextInput design (consider 6 separate boxes vs single field)
- Resend cooldown countdown UX (subtle vs prominent)
- Error toast placement (preserves Toast wrap absolute per memory rule)

#### 3.5.7 — Toast wrap absolute (memory rule)

Any new toast surface MUST wrap in `<View style={{position:"absolute", top:0/bottom:0, zIndex:100}}>` per `feedback_toast_needs_absolute_wrap`.

**File touches:** BusinessWelcomeScreen.tsx — +280 LOC (state + 3 new render branches + handlers + keyboard listener); existing animation patterns + Apple/Google flows preserved verbatim.

### 3.6 — Index gate (`mingla-business/app/index.tsx`)

#### 3.6.1 — Wire 2 new callbacks

```ts
export default function Index() {
  const {
    user,
    loading,
    signInWithGoogle,
    signInWithApple,
    signInWithEmail,    // NEW
    verifyEmailOtp,     // NEW
  } = useAuth();
  // ... existing loading + redirect ...
  if (!user) {
    return (
      <BusinessWelcomeScreen
        onGoogleSignIn={async () => { await signInWithGoogle(); }}
        onAppleSignIn={async () => { await signInWithApple(); }}
        onEmailSignIn={signInWithEmail}    // NEW
        onVerifyEmailOtp={verifyEmailOtp}  // NEW
      />
    );
  }
  // ...
}
```

**File touches:** index.tsx — +4 LOC.

### 3.7 — Realtime + cache (no changes)

No React Query, no Zustand store. Email-OTP flows through existing AuthContext singleton.

**File touches:** 0.

---

## 4 — Numbered success criteria (16 SC)

| SC | Criterion | Test |
|----|-----------|------|
| SC-1 | "Continue with Email" button visible on Welcome screen on iOS, Android, web | T-01 |
| SC-2 | Tap "Continue with Email" → email-input mode renders | T-02 |
| SC-3 | Email regex client-side guard rejects empty + obviously invalid emails with friendly copy | T-03 |
| SC-4 | Tap "Send code" with valid email → `signInWithOtp` called → mode transitions to otp-input | T-04 |
| SC-5 | Email rate-limit error (429) surfaces "Too many attempts. Wait a minute before trying again." copy | T-05 |
| SC-6 | OTP-input mode shows email confirmation subtext + 6-digit input + Resend button | T-06 |
| SC-7 | 6-digit code input auto-submits on 6th digit | T-07 |
| SC-8 | Wrong code surfaces "That code didn't match or has expired. Try again." + clears input | T-08 |
| SC-9 | Correct code → SIGNED_IN event → `ensureCreatorAccount` runs → Index gate redirects to /(tabs)/home | T-09 |
| SC-10 | First email-OTP sign-in creates creator_accounts row with `display_name = email-prefix` | T-10 |
| SC-11 | Resend button disabled for 60s after first send; shows "Resend in N seconds" countdown | T-11 |
| SC-12 | "Wrong email? Edit" link returns to email-input mode with email pre-filled | T-12 |
| SC-13 | Recovery on email-OTP sign-in fires via I-35 SIGNED_IN gate (account.tsx shows "Welcome back" toast if `deleted_at` was non-null) | T-13 |
| SC-14 | Keyboard discipline: TextInput visible above keyboard on iOS native | T-14 |
| SC-15 | Toast wrap absolute: error toasts appear above other UI on all 3 routes | T-15 |
| SC-16 | tsc clean (only pre-existing D-CYCLE12-IMPL-1/2 errors persist) | T-16 |

---

## 5 — Test cases (T-01..T-16 per SC + 5 regression tests T-17..T-21)

| Test | Scenario | Layer | Method |
|------|----------|-------|--------|
| T-01 | Email button renders on iOS+Android+web | Component | Visual smoke + grep |
| T-02 | Email button tap → state machine email-input | Component | RTL test or manual smoke |
| T-03 | Empty email + bad email regex rejection | Component | Unit |
| T-04 | Valid email → signInWithOtp called → otp-input mode | Hook+Component | Manual smoke + Supabase email arrived |
| T-05 | Rate-limit error shows specific copy | Hook | Unit (mock Supabase 429) |
| T-06 | OTP-input render with email subtext | Component | Visual smoke |
| T-07 | Auto-submit on 6th digit | Component | Manual smoke or RTL |
| T-08 | Wrong code error path + input clear | Hook+Component | Manual smoke (intentionally wrong code) |
| T-09 | Correct code → home tab | Full stack | Manual smoke (real OTP from email) |
| T-10 | First sign-in creator_accounts row exists with email-prefix display_name | Schema+Service | Supabase Studio query post-smoke |
| T-11 | Resend cooldown countdown + button disabled | Component | Manual smoke (60s wait) |
| T-12 | "Wrong email?" returns to email-input | Component | Manual smoke |
| T-13 | Recovery on email-OTP sign-in (deleted_at present, expect Welcome back toast) | Full stack | Manual smoke per Cycle 14 §15.4 Step 6 pattern |
| T-14 | Keyboard discipline on iOS — input above keyboard | Component | Manual smoke |
| T-15 | Toast wrap absolute (3 routes: Welcome email-input, Welcome otp-input, account/edit-profile) | Component | Grep `position: "absolute"` in toastWrap styles |
| T-16 | tsc clean | Static | `cd mingla-business && npx tsc --noEmit` |
| T-17 | Regression: Google sign-in unchanged on iOS+Android+web | Full stack | Manual smoke |
| T-18 | Regression: Apple sign-in unchanged on iOS+web | Full stack | Manual smoke |
| T-19 | Regression: Cycle 14 delete flow unchanged | Full stack | Manual smoke per Cycle 14 §15.4 Steps 5+6 |
| T-20 | Regression: signOut "everywhere" unchanged | Full stack | Manual smoke |
| T-21 | Web bundle still boots clean (WEB2 fix from Cycle 0b unchanged) | Full stack | `npx expo start --web` smoke |

---

## 6 — Implementation order (5 sequential steps)

| Step | Action | tsc checkpoint? |
|------|--------|-----------------|
| 0 | **Operator pre-IMPL verification gate:** Confirm Supabase Auth → Email Templates → "Magic Link" template includes 6-digit `{{ .Token }}` rendering. Confirm Auth → Providers → Email is enabled. Confirm rate limits are at default. | N/A |
| 1 | NEW `signInWithEmail` callback in AuthContext.tsx (3.4.1) | ✅ |
| 2 | NEW `verifyEmailOtp` callback in AuthContext.tsx (3.4.2) | ✅ |
| 3 | Type extension + value memoization in AuthContext.tsx (3.4.3 + 3.4.4) | ✅ |
| 4 | **`/ui-ux-pro-max` pre-flight** with query from §3.5.6; apply returned guidance | N/A |
| 5 | NEW state machine + render branches + handlers in BusinessWelcomeScreen.tsx (3.5) | ✅ |
| 6 | Wire 2 new callbacks at index.tsx (3.6) | ✅ |
| 7 | Final tsc + 8 grep gates + IMPL report | ✅ |

---

## 7 — Regression prevention

- **Grep gate T-15** — `position: "absolute"` in toastWrap of BusinessWelcomeScreen for both email-input and otp-input modes (memory rule `feedback_toast_needs_absolute_wrap`)
- **Grep gate** — 0 hits of `oklch|lab\(|lch\(|color-mix` in any new code (memory rule `feedback_rn_color_formats`)
- **Grep gate** — `signInWithOtp` exactly 1 call site in AuthContext.tsx; `verifyOtp` exactly 1 call site (no copy-paste drift to other surfaces)
- **Grep gate** — `shouldCreateUser: true` exactly 1 hit (locks first-sign-in account creation behavior)
- **Grep gate** — `signInWithEmail` + `verifyEmailOtp` callbacks exported from useMemo deps array (cache safety)
- **Hook ordering ORCH-0710** — all hooks BEFORE first conditional render in BusinessWelcomeScreen
- **Type-level enforcement** — AuthContextValue type forces all consumers to handle 2 new callbacks (TypeScript catches missed wires)

---

## 8 — Memory rule deference checklist

| Rule | Compliance plan |
|------|-----------------|
| `feedback_implementor_uses_ui_ux_pro_max` | Step 4 mandatory pre-flight |
| `feedback_keyboard_never_blocks_input` | ScrollView + Keyboard listener + dynamic paddingBottom on email-input + otp-input modes |
| `feedback_rn_color_formats` | hex/rgb/hsl/hwb only — verified at grep gate |
| `feedback_toast_needs_absolute_wrap` | toast styles use `position: "absolute"` per existing pattern |
| `feedback_diagnose_first_workflow` | Investigation report §10 cross-references prove this; SPEC drafted before code |
| `feedback_no_summary_paragraph` | IMPL report should follow Cycle 14 template (15 sections, no narrative summary) |
| `feedback_orchestrator_never_executes` | Orchestrator authors prompts only |
| `feedback_sequential_one_step_at_a_time` | 7 sequential steps with tsc checkpoint after each code-touching step |

---

## 9 — Cross-references

- Investigation: `Mingla_Artifacts/reports/INVESTIGATION_BIZ_CYCLE_15_ORGANISER_LOGIN.md`
- Cycle 0b close (WEB2 fix): `Mingla_Artifacts/reports/IMPLEMENTATION_CYCLE_0b_WEB_AUTH_UNBLOCK.md`
- Cycle 14 close (I-35 contract): `Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_14_ACCOUNT_REPORT.md`
- DEC-076 (auth model): `Mingla_Artifacts/DECISION_LOG.md`
- DEC-086 (founder-owned-workstream split): `Mingla_Artifacts/DECISION_LOG.md`
- I-35 invariant: `Mingla_Artifacts/INVARIANT_REGISTRY.md`
- Memory rules: `MEMORY.md` index + linked feedback files

---

**End of SPEC. Status BINDING post-DEC-097 lock 2026-05-04.**
