# INVESTIGATION REPORT — BIZ Cycle 15 (Organiser Login + Email-OTP)

**Mode:** INVESTIGATE-THEN-SPEC (IA)
**Cycle:** 15 (BIZ — scoped to email + 6-digit OTP only; J-L1..J-L4 marketing OUT-OF-SCOPE; J-L5a WEB2 already fixed in Cycle 0b)
**Date:** 2026-05-04 (final)
**Confidence overall:** H
**Phase 0 ingest:** ✅ complete (5 prior reports + DECISION_LOG DEC-076..089 + AGENT_HANDOFFS Cycle 0a/0b context + Cycle 14 close + memory work-history)
**Phase 1 symptom:** No email-based sign-in option for organisers without Google/Apple. Operator-locked D-15-2: email + 6-digit OTP code paste-back (brand-consistent with consumer-app SMS OTP UX).
**Phase 2 manifest:** 12 files read (auth + service + welcome + creator_accounts migration + DEC entries + Cycle 0b close + Cycle 14 close).
**Decisions resolved by ingest (no operator input needed):** D-15-1 (WEB2 ALREADY FIXED — Cycle 0b shipped Apr 29) · D-15-2 (operator-locked 6-digit OTP code paste-back).
**Operator decisions remaining:** 6 (D-15-3, D-15-5, D-15-6, D-15-7, D-15-8, D-15-9, D-15-10 — collapsed from 10).

---

## 1 — Layman summary

When you said "email and login already fixed," I verified that's true for **Google + Apple OAuth on web** — Cycle 0b (Apr 29, 2026) shipped the fix. The AuthProvider infinite-loader is gone, the OAuth-redirect flow works, both Google and Apple sign-in render on web. So WEB2 from the dispatch is **already closed** (Cycle 15 inherits a working web bundle).

What's NOT in the code: any email-based sign-in. Zero references to `signInWithOtp`, zero email-OTP code paths, no email input on the welcome screen. So Cycle 15's scope is genuinely **ONE thing** — add a third option to the welcome screen ("Continue with Email") that:

1. Asks for email
2. Sends a 6-digit code via Supabase `signInWithOtp` (using OTP-token mode, not magic-link)
3. Asks for the 6-digit code
4. Verifies with `verifyOtp({ type: "email" })`
5. Same `ensureCreatorAccount` + `tryRecoverAccountIfDeleted` post-sign-in path as Google/Apple (preserves I-35 recovery contract from Cycle 14)

**Effort revised:** ~12-16 hrs (down from epic's ~56hrs and dispatch's ~16-24hrs). Single component touch (BusinessWelcomeScreen) + 2 AuthContext callbacks + 1 service helper. Zero schema changes. Zero new dependencies.

---

## 2 — Investigation manifest (12 files read)

| # | File | Layer | Why |
|---|------|-------|-----|
| 1 | `Mingla_Artifacts/reports/IMPLEMENTATION_CYCLE_0b_WEB_AUTH_UNBLOCK.md` | Docs | Verify WEB2 shipped; review fix shape |
| 2 | `Mingla_Artifacts/DECISION_LOG.md` (DEC-076..089) | Docs | Auth model lock + WEB2 deferral context + DEC-086 founder-owned-workstream lock |
| 3 | `Mingla_Artifacts/AGENT_HANDOFFS.md` line 496 (AH-BIZ-001-E5) | Docs | Cycle 0a WEB2 deferral context |
| 4 | `Mingla_Artifacts/MEMORY.md` work-history | Docs | Project-state memory (Apple JWT expiry, etc.) |
| 5 | `mingla-business/src/context/AuthContext.tsx` (full file) | Code | Current OAuth flow + Cycle 14 recover-on-sign-in + I-35 gate |
| 6 | `mingla-business/src/services/supabase.ts` | Code | SSR-safe storage + `detectSessionInUrl: Platform.OS === "web"` |
| 7 | `mingla-business/src/services/creatorAccount.ts` | Code | `ensureCreatorAccount` upsert + `updateCreatorAccount` helper |
| 8 | `mingla-business/src/components/auth/BusinessWelcomeScreen.tsx` (full file) | Code | Current 2-button welcome screen + animation patterns + state hooks |
| 9 | `mingla-business/app/index.tsx` | Code | Auth gate routing |
| 10 | `mingla-business/app/auth/callback.tsx` | Code | OAuth callback (web only) — confirms WEB2 wiring |
| 11 | `supabase/migrations/20260404000001_creator_accounts.sql` | Schema | creator_accounts base table + RLS |
| 12 | `app-mobile/src/` grep for `signInWithOtp` | Code | Verify consumer app does NOT use email-OTP (confirmed: 0 hits) |

**Migration chain rule check:** creator_accounts has 1 base migration + PR #59 expansion (deleted_at + account_deletion_requests + marketing_opt_in + phone_e164 + default_brand_id, per Cycle 14 close). Latest = PR #59 expansion + Cycle 14 storage bucket. Cycle 15 adds **zero new schema**.

---

## 3 — Five-layer cross-check per thread

### Thread 1: WEB2 status verification

| Layer | Finding |
|-------|---------|
| **Docs** | DEC-078 says WEB2 deferred to Cycle 0b; Cycle 0b close report (`IMPLEMENTATION_CYCLE_0b_WEB_AUTH_UNBLOCK.md`) confirms 3 fixes shipped: Platform-gated `GoogleSignin.configure`, web branches in `signInWith*`, `detectSessionInUrl: Platform.OS === "web"`, NEW `app/auth/callback.tsx`. Code-level gates 1-5 PASS; founder smoke 6-9 deferred-to-runtime per dispatch. |
| **Code** | All 3 fixes verified at HEAD (AuthContext.tsx:34 `Platform.OS !== "web"` gate, supabase.ts:48 `detectSessionInUrl: Platform.OS === "web"`, app/auth/callback.tsx exists with Redirect to /). Plus 2 reworks shipped same cycle (Apple button render gate + sign-out navigation). |
| **Runtime** | Operator confirmed 2026-05-04: "email and login already fixed" (consistent with Cycle 0b commit `b2cc5daa` post-Apr 29 + the absence of any subsequent WEB2-related issue in MEMORY work-history or AGENT_HANDOFFS post-Cycle-0b). |
| **Schema** | N/A |
| **Data** | N/A |

**Verdict:** ✅ WEB2 IS FIXED. No additional work needed. Thread 1 closes immediately.

### Thread 2: Email + 6-digit OTP integration shape

| Layer | Finding |
|-------|---------|
| **Docs** | DEC-076 explicitly rejected "magic-link ONLY" (replacing OAuth) but did not forbid magic-link/email-OTP as ADDITIVE. Operator clarified 2026-05-04 wants email-OTP for organisers without Google/Apple. Brand-consistent with Mingla consumer-app SMS-OTP pattern (UX familiarity). |
| **Code** | Zero `signInWithOtp` / `verifyOtp` / `signInWithEmail` references in `mingla-business/`. Consumer app `app-mobile/` ALSO has zero email-OTP (uses SMS-OTP via Twilio). Cycle 15 ships the FIRST email-OTP path in the monorepo. |
| **Runtime** | Supabase JS SDK supports `supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } })` (sends code) + `supabase.auth.verifyOtp({ email, token, type: "email" })` (verifies). Both fire `onAuthStateChange(SIGNED_IN, ...)` on success → existing AuthContext listener (lines 120-138) handles `ensureCreatorAccount` + `tryRecoverAccountIfDeleted` (I-35 gate). |
| **Schema** | `creator_accounts` RLS already permits `auth.uid() = id` for SELECT/INSERT/UPDATE — applies to email-OTP-created auth.users rows identically to OAuth-created ones. `ensureCreatorAccount` upsert idempotent for both auth modes. NO schema changes needed. |
| **Data** | First email-OTP sign-in: `auth.users` row created by Supabase with email populated, `user_metadata.full_name` likely empty. `ensureCreatorAccount` falls back to `user.email.split('@')[0]` for display_name. Acceptable initial UX (operator can change in J-A1 edit-profile). |

**Verdict:** ✅ Implementation shape is clear. 2 new AuthContext callbacks + 1 BusinessWelcomeScreen extension + state machine. NO schema changes.

### Thread 3: Login page UX state machine

| Layer | Finding |
|-------|---------|
| **Docs** | Memory rules `feedback_implementor_uses_ui_ux_pro_max` (mandatory pre-flight before component code) + `feedback_keyboard_never_blocks_input` (TextInput must remain visible above keyboard) + `feedback_rn_color_formats` (hex/rgb/hsl/hwb only) all apply. |
| **Code** | BusinessWelcomeScreen.tsx is 547 LOC, single screen, animation-rich. Already handles 2 sign-in flows + entrance animations + reduce-motion exemption + Apple/iOS+web platform gating + back button hardware handler + accessibility labels. Extending with 3rd "Continue with Email" button is additive; entering email-input mode swaps the action zone content; entering OTP-input mode swaps again. State machine fits cleanly without route fork. |
| **Runtime** | Web + native parity: TextInput auto-handles email + numeric keyboards via `keyboardType` prop. `keyboardShouldPersistTaps` on outer ScrollView (if any) — but BusinessWelcomeScreen currently doesn't ScrollView-wrap; the actionZone is at bottom with `paddingBottom: insets.bottom`. For email-input mode, may need keyboard listener + dynamic `paddingBottom` to keep TextInput visible above keyboard (memory rule). |
| **Schema** | N/A |
| **Data** | N/A |

**Verdict:** ✅ Internal state machine in single component (NO route fork). Extends existing animation pattern. Keyboard discipline applied per memory rule.

### Thread 4: Cross-marketing coordination

| Layer | Finding |
|-------|---------|
| **Docs** | DEC-086 (2026-05-01): "Public-facing website is a SEPARATE FOUNDER-OWNED WORKSTREAM. Orchestrator does not initiate, plan, or dispatch work for the public-facing marketing website." Operator confirmed `mingla-marketing/` (Next.js 15 + React 19) exists at `mingla-main/mingla-marketing/` and is being worked on in another chat. |
| **Code** | `mingla-marketing/` is a separate top-level project: Next.js 15.1.6 + React 19 + Tailwind 4 + Framer Motion + Lucide-React. Has `(explorer)` route group + `organisers` route. **OUT OF SCOPE for this thread; do not touch.** |
| **Runtime** | DEC-077 (amended): no Vercel deploy until UI signed off. mingla-business runs locally via `npx expo start --web`. Production URL (`business.mingla.com` per DEC-076) deferred to post-Cycle-17 deploy. For dev, marketing CTAs link to localhost. |
| **Schema** | N/A |
| **Data** | N/A |

**Verdict:** ✅ Login page lives at `/` (current Index gate already routes signed-out users to BusinessWelcomeScreen). Marketing CTAs link to whatever URL `mingla-business` Expo Web is deployed at. **Cross-coordination output:** orchestrator authors a coordination note for the other chat (D-15-10 RESOLVED — orchestrator owns this).

---

## 4 — Findings (classified)

### 🔵 D-CYCLE15-FOR-1 — WEB2 already resolved (Cycle 0b)
**Layer:** Docs/Code contradiction in dispatch
**Finding:** Dispatch §3 Thread 1 was authored on stale reading of AGENT_HANDOFFS line 496 (Cycle 0a WEB2 deferral) without checking Cycle 0b's close report. Cycle 0b (commit `b2cc5daa`, Apr 29 2026) shipped 3 surgical fixes that closed WEB2.
**Impact:** Cycle 15 collapses to email-OTP-only. ~4hrs saved.
**Action:** Dispatch §3 Thread 1 superseded by this report's §3 Thread 1 verification. No code changes required.

### 🔵 D-CYCLE15-FOR-2 — DEC-081 vs `mingla-marketing/` codebase reality
**Finding:** DEC-081 (2026-04-29) declared `mingla-web` Next.js codebase DISCONTINUED. `mingla-marketing/` exists at HEAD as an active Next.js codebase being worked on in another chat. DEC-086 (2026-05-01) implicitly authorizes "founder-owned workstream" (the founder's directive: *"I will work on the UI for the front facing website separately"*) but does not explicitly retract DEC-081 for the new codebase.
**Impact:** Documentation drift; future investigators may flag `mingla-marketing/` as "deprecated per DEC-081" when it's actually founder-owned per DEC-086.
**Action:** Orchestrator authors NEW DEC entry post-CLOSE that:
- Notes `mingla-marketing/` exists as the founder-owned implementation of DEC-086's "separate workstream"
- Clarifies DEC-081's discontinuation applies to the orchestrator's lane only; founder's separate codebase IS the realisation of DEC-086

### 🟠 D-CYCLE15-FOR-3 — Supabase project setting verification (OTP mode)
**Finding:** Supabase `signInWithOtp({ email })` defaults emit BOTH a magic-link AND a token in the email body. For 6-digit-code-paste UX, the email template must include `{{ .Token }}` (not just `{{ .ConfirmationURL }}`). At the Supabase Auth dashboard level: **Auth → Email Templates → Magic Link** template needs verification.
**Impact:** If template is link-only, the email body will show only a clickable link with no code visible — the operator's UX expectation breaks.
**Action:** Pre-IMPL operator check: Supabase Dashboard → Authentication → Email Templates → "Magic Link" template should contain `{{ .Token }}` token-style code OR be customized to clearly display the code. Surface as part of D-15-3 below.

### 🟡 D-CYCLE15-FOR-4 — `ensureCreatorAccount` UX with email-OTP first sign-in
**Finding:** `ensureCreatorAccount` (creatorAccount.ts:8-33) derives `display_name` from `user.user_metadata.full_name` || `user_metadata.name` || `user.email.split('@')[0]` || `"Creator"`. Email-OTP sign-up populates `auth.users.email` but typically NOT `user_metadata.full_name` (Supabase doesn't have a name to attribute it from). So first email-OTP sign-in produces `display_name = "<email-prefix>"` (e.g., "joe" from "joe@example.com").
**Impact:** Cosmetic only. Operator can edit in J-A1 (edit-profile) post-sign-in. Acceptable initial UX.
**Action:** Document in IMPL report's transition items. NO code change. Could optionally trigger first-time edit-profile prompt as polish in a future cycle.

### 🔵 D-CYCLE15-FOR-5 — Apple JWT expiry tracker (D-IMPL-46 follow-up)
**Finding:** D-IMPL-46 (Cycle 0b discovery) notes Apple OAuth JWT expires 2026-10-26 (Apple's 6-month max). Recommended calendar reminder for ~2026-10-12.
**Impact:** Web Apple sign-in WILL break after 2026-10-26 if JWT not regenerated. Cycle 15 inherits this risk.
**Action:** Verify orchestrator scheduled reminder per /schedule conventions. NOT a Cycle 15 task; pre-existing followup. Surface to operator at REVIEW.

### 🟠 D-CYCLE15-FOR-6 — Rate-limit UX needs explicit copy
**Finding:** Supabase has per-email and per-IP rate limits on `signInWithOtp` (default ~4/hour per email, ~30/hour per IP). Hitting rate-limit returns error code 429 with message "Email rate limit exceeded".
**Impact:** Without explicit UX, user sees a generic error and may retry-loop. Need explicit copy + countdown timer ("Wait N minutes before trying again") OR surface rate-limit error gracefully.
**Action:** SPEC §5 (component layer) MUST handle the 429 error path with explicit user-facing copy.

### 🔵 D-CYCLE15-FOR-7 — DEC-082 missing from DECISION_LOG numbering
**Finding:** Grep for `DEC-08[2-9]` returned DEC-083..089 but NO DEC-082. Likely a numbering gap or formatting issue.
**Impact:** Minor documentation hygiene; no functional impact.
**Action:** Orchestrator audits at next housekeeping pass. NOT Cycle 15 scope.

---

## 5 — Operator decisions queued (6 remaining; 4 collapsed by ingest)

| ID | Status | Question |
|----|--------|----------|
| ~~D-15-1~~ | ✅ RESOLVED | WEB2 fix scope — already shipped in Cycle 0b. NOT needed. |
| ~~D-15-2~~ | ✅ RESOLVED | OTP mode — operator-locked 6-digit code paste-back 2026-05-04. |
| **D-15-3** | OPEN | Email provider — Supabase default OR Resend? Verify Supabase Auth → SMTP settings. Recommendation: keep Supabase default for Cycle 15; Resend wires can ship in B-cycle alongside notification infra. |
| ~~D-15-4~~ | ✅ RESOLVED (collapsed) | Redirect URL — N/A for code-paste mode. |
| **D-15-5** | OPEN | Login page URL — current `/` Index gate auto-routes signed-out users to BusinessWelcomeScreen. Recommendation: stay at `/`; mingla-marketing CTAs link to deployed mingla-business URL (e.g., `business.mingla.com` post-DEC-076 production). |
| **D-15-6** | OPEN | Extend BusinessWelcomeScreen with email mode OR separate `/login` web route? Recommendation: extend BusinessWelcomeScreen — internal state machine matches Cycle 14's 4-step delete-flow precedent. |
| **D-15-7** | OPEN | Sign-in vs sign-up UX — same button (auto-create on first sign-in via `shouldCreateUser: true`)? Recommendation: same button — matches OAuth pattern (Google/Apple auto-create on first sign-in via `ensureCreatorAccount`). |
| **D-15-8** | OPEN | Rate-limit UX copy — what exact copy on 429? Recommendation: "Too many attempts. Wait a minute before trying again." + disable Send button for 60s. |
| **D-15-9** | OPEN | First-email-OTP account-creation behavior — accept fallback `display_name = email-prefix`? Recommendation: yes (per D-CYCLE15-FOR-4); operator changes in J-A1 post-sign-in. |
| **D-15-10** | OPEN | Cross-marketing coordination — orchestrator authors coordination note? Recommendation: yes — orchestrator owns this; founder gets a one-liner about the URL convention. |

---

## 6 — Invariants to preserve

| ID | Status | How preserved |
|----|--------|---------------|
| I-35 (Cycle 14) | ✅ Preserved | Email-OTP SIGNED_IN event flows through existing `onAuthStateChange` handler at AuthContext:120-138 → triggers `tryRecoverAccountIfDeleted` (gated to SIGNED_IN per v2 fix Bug B). Recovery toast fires in account.tsx same as Google/Apple. |
| Constitution #2 (one owner per truth) | ✅ Preserved | `creator_accounts` remains canonical for organiser identity; auth.users mirror; both populated via `ensureCreatorAccount`. |
| Constitution #3 (no silent failures) | ✅ Preserved | All error paths (invalid email, network fail, rate-limit, wrong code, expired code) surface user-visible toast/Alert. |
| Constitution #11 (one auth instance) | ✅ Preserved | Reuses `supabase.auth` singleton; no new auth client. |
| Constitution #6 (logout clears) | ✅ Preserved | Email-OTP sign-out flows through existing `signOut` (AuthContext:346-362) which calls `clearAllStores()`. |

**No new invariants from Cycle 15.**

---

## 7 — Decomposition recommendation

**SINGLE Cycle 15** — ~12-16 hrs total. Tight scope:
- 3 NEW AuthContext callbacks (`signInWithEmail`, `verifyEmailOtp`, `cancelEmailOtp` for back navigation)
- 1 NEW state machine in BusinessWelcomeScreen (idle → email-input → otp-input → otp-verifying)
- 1 NEW pair of TextInputs (email + 6-digit code) with keyboard discipline
- 1 NEW "Continue with Email" button + animation
- 0 schema changes
- 0 new dependencies
- 0 new routes

**No D-CYCLE15-IMPL-N pre-flagged.**

---

## 8 — Confidence: H

**Per thread:**
- Thread 1 (WEB2): H — Cycle 0b close confirmed; code at HEAD verified
- Thread 2 (Email-OTP integration): H — Supabase API documented; existing patterns clear; ensureCreatorAccount handles both flows
- Thread 3 (UX state machine): H — BusinessWelcomeScreen pattern extends cleanly; memory rules mappable
- Thread 4 (Cross-marketing): H — DEC-086 frames the workstream; URL convention straightforward

**No M or L threads.** Spec dispatch can proceed immediately on operator-decision lock-in for the 6 remaining queued decisions.

---

## 9 — Recommendation: proceed to SPEC

All 4 threads at H confidence. Bounded scope. Operator-decision queue collapsed to 6 (was 10). All 6 have orchestrator recommendations attached.

**Hand back to orchestrator for:**
1. REVIEW investigation report
2. Surface 6 D-15-N decisions in plain English for batched lock-in (DEC-097)
3. SPEC dispatch authorship

SPEC scope: code-level contracts for 3 AuthContext callbacks + state machine + Supabase API calls + error paths + memory rule deference.

---

## 10 — Cross-references

- Dispatch: `Mingla_Artifacts/prompts/FORENSICS_BIZ_CYCLE_15_ORGANISER_LOGIN.md`
- Cycle 0b close: `Mingla_Artifacts/reports/IMPLEMENTATION_CYCLE_0b_WEB_AUTH_UNBLOCK.md`
- Cycle 14 close: `Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_14_ACCOUNT_REPORT.md`
- Epic: `Mingla_Artifacts/github/epics/cycle-15.md`
- DEC-076 (auth model — magic-link additive, not replacement): `Mingla_Artifacts/DECISION_LOG.md`
- DEC-078 (Cycle 0a WEB2 deferral): `Mingla_Artifacts/DECISION_LOG.md`
- DEC-081 (mingla-web Next.js discontinued; superseded by DEC-086 for `mingla-marketing/` reality)
- DEC-086 (founder-owned-workstream split): `Mingla_Artifacts/DECISION_LOG.md`
- I-35 (creator_accounts.deleted_at soft-delete contract): `Mingla_Artifacts/INVARIANT_REGISTRY.md`
- Memory rules: `feedback_implementor_uses_ui_ux_pro_max` · `feedback_keyboard_never_blocks_input` · `feedback_rn_color_formats` · `feedback_diagnose_first_workflow`
