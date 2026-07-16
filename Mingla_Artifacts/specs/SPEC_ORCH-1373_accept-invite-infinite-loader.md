# SPEC — ORCH-1373 [accept-invite-infinite-loader] + 1374 / 1375 / 1376 / 1377 / 1378 / 1380

**Mode:** SPEC (build contract — no code written, no product file modified)
**Dispatched by:** mingla-orchestrator (conductor) · **Skill:** mingla-forensics
**Date:** 2026-07-15
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1373-[accept-invite-infinite-loader]/` on `ORCH-1373-accept-invite-infinite-loader` (rebased onto `origin/main`, clean)
**Downstream:** mingla-implementor → mingla-tester → mingla-orchestrator (CLOSE)
**Ships as:** ONE PR (Seth-decided), `[deploy]`-tagged. **No OTA.** See §12.

**Source investigations (all committed on this branch):**
- `Mingla_Artifacts/investigations/ORCH-1373-accept-invite-infinite-loader-INVESTIGATION.md`
- `Mingla_Artifacts/investigations/ORCH-1377-business-web-auth-7s-stall-INVESTIGATION.md`
- `Mingla_Artifacts/investigations/ORCH-1378-onelink-dead-on-business-web-INVESTIGATION.md`
- `Mingla_Artifacts/WORLD_MAP.md` — the 1373/1377/1378 banners are **authoritative** where they contradict an investigation body.

---

## 1. Executive summary

**In plain English.** A brand gets an email invite, clicks "Accept invite", and lands on a spinner that never stops. It never accepts, never errors, never says anything. Every logged-out invitee hits this — which is essentially every invitee, because an invitee is by definition someone clicking a link in an email. The invite funnel has a lifetime success rate of **0 of 1**.

The cause is proven and small: the page's first line says *"if auth isn't ready, wait"*, and the code meant to catch a logged-out visitor and send them to sign in sits **one line below** it. Those two conditions can never both be true, so that redirect has **never executed in production**. The page has no screen for a logged-out invitee — only a spinner.

**This spec fixes seven things in one PR:**

| ORCH | What a user gets |
|---|---|
| **1373** | The invite page resolves fast and always tells you the outcome — including a real screen (not a spinner) if you're logged out. |
| **1374** | The scanner-invite page — a line-for-line clone of the same bug — fixed identically before it ever fires. |
| **1375** | Signing in from an invite actually **resumes** the invite instead of dumping you on the home page with the token thrown away. |
| **1378** | A successful invitee gets an attributed "Download the app" button that works on iOS and Android; a live crash-on-every-page-load is fixed. |
| **1377** | A production log that **lies on 100% of loads** stops lying, and a real latent state-corruption bug behind it is fixed. |
| **1376** | A latent trap that would silently destroy an invite token / Stripe secret is closed. |
| **1380** | A second live crash (every tab refocus) is fixed. |

**The one non-obvious risk this spec exists to prevent:** ORCH-1375 is **load-bearing**. Fixing 1373 *without* it converts an infinite spinner into a **silent token drop** — the invitee signs in, lands on home, the invite is silently discarded, and it **looks like success**. That is worse than the bug. 1373 and 1375 must ship together or not at all.

---

## 2. Scope & non-goals

### 2.1 In scope
The seven ORCHs above, exactly. Every file is allowlisted in §11.

### 2.2 Explicit non-goals (with reasons)

| Not doing | Why |
|---|---|
| **Deferred deep-link continuity** (invitee lands back *inside* the invite after installing) | Needs business-app code → a native build; business cannot OTA (COMMS-0063). **And it does not matter here:** this leg fires for a *successful* invitee whose membership is **already granted** server-side — they install, sign in, and it is there. **The spec must not promise it.** |
| **Any migration / DB change** | The schema already expresses every outcome (`accepted_at` / `expires_at` / `revoked_at` / `declined_at` / `status`). Verified in the ORCH-1373 investigation §5. **No migration is needed and none may be written.** |
| **ORCH-1379** (Sentry dark on production business web) | Registered separately (#890). Unrelated to auth. |
| **Signed-in cold-boot latency** | Unmeasured (needs Seth's real OAuth). ORCH-1377 §11 states this openly. Separate dispatch. |
| **`_layout.tsx:737` behavioural change beyond the exempt check** | ORCH-1376 is **latent** — proven inert 0/4. One defensive line only. |
| **Raising / removing the 7000 ms ceiling** | ORCH-1377 F-1: the falsehood is *unconditionality*, not the number. The backstop's purpose (GoTrue lock deadlock) is legitimate. |
| **`resolveBusinessOneLinkDestination` behaviour on web** | No web-reachable call site (ORCH-1378 D-4). Ships as a no-op stub for parity only. |

### 2.3 Assumptions (stated, not assumed silently)
- **A-1.** The business OneLink `https://biz.usemingla.com/ZSCW` is LIVE on both platforms. **Verified by me via curl, 2026-07-15** (§4.4.1) — not inherited from the dispatch.
- **A-2.** The store build already live (1.1.2, both stores READY_FOR_SALE / `completed`) carries the AppsFlyer SDK. Attribution therefore does **not** depend on this PR's artifact (ORCH-1378 F-10).

---

## 3. Cross-Surface Impact Declaration (MANDATORY)

| # | Surface | Covered? | User-visible behaviour demanded | Files | Parity |
|---|---|---|---|---|---|
| 1 | **Consumer iOS** (`app-mobile`) | **NO** | — | none | No brand-invite-accept route exists. |
| 2 | **Consumer Android** | **NO** | — | none | Same. |
| 3 | **Buyer/anonymous Web** (`mingla-business` web) | **YES — PRIMARY** | Invite resolves ≤1s; every outcome has copy; logged-out gets a real screen + resume; success gets an attributed download CTA. Root layout stops throwing. | §4.1–§4.5 | **Automatic** — this is the surface the invite email opens. |
| 4 | **Business iOS** | **PARTIAL** | Route exists in the same Expo Router tree. Auth-gate fix + copy apply automatically. **The 1377 F-3 ref fix applies (ORCH-1292 de-gated the ceiling to native).** Download CTA is web-only by design (§4.4.5). | §4.1, §4.2, §4.5 | **Automatic** (shared modules). **Not runtime-verified on native** — out of scope, stated plainly. |
| 5 | **Business Android** | **PARTIAL** | Same as #4. | Same | Same. |
| 6 | **Admin Web** (adjacent) | **NO** | — | none | Separate app; admins do not accept brand invites. |
| 7 | **Business Web preview** (adjacent) | **YES — incidental** | Root-layout TypeErrors (1378/1380) fixed → every business-web route stops throwing on load/refocus. | §4.4.2, §4.6 | **Automatic** (shared root layout). |

---

## 4. Layered specification

### 4.1 — ORCH-1373: the invite loader (`accept-brand-invitation.tsx`)

**File:** `mingla-business/app/accept-brand-invitation.tsx`

#### 4.1.1 The defect, restated as a contract
Today `:63-73` reads:
```
if (!isAuthReady) return;        // ← fires forever for a logged-out visitor
…
if (user === null) { router.replace('/auth?next=…') }   // ← UNREACHABLE. 0/12 combinations.
```
`isBusinessAuthReady` is true **only** for `authStatus === "signed_in_ready"` (`authReadiness.ts:108-112`); a logged-out visitor is terminally `signed_out` (`:85-106`). The two are **mutually exclusive**.

#### 4.1.2 CONTRACT — two independent axes, never one spinner

**C-1373-A (the load-bearing change).** The component MUST model **two independent axes**:
- **Axis 1 — auth resolution:** `bootstrapping` (transient) vs **resolved** (`signed_out` | `signed_in_ready` | `error`).
- **Axis 2 — invite outcome:** `unknown` / `resolved(success|error)`.

A spinner may be shown **only** when Axis 1 is *genuinely transient* (`authStatus === "bootstrapping"`) **or** Axis 2 is `unknown` **while an accept call is genuinely in flight**. `signed_out` is a **terminal, actionable** state and MUST render a screen.

> **Binding note:** `!isAuthReady` is **NOT** "still loading". Deriving the spinner from `!isAuthReady` is the bug. The implementor MUST branch on `authStatus`, which `useAuth()` already exposes (`AuthContext.tsx:174`), **not** on the boolean.

**C-1373-B (reachability).** The logged-out branch MUST be **provably reachable** for `authStatus === "signed_out"`. Enforced by the §9.1 regression test against the **real shipped** `authReadiness.ts`.

**C-1373-C (folds in C-7 — resolved outcome must never be re-masked).** The render gate at `:135` (`if (!isAuthReady || phase.kind === "loading")`) MUST NOT allow an auth-state change to mask an **already-resolved** `phase`. Observed in Arm B: the page returned to the spinner *after* the accept had already resolved.
→ **Contract:** once `phase.kind !== "loading"`, the rendered output is a **pure function of `phase`** and MUST NOT consult auth state. Precedence is strictly: **resolved `phase` > auth axis**.

**C-1373-D (folds in C-6 — delete the retry loop).** The 10×150 ms `getSession()` loop at `:84-93` MUST be **removed**, not preserved.
**Evidence it is dead:** reaching it requires `isAuthReady === true`, which **already** requires `hasUsableBusinessSession(session)` — a non-empty `access_token` (`authReadiness.ts:37-41, 108-112`). ORCH-1377 F-2 additionally measured `getSession()` at **zero network calls** on this path. It can only ever spin on a storage-flush race the gate already closes, while costing ≤1.5 s against Seth's *"lightning fast"*.
**Guard:** if the implementor believes a real race survives, they MUST stop-and-amend with evidence rather than keep it by reflex.

#### 4.1.3 CONTRACT — every state's copy (exhaustive; no state without copy)

`errorCopyFor` already covers 6 codes correctly. **Two gaps are proven** (§4.1.4) and one new terminal state is added.

| State | Trigger | Title | Body | Primary action |
|---|---|---|---|---|
| **Auth bootstrapping** | `authStatus === "bootstrapping"` | *(spinner — the ONLY legitimate spinner)* | "Checking your invitation…" | — |
| **Accepting** | `phase.kind === "loading"` AND call in flight | *(spinner)* | "Accepting your invitation…" | — |
| **Logged out** ← **NEW** | `authStatus === "signed_out"` | **"You're invited"** | **"Sign in to accept this invitation. We'll bring you right back."** | **"Sign in"** → `/auth?next=<validated>` (§4.3) |
| **Auth error** ← **NEW** | `authStatus === "error"` | **"Something went wrong"** | **"We couldn't check your sign-in. Try again in a moment."** | **"Try again"** (re-run) |
| Success (member) | `phase.success`, `!transferred` | "You're on the team" | *(existing copy — unchanged)* | "Go to team" **+ download CTA (§4.4)** |
| Success (owner) | `phase.success`, `transferred` | "Ownership transferred" | *(existing)* | "Go to team" **+ download CTA (§4.4)** |
| Already used | `invite_already_used` (410) | "Already accepted" | *(existing)* | "Back to Mingla" |
| Expired | `invite_expired` (410) | "Invitation expired" | *(existing)* | "Back to Mingla" |
| Revoked | `invite_revoked` (410) | "Invitation revoked" | *(existing)* | "Back to Mingla" |
| Wrong account | `invite_email_mismatch` (403) | "Wrong account" | *(existing)* | "Back to Mingla" |
| Invalid link | `validation` (400) | "Invalid link" | *(existing)* | "Back to Mingla" |
| **Declined** ← **NEW** | `invite_declined` (410) | **"Invitation declined"** | **"This invitation was declined. Ask the brand owner to send a new one."** | "Back to Mingla" |
| **Bank not connected** ← **NEW** | `invite_currency_mismatch` (409) | **"Connect your bank first"** | **"Connect your bank to accept this brand."** | "Back to Mingla" |
| Server error | default | "Something went wrong" | *(existing)* | "Back to Mingla" |

#### 4.1.4 EVIDENCE for the two new error codes (a real gap the dispatch's list did not anticipate)
`supabase/functions/accept-brand-invitation/index.ts:96-116` (`mapRpcError`) returns **seven** codes. The route's `errorCopyFor` (`:188-230`) handles **five** of them plus `validation`. **Unhandled:**
- `invite_currency_mismatch` → **409** (`:112`)
- `invite_declined` → **410** (`:116`)

Both currently fall to `default` → *"We couldn't accept this invitation right now (status 409). **Try again in a moment.**"* — actively **wrong**: both are permanent, non-retryable states, and `currency_mismatch` is **actionable** (connect a bank).

**Copy is not invented — it is lifted from the approved sibling** `mingla-business/src/components/team/InvitePendingSheet.tsx:159-166`, which already ships copy for exactly these two codes (`"Connect your bank to accept this brand."`). Reuse it verbatim.

> **Scanner note:** `accept-scanner-invitation/index.ts:57-65` returns **only five** codes — no `declined`, no `currency_mismatch`. The scanner copy map is therefore **already complete**; do NOT add the two new codes there (dead copy).

---

### 4.2 — ORCH-1374: `/accept-scanner-invitation`

**File:** `mingla-business/app/accept-scanner-invitation.tsx`

**Verified line-for-line clone:** `:63` `if (!isAuthReady) return;` → `:68` `if (user === null)` → `:72` `router.replace('/auth?next=…')`; spinner gate `:104`. Shares `authReadiness.ts`, so the mutual-exclusivity proof applies **verbatim**.

**CONTRACT C-1374.** Apply **C-1373-A/B/C** identically, and the logged-out + auth-error copy from §4.1.3 (substituting "scanner invitation" where the existing file already says so). **Differences from 1373, binding:**
- **No C-1373-D** — the scanner route has **no** `getSession()` retry loop (verified: `:77-88` calls `acceptAsync` directly).
- **No new error codes** (§4.1.4 scanner note).
- **No download CTA** (§4.4.5) — a scanner accepting at a door is not a business-app install target; scoped out deliberately.

**Blast:** production `scanner_invitations` = **0 rows**. This is a **loaded landmine**, not a live fire — fix it now because the shared-module fix makes it nearly free.

---

### 4.3 — ORCH-1375: the `?next=` resume path **(LOAD-BEARING)**

> **Without this, ORCH-1373's fix is WORSE than the bug.** `next` has **4 writers, 0 readers**.

#### 4.3.1 Proven current state
- **No `app/auth.tsx` exists.** `/auth` → `app/auth/index.tsx`, which **ignores query params** and hard-redirects: `:22-24` `if (!loading && user) router.replace(AppRoutes.home)`.
- `app/auth/callback.tsx` has **no** `next` handling — `:42` `return <Redirect href="/" />`.
- Writers: `accept-brand-invitation.tsx:71`, `accept-scanner-invitation.tsx:72`, `rsvp/create.tsx:221`, `event/create.tsx:221`.

#### 4.3.2 **NEW FINDING — the OAuth round-trip physically destroys `next`** (this spec's most important architectural correction)

`AuthContext.tsx:164-168`:
```ts
const buildWebRedirectTo = (): string | undefined => {
  …
  return `${window.location.origin}/auth/callback`;   // ← NO query params
};
```
Consumed at `:802` (`signInWithGoogle`) and `:923` (`signInWithApple`).

**Consequence:** on the OAuth path the browser leaves the page entirely (`/auth?next=X` → Google → Supabase → `/auth/callback#access_token=…`). `next` lives **only** in the `/auth` URL, and `redirectTo` does not carry it → **`next` is destroyed at the `signInWithOAuth` call**, before `/auth/callback` ever exists.

**Therefore: reading `next` in `auth/index.tsx` alone fixes ONLY the email-OTP path.** Verified asymmetry:
- **Email OTP** (`signInWithOtp` `:1010` + `verifyEmailOtp` `:1042`) — **no page navigation**. `next` survives in the `/auth` URL. ✅
- **OAuth Google/Apple** — full-page navigation away and back. `next` is lost. ❌

An implementor who only wires `auth/index.tsx` will ship a resume that works for email and **silently drops the token for every Google/Apple invitee** — the exact silent-drop failure this ORCH exists to prevent, reintroduced through the back door.

#### 4.3.3 CONTRACT C-1375 — the mechanism

**Mandated: `sessionStorage` hand-off, with the URL as the source of truth.**

| Step | Where | Contract |
|---|---|---|
| **1. Capture** | `app/auth/index.tsx` | On mount, read `next` from the URL. **Validate (§4.3.4).** If valid → persist to `sessionStorage` under key **`mingla.biz.auth.next`**. If invalid → **discard silently and proceed as if absent** (never redirect to it, never throw). |
| **2. Resume (email path)** | `app/auth/index.tsx:22-24` | Replace the unconditional `router.replace(AppRoutes.home)` with: **re-validate** the stored/URL `next` → if valid, `router.replace(next)`; else `AppRoutes.home`. **Clear the key** on consumption. |
| **3. Resume (OAuth path)** | `app/auth/callback.tsx` | Before `<Redirect href="/" />`: read `mingla.biz.auth.next`, **re-validate**, and if valid `<Redirect href={next} />`. **Clear the key** on consumption. Keep the existing `loading` spinner. |
| **4. Consume-once** | both | The key MUST be cleared after **one** consumption (success *or* rejection). A stale `next` must never resume a later, unrelated sign-in. |

**Rationale for `sessionStorage` over threading `next` into `redirectTo`:**
1. Threading a query string into `redirectTo` requires the **Supabase dashboard Redirect-URL allowlist** to accept it — an **operator/config dependency outside this PR** and outside CI's reach. A mismatch fails **silently at the provider**, which is precisely the class of failure this ORCH exists to kill.
2. `sessionStorage` is **per-tab** and survives a same-tab OAuth redirect — the exact lifetime required, and it cannot leak across tabs or persist after the browser closes (unlike `localStorage`).
3. It needs **no** change to `signInWithGoogle` / `signInWithApple` signatures → no blast radius into every other sign-in caller.

> **Stop-and-amend trigger:** if the implementor cannot make `sessionStorage` survive the round-trip on any target browser, STOP — do **not** silently fall back to `redirectTo` threading (it carries the config dependency above).

#### 4.3.4 CONTRACT C-1375-SEC — `next` is an open-redirect vector **(HARD MUST)**

`next` is attacker-controllable: anyone can mail `https://business.usemingla.com/auth?next=https://evil.example/phish`. A naive `router.replace(next)` is a **classic open redirect** on a domain users are being trained to trust with an auth flow.

**A single shared validator MUST own this.** New pure module: **`mingla-business/src/utils/nextRoute.ts`**, exporting:
```ts
export const sanitizeNextRoute = (raw: string | string[] | null | undefined): string | null
```

**Accept ONLY if ALL hold** (allowlist, not denylist):
1. Type is `string` (arrays → take none; reject). Non-empty after `trim()`.
2. **Starts with exactly one `/`** and **NOT `//`** (protocol-relative `//evil.com` is an absolute URL to a browser) **and NOT `/\`** (backslash — some browsers normalise `/\` to `//`).
3. Contains **no** scheme: reject any match of `/^[a-z][a-z0-9+.-]*:/i` after decoding (kills `javascript:`, `data:`, `https:`).
4. **Decode-then-revalidate.** Apply `decodeURIComponent` (in `try/catch`; a throw → reject) and re-run 2+3 on the decoded value. Kills `%2f%2fevil.com` and double-encoding.
5. **Path allowlist.** The path segment (before `?`/`#`) MUST match one of an explicit, named allowlist — **not** "any relative path":
   - `/accept-brand-invitation` (+ `/…/success`)
   - `/accept-scanner-invitation`
   - `/rsvp/create`
   - `/event/create`
   Matching is **segment-safe** (`normalized === base || normalized.startsWith(base + "/")`) — reuse the exact discipline already proven in `coldLoadAuthGates.ts:283-300` (`isSelfAuthenticatedExemptRoute`). `/accept-brand-invitation-evil` MUST NOT match.
6. Reject anything > **2048** chars (bound the surface).

**Return** the sanitized **relative** path (never an absolute URL). **Never** `window.location.origin + next`.

> **Why an allowlist and not "any same-origin relative path":** the only legitimate resume targets are the four known writers. A general relative-path rule silently authorises every future route as a redirect target — including ones that may later carry credentials. Enumerate, don't generalise.

#### 4.3.5 The other two writers — **covered, not scoped out**
`rsvp/create.tsx:221` and `event/create.tsx:221` write the same dead param. **They are fixed for free** by steps 2+3 (the readers are route-agnostic) and are in the §4.3.4 allowlist. **No change to those two files is required or permitted** — they already write the correct shape. The implementor MUST verify resume works for them (§7 T-14/T-15) rather than assume it.

---

### 4.4 — ORCH-1378: download CTA + the web shim

> **BINDING (from the ORCH-1378 investigation §11-1 and the WORLD_MAP banner): these are TWO INDEPENDENT changes.** The CTA is a link and works whether or not the shim is fixed. **Do NOT spec the shim fix as a prerequisite for the CTA.**

#### 4.4.1 LIVE-VERIFIED CONSTANTS — **re-verified by me, 2026-07-15, not inherited**

```
$ curl -sSI -A "<Android UA>" https://biz.usemingla.com/ZSCW
HTTP/2 301
location: market://details?id=com.sethogieva.minglabusiness&referrer=af_tranid%3DOTAyMzg2MTI4MjYxMzc3OTg4Mw%3D%3D

$ curl -sSI -A "<iOS UA>" https://biz.usemingla.com/ZSCW
HTTP/2 301
location: https://apps.apple.com/US/app/id6768737367?mt=8
```
The `referrer=af_tranid…` **IS** the attribution (it rides the Play Install Referrer into the install).

> **⚠️ RECORD CORRECTION — COMMS-0101 item (2) is now STALE.** It states the business OneLink is *"STILL DEAD on Android — HTTP 200 'app unavailable'"*. **I re-ran it: `minglabiz.onelink.me/ZSCW` under an Android UA now returns `301 → market://…&referrer=af_tranid…`.** The AppsFlyer Refresh Status click has landed. **Both** the branded and raw-vendor hosts are healthy on both platforms. This unblocks ORCH-1381, which COMMS-0101 currently instructs to wait. → **Collateral §10-1** (ledger correction owed).

**HARD GUARDS (all still binding):**
- **Use `https://biz.usemingla.com/ZSCW`** — the branded business domain.
- **NEVER `go.usemingla.com`** — Explorer/consumer-ONLY (ORCH-1346: 1 domain = 1 template).
- **NEVER `minglabiz.onelink.me`** — raw vendor base; works, but is not the branded one.
- **NEVER reuse `GUEST_FUNNEL_ONELINK_URL`** (`storeLinks.ts:47`) — that is the **consumer** guest-funnel flip constant, still `null`.
- **NEVER reuse `usemingla.com/business/download`** — carries a PLAIN store link ⇒ **no attribution**.

#### 4.4.2 Shim fix (independent leg A)
**File:** `mingla-business/src/services/appsFlyerService.web.ts`

Native (`appsFlyerService.ts`) exports **8 values + 1 type**; the web shim exports **6**. Missing: `subscribeOneLinkDeepLink`, `resolveBusinessOneLinkDestination`.
Live: `TypeError: (0 , P.subscribeOneLinkDeepLink) is not a function` from the **root `_layout`** on **every** business-web load (3/3).

**CONTRACT C-1378-SHIM.** Add both missing exports as **no-ops matching the native type signatures**:
- `subscribeOneLinkDeepLink(cb)` → returns an **unsubscribe function** (`() => void`) — it MUST match the native return contract, because `_layout.tsx:518` may store/call it. Returning `undefined` would swap a TypeError for a different one.
- `resolveBusinessOneLinkDestination(...)` → returns `null` (no web-reachable call site; parity only — ORCH-1378 D-4).
- Re-export the `BusinessOneLinkDestination` **type** so the shim's type surface matches.

#### 4.4.3 The constant (independent leg B)
**File:** `mingla-business/src/constants/storeLinks.ts`

```
export const BUSINESS_INVITE_ONELINK_URL = "https://biz.usemingla.com/ZSCW";
```
Plus per-channel attribution params minted at the call site (mirroring the proven `guestFunnelLink.ts:122-134` grammar):
`?pid=business_web&c=brand_invite_accept`

> **⚠️ THE DISPATCH'S GATE CLAIM IS FALSE — and this is load-bearing.** The dispatch states the constant *"MUST live in `storeLinks.ts` or gate `orch-1342-store-links-ssot` fails the PR"*. **It would not.** I read the gate: it byte-compares **only** `APP_STORE_URL` / `PLAY_STORE_URL` against marketing, and its BANNED list is exactly `apps.apple.com`, `play.google.com/store`, `go.usemingla.com`. **`biz.usemingla.com` is not banned anywhere** → the constant could be scattered as a literal into any component and CI would stay **green**.
>
> **PROVEN EMPIRICALLY, not reasoned.** I appended `const PROBE = "https://biz.usemingla.com/ZSCW";` to `guestFunnelLink.ts` (outside the SSOT) and ran the gate:
> ```
> ORCH-1342 PASS — …no store/OneLink-domain literal exists outside it.
> ```
> The gate **passed on a violation of the very rule the dispatch credits it with enforcing.** (Probe reverted; tree clean.) **Today the business-OneLink SSOT rule is unenforced — it is a decorative guard in the §9.0 sense.**
>
> **CONTRACT C-1378-GATE (mandatory):** extend `.github/scripts/strict-grep/orch-1342-store-links-ssot.mjs` BANNED with:
> - `{ id: "bizonelink", re: /biz\.usemingla\.com/i, why: "…" }`
> - `{ id: "rawonelink", re: /minglabiz\.onelink\.me/i, why: "…" }` — **grandfather** `mingla-business/src/services/appsFlyerService.ts` for this id **only if** it already carries the literal (it is currently grandfathered for `onelink`/`go.usemingla.com`; verify before adding).
>
> Both regexes **case-insensitive** per §9.3. Add self-test cases proving each fires. **Without this, the SSOT rule for the business OneLink is decorative.**

#### 4.4.4 CTA placement — **TWO homes, not one** (a real finding the dispatch did not anticipate)

The dispatch says *"on a SUCCESSFUL accept, route the invitee to download the business app."* There are **two distinct success surfaces**, and today they behave inconsistently:

| Surface | Who reaches it | Today | Contract |
|---|---|---|---|
| **Inline success card** — `accept-brand-invitation.tsx:144-167` | **The common case** — every ordinary team-member accept (`!partnerSetup \|\| !transferred`) | **NO download CTA at all** | **ADD** the CTA (§4.4.5). |
| **Celebration screen** — `app/accept-brand-invitation/success.tsx` | **Narrow** — only `partnerSetup && transferred` (routed at `:116-129`) | A **hardcoded, NON-attributed, NON-device-aware** pair of buttons (`IOS_STORE_URL` / `ANDROID_STORE_URL`, `:49-51`), shown to everyone regardless of platform, opened via `window.location.href = url` (`:108`) which **destroys the page** | **REPLACE** with the same CTA (§4.4.5). |

**Evidence `success.tsx` is the known-debt file:** the 1342 gate's own `GRANDFATHERED` map names it verbatim — *"carries the BUSINESS store listing URLs inline — predates this gate; **needs BUSINESS_\* SSOT entries in a follow-up ORCH**"*. **This is that follow-up.** Once the CTA imports the SSOT constant, **remove `success.tsx` from `GRANDFATHERED`** so the gate starts policing it (a grandfather entry left behind after the debt is paid is a decorative guard).

#### 4.4.5 CONTRACT C-1378-CTA — the component

**New file:** `mingla-business/src/components/invite/BusinessAppDownloadCta.tsx`

- **Copy:** Title **"Get the Mingla Business app"** · Body **"Manage your brand, sell tickets, and scan guests in from your phone."** · Button **"Download the app"**.
- **Device-aware:** reuse the **existing proven** `detectClientPlatform()` from `guestFunnelLink.ts:87-94` (the ORCH-1319 trio incl. the iPad-as-Mac `maxTouchPoints` catch). **Do NOT re-roll platform detection.**
- **Target:** `BUSINESS_INVITE_ONELINK_URL` + `?pid=business_web&c=brand_invite_accept` for **all** platforms — the OneLink itself does the per-platform 301 (proven §4.4.1). **One URL, no client-side branching to store URLs.** Desktop is a legitimate target (301s to the App Store listing) — acceptable; do not special-case it.
- **Web-only render:** `Platform.OS === "web"` only. On business native the user **already has the app** — an install CTA there is nonsense. (This is why §3 lists the CTA as web-only on surfaces 4/5.)
- **a11y:** `accessibilityRole="link"`, label "Download the Mingla Business app", ≥44pt target.

#### 4.4.6 CONTRACT C-1378-OPEN — the ORCH-1381 trap **(the dispatch's mandate is not executable as written — resolved here)**

**The dispatch says:** *"MUST reuse `mingla-marketing/lib/open-external.ts` (the ONE owner) — never re-roll `window.open`."*

**Three verified facts make that impossible as written:**
1. **`mingla-business` has NO import path to `mingla-marketing`.** `mingla-business/tsconfig.json` `paths` map only `@/*` and `@mingla/*` → `packages/*`. **Zero** runtime imports from marketing exist; every cross-reference is a **comment + a byte-comparing test** (e.g. `guestFunnelLink.ts:50` *"Source: mingla-marketing/lib/device-platform.ts. A unit test pins the…"*). That is the **established repo pattern**.
2. **`mingla-business` already has its own `openExternal` — and it carries the EXACT ORCH-1381 bug, LIVE:**
   ```ts
   // mingla-business/src/services/guestFunnelLink.ts:170-174
   export function openExternal(dest: string): void {
     if (typeof window === "undefined") return;
     const win = window.open(dest, "_blank", "noopener,noreferrer");  // ← returns null EVEN ON SUCCESS
     if (!win) window.location.assign(dest);                          // ← therefore ALWAYS fires
   }
   ```
   Called live from `SeeWhosGoingGate.tsx:273`. **ORCH-1381 fixed the marketing copy and shipped a gate — but the gate's `TARGET` is `mingla-marketing/lib/open-external.ts` ONLY** (verified: `orch-1381-open-external-no-double-nav.mjs:51`). **The business twin is unguarded and still broken.** ORCH-1381's own `I-…-OPEN-EXTERNAL-SINGLE-OWNER` invariant is, in `mingla-business`, currently fiction.
3. **`Linking.openURL` is not a safe substitute.** `react-native-web`'s implementation is `window.open(urlToOpen, target, 'noopener')` with **no** return check (`node_modules/react-native-web/dist/exports/Linking/index.js:93-101`). It cannot double-navigate (no fallback), but a genuine popup-block becomes a **silent dead tap** — and `.catch()` never fires because `open()` does not throw (making `DownloadMinglaCta.tsx:32`'s `.catch()` fallback **dead code** today).

**RESOLUTION — CONTRACT C-1378-OPEN:**
- **Fix `mingla-business/src/services/guestFunnelLink.ts:170-174`** to the ORCH-1381-corrected semantics: **bare `window.open(dest, '_blank')` — NO feature string** (both `noopener` **and** `noreferrer` must be absent; **`noreferrer` alone also nulls the return**), then `if (win) win.opener = null; else window.location.assign(dest);`.
- **The new CTA (§4.4.5) MUST call this fixed `openExternal`.** It is the **one** business-side owner. **Do NOT re-roll `window.open`. Do NOT create a third copy.**
- **Extend the gate to cover BOTH owners** — see §9.3 C-1378-OPEN-GATE.
- This **also fixes the live `SeeWhosGoingGate` double-navigation** as a side effect. **Flagged as a deliberate, minimal scope addition** — it is forced: the dispatch commands reuse of the single owner, and the only reusable business-side owner is broken. → **Collateral §10-2** for the orchestrator to register.

---

### 4.5 — ORCH-1377: fix what MISLED US (three sub-items)

> Seth: *"fix the logs or whatever made you think the other 2 were real issues."* **The lying log cost a full investigation cycle and produced a false "7-second stall" report.** These are not ride-alongs — this is the diagnostic-truth layer.

#### 4.5.1 Sub-item 1 — the lying log
**File:** `mingla-business/src/context/AuthContext.tsx:297-308`

The timer is guarded **only** by `if (!mounted) return;`. It never reads `loading`, so it emits
`[auth] resolution-hard-ceiling: auth did not resolve within 7000ms — releasing the loading gate`
on **every** load where the tab stays open ~7.5 s — **including loads where auth resolved in 604 ms**. Fired **4/4** at ~7505-7666 ms with **zero** observable state change. Its arrival time (mount + exactly 7000 ms) is itself the proof of unconditionality.

**CONTRACT C-1377-LOG.** The log MUST be emitted **only when auth genuinely did not resolve**. A diagnostic that lies is worse than no diagnostic.

**⚠️ THE STALE-CLOSURE TRAP (this will bite the implementor).** The bootstrap effect is `useEffect(…, [])` (`:272`) — it runs **once**. A naive `if (!loading) return;` inside the timer callback closes over `loading` **from mount**, when it is `true`. It would **never** guard, and the fix would silently do nothing while looking correct.

**Mandated mechanism — a resolution ref (stale-closure-safe):**
1. Add `const bootstrapResolvedRef = useRef(false);` beside the three existing refs (`:237/246/256`).
2. Set `bootstrapResolvedRef.current = true` at **every** bootstrap resolution point. **Enumerated exhaustively — all three are inside the same effect:**
   - `:347` — the ORCH-0887-A race-timeout branch
   - `:358` — the `getSession()` **error** branch
   - `:386` — the ORCH-1294 main success release (the normal path)
3. In the ceiling callback, **immediately after `if (!mounted) return;`**, add `if (bootstrapResolvedRef.current) return;`.

**Acceptable alternative:** `clearTimeout(hardCeilingTimer)` at the same three points (the handle is in scope at `:298`). Either is acceptable; **enumerating all three points is NOT optional** — miss one and the log lies again on that path.

**🚨 DO NOT DELETE THE REF-WRITE — four existing tests pin it.** `authContext.adversarial.orch1204.test.tsx:227-240` slices the ceiling body and asserts:
```js
expect(ceiling[0]).toMatch(/setLoading\(false\)/);
expect(ceiling[0]).toMatch(/bootstrapTimedOutRef\.current = true/);   // ← MUST remain textually inside
expect(ceiling[0]).not.toMatch(/setUser\(\s*null\s*\)/);
```
Also `AuthContext.timeout.test.ts:451-472` (Case 16) counts `= true;` ≥1, `= false;` ≥1, and `bootstrapTimedOutRef` ≥3; and `authContext.sync-hydration.orch1204.test.tsx:313`.
**The mandated early-return shape satisfies all four unchanged** (the body keeps both statements; only an early return is added above them). **A naive "delete the ref-write" fix breaks 4 existing tests — that is the wrong fix.**

#### 4.5.2 Sub-item 2 — F-3: a REAL latent bug. **Dispatch demands resolution: traced.**

**Every consumer of `bootstrapTimedOutRef` (exhaustive grep, product source):**

| Line | Role | Verdict |
|---|---|---|
| `:246` | `useRef(false)` declaration | — |
| **`:306`** | **write `= true` — the unconditional ceiling** | **THE BUG.** Arms on every successful boot. |
| `:343` | write `= true` — the ORCH-0887-A race-timeout branch | **LEGITIMATE.** This is a genuine bootstrap failure — the ref's name is *true* here. **MUST NOT change.** |
| `:540` | **read** — `if (bootstrapTimedOutRef.current)` | The consumer. |
| `:565` | write `= false` — late passive event **with** a usable session (ORCH-1004 recovery) | Correct. |
| `:569` | write `= false` — explicit `SIGNED_IN`/`SIGNED_OUT` | Correct. |

**Real blast radius (stated, not hedged).** The reader at `:540-552` uses the ref to discard **stale echoes of a failed bootstrap**. Because `:306` arms it **7 s after every load — including bootstraps that succeeded in 604 ms** — for any user sitting on the page >7 s (i.e. everyone), a subsequent **passive** event (`INITIAL_SESSION` / `TOKEN_REFRESHED` / `USER_UPDATED`) carrying an **unusable** session is silently dropped (`:544-552` `return`) instead of clearing `session`/`user`. **The app would keep rendering an authed shell under a dead token.**

**Why the exposure is genuinely narrow (honest):** supabase-js fires `SIGNED_OUT` for most revocations, which is **not** a passive echo and correctly clears the ref (`:566-570`). The gap is **specifically** a passive event delivering a null/unusable session.

**Blast includes native:** ORCH-1292 de-gated the ceiling from web-only to native (`:283-294`), so business iOS/Android arm this ref 7 s after **every** cold start too.

**CONTRACT C-1377-F3 — FIXED, not scoped out.** The §4.5.1 guard **resolves F-3 by construction**: if the ceiling never fires on a resolved bootstrap, `:306` never runs, and the ref retains its true meaning (armed **only** by `:343`, a real timeout). **One guard kills both the lying log and the ref corruption.** Fixing only the log while leaving the ref write would fix *the symptom that has no impact* and leave *the impact that has no symptom*.

> **Confidence, stated honestly:** the investigation capped F-3 at **suspected** (source-only; staging it needs a prod session-revocation — refused). This spec does **not** upgrade that claim. The fix is justified on the **proven** unconditionality (4/4) plus the **proven** semantic corruption of a flag whose name means "bootstrap FAILED"; the *downstream user-visible consequence* remains **suspected**, and §7 T-11 verifies the **mechanism** (ref not armed on a resolved boot) rather than the unproven end-state.

#### 4.5.3 Sub-item 3 — N-4: the structural cause **(the fix that prevents the next misattribution)**

**THREE distinct `7000` constants with near-identical names.** This collision **IS** why ORCH-1373 quoted #1's log while reasoning about #2's semantics.

| # | Constant | Defined | Gates? | Logs |
|---|---|---|---|---|
| 1 | `AUTH_RESOLUTION_HARD_CEILING_MS` | `AuthContext.tsx:105` | **NO** — unconditional; releases `loading` only | `[auth] resolution-hard-ceiling…` ← **the message C-4 quoted** |
| 2 | `AUTH_RESOLUTION_CEILING_MS` | `coldLoadAuthGates.ts:396` | **YES** — `isAuthResolutionExpired` → `_layout.tsx:437/737`. **The real UI gate.** Correctly conditional (`if (!stillResolving) return false;`). 0/4 fired. | `[_layout] auth-resolution-deadline…` |
| 3 | `BRAND_RESOLVE_AUTH_CEILING_MS` | `coldLoadAuthGates.ts:23` | YES — `/brand/[id]` routes only | nothing |

**CONTRACT C-1377-N4 — disambiguate by name and document what each gates.**
1. **Rename #1** → **`AUTH_LOADING_GATE_RELEASE_BACKSTOP_MS`**. It does not "resolve auth" and it is not a "ceiling" on anything observable — it **releases the loading gate as a backstop**. The name must state the job.
2. **Rename its log** → `[auth] loading-gate-backstop: bootstrap did not resolve within {N}ms — releasing the loading gate`. **The old text asserted a falsehood; the new text must be true by construction** (it can now only fire when unresolved, per §4.5.1).
3. **Rename #2** → **`AUTH_UI_GATE_EXPIRY_MS`** — it is the one that **gates the UI**.
4. **#3 keeps its name** (already route-scoped and unambiguous).
5. **Correct the comment block** `AuthContext.tsx:88-104`. It currently describes a *conditional last-resort backstop* — ORCH-1377's Docs layer verdict is that **this comment is what ORCH-1373 believed, and it is wrong**. Post-fix the comment becomes **true**; it MUST state explicitly: *"this fires ONLY when bootstrap did not resolve — see `bootstrapResolvedRef`."*
6. Each constant's docblock MUST name **what it gates** and **what it logs**.

> **Rename blast radius (implementor must sweep):** `AUTH_RESOLUTION_HARD_CEILING_MS` is referenced in `AuthContext.tsx` **and in tests** (`AuthContext.timeout.test.ts`, `authContext.adversarial.orch1204.test.tsx:231`, `authContext.sync-hydration.orch1204.test.tsx:313`). The `orch1204` test **regex-matches `AUTH_RESOLUTION_HARD_CEILING_MS` in the `setTimeout(…)` slice** — renaming the constant **will break that regex**. Update those tests **in the same commit**; this is a **rename**, not a behaviour change, and their assertions must survive verbatim in meaning.

---

### 4.6 — ORCH-1376: cheap permanent hardening (latent — labelled honestly)

**File:** `mingla-business/app/_layout.tsx:737`

```ts
const atSignInRoute = isSignInRoute(pathname);
if (authResolutionExpired && !atSignInRoute) {
  return <Redirect href="/" />;      // ← does not consult isSelfAuthenticatedExemptRoute
}
```

**PROVEN INERT TODAY (0/4).** It is driven by conditional ceiling **#2**, which requires `stillResolving`; `isWebAuthResolving` is false for a logged-out visitor with no stored session (`coldLoadAuthGates.ts:360-376`). **Do NOT design ORCH-1373 around it. Do NOT claim it as an active bug.**

**Why fix it anyway:** it is a latent trap that would **destroy the out-of-band URL credential** (invite token / Stripe `client_secret`) if a future change ever made such a route report `stillResolving` — trading a visible spinner for an **invisible data-loss** bug. Note ORCH-1373's fix is *specifically* the kind of change that touches this area.

**CONTRACT C-1376.** Add the exempt check the sibling predicate already uses:
```ts
if (authResolutionExpired && !atSignInRoute && !isSelfAuthenticatedExemptRoute(pathname)) {
```
`isSelfAuthenticatedExemptRoute` is already exported (`coldLoadAuthGates.ts:283`) and already covers `INVITE_ACCEPT_ROUTE_PREFIXES` + Stripe-Connect routes (`:296`). **This makes `:737` consistent with `shouldRedirectToSignInFromRoute` (`:346`), which already consults it** — the inconsistency between the two is the whole defect.

**Label in code + PR:** *"defensive hardening — latent, not currently firing (ORCH-1376)."* Do not overstate.

---

### 4.7 — ORCH-1380: fold-in (orchestrator's call — recorded as such)

**File:** `mingla-business/src/services/oneSignalService.web.ts`

Native exports `canRequestPushPermission` (`:166`) + `syncPushPermissionTag` (`:196`); the web shim exports neither. `syncPushPermissionTag` throws a **live** `TypeError` on **every tab refocus** (`_layout.tsx:654`, runtime-proven).

**CONTRACT C-1380.** Add both as no-ops matching native signatures:
- `canRequestPushPermission(): Promise<boolean>` → `false`
- `syncPushPermissionTag(): Promise<void>` → resolves

**Why folded in (say so in the PR):** the §9.2 parity gate **will fail on this file**. Folding in two no-op exports is strictly cheaper than writing and maintaining an allowlist entry for a known-live bug.

---

## 5. Success criteria

Per-surface where parity is manual. **Web = `mingla-business` web** (the surface the invite email opens).

| ID | Criterion |
|---|---|
| **SC-1-Web** | A logged-out visitor opening `/accept-brand-invitation?token=X` sees the **"You're invited"** screen with a working **"Sign in"** button within **≤1.5 s**. **Never a spinner that outlives auth resolution.** |
| **SC-2-Web** | `authStatus === "signed_out"` **provably reaches** the logged-out branch (§9.1 unit test over the real `authReadiness.ts`). |
| **SC-3-Web** | Signing in from that screen **via email OTP** returns to `/accept-brand-invitation?token=X` and states the outcome. Token **not** discarded. |
| **SC-4-Web** | Signing in **via Google/Apple OAuth** does the same (the §4.3.2 leg — the one a naive fix breaks). |
| **SC-5-Web** | `next` values `//evil.com`, `https://evil.com`, `javascript:alert(1)`, `/\evil.com`, `%2f%2fevil.com`, `/accept-brand-invitation-evil` **ALL** resolve to home — **never** an off-origin navigation. |
| **SC-6-Web** | Each of the 9 outcome states renders its §4.1.3 copy — incl. **`invite_declined`** and **`invite_currency_mismatch`**, which today wrongly say *"Try again in a moment."* |
| **SC-7-Web** | A resolved `phase` is **never** re-masked by a later auth change (C-7 / C-1373-C). |
| **SC-8-Web** | The `getSession()` retry loop is **gone**; a signed-in accept fires the edge fn with **no** added latency. |
| **SC-9-Web** | `/accept-scanner-invitation` satisfies SC-1/2/3/4/7 identically. |
| **SC-10-Web** | On a **successful** accept — **both** the inline card **and** `success.tsx` — a "Download the app" CTA renders, targeting `biz.usemingla.com/ZSCW?pid=business_web&c=brand_invite_accept`. |
| **SC-11-Web** | Tapping it opens the store in a **new tab** and the invite page **stays mounted** (no double-navigation — the ORCH-1381 trap). |
| **SC-12-Web** | `business.usemingla.com` loads with **zero** `subscribeOneLinkDeepLink` TypeErrors (was 3/3). |
| **SC-13-Web** | Tab background→foreground throws **zero** `syncPushPermissionTag` TypeErrors. |
| **SC-14-Web** | On a load where auth resolves normally, `[auth] loading-gate-backstop` is **NOT** emitted after 7 s (was 4/4). |
| **SC-15-Web/iOS/Android** | `bootstrapTimedOutRef` is **not** armed by the backstop on a resolved bootstrap (native included — ORCH-1292). |
| **SC-16-Web** | `_layout.tsx:737` does not redirect a self-authenticating exempt route even when `authResolutionExpired` is forced true. |
| **SC-17-CI** | The §9.2 parity gate FAILS on a deleted shim export and PASSES when restored — **proven in both directions**. |
| **SC-18-CI** | The extended 1342 gate FAILS on a `biz.usemingla.com` literal outside `storeLinks.ts`. |
| **SC-19-CI** | The extended open-external gate FAILS on `noopener` **or** `noreferrer` (**any case**) in **either** owner. |

---

## 6. Invariants

### 6.1 Preserved (must not regress)
| Invariant | How preserved | Verified by |
|---|---|---|
| `I-PROPOSED-1342-STORE-LINKS-SSOT` (ACTIVE) | The OneLink constant lands in `storeLinks.ts`; the gate is **extended**, never weakened. `success.tsx` leaves `GRANDFATHERED` **because its debt is paid**. | SC-18 |
| ORCH-1204 — ceiling releases only `loading`, never clears `user`/`session` | The §4.5.1 guard **adds an early return**; the body is otherwise untouched. | `authContext.adversarial.orch1204.test.tsx` (unchanged) |
| ORCH-1292 — ceiling armed on native (iPad hang) | The guard changes **when** it fires, not **where** it is armed. **Do not regress the iPad hang.** | T-11 |
| ORCH-1004 — late real session recovers | `:343` (the legitimate write) and `:565/:569` (the clears) are **untouched**. | `AuthContext.timeout.test.ts` Case 15/16 |
| ORCH-1139 — invite routes exempt from the sign-in redirect | Unchanged; ORCH-1376 **extends** the same exemption to `:737`. | SC-16 |
| `I-…-OPEN-EXTERNAL-SINGLE-OWNER` (ORCH-1381) | **Strengthened** — the business twin is fixed and brought under the gate. | SC-19 |

### 6.2 Proposed — **DRAFT** (`I-PROPOSED-1373-*`; the orchestrator flips them ACTIVE at CLOSE, not me)

| ID | Statement |
|---|---|
| **I-PROPOSED-1373-AUTH-TERMINAL-STATE-IS-ACTIONABLE** | In `mingla-business`, no route may render a spinner for `authStatus === "signed_out"`. A terminal auth state MUST render an actionable screen. `!isAuthReady` is **not** "loading". |
| **I-PROPOSED-1373-RESOLVED-PHASE-WINS** | Once an async outcome has resolved, rendering is a pure function of that outcome and MUST NOT be re-masked by auth state. |
| **I-PROPOSED-1375-NEXT-ALLOWLISTED** | Any `next`/return-to param MUST pass `sanitizeNextRoute` — relative, scheme-less, non-protocol-relative, decode-stable, and **path-allowlisted**. No caller may redirect to a raw `next`. |
| **I-PROPOSED-1375-NEXT-HAS-A-READER** | Every writer of a resume param MUST have a corresponding reader that consumes it. A write with no reader is a silent data drop. |
| **I-PROPOSED-1377-DIAGNOSTIC-TRUTH** | A log asserting a failure MUST be emitted only when that failure occurred. A timer-driven diagnostic MUST read the state it describes. |
| **I-PROPOSED-1377-CEILING-NAMES-DISAMBIGUATED** | No two auth-timing constants may share a value **and** a near-identical name without each docblock naming what it gates and what it logs. |
| **I-PROPOSED-1378-WEB-SHIM-EXPORT-PARITY** | Every `.web.*` shim MUST export a **superset** of its native twin's public value exports. TypeScript cannot see this — CI must. |
| **I-PROPOSED-1378-BUSINESS-ONELINK-SSOT** | The business OneLink domain may appear **only** in `mingla-business/src/constants/storeLinks.ts`. |
| **I-PROPOSED-1381-OPEN-EXTERNAL-NO-FEATURE-STRING** *(extends ORCH-1381 to `mingla-business`)* | Any `window.open` used for external navigation MUST pass **no** feature string; `noopener`/`noreferrer` (either alone) null the return and make a `!win` fallback fire unconditionally. Opener safety is preserved via `win.opener = null`. |

---

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| **T-1** | Logged-out invitee (**the bug**) | `signed_out` + valid token | "You're invited" + Sign in. **No spinner.** | Component |
| **T-2** | Mutual-exclusivity (**fails-on-revert**) | Real `authReadiness.ts`, exhaustive sweep | Logged-out branch **REACHABLE** for `signed_out` | Unit |
| **T-3** | Bootstrapping | `authStatus="bootstrapping"` | Spinner (**the only legitimate one**) | Component |
| **T-4** | Resolved phase not re-masked (**C-7**) | `phase=success` → auth flips `signed_out` | **Success stays rendered** | Component |
| **T-5** | Retry loop gone | grep the source | No `getSession()` loop | Static |
| **T-6** | Happy accept | `signed_in_ready` + valid token | Edge fn fires once; success + CTA | Integration |
| **T-7** | `invite_declined` | 410 `invite_declined` | "Invitation declined" — **not** "Try again in a moment" | Component |
| **T-8** | `invite_currency_mismatch` | 409 | "Connect your bank to accept this brand." | Component |
| **T-9** | Resume — email OTP | `/auth?next=/accept-brand-invitation?token=X` → OTP | Lands back on the invite; accepted | Integration |
| **T-10** | Resume — **OAuth** (§4.3.2) | Same → Google round-trip via `/auth/callback` | Lands back on the invite. **Fails without the sessionStorage leg.** | Integration |
| **T-11** | Backstop does not arm on a resolved boot | `getSession()`→`{session:null}` fast; fake-timers past 7 s | **No log**; `bootstrapTimedOutRef` **not** armed | Unit |
| **T-12** | Backstop **does** fire on a real stall | `getSession()` never resolves; advance 7 s | Log **IS** emitted; `loading` released | Unit |
| **T-13** | ORCH-1376 exempt | `authResolutionExpired=true`, path=`/accept-brand-invitation` | **No** `<Redirect href="/">` | Unit |
| **T-14** | `/rsvp/create` resume | `next=/rsvp/create` | Resumes (§4.3.5) | Integration |
| **T-15** | `/event/create` resume | `next=/event/create` | Resumes | Integration |
| **T-16** | **Open-redirect** (§4.3.4) | `//evil.com`, `https://evil.com`, `javascript:alert(1)`, `/\evil.com`, `%2f%2fevil.com`, `/accept-brand-invitation-evil`, 3000-char | **ALL** → home. Zero off-origin. | Unit (security) |
| **T-17** | Scanner logged-out | `signed_out` + token | "You're invited" + Sign in | Component |
| **T-18** | CTA target | Render success | `biz.usemingla.com/ZSCW?pid=business_web&c=brand_invite_accept` | Component |
| **T-19** | CTA no double-nav | Fake window; `open` returns null-on-success | **Exactly one** navigation; `location.assign` **not** called | Unit |
| **T-20** | Shim parity — appsFlyer | Import the `.web` shim | Both exports exist; `subscribe…` returns a function | Unit |
| **T-21** | Shim parity — oneSignal | Import the `.web` shim | Both exports exist | Unit |
| **T-22** | Parity gate self-test | `--self-test` | Every case fires in **both** directions | CI |
| **T-23** | Native CTA absent | `Platform.OS="ios"` | CTA **not** rendered | Component |
| **T-24** | `success.tsx` de-grandfathered | Read the 1342 gate | `success.tsx` **absent** from `GRANDFATHERED`; gate green | CI |

---

## 8. Implementation order

Bottom-up; each step independently green.

1. **`src/utils/nextRoute.ts`** — `sanitizeNextRoute` + T-16 (security first; nothing redirects until this exists).
2. **`src/services/appsFlyerService.web.ts`** + **`oneSignalService.web.ts`** — the 4 no-op exports (T-20/21). *Kills two live production TypeErrors — smallest, highest-value step.*
3. **`.github/scripts/strict-grep/i-1378-web-shim-export-parity.mjs`** — the parity gate + self-test (T-22). Ordered **after** step 2 so it lands green.
4. **`src/context/AuthContext.tsx`** — `bootstrapResolvedRef` + guard + the N-4 renames + comment correction (T-11/12). **Update the 4 pinning tests in the same commit** (§4.5.1).
5. **`src/utils/coldLoadAuthGates.ts`** *(read-only)* + **`app/_layout.tsx:737`** — the ORCH-1376 exempt check (T-13).
6. **`src/services/guestFunnelLink.ts`** — fix `openExternal` (T-19) + extend the open-external gate (SC-19).
7. **`src/constants/storeLinks.ts`** — `BUSINESS_INVITE_ONELINK_URL`; extend the 1342 gate; **remove `success.tsx` from `GRANDFATHERED`** (T-24, SC-18).
8. **`src/components/invite/BusinessAppDownloadCta.tsx`** — the CTA (T-18/19/23).
9. **`app/auth/index.tsx`** + **`app/auth/callback.tsx`** — capture + both resume legs (T-9/10/14/15).
10. **`app/accept-brand-invitation.tsx`** — the two-axis restructure + copy + CTA + remove the retry loop (T-1..T-8).
11. **`app/accept-brand-invitation/success.tsx`** — swap the hardcoded pair for the CTA.
12. **`app/accept-scanner-invitation.tsx`** — the same restructure (T-17).
13. **`__tests__/orch_1373_mutual_exclusivity.test.ts`** — promote the proof (T-2).

---

## 9. Regression prevention (CLOSE Step 0.5 — **HARD MUST**)

### 9.0 ⚠️ DECORATIVE-GUARD RULE — **BINDING**
**ORCH-1381 shipped a live prod bug past two GREEN gates** because they asserted **token presence** (`window.open(` appears in the file), not **behaviour**.

> **Every gate this spec mandates MUST be proven to FAIL in both directions.** A guard that cannot be made to fail is **decorative and will be REJECTED at REVIEW.** The implementor MUST record, per gate, the exact mutation that makes it fail and the evidence it passes when reverted.

**Also binding:** **gate regexes MUST be case-insensitive** (`/…/i`). Browsers are case-insensitive; `NOOPENER` slips a case-sensitive regex.

**This spec's own compliance:** §9.1 asserts *reachability* (semantics), §9.2 asserts an *export set* (structure the bundler actually uses), §9.3 asserts *absence of a feature string* + *presence of the opener-null* (behaviour). None is a presence-of-token check.

### 9.1 Promote the mutual-exclusivity proof
**From:** `/tmp/orch-1373/mutual-exclusivity-proof.mts` → **`mingla-business/src/utils/__tests__/orch_1373_mutual_exclusivity.test.ts`**

- MUST `import` the **real shipped** `../authReadiness` — **never** reimplement `deriveBusinessAuthStatus` / `isBusinessAuthReady`.
- Assert: for `{loading:false, session:null, user:null, authError:null}` → `authStatus === "signed_out"` **and** the component's logged-out branch is **REACHABLE**.
- Assert the exhaustive sweep: **combinations where `user===null && isAuthReady===true` = 0**.
- **Fails-on-revert by construction:** restoring the `!isAuthReady` early-return above the `user === null` branch makes the branch unreachable → the reachability assertion fails.
- **Proof required:** reintroduce the early return → test FAILS; remove → PASSES.

### 9.2 `.web.*` export-parity CI gate — **the structural fix for the whole class**
**New:** `.github/scripts/strict-grep/i-1378-web-shim-export-parity.mjs`

**Why it must exist:** **TypeScript is structurally blind here.** `tsc` resolves the import to the **NATIVE** module (`moduleSuffixes` unset in `mingla-business/tsconfig.json`); Metro substitutes the `.web.*` override at bundle time. **Typecheck GREEN, shipped bundle broken.** No existing gate compares the pair.

**Rule:** for every `X.web.ts(x)` with a sibling `X.ts(x)`, the web shim's exported **value** names MUST be a **superset** of the native twin's. (Values only — type-only exports are erased and cannot throw.)

**Bounded — I verified this myself rather than trusting the dispatch.** My own sweep (`/tmp/orch-1373/drift-verify.mjs`) across **`mingla-business` + `app-mobile` + `mingla-admin` + `packages`**:
```
DRIFT: mingla-business/src/services/appsFlyerService.web.ts
   native-only VALUE exports missing on web: resolveBusinessOneLinkDestination, subscribeOneLinkDeepLink
DRIFT: mingla-business/src/services/oneSignalService.web.ts
   native-only VALUE exports missing on web: canRequestPushPermission, syncPushPermissionTag
--- pairs=28 drifting=2 missingExports=4 ---
```
**28 pairs, exactly 2 drifting, exactly 4 exports** — matching the orchestrator's bound. After steps 2/§4.4.2/§4.7 the gate is green with **zero allowlist entries**. **No allowlist may be added** — an allowlist here would re-open the exact class the gate exists to close.

**Self-test (both directions, per §9.0):**
- compliant fixture → PASS
- delete `subscribeOneLinkDeepLink` from the shim → **FAIL**
- delete `syncPushPermissionTag` → **FAIL**
- add a native export with no web twin → **FAIL**
- web exports a **superset** (extra web-only export) → **PASS** (superset, not equality)
- type-only native export absent from web → **PASS** (values only)
- a `.web.*` with **no** native twin → **skipped**, not failed

### 9.3 Extended open-external gate — **C-1378-OPEN-GATE**
**Amend** `.github/scripts/strict-grep/orch-1381-open-external-no-double-nav.mjs`: its `TARGET` is currently the single file `mingla-marketing/lib/open-external.ts` (`:51`). **Generalise to a TARGETS list covering BOTH owners:**
- `mingla-marketing/lib/open-external.ts`
- `mingla-business/src/services/guestFunnelLink.ts`

Per owner REQUIRE (comment-stripped, **case-insensitive**):
1. **No** `noopener` **and no** `noreferrer` token anywhere in the `window.open(` call (`/noopener|noreferrer/i`).
2. `window.open(` is called with **exactly two** arguments (no feature string).
3. `opener` is nulled on the success branch.
4. A `location.assign` fallback exists **only** on the falsy branch.

**Self-test both directions:** re-adding `'noopener'` → FAIL · `'noreferrer'` alone → FAIL · `'NOOPENER'` (**uppercase**) → **FAIL** (proves case-insensitivity) · removing `win.opener = null` → FAIL · correct shape → PASS.

### 9.4 Diagnostic-truth guard
`AuthContext.timeout.test.ts` (existing home): **T-11 (resolved boot → no log, ref not armed)** and **T-12 (real stall → log IS emitted)** under fake timers.
**Fails-on-revert:** removing the `bootstrapResolvedRef` guard re-emits the log on a resolved boot → T-11 fails. **T-12 is the anti-over-correction guard** — it fails if someone "fixes" the log by deleting the backstop.

### 9.5 Protective comments
Each fix carries a short **why**, not a what: the dead-gate ordering (`accept-*.tsx`), `next`'s open-redirect class (`nextRoute.ts`), the null-return trap (`guestFunnelLink.ts`), TypeScript's blindness (the parity gate), and the unconditional-timer falsehood (`AuthContext.tsx`).

---

## 10. Open questions / Collateral

### 10.1 For the orchestrator to register (Collateral — NOT silently scope-crept)
- **§10-1 — COMMS-0101 item (2) is STALE.** It says the business OneLink is dead on Android; **I curl-verified both hosts 301 correctly on Android, 2026-07-15**. **ORCH-1381 is currently told to wait on a blocker that has cleared.** A correcting ledger entry is owed. *(Ledger writes are the orchestrator's — I performed none.)*
- **§10-2 — `mingla-business/src/services/guestFunnelLink.ts:170` carries the live ORCH-1381 double-navigation bug, and ORCH-1381's gate does not cover it** (`TARGET` = marketing only). Live on `SeeWhosGoingGate.tsx:273`. **Folded into this PR (§4.4.6) because the dispatch mandates reusing the single owner and the only business-side owner is broken.** Flagged for registration as an ORCH-1381 follow-up if the orchestrator prefers it split out.
- **§10-3 — `DownloadMinglaCta.tsx:32`'s `.catch(() => Linking.openURL(universalLink))` is dead code on web.** RN-web's `openURL` never rejects (`open()` does not throw). Pre-existing; **not fixed here** (out of scope, no user-visible symptom).
- **§10-4 — The 1342 gate's `GRANDFATHERED` entry for `appsFlyerService.ts` (`go.usemingla.com` as the business branded domain) is now questionable.** The business branded domain is live as `biz.usemingla.com`; the service still names the consumer domain. **Not touched here** (native-build-bound, ORCH-1346 territory) but it is now a *provable* mismatch, not a pending one.
- **§10-5 — ORCH-1379** (Sentry dark on production business web) remains the highest-value unaddressed finding in this cluster. Not in scope.

### 10.2 Genuinely open — **needs Seth**
- **OQ-1 — Should the logged-out invitee screen also offer "Download the app" (not just "Sign in")?** Seth's #880 wording was *"redirect them to download the app and sign [up/in]"*. **This spec deliberately puts the CTA on SUCCESS only** (§4.4.4), because pre-install the app cannot resume the invite (no deferred continuity — §2.2), so a pre-sign-in download button sends the invitee **away** from the only flow that works and **loses them**. **Recommendation: keep the CTA on success. Needs Seth's ruling** — it is a direct reading of his words vs. the mechanism.
- **OQ-2 — Evidence too thin to contract:** the **authed happy path has never been observed end-to-end** (0 of 1 invites ever accepted in production). ORCH-1373 §10 states this openly; the synthetic Arm-B session proved only that the gate is the blocker. **The tester must close this with a real invite + real sign-in on the physical Samsung.** I did not write a contract asserting the post-accept membership grant works — **it is untested, not proven.**
- **OQ-3 — Native deep-link entry** into `/accept-*` is unverified on iOS/Android (email CTA targets web). Out of scope; flagged so nobody assumes it.

---

## 11. Scoped allowlist + DO-NOT-TOUCH

### 11.1 ALLOWLIST — the implementor may change **only** these

**Create (5):**
- `mingla-business/src/utils/nextRoute.ts`
- `mingla-business/src/components/invite/BusinessAppDownloadCta.tsx`
- `mingla-business/src/utils/__tests__/orch_1373_mutual_exclusivity.test.ts`
- `.github/scripts/strict-grep/i-1378-web-shim-export-parity.mjs`
- Test files for T-16/T-19/T-20/T-21/T-23 (co-located `__tests__/`)

**Modify (13):**
- `mingla-business/app/accept-brand-invitation.tsx`
- `mingla-business/app/accept-brand-invitation/success.tsx`
- `mingla-business/app/accept-scanner-invitation.tsx`
- `mingla-business/app/auth/index.tsx`
- `mingla-business/app/auth/callback.tsx`
- `mingla-business/app/_layout.tsx` *(**line 737 only** — the exempt check)*
- `mingla-business/src/context/AuthContext.tsx` *(ref + guard + renames + comment)*
- `mingla-business/src/services/appsFlyerService.web.ts`
- `mingla-business/src/services/oneSignalService.web.ts`
- `mingla-business/src/services/guestFunnelLink.ts` *(`openExternal` only)*
- `mingla-business/src/constants/storeLinks.ts` *(add the constant)*
- `.github/scripts/strict-grep/orch-1342-store-links-ssot.mjs` *(extend BANNED; de-grandfather `success.tsx`)*
- `.github/scripts/strict-grep/orch-1381-open-external-no-double-nav.mjs` *(TARGET → TARGETS)*

**Modify — tests, only to track the §4.5.3 rename (assertions must survive verbatim in meaning):**
- `mingla-business/src/context/__tests__/AuthContext.timeout.test.ts`
- `mingla-business/src/context/__tests__/authContext.adversarial.orch1204.test.tsx`
- `mingla-business/src/context/__tests__/authContext.sync-hydration.orch1204.test.tsx`

### 11.2 DO-NOT-TOUCH (stop-and-amend required)
- **`supabase/**` — ANY file.** No migration, no edge-fn change. The schema and the error codes are **correct and complete**; the bug is 100% client-side. **NO PRODUCTION DB WRITES.**
- `mingla-marketing/**` — incl. `lib/open-external.ts` and `lib/store-links.ts`. ORCH-1381 owns marketing; this PR only **extends the gate's scope**, never edits marketing source.
- `app-mobile/**`, `mingla-admin/**`, `packages/**` — not in this flow.
- `mingla-business/src/utils/authReadiness.ts` — **the fix is the CALLERS' ordering, not this module.** Editing it would invalidate the §9.1 proof, which derives its force from testing the **unmodified shipped** module.
- `mingla-business/src/utils/coldLoadAuthGates.ts` — **read-only.** ORCH-1376 consumes `isSelfAuthenticatedExemptRoute`; it does not change it. Constant **#2**'s rename (§4.5.3) is the **only** permitted edit here — if that proves to have a wide blast radius, **stop-and-amend rather than widen**.
- `AuthContext.tsx:343` — the **legitimate** race-timeout ref write. **Must not change.**
- `mingla-business/src/components/event/SeeWhosGoingGate.tsx` — it **consumes** the fixed `openExternal`; do not edit the call site.
- `mingla-business/src/components/team/InvitePendingSheet.tsx` — the copy **source**; read, don't edit.
- Any `eas.json` / `app.json` version field — `I-RELEASE-VERSION-PARITY` (COMMS-0096) fails divergence.

---

## 12. Deploy / OTA

- **`[deploy]` — YES, REQUIRED.** Touches `mingla-business/**`; the fix must reach `business.usemingla.com` via Vercel. Tag the PR title `[deploy]`.
- **OTA — NO. FORBIDDEN.** **Business-app OTA empirically BRICKS launch** (COMMS-0063: an `eas update` of a pure-JS fix stuck the app on the splash screen indefinitely; only reinstall cleared it). Every business fix ships in a **native build**.
- **Native-build dependency: NONE for the user-visible win.** The accept route is opened by the **invite email → web**. The web deploy delivers 1373/1374/1375/1378-CTA/1378-shim/1380 **in full**.
- The **native** half of the 1377 F-3 fix and the 1376 hardening ride the **next business native build**. **No new native build is required by this PR** — and attribution does not need one (§2.3 A-2; ORCH-1378 F-10).
- **No edge-function deploy. No migration.**

---

## 13. Downstream routing

1. **mingla-implementor** — build §8 in order, in this worktree. Honor §11. Record the both-directions failure proof for every gate (§9.0). **Stop-and-amend** rather than widen.
2. **mingla-tester** — verify §5 on the physical Samsung `R58R54YV7JT` against a **preview** deploy. **Priority: SC-4 (the OAuth resume leg — the one a naive fix silently breaks) and OQ-2 (the never-once-observed authed happy path).** Drive a **real** invite end-to-end.
3. **mingla-orchestrator** — CLOSE: flip the 9 `I-PROPOSED-*` DRAFTs to ACTIVE, register §10 collateral, write the COMMS-0101 correction (§10-1), reap the worktree.

---

**Confidence:** the root cause is **PROVEN** (device + exhaustive mechanical proof + data corroboration). Every contract above is anchored to a file:line I read in this worktree. The two places I refused to write a contract are named in §10.2 (OQ-2, OQ-3) rather than papered over.
