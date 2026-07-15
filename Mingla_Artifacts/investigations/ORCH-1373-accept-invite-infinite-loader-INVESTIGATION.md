# ORCH-1373 [accept-invite-infinite-loader] — INVESTIGATION

**Mode:** INVESTIGATE (no fix proposed, no product code changed)
**Dispatched by:** mingla-orchestrator (conductor)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1373-[accept-invite-infinite-loader]/` on `ORCH-1373-accept-invite-infinite-loader`
**Date:** 2026-07-14
**Source issue:** GitHub #880 (Seth)
**Confidence:** **PROVEN** — live repro on Seth's physical Samsung `R58R54YV7JT` (SM-A725F) against **production** `business.usemingla.com`, both arms, plus an exhaustive mechanical proof executed against the real shipped module and a read-only production data check.

---

## 1. Verdict on the prime hypothesis

> **CONFIRMED — all five links of the orchestrator's hypothesis proved true at runtime.** No link required correction. The `/auth?next=…` redirect at `accept-brand-invitation.tsx:69-73` is **dead code**, and the spinner is **permanent**, for **every logged-out invitee** — which is essentially every invitee.

One nuance the hypothesis did not anticipate, which *strengthens* rather than weakens it: a logged-out visitor does not reach `signed_out` via the clean bootstrap path. On business web the auth bootstrap **never resolves natively** and is force-released by the 7000 ms hard ceiling (Collateral C-4), whose own stated purpose is *"treating as logged-out so the user lands on sign-in, never an infinite spinner"*. On this route that safety net **produces** the infinite spinner it exists to prevent, because the route is exempt from the sign-in redirect and its own redirect is dead. Both the `bootstrapping` and `signed_out` states yield `isAuthReady === false`, so the verdict is unchanged either way (proved exhaustively in F-2).

---

## 2. Symptom

| | |
|---|---|
| **Expected** | Invitee clicks "Accept invite" in the email → the invite resolves fast → they are told the outcome (accepted / expired / already used / wrong account) and, if logged out, are routed to sign in / download the app. |
| **Actual** | Infinite `ActivityIndicator` + "Accepting your invitation…". Never resolves. Never errors. Never redirects. Never tells them anything. |
| **Reproduction** | **Always**, for any logged-out visitor, regardless of token validity. |

---

## 3. Proven root cause (plain English)

The accept-invite page refuses to do anything until the user is **fully signed in**. The very first line of its logic says "if auth isn't ready, stop and wait." For someone who is genuinely logged out, auth is *never* going to become ready — that's the terminal state, not a temporary one. So the page waits forever. The code that was *supposed* to catch this and send them to sign in sits **one line below** the wait, and can therefore never run: the two conditions are mutually exclusive, so that redirect is unreachable code that has never executed in production. The screen only knows how to render a spinner in that state, so the invitee stares at "Accepting your invitation…" until they give up. Because an invitee is by definition someone clicking an email link — i.e. logged out — **this hits essentially every invitee**. The invite token, the email, the network and the backend edge function are all fine and entirely innocent: the edge function is never even called.

### Exact file:line chain

1. `mingla-business/src/utils/authReadiness.ts:85-106` — `deriveBusinessAuthStatus({loading:false, session:null, user:null, authError:null})` → **`"signed_out"`**.
2. `mingla-business/src/utils/authReadiness.ts:108-112` — `isBusinessAuthReady` returns true **only** when `authStatus === "signed_in_ready" && hasUsableBusinessSession(session)` → for a logged-out visitor, **`false` permanently**.
3. `mingla-business/app/accept-brand-invitation.tsx:64` — `if (!isAuthReady) return;` — the effect's **first statement**, fires on every render, unconditionally returns.
4. `mingla-business/app/accept-brand-invitation.tsx:69-73` — `if (user === null) { router.replace('/auth?next=…') }` — **UNREACHABLE**. `isAuthReady === true` and `user === null` cannot coexist (F-2, exhaustive: 0/12 combinations).
5. `mingla-business/app/accept-brand-invitation.tsx:135-142` — `if (!isAuthReady || phase.kind === "loading")` → renders the spinner + "Accepting your invitation…" **forever**.
6. **No rescue from the root layout** (both hatches closed):
   - `mingla-business/src/utils/coldLoadAuthGates.ts:330-346` — `shouldRedirectToSignInFromRoute` excludes `isSelfAuthenticatedExemptRoute(pathname)`; `/accept-brand-invitation` is in `INVITE_ACCEPT_ROUTE_PREFIXES` (`:260-263`) → `redirectToSignIn === false`.
   - `mingla-business/src/utils/coldLoadAuthGates.ts:398-415` — `isAuthResolutionExpired` returns false unless `stillResolving` is true; `isWebAuthResolving` (`:360-376`) is false for a logged-out user with no stored session → the `_layout.tsx:737` ceiling redirect **never arms**.

---

## 4. Runtime evidence trail

All evidence from **Seth's physical Samsung `R58R54YV7JT`** driven over `adb` + Chrome DevTools Protocol (port **9373** — port 9222 was already held by another session's headless Chrome and was deliberately not touched). Target: **production** `https://business.usemingla.com`. The device Chrome was **already genuinely logged out** (`storedSbKeys: []`) — the authentic invitee state; no incognito or profile surgery required.

Live `AuthContext` values were read by walking the React fiber tree (`__reactContainer$…` → `memoizedProps.value`), per `reference_drive_samsung_adb_cdp_web_forensics.md`.

**Probe harnesses (scratch):** `/tmp/orch-1373/cdp.mjs`, `/tmp/orch-1373/armB.mjs`, `/tmp/orch-1373/armB-fast.mjs`, `/tmp/orch-1373/mutual-exclusivity-proof.mts`
**Captures (scratch):** `/tmp/orch-1373/capture-*.json`
**Evidence (committed):** `Mingla_Artifacts/evidence/ORCH-1373/armA-loggedout-infinite-spinner-samsung.png`

> **Test-URL note.** Both arms deliberately used a **garbage token** (`ORCH1373PROBETOKEN`). This is a feature of the design, not a shortcut: the hypothesis predicts the auth gate fires *before* any token handling, so a garbage token must produce the *same* infinite spinner as a real one — and it did. It also means **no production token was needed and no production row was touched**. The URL shape tested is byte-identical to the one real invitees receive, built at `supabase/functions/invite-brand-member/index.ts:578` (`https://business.usemingla.com/accept-brand-invitation?token=…`), confirmed by `orch-1050-invite-happy.test.ts:110`.

### Arm A — logged-out invitee (the reported symptom) → **REPRODUCED**

Command: `node /tmp/orch-1373/cdp.mjs 144 "https://business.usemingla.com/accept-brand-invitation?token=ORCH1373PROBETOKEN" armA 30000`

16 consecutive fiber samples over **32.3 seconds**, verbatim (abridged to first/last — all 16 identical):

```
  2128ms | isAuthReady=False | authStatus=signed_out | loading=False | body='Accepting your invitation…' | url=cept-brand-invitation?token=ORCH1373PROBETOKEN
 ... (14 identical samples) ...
 32294ms | isAuthReady=False | authStatus=signed_out | loading=False | body='Accepting your invitation…' | url=cept-brand-invitation?token=ORCH1373PROBETOKEN

accept edge fn calls: 0
```

Four decisive facts in one capture:
- **`isAuthReady=False` at every sample** — never flips.
- **`loading=False`** — the bootstrap has **finished**. This is the **terminal** state, not a transient warming window. This is the single most important number in the investigation: it converts "slow" into "permanent".
- **`url` never changes** — the `/auth?next=` redirect at `:69-73` **never fired**. This is the direct runtime proof of dead code.
- **`accept edge fn calls: 0`** — the `accept-brand-invitation` edge function is **never invoked**. The backend never learns the invitee exists.

Screenshot (Seth's device, production): `Mingla_Artifacts/evidence/ORCH-1373/armA-loggedout-infinite-spinner-samsung.png` — orange spinner over "Accepting your invitation…" on `…ess.usemingla.com`.

### Arm B — auth gate opened (the contrast) → **EDGE FN FIRES**

To obtain the authed arm without Seth's OAuth credentials, a synthetic Supabase session was planted in the **device's own Chrome localStorage** (`sb-gqnoajqerqhnvulmnyvv-auth-token`) — a **client-side-only** manipulation, **no production write**, removed afterwards (verified clean, §7).

Fast-poll (250 ms) capture, state transitions only:

```
 7500ms   {"isAuthReady":true, "authStatus":"signed_in_ready","loading":false,"hasUser":true}   | "Accepting your invitation…"
10000ms   {"isAuthReady":false,"authStatus":"signed_out",     "loading":false,"hasUser":false}  | "Accepting your invitation…"

ACCEPT EDGE FN CALLS: 2
   POST    https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/accept-brand-invitation
   OPTIONS https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/accept-brand-invitation
```

Ordered network + console trace showing the full mechanism:

```
POST /functions/v1/accept-brand-invitation          ← gate OPEN → the effect body RAN
GET  /auth/v1/user                                  ← AuthContext boot probe
[auth] boot-session-probe: stored session rejected by server (invalid JWT: unable to
       parse or verify signature, token is malformed: could not base64 decode signa…)
POST /auth/v1/logout?scope=global                   ← classifyBootSessionProbe → invalid_session → sign out
                                                    ← isAuthReady back to false → spinner returns
```

**This is the decisive evidence.** Same device, same page, same production build, **same garbage token**. The only variable changed was whether the auth gate opened:

| Arm | `isAuthReady` | accept edge-fn calls | User sees |
|---|---|---|---|
| **A** — logged out | `false` (32 s, 16/16 samples) | **0** | spinner, forever |
| **B** — gate opened | `true` (observed at 7500 ms) | **2** (OPTIONS + POST) | — |

The auth gate — **not** the token, **not** the network, **not** the edge function — is what blocks the flow. `isAuthReady` is the sole determinant of whether the invite is ever processed.

### Mechanical proof — the redirect is unreachable for *every* logged-out input

`/tmp/orch-1373/mutual-exclusivity-proof.mts` imports and executes the **real shipped** `mingla-business/src/utils/authReadiness.ts` (no reimplementation), seeded with the exact state measured on the device:

```
state                                      authStatus       isAuthReady  user===null  line64 returns?  line69 reachable?
------------------------------------------------------------------------------------------------------------------------
logged-out invitee (MEASURED on Samsung)   signed_out       false        true         true             false
cold boot, no stored session               bootstrapping    false        true         true             false
authed brand user (contrast)               signed_in_ready  true         false        false            false

--- EXHAUSTIVE: is there ANY input where (user===null) AND (isAuthReady===true)? ---
combinations where user===null AND isAuthReady===true : 0
=> PROVEN: the /auth?next= redirect at :69-72 is UNREACHABLE for every logged-out input. DEAD CODE.
```

Note row 2: the redirect is unreachable during the `bootstrapping` window **as well as** the terminal `signed_out` state. There is no timing window, no race, and no state in which it can fire.

---

## 5. Five-Truth-Layer reconciliation

| Layer | Finding | Contradiction |
|---|---|---|
| **Docs** | The route's own header comment, `accept-brand-invitation.tsx:9-10`, states: *"If the user isn't authenticated, send them to /auth and preserve the token via the `next` query param so /auth/callback can resume."* | **CONTRADICTED BY CODE + RUNTIME.** The documented behavior has never once executed in production. The comment describes an intent the control flow makes impossible. Worse, the resume half is fiction at *both* ends: nothing reads `next` (C-2), and `auth/callback.tsx` contains no `next` handling at all. **The docstring is the clearest statement of the intended design and should anchor the fix.** |
| **Schema** | `brand_invitations` (uuid `id`, `token_hash`, `expires_at`, `accepted_at`, `revoked_at`, `declined_at`, `status`, …). Healthy; supports every outcome the UI needs to report (expired / used / revoked / declined). Note: **no `created_at`** column. | No contradiction. The schema can already express every outcome Seth wants surfaced. |
| **Code** | `:64` returns before `:69` can ever run; `:135` render gate has no non-spinner branch for `!isAuthReady`. | **The bug.** |
| **Runtime** | 16/16 samples over 32 s: `isAuthReady=false`, `loading=false`, URL unchanged, 0 edge-fn calls. Gate opened ⇒ edge fn fires. | Agrees with Code; **contradicts Docs**. |
| **Data** | Production `brand_invitations`: **`total=1, accepted=0, live_pending=1`**. `scanner_invitations`: `total=0`. | **Corroborates.** The accept funnel's lifetime success rate in production is **0 of 1 (0%)**. The single live-pending invite is the one behind issue #880. (Prod was wiped of test data 2026-06-22, so this is clean post-wipe reality — a small but perfectly consistent sample.) |

**Truth holder:** Code + Runtime. The Docs layer describes a design that was intended but never wired; the Data layer independently confirms nobody has ever completed the flow.

---

## 6. Blast radius

**Who is affected: every logged-out invitee — which is essentially every invitee.**

An invitee is by construction a person who receives an email and clicks a link. That person is, in the overwhelming majority of cases, not already signed in to `business.usemingla.com` in the same browser. The **only** invitee who succeeds today is one who happens to already hold a live business web session in the exact browser that opens the email link. Partner/brand onboarding is precisely the population *least* likely to satisfy that — they are new to the product, and many are being onboarded onto a brand for the first time.

| Surface | Affected? | Detail |
|---|---|---|
| **Buyer/anonymous Web** (`business.usemingla.com/accept-brand-invitation`) | **YES — primary** | Proven on device. This is the URL the invite email sends (`invite-brand-member/index.ts:578`). |
| **Business Web** `/accept-scanner-invitation` | **YES — identical defect** | C-1. Same dead redirect, same render gate. Currently 0 rows, so 0 users hit *yet* — a live landmine, not a live fire. |
| **Business iOS / Android (native)** | **Indirect** | The email CTA targets the web URL; native is reached only via the download CTA. The route exists in the same Expo Router tree, so a deep link into it on native would hit the same gate. Not runtime-verified here (out of scope). |
| **Consumer iOS / Android** | **NO** | Separate app; no brand-invite accept route. |
| **Admin Web** | **NO** | Not in this flow. |

**Funnel impact:** the partner-onboarding funnel has a **hard 0% completion rate** for logged-out invitees, with **no error, no telemetry, and no signal to the inviter**. The brand owner sees the invite as "pending" forever and cannot distinguish "hasn't opened it" from "opened it and was silently broken". The invitee experiences a dead product. Nothing is logged; the edge function never runs, so there is not even a server-side trace that the attempt happened. **This is an S0/S1 launch-quality defect on the partner-onboarding funnel.**

---

## 7. Guard compliance

- **No production DB writes.** Every DB statement was `SELECT`/`information_schema` only.
- **Synthetic-session diligence.** Arm B's fake JWT caused the client to *attempt* `POST /rest/v1/creator_accounts?on_conflict=id` (`ensureCreatorAccount`). The server rejected the invalid signature. Verified read-only afterwards — **0 rows**:
  ```sql
  SELECT count(*) FROM creator_accounts
   WHERE id='00000000-0000-4000-8000-000000000001'
      OR email='orch1373-probe@example.invalid';   -- → 0
  SELECT count(*) FROM brand_team_members
   WHERE user_id='00000000-0000-4000-8000-000000000001';  -- → 0
  ```
- **Device left clean.** All `sb-*-auth-token` keys removed; verified `removed=0 remaining=0` (AuthContext's own sign-out had already purged the synthetic key).
- **No cross-session interference.** Used port **9373**; port 9222 (another session's headless Chrome) untouched. No global `pkill`. Metro port 8100 was never needed — production was the faithful target.
- **No instrumentation left behind.** The `[ORCH-1373-DIAG]` markers offered in the dispatch proved **unnecessary** — the React fiber walk read live `AuthContext` state (`isAuthReady`/`authStatus`/`loading`/`user`) directly off the **unmodified production bundle**. **No product code was modified at any point**, so there is nothing to reap and zero risk of a diagnostic marker leaking into a commit. Evidence is stronger for it: it was captured from the exact bytes real invitees execute.
- **No fix proposed or written.** INVESTIGATE only.

---

## 8. Collateral findings

Recorded for the orchestrator to register as **separate** ORCHs. Not fixed, not scope-crept.

### C-1 — `/accept-scanner-invitation` carries the IDENTICAL dead-redirect defect — **suggested S1**
`mingla-business/app/accept-scanner-invitation.tsx` is a line-for-line clone of the same mistake: `:63` `if (!isAuthReady) return;` precedes `:68` `if (user === null)` → `:72` `router.replace('/auth?next=…')`, with the same `:104` `if (!isAuthReady || phase.kind === "loading")` spinner gate. The mutual-exclusivity proof applies verbatim, so its redirect is dead too. **Evidence:** source + the F-2 exhaustive proof (shared `authReadiness.ts`). Production `scanner_invitations` currently has `total=0`, so no user has hit it **yet** — this is a loaded landmine that fires the first time a brand invites a scanner. Any fix for ORCH-1373 that does not cover this file leaves the bug live on a sibling surface. **Surface:** Business Web.

### C-2 — `?next=` is entirely vestigial: 4 writers, 0 readers — **suggested S1**
Nothing in `mingla-business` ever reads a `next` param. Writers: `accept-brand-invitation.tsx:71`, `accept-scanner-invitation.tsx:72`, `rsvp/create.tsx:221`, `event/create.tsx:221`. There is **no `app/auth.tsx`** — the target resolves to `app/auth/index.tsx`, which ignores query params and hard-redirects to home (`:23` `router.replace(AppRoutes.home)`); `app/auth/callback.tsx` contains **no** `next` handling despite the route docstring at `accept-brand-invitation.tsx:9-10` explicitly promising *"so /auth/callback can resume"*. **This is load-bearing for ORCH-1373's fix:** merely reordering the two `if`s would send the invitee to sign in and then strand them on home with the token silently discarded — converting an infinite spinner into a silent drop, which is arguably worse because it looks like success. The resume path must be built, not assumed. Also independently breaks the `/rsvp/create` and `/event/create` sign-in resume flows. **Evidence:** `grep` for writers returns 4 hits; grep for any reader returns 0. **Surface:** Business Web + Business native.

### C-3 — `_layout.tsx:737` ceiling redirect does not exempt self-authenticating routes — **suggested S2 (latent)**
`if (authResolutionExpired && !atSignInRoute) return <Redirect href="/" />;` is guarded only against the sign-in route. It does **not** consult `isSelfAuthenticatedExemptRoute`. Today it never fires on the accept route because `isAuthResolutionExpired` requires `stillResolving`, which is false for a logged-out visitor (`coldLoadAuthGates.ts:398-415`) — so it is latent, not active. But it is a **trap for the fix**: any change that makes the accept route "resolve" through the loading gate (a plausible shape for a fix) could arm this ceiling and bounce the invitee to `/`, **destroying the token in the URL** — turning a visible spinner into an invisible data-loss bug. The same exposure applies to the Stripe-Connect self-authenticating routes. **Evidence:** `app/_layout.tsx:737`; `coldLoadAuthGates.ts:330-346` vs `:398-415`. **Surface:** Business Web.

### C-4 — business-web auth bootstrap never resolves natively; the 7000 ms hard ceiling does all the work — **suggested S2**
`[auth] resolution-hard-ceiling: auth did not resolve within 7000ms — releasing the loading gate (treating as logged-out so the user lands on sign-in, never an infinite spinner)` fired on **every** capture — including the plain home page, for a logged-out user with **no stored session**, where `getSession()` should return `null` in milliseconds. Something in the bootstrap is stalling ~7 s on every cold load of `business.usemingla.com`; the ceiling is not a rare backstop but the **normal** path. Two consequences: (a) every business-web cold load costs ~7 s of auth limbo, directly contradicting Seth's *"this should load lightning fast"*; (b) the ceiling's stated purpose — *"never an infinite spinner"* — is **inverted** on the invite-accept route, where the `signed_out` verdict it force-releases is exactly what pins `isAuthReady=false` and creates the permanent spinner. The safety net manufactures the symptom it was built to prevent. **Evidence:** `capture-baseline-session-state.json` + `capture-armA-loggedout-garbage-token.json` console, 2/2 captures. **Surface:** all of Business Web.

### C-5 — `TypeError: subscribeOneLinkDeepLink is not a function` in root `_layout` on every business-web load — **suggested S2**
```
TypeError: (0 , P.subscribeOneLinkDeepLink) is not a function
    at https://business.usemingla.com/_expo/static/js/web/_layout-5d9057a4a40f96e3f448d9d0863541b8.js:1:3197
```
Thrown as an unhandled promise rejection from the **root layout** on every production business-web page load (home and accept route alike), so it does not white-screen — but the AppsFlyer OneLink deep-link subscription is **dead on web**. Directly relevant to the eventual fix: ORCH-1346's OneLink work is prior art, and the intended UX for a logged-out invitee is *"redirect them to download the app"* — i.e. the fix will likely lean on exactly this broken deep-link path. Note memory records the business OneLink template swap to `minglabiz` as still pending the next native build. **Evidence:** `pageErrors` in both captures, 2/2. **Surface:** all of Business Web. **Prior art:** ORCH-1313, ORCH-1346.

### C-6 — the 10×150 ms `getSession()` retry loop is redundant dead-ish defence — **suggested S3**
`accept-brand-invitation.tsx:84-93` polls `supabase.auth.getSession()` up to 10× at 150 ms (≤1.5 s of added latency) waiting for a usable `access_token`. This is an ORCH-1081 hotfix that the `isAuthReady` gate has since made largely redundant: reaching the loop requires `isAuthReady === true`, which **already** requires `hasUsableBusinessSession(session)` — i.e. a non-empty `access_token` (`authReadiness.ts:37-41, 108-112`). It can therefore only ever spin on a storage-flush race the gate has mostly closed, while taxing the happy path against Seth's *"lightning fast"* intent. It is also unreachable for the logged-out population entirely. Worth re-examining as part of the fix rather than preserved by reflex. **Evidence:** `accept-brand-invitation.tsx:84-93` vs `authReadiness.ts:108-112`. **Surface:** Business Web.

### C-7 — the render gate lets auth state mask an already-resolved outcome — **suggested S2, folds into the ORCH-1373 fix**
`:135` `if (!isAuthReady || phase.kind === "loading")` shows the spinner whenever `!isAuthReady`, **regardless of `phase`**. Observed in Arm B: after the accept call resolved and auth was torn down, the page returned to the spinner even though `phase` had left `loading`. So a *resolved* success or error can be re-hidden behind the spinner if auth drops at any point. Any fix must decouple "auth is resolving" from "the invite outcome is unknown" — they are different questions and this line conflates them. **Evidence:** Arm B fast-poll timeline (body stayed "Accepting your invitation…" across the `signed_in_ready` → `signed_out` transition, after the POST had already fired). **Surface:** Business Web.

---

## 9. Recommended fix direction (direction only — no implementation)

Not a spec. Scope-shaping notes for the SPEC phase, anchored to Seth's stated intent: *"This should load lightning fast and tell the user if the invite has been accepted, and redirect them to download the app and sign [up/in]."*

1. **Decouple "auth resolving" from "invite outcome unknown."** These are two independent axes that `:64` and `:135` currently conflate into one spinner. A logged-out invitee is a **terminal, actionable** state, not a loading state — it deserves a screen, not a spinner. The `!isAuthReady` disjunct must not be able to mask a resolved `phase` (C-7).
2. **The logged-out branch must be reachable.** Whatever shape it takes, the fix must be provably reachable for `authStatus === "signed_out"` — the current ordering makes it structurally impossible. This is the load-bearing change.
3. **Build the resume path, don't assume it.** C-2 shows `next` is read by nothing. Reordering the `if`s **without** wiring resume converts an infinite spinner into a silent token drop — a *worse* failure because it looks like success. Fix direction and C-2 must ship together or the funnel stays at 0%.
4. **Cover `/accept-scanner-invitation` in the same change** (C-1) — identical defect, shared root module; fixing one and not the other leaves the bug live.
5. **Mind the ceiling trap** (C-3) — a fix that routes the accept page through the loading gate could arm `_layout.tsx:737` and bounce the invitee to `/`, destroying the URL token.
6. **Download CTA surfaces:** `reference_email_device_aware_download_cta.md` (email download = **server 307, not client JS**) and `project_orch_1346_onelink_branded_domain_live.md` (`go.usemingla.com` OneLink is **consumer-owned**; 1 domain = 1 template; the business swap to `minglabiz` is pending the next native build). **C-5 means the OneLink deep-link subscription is currently throwing on business web** — the download leg of the intended UX rests on a path that is broken today and must be treated as a dependency, not an assumption.
7. **The schema already supports the full outcome vocabulary** (`accepted_at` / `expires_at` / `revoked_at` / `declined_at` / `status`) — "tell the user the outcome" needs no migration, only that the edge function actually gets called and its result rendered.
8. **Regression contract (CLOSE HARD MUST):** the natural guard is a pure unit test over the real `authReadiness.ts` asserting that the logged-out branch is reachable — i.e. the `user === null` path executes for `authStatus === "signed_out"`. `/tmp/orch-1373/mutual-exclusivity-proof.mts` is a working prototype of exactly this and should be promoted into the suite; it **fails on revert** by construction, since reverting restores the `!isAuthReady` early return that makes the branch unreachable.

---

## 10. Confidence

**PROVEN.** Live repro on the reserved physical device against production, both arms, with the causal variable isolated (identical token; only the auth gate differed → 0 vs 2 edge-fn calls). The dead-code claim is additionally proven exhaustively against the real shipped module (0/12 combinations). The data layer independently corroborates (0 of 1 invites ever accepted). Docs/Code/Runtime/Data contradictions are all resolved and attributed.

**Known limits, stated plainly:**
- The authed arm used a **synthetic client-side session**, not a real signed-in brand user (real OAuth needs Seth's credentials — a genuine blocker I did not overcome). This does **not** weaken the verdict: the arm's only job was to prove the gate is the sole blocker, and it did so by firing the edge fn under an otherwise-identical setup. The synthetic token was correctly rejected server-side, which is itself confirmation that the backend auth posture is sound.
- **Not verified:** the authed *happy path* end-to-end (valid token + real session → membership granted). The existing 0-accept production history means this has never been observed in the wild either. Worth a tester pass once fixed.
- **Not verified:** native (iOS/Android) deep-link entry into the accept route. Out of dispatch scope; email CTA targets web.

---

## 11. Next phase

**SPEC** — the root cause is proven and the scope is clear. The SPEC must cover `accept-brand-invitation.tsx` **and** `accept-scanner-invitation.tsx` (C-1) **and** the `next` resume path (C-2), or the funnel stays at 0%. C-3/C-4/C-5 should be registered as separate ORCHs on the NOW horizon; C-6 and C-7 fold naturally into this fix's scope.
