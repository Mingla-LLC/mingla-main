# INVESTIGATION — ORCH-1400 / 1401 / 1402 / 1403 — invite-flow issues (post-1373)

**Mode:** INVESTIGATE (no fixes, no code changes). Dispatched by mingla-orchestrator.
**Date:** 2026-07-18
**Surface under test:** production `business.usemingla.com` (business WEB).
**Device:** Samsung `R58R54YV7JT` / SM-A725F, driven over USB via Chrome DevTools Protocol on **port 9378** (9222 untouched).
**Anchor read-only:** `~/Desktop/mingla-main` (no edits, no git).
**Evidence:** `Mingla_Artifacts/evidence/ORCH-1400-1403/`
**Production writes:** NONE. The ORCH-1400 repro was token-independent (auth-switch path), so the authorized single reversible invite was **not** created. rambleawaypod's live web session was momentarily removed and **restored** for one signed-out capture (verified restored).

---

## TL;DR per issue

| ORCH | Issue | Verdict | Confidence |
|------|-------|---------|------------|
| 1400 | Invite sign-in "freeze" when another account active | **Hard-freeze NOT reproduced on web.** The different-user accept path resolves to a generic error dead-end (see F-1). A literal hang is only plausible on the OAuth-callback lock path (suspected) or native. | proven (no hard freeze on web) + suspected (OAuth/native) |
| 1401 | Invite email should be ONE bank-first CTA | Current-state map delivered (F-3). Today: 2 CTAs in the email; non-partner accept never routes to bank. | mapped |
| 1402 | Invite/connect copy is ticket-centric | Catalog delivered (F-4) — 20+ ticket strings, file:line. | cataloged |
| 1403 | Connect-bank web page renders two headings overlapping | **PROVEN root cause** — non-scrolling `body` with `justifyContent:"center"` overflows the heading up over the fixed top bar on short viewports. Screenshot + geometry. | proven |

**NEW issue found (not in dispatch):** the accept-page error copy collapses to a generic "Something went wrong (status 500)" for **every** error code — the specific mapped copy ("Invitation not found", "Wrong account", "Connect your bank first", …) is dead. Runtime-proven. See **F-2**. This is the strongest concrete defect behind the ORCH-1400 "different account" symptom.

---

## Investigation manifest (files read, in trace order)

- `mingla-business/app/accept-brand-invitation.tsx` — accept route (ORCH-1373 shape)
- `mingla-business/app/accept-brand-invitation/success.tsx` — celebration screen
- `mingla-business/src/context/AuthContext.tsx` (full) — auth state machine, sign-in, sign-out, ORCH-1254 lock defer
- `mingla-business/src/utils/authReadiness.ts` — `deriveBusinessAuthStatus` / `isBusinessAuthReady`
- `mingla-business/src/utils/coldLoadAuthGates.ts` — route gates (`isSignInRoute`, invite-accept exemption)
- `mingla-business/app/_layout.tsx` — root auth-routing gate
- `mingla-business/app/auth/index.tsx`, `app/auth/callback.tsx` — sign-in + OAuth return
- `mingla-business/src/services/brandInvitationsService.ts`, `hooks/useBrandInvitations.ts` — accept mutation
- `supabase/functions/accept-brand-invitation/index.ts` — accept edge fn (error envelope)
- `supabase/functions/invite-brand-member/index.ts` + `_shared/brandInviteEmail.ts` — invite email
- `mingla-business/src/components/invite/BusinessAppDownloadCta.tsx` — download CTA
- `mingla-business/app/brand/[id]/payments/onboard.tsx`, `payments/index.tsx` — connect-bank routes
- `mingla-business/src/components/brand/BrandOnboardView.tsx` — the connect-bank view (ISSUE 4)
- `mingla-business/src/components/stripe/connect-pages/*` + `connectEmbeddedPageHelpers.ts` — Stripe embedded pages

---

# ORCH-1400 — [invite-signin-freeze-when-another-account-active] (S1)

## What Seth reported
Signed in as `rambleawaypod` on the device; invited `support@usemingla.com`; opened the invite; **tapped Sign in → the app froze.** Hypothesis: the freeze is caused by a *different* account already being signed in.

## What the current code actually does
The ORCH-1373 rewrite of `accept-brand-invitation.tsx` **removed** the old `user !== null` branch and the `10×150ms getSession()` retry loop the dispatch references — they no longer exist. The route now branches purely on `authStatus` (`accept-brand-invitation.tsx:87-125`):
- `signed_in_ready` → runs the accept mutation → renders success **or an error screen**.
- `signed_out` → renders **"You're invited / Sign in"** (the only place a "Sign in" button exists).
- `bootstrapping`/`refreshing` → spinner; `error` → "Something went wrong / Try again".

The accept route is **exempt** from the root-layout sign-in redirect (`coldLoadAuthGates.ts:319-360` `INVITE_ACCEPT_ROUTE_PREFIXES`), so a logged-out invitee is not bounced. That part of the 1373 fix works (verified below).

## Live repro (device, CDP 9378) — three permutations, NO hard freeze

**TEST 1 — signed in as a DIFFERENT account (`rambleawaypod+orch1384retest@gmail.com`), open accept link (garbage token).**
Fiber read at rest: `authStatus:"signed_in_ready", isAuthReady:true, loading:false, user=rambleawaypod`. Rendered: **"Something went wrong / We couldn't accept this invitation right now (status 500). / Back to Mingla"**. Network shows the accept call returning **404**, not 500. No hang; the page resolved in <2s.
Evidence: `evidence/ORCH-1400-1403/test1-signedin-diffaccount-accept.png`.

**TEST 2 — land on `/auth?next=<accept>` with the different-account session active** (Seth's "sign in while another account is active"). AuthIndex STEP-2 immediately resumed to the accept page (no loop), which resolved to the same error screen. No freeze, no redirect loop.
Evidence: `evidence/ORCH-1400-1403/test2-auth-next-accept-active-session.png`.

**TEST 3 — signed-OUT accept screen + tap Sign in** (token saved → removed → reload → tap → restore). Rendered exactly **"You're invited / Sign in to accept this invitation. We'll bring you right back. / Sign in"**; tapping Sign in navigated cleanly to `/auth?next=%2Faccept-brand-invitation%3Ftoken%3D…` showing BusinessWelcomeScreen (Continue with Apple/Google/Email). No freeze. Session restored (verified live at `/home`).
Evidence: `test3-signedout-accept-youre-invited.png`, `test3b-after-signin-tap.png`.

### F-1 — "already authenticated as a different user opens the accept flow" resolves to a generic-error DEAD END (not a hang)
- **Symptom:** wrong-account invitee sees "Something went wrong (status 500) / Back to Mingla" with **no way to switch accounts**. From the user's seat this reads as "stuck/frozen — it didn't work."
- **Layer:** code / runtime.
- **Probe:** TEST 1 & TEST 2 above (CDP fiber + DOM + network).
- **Evidence:** `authStatus:"signed_in_ready"`; DOM body = generic-500 error; accept HTTP = 404. Screenshots test1/test2.
- **Mechanism:** signed-in-as-wrong-user → accept mutation → edge fn returns a non-2xx (for a real support@ invite it would be `403 invite_email_mismatch`) → the accept page renders an error screen whose only action is "Back to Mingla" (dumps to home). There is no "sign out & sign in as the invited email" affordance.
- **Severity:** CONFIRMED (the reproducible defect matching Seth's "a different account was signed in"). This is the product-level truth behind ORCH-1400.

### On the LITERAL hard freeze
A permanent hang was **not reproducible** in any web auth-switch permutation. The only true hang class in this codebase's auth is the **GoTrue navigator-lock deadlock** (documented at `AuthContext.tsx:670-708` ORCH-1254 and `coldLoadAuthGates.ts:438-489` ORCH-1102/1100). The one place it could still bite the invite flow is the **OAuth return leg** (`app/auth/callback.tsx`): `detectSessionInUrl` must swap the session while a *different* account's token already sits in `localStorage`; if the lock is orphaned, `/auth/callback` shows a permanent `ActivityIndicator` until the 7s `AUTH_LOADING_GATE_RELEASE_BACKSTOP_MS` backstop flips `loading` false — after which the callback either resumes or drops the session and lands back at sign-in (invite token lost). I could not force a real cross-account OAuth on the shared live device session without risk, so this stays **suspected**. It is also possible Seth's freeze was on the **native app** (the device's foreground app was `com.sethogieva.minglabusiness`, not Chrome; there was **no** ANR since boot). The invite link (`brandInviteEmail.ts` → `acceptUrl = https://business.usemingla.com/accept-brand-invitation?token=…`) can open the native app via Android App Links, so the native accept/sign-in path is a real second candidate — but it cannot be puppeted on a release build.

### Recommended fix DIRECTION (ORCH-1400)
1. **Make "wrong account" a first-class, recoverable screen, not a generic 500 dead end.** When the accept edge fn returns `invite_email_mismatch` (or the caller is signed in as an email that doesn't match the invite), render the intended "Wrong account" copy **plus a "Sign in with a different email" action** that signs the current user out and routes to `/auth?next=<accept>`. This depends on **F-2 being fixed first** (today the code never even reaches the mismatch copy).
2. **Harden the OAuth-callback session swap** against the lock-contention hang: sign out / clear the prior session before establishing the invitee's, or gate `/auth/callback` behind the same bounded backstop the root layout uses so it can never spin indefinitely (it currently reads `loading` with no local ceiling).
3. **Verify the native App-Link accept path** as a separate confirm (needs a dev build / Seth on-device), since the freeze may live there.

---

### F-2 (NEW ISSUE) — every accept error collapses to generic "status 500"; all specific copy is dead
- **Symptom:** a 404/403/409/410 from the accept edge fn all render the **default** copy "We couldn't accept this invitation right now (status 500)". The mapped copy at `accept-brand-invitation.tsx:292-345` ("Invitation not found", "Already accepted", "Wrong account", "Connect your bank first", "Invitation expired/revoked/declined") is **unreachable on web**.
- **Layer:** code (service) / runtime.
- **Probe:** TEST 1 — accept HTTP was **404** (network log) but UI showed **status 500** default copy.
- **Evidence:** `brandInvitationsService.ts:364-387`. `extractStatus` reads `error.context?.response?.status`, but for a supabase-js `FunctionsHttpError` the `context` **is** the `Response` (status at `error.context.status`, no `.response`), so it always falls through to `500`. `extractErrorCode` reads `data.error`, but on a non-2xx `data` is `null` (the body must be read async via `await error.context.json()`), so the code always defaults to `"server"`.
- **Mechanism:** wrong status + wrong code → `errorCopyFor("server", 500)` → the `default` branch on every failure.
- **Severity:** CONFIRMED (secondary root cause; directly degrades the ORCH-1400/1373 invite funnel — the invitee never sees *why* it failed).
- **Fix direction:** in the service, read status from `error.context.status` and parse the code from `await error.context.json()` (or surface the Response to the caller). Add a fails-on-revert test that a 404 renders "Invitation not found" and a 403 renders "Wrong account".

---

# ORCH-1401 — [invite-email-bank-first-single-cta] — CURRENT-STATE MAP

Seth's target: ONE CTA → accept → **connect bank (Stripe) ASAP** → then download; if they skip bank, continue → store.

### F-3 — the funnel as it exists today (map, not a redesign)

**1. Invite email** (`supabase/functions/_shared/brandInviteEmail.ts`, sent by `invite-brand-member/index.ts:287-344`; `acceptUrl = https://business.usemingla.com/accept-brand-invitation?token=…`):
- **TWO CTAs today.** Primary filled button = "Accept invitation" (partner variant: "Accept & set up {brand}") → `acceptUrl` (`brandInviteEmail.ts:150-157`). Secondary ghost button = **"Get the Mingla Business app"** → static `https://usemingla.com/business/download` (`:159-175`) — a **download** CTA that competes with accept, and is byte-frozen by `orch-1329-invite-email.tester.test.ts`.
- The **partner** variant already tells the bank-first story in copy — a 3-step block "Accept & claim → Connect your bank → You're live" (`:123-124`) — but still renders two buttons and never links the bank directly.

**2. Accept landing** (`accept-brand-invitation.tsx`): on success, **non-partner** → inline card "You're on the team" + **"Go to team"** + `BusinessAppDownloadCta` (`:182-207`). **Partner transfer** → redirects to the success/celebration screen (`:156-169`). So a plain team invitee is **never routed to the bank** — only partner transfers are.

**3. Success / celebration** (`accept-brand-invitation/success.tsx`, partner path only): "Welcome to {brand}" + "The next step is connecting your bank so customers can buy tickets." + primary **"Set up {brand} on the web →"** → `/brand/{id}/payments` (`:109-143`) + `BusinessAppDownloadCta` + "Or come back to your email anytime."

**4. Bank connect** lives two taps past that: `/brand/{id}/payments` (`BrandPaymentsView`, "Connect bank to sell tickets") → tap → `/brand/{id}/payments/onboard` (`BrandOnboardView`) → ToS gate → "Set up payments" → Stripe Connect embedded (`connect-onboarding.web.tsx` → `ConnectOnboardingBody.web.tsx`).

**5. Smart link** `biz.usemingla.com/ZSCW` → `minglabiz.onelink.me/ch/ZSCW` → per-platform store 301 (`referrer=af_tranid` attribution). It is a **pure download** link today; it carries no accept/bank context.

**Seams a bank-first single-CTA funnel would need:**
- Collapse the invite email to ONE primary CTA (accept) and demote/remove the competing "Get the app" button (currently pinned by a test).
- Route the **non-partner** accept-success straight to the bank onboard (`/brand/{id}/payments/onboard`), not "Go to team" — matching the partner path. Ideally skip the intermediate `/payments` dashboard.
- Add an explicit **"Skip / do this later → download the app"** continue action on the bank screen that falls through to the OneLink store redirect (reuse `BusinessAppDownloadCta` / `buildBusinessInviteDownloadUrl`).
- The bank onboard entry currently gates on the ToS sheet + country picker; a "bank ASAP" funnel must account for those two pre-steps.

Relates to ORCH-1329 (device-aware download), ORCH-1331 (NG Paystack rail), ORCH-1052 (currency gate).

---

# ORCH-1402 — [invite-flow-offering-agnostic-copy] — CATALOG

Positioning ([[feedback_mingla_positioning]]): Mingla is an **experiences** platform (venues, trips, experiences), not a ticketing tool. A bank is needed for venues and trips too. Every string below hard-codes "tickets".

**Accept-success "Welcome to {brand}" page** (`app/accept-brand-invitation/success.tsx`):
- `:132` — "The next step is connecting your bank so customers can **buy tickets**."

**Connect-bank view** (`src/components/brand/BrandOnboardView.tsx`):
- `:648` — heading "Connect bank to start **selling tickets**"
- `:651-652` — "Set up payments to publish events and receive money from **ticket sales**."

**Connect-bank dashboard** (`src/components/brand/BrandPaymentsView.tsx`) — same flow, reached from the invite:
- `:98` — "Connect bank to **sell tickets**"
- `:127` — "We need additional information before you can **sell tickets**."
- `:705` — "Payouts arrive here once you start **selling tickets**."
- `:808` — "…from **selling tickets**. Existing **buyers keep their tickets**;…"

**Download CTA shown on accept success** (`src/components/invite/BusinessAppDownloadCta.tsx`):
- `:88` — "Manage your brand, **sell tickets**, and **scan guests** in from your phone."

**Invite email** (`supabase/functions/_shared/brandInviteEmail.ts`):
- `:142` / `:226` — "{brand} runs its events, **tickets** and page on Mingla…"
- `:124` — partner step 3: "your events open **for tickets** and the money lands…"
- `:174` — "…scan guests in, check sales, run events…" (event-centric)
- `roleCanPhrase` `:272-278` — event_manager "manage **tickets** and guests"; scanner "**scan tickets** and check guests in at the door"; finance "see **sales**…"

**Stripe embedded headers** (secondary, not invitee-facing copy but same flow):
- `ConnectOnboardingBody.web.tsx:276` — "Mingla — Set up payments" (offering-neutral already — good)

**Direction:** swap "sell/selling tickets", "ticket sales", "buy tickets" → offering-neutral revenue language ("get paid", "take payments", "receive money from sales", "sell out your experiences"). Keep it consistent across the accept-success page, `BrandOnboardView`, `BrandPaymentsView`, `BusinessAppDownloadCta`, and the invite email. Note: `BrandPaymentsView` shares copy with the invite funnel, so a copy pass scoped only to the three named surfaces would leave the payments dashboard inconsistent — include it.

---

# ORCH-1403 — [connect-bank-web-text-collision] (S1) — PROVEN ROOT CAUSE

## Symptom
On the connect-bank web page, two headings paint **on top of each other** — "Connect bank to start selling tickets" over "Set up payments" (+ a "Cancel" fragment), illegible.

## Route + component
`/brand/{id}/payments/onboard` (`app/brand/[id]/payments/onboard.tsx`) → **`BrandOnboardView`** (`src/components/brand/BrandOnboardView.tsx`), a react-native-web component. All three colliding strings are in this ONE component: the fixed top bar renders "Set up payments" (title `:534`) + "Cancel" (`:527`); the `idle`-state body renders the heading "Connect bank to start selling tickets" (`:648`). (These are NOT the Stripe embedded pages — `ConnectOnboardingBody.web.tsx` header is "Mingla — Set up payments".)

## Live repro (device, CDP 9378) — geometry + screenshot
Navigated to `/brand/1ce63bf4-…/payments/onboard` (idle state, ToS gate up) at several viewport heights (width 412):

| viewport | "Set up payments" (topbar) | "Connect bank to start selling tickets" (heading) | overlap |
|----------|----------------------------|---------------------------------------------------|---------|
| 412×820 | top 12 / bot 44 | top 86 / bot 158 | **none** (clean) |
| **412×640** | top 12 / bot 44 | **top −4 / bot 68** | **32px over "Set up payments", 20px over "Cancel"** |
| 412×520 | top 12 / bot 44 | top −64 / bot 8 | heading pushed off-screen top |
| 412×430 | top 12 / bot 44 | top −109 / bot −37 | heading fully above viewport |

The Samsung's real usable Chrome viewport (~640px tall with the URL bar) lands squarely in the collision band. **Screenshot `evidence/ORCH-1400-1403/test4-onboard-h640.png` is a pixel match to Seth's report** — the big heading painted over "Set up payments" + "Cancel". Baseline (no overlap) at `test4-connect-bank-onboard-brand1ce6.png` (820px).

### F-5 — non-scrolling `body` with `justifyContent:"center"` overflows the heading up over the fixed top bar
- **Layer:** code (component layout) / runtime.
- **Probe:** the geometry table above (CDP `getBoundingClientRect`) + screenshots.
- **Evidence:** `BrandOnboardView.tsx:571-580` renders `<View style={styles.host}>` (`{flex:1}`, `:994`) containing `renderTopBar()` (`topBarRow` `minHeight:56`, `:999-1006`) then `<View style={styles.body}>` where `styles.body = {flex:1, justifyContent:"center", gap:xl}` (`:1021-1026`). The body is a **plain View, not a ScrollView.**
- **Mechanism:** the `idle` content (heading + subtext + country picker + prereq card + "Set up payments" button + "Powered by Stripe", plus the `MinglaToSAcceptanceGate` sheet consuming the lower half) is taller than the available body height on a short viewport. With `justifyContent:"center"` and RN's default `overflow:visible`, the overflow spills **equally top and bottom**, so the top of the content (the heading) is painted **above the body box, directly over the fixed top bar**. Taller viewport → fits → no collision; shorter viewport → heading climbs over "Set up payments"/"Cancel".
- **Severity:** CONFIRMED ROOT CAUSE.
- **Cross-surface:** proven on business WEB. Latent on business **native** too (same component, same styles) — a short native screen or the keyboard raised could trigger the same overflow; not verified on-device.
- **Fix direction:** make the body **scrollable** — wrap the state content in a `ScrollView` with `contentContainerStyle={{ flexGrow:1, justifyContent:"center" }}` (so short content still centers but tall content scrolls under the fixed top bar), or drop `justifyContent:"center"` on the outer body and let content flow from the top with scroll. The sibling Stripe embedded pages already solve this with `pageWrapperStyle` (`overflowY:auto`, `connectEmbeddedPageHelpers.ts:43-54`) — `BrandOnboardView` simply never got a scroll container. Regression guard: assert the heading's `top` stays ≥ the top bar's `bottom` at a 640px viewport.

---

## Five-truth-layer note
- **Docs vs Code (1400):** the dispatch's mental model (a `user !== null` branch + `getSession` loop) reflects **pre-1373** code; ORCH-1373 deleted both. The current defect is F-1/F-2, not the old loop. Flagged so the SPEC scopes the real code.
- **Code vs Runtime (1403):** source alone reads "top bar then body, no overlap"; only the live short-viewport geometry exposes the overflow. Confirms the live-fire requirement.

## Discoveries for Orchestrator
- **F-2 (NEW):** accept-error copy is universally the generic 500 — the whole mapped error table is dead on web. Register as its own bug (or fold into ORCH-1400); it is the concrete reason the "wrong account" invitee sees a broken-looking screen.
- `BrandPaymentsView` shares the ticket-centric copy — an ORCH-1402 copy pass scoped only to the 3 named surfaces would leave it inconsistent.
- The invite email "Get the app" secondary CTA is pinned byte-for-byte by `orch-1329-invite-email.tester.test.ts`; the ORCH-1401 single-CTA change must update/retire that test.

## Confidence
- ORCH-1403: **proven** (runtime geometry + screenshot).
- ORCH-1400 F-1/F-2: **proven** (runtime); the literal hard-freeze: **not reproduced on web**, **suspected** on the OAuth-callback lock swap or native app.
- ORCH-1401/1402: current-state map + catalog complete.

## Recommended next phase
SPEC. ORCH-1403 and F-2 are tight, provable fixes ready to spec now. ORCH-1400 (F-1 recoverable "wrong account" + OAuth-callback hardening) should spec alongside F-2. ORCH-1401/1402 are product/copy specs (mingla-product for copy, then implementor). The native-app freeze candidate needs a separate on-device confirm before it can be specced.
