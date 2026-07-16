# QA — ORCH-1373 [accept-invite-infinite-loader] + 1374 / 1375 / 1376 / 1377 / 1378 / 1380 / 1382

**Skill:** mingla-tester · **Dispatched by:** mingla-orchestrator
**Date:** 2026-07-15 (RETEST-1: 2026-07-16)
**Contract:** `Mingla_Artifacts/specs/SPEC_ORCH-1373_accept-invite-infinite-loader.md` (§5 + **AMENDMENT A-1**)
**Under test (RETEST-1):** `ORCH-1373-accept-invite-infinite-loader` @ `eeba4b792` (rework `5339baa24` + A-1 `eeba4b792`); rebase vs `origin/main` = already up to date
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1373-[accept-invite-infinite-loader]/`
**Retest cycle:** 1 of 2 (not stuck-in-loop)

---

## 0. RETEST-1 VERDICT — **CONDITIONAL PASS → treat as BLOCKED pending Seth**

**P0: 0 · P1: 2 · P2: 0 · P3: 0 · P4: 3**

> **P0-1 IS DEAD. I attacked it exactly as I did when I falsified it, and it held.**
> A logged-out invitee tapping "Sign in" now keeps the URL `/auth?next=<token>` (**retained, never rewritten to `/`**) and `sessionStorage['mingla.biz.auth.next']` is **non-null within 400 ms and stable through 4 s**. Last run: URL → `/`, token → `null`. SC-3 closes end-to-end. The ORCH-1103 white-screen loop guard survives every shape I threw at it.
>
> **But I could ORPHAN the new test — twice.** The `slice-and-execute` guard stays at a full green **21/21** while the shipped layout re-introduces **P0-1 verbatim**. It executes ONE EXPRESSION in isolation and is structurally blind to (a) the control flow around it and (b) whether the text it sliced is even the code that ships. This is the **fourth decorative-check instance** in this ORCH's lifetime and the orchestrator's question was the right one. I wrote the guard that closes both holes (§5b) — it catches both mutations that the implementor's test survives.
>
> **And the branch will go RED in CI right now** (P1-2): the `[TEST-MOD-APPROVED ORCH-1377]` token sits on `5339baa24` = **HEAD~1**; the A-1 amendment commit `eeba4b792` knocked it off HEAD. The append-only gate reads **HEAD only** → **4 failures**. This is precisely the COMMS-0098 / PR #883 trap the dispatch named. My QA commit carries the token forward and re-greens the gate — but **every future commit on this branch must carry it too**.
>
> **Why not PASS:** two P1s, neither accepted by Seth in the dispatch. Per the skill's CONDITIONAL-PASS rule, absent affirmative documented acceptance this is **BLOCKED, not CONDITIONAL** → surface to Seth. Neither P1 is a code defect in the shipped fix — the fix itself is correct and runtime-proven.
>
> **SC-4 (real OAuth round-trip) and OQ-2 (the authed happy path) remain OPEN — no agent has the credentials. §8 has the exact steps for Seth. An honest OPEN beats a manufactured PASS.**

### RETEST-1 findings

| ID | Sev | One line | Blocks CLOSE? |
|---|---|---|---|
| **P1-1** | P1 | The new `orch_1373_auth_route_gate.test.ts` can be **silently orphaned** — 2 proven mutations keep it 21/21 green while P0-1 is live in the shipped layout. | No (my §5b guard closes it) |
| **P1-2** | P1 | **CI is red now:** `[TEST-MOD-APPROVED ORCH-1377]` is on HEAD~1, not HEAD → append-only gate = 4 failures. | **Yes — merge-blocking** |
| P4-1 | P4 | The P0-1 fix is correct, minimal, segment-safe, and the reasoning for `isSignInRoute` over the self-auth list is right. | — |
| P4-2 | P4 | P2-2 replica cure is **real**: deleting the REAL guard now kills 5 tests incl. behavioural T-11 (was green). | — |
| P4-3 | P4 | `sanitizeNextRoute` is **deny-by-default** (4-entry allowlist) — traversal + open-redirect fully closed. | — |

### RETEST-1 SC matrix (SPEC §5 + Amendment A-1)

| SC | Result | Evidence |
|---|---|---|
| SC-1-Web | **PASS** | `652 ms` to "You're invited" + working "Sign in" (was 707 ms). Never a spinner. |
| SC-2-Web | **PASS** | 192/192 across 7 touched+adjacent suites. |
| SC-3-Web | **PASS (was FAIL)** | `sc3_trace.mjs`: URL **retained**; `ss` = `/accept-brand-invitation?token=TRACE1` @400 ms → stable @4000 ms. |
| **SC-4-Web** | **OPEN — cannot test** | Real Google/Apple OAuth needs credentials no agent has. §8. |
| SC-5-Web | **PASS** | 12/12 off-origin + scheme payloads → `null`. |
| SC-6-Web | PASS (carried) | Unchanged by rework. |
| SC-7-Web | PASS (carried) | Unchanged by rework. |
| SC-8-Web | PASS (carried) | Unchanged by rework. |
| SC-9-Web | **PASS** | Scanner: "You're invited" + Sign in; parity with SC-1. |
| SC-10-Web | PASS (carried) | Unchanged by rework. |
| SC-11-Web | **PASS** | Real Chrome 150: page **stays mounted**, no double-navigation. |
| SC-12/13-Web | **PASS** | Zero TypeErrors across the run. |
| SC-14-Web | **PASS** | No `loading-gate-backstop` log after 9 s. |
| SC-15/16-Web | **PASS** | Ceiling redirect suppressed on `/auth`, `/accept-brand-invitation`, `/connect-onboarding`. |
| SC-17/18/19-CI | PASS (carried) | Implementor gates; re-verified indirectly. |
| **A-1: `/auth` reachable** | **PASS** | Runtime: `/auth?next=` retained + captured. |
| **A-1: ORCH-1103 holds** | **PASS** | `/`, `""`, `null`, `undefined`, `"  "`, `"/ "`, `" /"` → **no redirect**. No React #185 path. |
| **A-1: `:750` ceiling** | **PASS** | `/auth` @8 s → renders welcome, **never spins**. |
| **A-1: segment-safe** | **PASS** | `/authorize`, `/auth-settings`, `/AUTH` **not** swept in; `/auth/`, `/auth/callback/` are. |
| **A-1: classes honest** | **PASS** | `isSelfAuthenticatedExemptRoute("/auth") === false`. |
| **OQ-2 (authed accept)** | **OPEN — never observed** | 0-of-1 funnel; needs a real invite round-trip. §8. |

---
## 1. ORIGINAL RUN (2026-07-15) — VERDICT: **FAIL** — superseded by §0 above

**P0: 1 · P1: 0 · P2: 2 · P3: 2 · P4: 2**

> **The headline bug IS fixed and I proved it at runtime: a logged-out invitee now gets "You're invited" + a working Sign in button in 707 ms, never a spinner.**
>
> **But the button is a trap.** Tapping "Sign in" — the *only* action on that screen — navigates to `/auth?next=<invite token>`, and `_layout.tsx:768` bounces `/auth` to `/` **before** the capture effect can run. The token is destroyed. `sessionStorage['mingla.biz.auth.next']` is `null`. The invitee lands on the marketing home page with nothing.
>
> **This is precisely the failure the SPEC exists to prevent**, in the SPEC's own words: *"Fixing 1373 alone converts an infinite spinner into a **silent token drop** that looks like success — worse than the bug."* The implementor built the anti-drop machinery correctly; it is **unreachable**. The 0-of-1 funnel would remain 0.
>
> Routing: **REWORK → mingla-implementor.** One P0, cited by SC-ID + file:line in §3.

**Regression gate:** satisfied. Implementor happy-path fails-on-revert independently re-run (§4). Tester adversarial test on-branch, in-diff, different angle, own fails-on-revert (§5).

---

## 2. SC-by-SC matrix vs SPEC §5

Surface = `mingla-business` web (the surface the invite email opens), driven in **real Chrome 150** via CDP **9376** against a **production-shaped web export** (`npx expo export --platform web`) served as an SPA at `127.0.0.1:8176`. Evidence paths under `Mingla_Artifacts/evidence/ORCH-1373/` → mirrored at `/tmp/orch-1373/evidence/` (gitignored by policy; cited, not force-added).

| ID | Verdict | Evidence |
|---|---|---|
| **SC-1-Web** | **PASS** (proven) | Logged-out + `?token=ORCH1373PROBE` → **"You're invited / Sign in to accept this invitation. We'll bring you right back."** + `Sign in`. **Time-to-actionable 707 ms** (≤1.5 s). No spinner. URL + token preserved. `evidence/SC1_logged_out_invite.png`, `SC1_console.log` |
| **SC-2-Web** | **PASS** (proven) | Re-ran `orch_1373_mutual_exclusivity.test.ts` 12/12 against the real, unmodified `authReadiness.ts`. Corroborated by the SC-1 runtime capture — the logged-out branch demonstrably renders. |
| **SC-3-Web** | **FAIL** | **P0-1.** `/auth?next=%2Faccept-brand-invitation%3Ftoken%3DX` → lands on `/`, `sessionStorage['mingla.biz.auth.next'] === null`. Capture never runs. `evidence/SC4_oauth_handoff.png`; trace in §3. |
| **SC-4-Web** | **FAIL** | **P0-1.** The OAuth leg fails *before* OAuth is even involved: the capture that must precede the round-trip never executes, because `/auth` is bounced. **Separately: no real Google/Apple round-trip was performed — no OAuth credentials available (see §7 BLOCKED).** The failure is proven without needing them. |
| **SC-5-Web** | **PASS** (unit, proven) — *runtime N/A* | All 6 named attacks → `null` (`nextRoute.test.ts` 33/33). My independent 32-string corpus + the **real WHATWG URL parser**: every accepted value resolves same-origin (39/39, §5). Runtime end-to-end is N/A: `next` is never consumed (P0-1). **Caveat: P2-1 — traversal defeats the allowlist's stated intent.** |
| **SC-6-Web** | **PARTIAL — source-verified, render NOT proven** | Independently verified the edge fn returns exactly **7** codes (`mapRpcError`, `accept-brand-invitation/index.ts:96-118`) and the client has a distinct case for **all 7** + `validation` + default (`accept-brand-invitation.tsx:293-335`). `invite_declined` / `invite_currency_mismatch` no longer say "Try again in a moment". **Render proof requires an authed session — BLOCKED (§7).** |
| **SC-7-Web** | **PASS** (source, proven-by-construction) | `phase.kind === "success"` (`:182`) and `"error"` (`:210`) branches precede **all** auth branches (`:234`, `:254`). A resolved phase cannot be re-masked — the auth axis is unreachable once phase resolves. |
| **SC-8-Web** | **PASS** (proven) | Retry loop **gone**: no `for`/`while`/`setTimeout` retry in the file. ⚠️ The implementor's "grep `getSession` → 0" is **wrong** — it returns **2**; both are *comments* documenting the deletion (`:108`, `:112`). Substance correct, claim imprecise (**P3-2**). |
| **SC-9-Web** | **PARTIAL — SC-1 arm PASS, resume arm FAIL** | Scanner logged-out → **"You're invited / Sign in to accept this scanner invitation."** in **603 ms**, no spinner (`evidence/ORCH1374_scanner_logged_out.png`). Its `Sign in` routes to `/auth?next=` → **inherits P0-1**. |
| **SC-10-Web** | **NOT PROVEN** | Requires a successful accept → BLOCKED (§7, and unreachable while P0-1 stands). Unit: `BusinessAppDownloadCta.test.ts` 12/12 pins the exact URL. |
| **SC-11-Web** | **PASS** (mechanism proven in real Chrome) | **Real-browser, one user-activation per call:** OLD shape `window.open(d,'_blank','noopener,noreferrer')` → **NULL** ⇒ `if(!win) location.assign` **fires** ⇒ double-nav (**the live bug reproduced**). NEW shape `window.open(d,'_blank')` → **WindowProxy** ⇒ assign **skipped** ⇒ **page stays mounted**. `win.opener = null` → OK. Host page never navigated. App-level "see who's going" tap **not** drivable: **0 published events in prod**. |
| **SC-12-Web** | **PASS** (proven) | Full business-web load: **zero** `subscribeOneLinkDeepLink` TypeErrors (was 3/3). `evidence/SC1_console.log`. |
| **SC-13-Web** | **PASS** (proven) | 3× background→foreground cycles: **zero** `syncPushPermissionTag` TypeErrors. `evidence/SC13_refocus.log`. |
| **SC-14-Web** | **PASS** (proven at runtime) | Real load held **9 s** past the 7 s backstop: **no** `loading-gate-backstop` and **no** `resolution-hard-ceiling` emitted (was 4/4). Old lying log text is gone from all product code. **This runtime proof matters — the unit "behavioural" test does not actually cover it (P2-2).** |
| **SC-15** | **PARTIAL — structural only** | All 3 resolution points set `bootstrapResolvedRef` (source-verified). Behavioural coverage is a **replica**, not shipped code (**P2-2**). Native runtime not exercised (no native build; OTA forbidden — COMMS-0063). |
| **SC-16-Web** | **PASS** (latent, honestly labelled) | Exempt check present at `_layout.tsx:751-754`. Proven inert (`isSelfAuthExempt("/accept-brand-invitation") === true`). Not claimed active — matches the implementor's own honest framing. |
| **SC-17-CI** | **PASS — both directions, independently re-verified** | §6.2 |
| **SC-18-CI** | **PASS — both directions, independently re-verified** | §6.1 — **and I confirmed it genuinely WAS decorative on `origin/main`.** |
| **SC-19-CI** | **PASS** (orchestrator re-verified 4/4 per dispatch; I did not duplicate) | Dispatch states the `orch-1381` gate was independently re-verified upstream. |

---

## 3. Findings

### 🔴 P0-1 — The `?next=` resume is DEAD: `/auth` is bounced to `/`, silently destroying the invite token

**SC:** SC-3, SC-4, SC-9 (resume arm) · **Invariant:** `I-PROPOSED-1375-NEXT-HAS-A-READER` (the reader exists but is unreachable)

**Evidence — runtime (Chrome 150, CDP 9376, production-shaped export):**

```
STEP 1 — logged out on the invite:
  {"url":".../accept-brand-invitation?token=ORCH1373TOKEN","ss":null}
STEP 2 — after tapping 'Sign in' (click result: CLICKED):
  {"url":"http://127.0.0.1:8176/","ss":null}          ← NOT /auth?next= ; NOT captured
navigation trace: SPA nav → "/" ×4    (/auth never appears)

DIRECT navigate to /auth?next=%2Faccept-brand-invitation%3Ftoken%3DDIRECT1:
  {"url":"http://127.0.0.1:8176/","ss":null}          ← same bounce, capture never runs
```

**Evidence — the predicate (executed, not reasoned):**

```
/auth                    isSignInRoute=false  isSelfAuthExempt=false  isPublicBuyer=false  REDIRECT_TO_ROOT=true
/auth/callback           isSignInRoute=false  isSelfAuthExempt=false  isPublicBuyer=false  REDIRECT_TO_ROOT=true
/accept-brand-invitation isSignInRoute=false  isSelfAuthExempt=true   isPublicBuyer=false  REDIRECT_TO_ROOT=false
/                        isSignInRoute=true   isSelfAuthExempt=false  isPublicBuyer=false  REDIRECT_TO_ROOT=false
```
`shouldRedirectToSignInFromRoute({isWeb:true, loading:false, hasUser:false, hasStoredWebSession:false, pathname:"/auth"})` → **`true`** → `app/_layout.tsx:768` `return <Redirect href="/" />`.

Root: `coldLoadAuthGates.ts:128` `SIGN_IN_ROUTE = "/"`; `isSignInRoute` (`:130-140`) matches **only** `""` or `"/"`. `/auth` is neither a sign-in route, a public buyer route, nor self-auth exempt → the route-agnostic redirect fires and the URL — **which carries the credential** — is thrown away.

**Provenance (important, and it exonerates the predicate but not the ship):** the predicate is **untouched by this PR** (`git diff origin/main...HEAD -- coldLoadAuthGates.ts` → no change to `SIGN_IN_ROUTE`/`isSignInRoute`/`shouldRedirect*`). On `origin/main` the `router.replace('/auth?next=…')` call already existed (`accept-brand-invitation.tsx:71`) but sat **below the dead `if (!isAuthReady) return;`** — unreachable, so the bounce never mattered. **This PR makes it reachable and load-bearing.** The defect is latent-on-main, **shipped-live by this PR**.

**Impact:** every logged-out invitee — i.e. **every invitee** — taps the only button on the newly-fixed screen and loses the token. They land on marketing home with no path back. **The 0-accepted-of-1 funnel stays 0%.** The infinite spinner is replaced by a *silent token drop that looks like a successful navigation* — the exact trade the SPEC forbids. The same bounce breaks the `/rsvp/create` and `/event/create` legs (`rsvp/create.tsx:221`, `event/create.tsx:221`).

The irony is exact and worth quoting — the ORCH-1376 docblock this PR *added* (`_layout.tsx:742-746`) describes this bug:
> *"a self-authenticating route carries its credential IN THE URL (an invite token…). Redirecting it to "/" does not just lose the page — it DESTROYS the out-of-band credential, silently. That trades a visible spinner for invisible data loss, which is strictly worse."*

ORCH-1376 added `atSelfAuthRoute` to the `authResolutionExpired` branch (`:752`) **only**. The branch that actually fires is `redirectToSignIn` (`:763`), which has no such exemption — and `/auth` is not in the exempt list anyway.

**Required fix (implementor):** make `/auth` (and `/auth/callback`) reachable for a logged-out visitor so `AuthIndex`'s capture effect runs. Either teach `isSignInRoute` about `/auth` (it *is* a sign-in route in practice), or add both to `SELF_AUTHENTICATED_EXEMPT`. Preserve the ORCH-1103 loop guard (`redirectToSignIn` must stay false on the route it is on) and ORCH-1115 buyer allowlist. **Add a test that renders `/auth?next=…` inside the real `_layout` gate** — every existing test passes because they exercise `sanitizeNextRoute`/`authNextHandoff` in isolation and *simulate* the round-trip; none puts the reader behind the real redirect.

**Retest:** re-run `/tmp/orch-1373/sc3_trace.mjs` + `auth_direct.mjs` → expect URL `/auth?next=…` retained and `mingla.biz.auth.next` non-null; then SC-3/SC-4 end-to-end.

---

### 🟡 P2-1 — `sanitizeNextRoute` accepts dot-segment traversal, defeating the allowlist it advertises

**SC:** SC-5 · **Invariant:** `I-PROPOSED-1375-NEXT-ALLOWLISTED` ("…and **path-allowlisted**")

**Evidence (executed):**
```
REJECT  "/brand/123/payments"                              -> null
ACCEPT  "/accept-brand-invitation/../brand/123/payments"   -> returned verbatim
ACCEPT  "/accept-brand-invitation/../../evil"              -> returned verbatim
ACCEPT  "/rsvp/create/../../../evil.com"                   -> returned verbatim
ACCEPT  "/accept-brand-invitation/%2e%2e/%2e%2e/evil"      -> returned verbatim
```
`isAllowlistedPath` (`nextRoute.ts:83-93`) matches `normalized.startsWith(base + "/")` on the **pre-resolution** string. `remove_dot_segments` runs later, in the router/URL parser. So the value the validator judges and the path the browser lands on are different strings — and `/accept-brand-invitation/../brand/123/payments` resolves to `/brand/123/payments`, **the exact path the implementor's own test asserts must be rejected**.

**NOT a security breach — I proved the ceiling rather than asserting it.** My adversarial test resolves every accepted value through the real WHATWG `URL` parser against two origins: **all** land same-origin (39/39). Dot-segments are resolved *relative to a fixed base origin*, so no off-origin escape exists. Credentials/hostname smuggling also negative.

**Impact:** defence-in-depth only, but it voids the module's stated contract. Its own docblock says *"Enumerate, don't generalise… A general relative-path rule silently authorises EVERY FUTURE ROUTE as a redirect target"* — traversal silently generalises it to every same-origin route, which is what the allowlist exists to prevent. This is the same shape as the decorative-guard class the SPEC §9.0 is about: the control looks enforced, its test is green, the enforcement is bypassable.

**Required fix:** reject any `next` whose path contains a `..` (or `%2e%2e`) segment, or normalise dot-segments **before** the allowlist match and validate the normalised form. **Retest:** add the 5 strings above to `nextRoute.test.ts` expecting `null`.

---

### 🟡 P2-2 — The ORCH-1377 "behavioural" test is a **replica**; SC-14/15 rest on source-text assertions

**SC:** SC-14, SC-15 · **SPEC §9.0 (decorative-guard rule)**

**Evidence:** `AuthContext.diagnosticTruth.orch1377.test.ts` imports **only `node:fs` and `node:path`** — it never imports `AuthContext.tsx`. `armBackstop` (`:157-181`) is a **hand-written copy** of the backstop with the guard inlined at `:174` (`if (bootstrapResolvedRef.current) return; // ← THE GUARD`).

Proven by my Step-0.5 mutation — true line-deletion of the **real** guard from `AuthContext.tsx:348`:
```
✕ T-11a/b/c/d   (structural — read the source as TEXT)          ← the only 4 that fail
✓ T-11  "RESOLVED boot … NO log, ref NOT armed, past 7s"        ← STILL GREEN with the fix deleted
✓ T-12, T-12b, + 11 others                                       ← STILL GREEN
Tests: 4 failed, 12 passed, 16 total
```
The "behavioural" arm would pass if `AuthContext.tsx` were **deleted entirely**. The regression guard against this fix is *text presence*, not behaviour — the exact pattern that let ORCH-1381 ship a live bug past two GREEN gates.

**Mitigating (and why this is P2, not P1): I verified SC-14 independently at runtime** — a real 9 s load emits no backstop log. The **criterion holds**; the **test** does not defend it.

**Required fix:** make T-11/T-12 drive the real module (import `AuthProvider`, or export the backstop factory from `AuthContext.tsx` and have both the test and the provider consume the same function — one owner, per Constitution #2). **Retest:** delete `AuthContext.tsx:348` → a *behavioural* test must go red.

---

### 🔵 P3-1 — `guestFunnelLink.ts` docblock still prescribes the pattern that WAS the bug

`src/services/guestFunnelLink.ts:32-36` still reads: *"openExternal is the ORCH-1328 client-side store-open byte-pattern: `window.open('_blank','noopener,noreferrer')`, popup-blocked → `window.location.assign`"* — the **exact shape ORCH-1382 removed**, and it contradicts the correct docblock at `:223-229` and the implementation at `:227-238`. In an ORCH whose thesis is *comments and logs that lie cost real money*, a docblock instructing the next reader to reintroduce the bug is worth one line of cleanup. **Fix:** update `:32-36` to the bare-`open` + `win.opener = null` contract.

### 🔵 P3-2 — Implementation-report inaccuracies (substance mostly correct; the numbers are not)

1. **"`grep getSession …` → 0"** — actually **2** (both comments). SC-8 still holds.
2. **"300 failing jest suites on `origin/main`"** — my measurement: **149** (`origin/main` `d344de987`). Branch: **150**. The "300" figure is wrong by ~2×; the *tests* figure (235) matches.
3. **"0 new failures"** — I measured **+1 suite / +1 test** (149→150, 234→235). See §8: I could **not** attribute it (all 7 new suites pass 104/104 in isolation), and it is most likely ordering/flake in a 235-failure baseline. **Not treated as a blocker**, but "0 new" is unverified as stated.

### 🟢 P4 — Credit where due

1. **`nextRoute.ts` is genuinely good defensive code** — decode-then-revalidate, segment-safe matching, returns RAW to preserve token encoding, and a docblock that explains the *class* not the instance. My 32-string corpus + real-URL-parser differential could not produce an off-origin escape. The one gap (P2-1) is a boundary miss, not a design error.
2. **The implementor's honesty is exemplary and load-bearing.** He explicitly refused to claim OQ-2, capped ORCH-1377 F-3 at `suspected`, labelled ORCH-1376 latent/inert 0/4, and reported 5 places the SPEC was wrong. **Every one of those five I spot-checked was correct** (SPEC-CORRECTION-2: `appsFlyerService.ts:257` does declare `): void`; SPEC-CORRECTION-5: `appsFlyerService.ts` carries `go.usemingla.com`, not the biz literal). That honesty is why this review could focus on finding P0-1 instead of re-deriving his claims.

---

## 4. Step 0.5 — independent re-run of the implementor's fails-on-revert proof

Rebase rewrote hashes: the implementor's `40f79aad3` is now **`deb978a7d`** ("ORCH-1377 + ORCH-1376 steps 4-5/13").

**Ran it myself.** True line-deletion of `if (bootstrapResolvedRef.current) return;` (`AuthContext.tsx:348`; `diff` confirms exactly `348d347`, one line):

| | Result |
|---|---|
| Fix DELETED | **4 failed, 12 passed, 16 total** — `✕ T-11a` (guard present) · `✕ T-11b` (ordered before the log) · `✕ T-11c` (ordered before the `bootstrapTimedOutRef` write) · `✕ T-11d` (sits after the mounted check) |
| Fix RESTORED | **16/16 PASS**; `git diff --exit-code src/context/AuthContext.tsx` → **byte-exact clean** |

**Verdict: the claim is TRUE but materially weaker than reported.** It fails on revert — but only via **structural source-text** assertions. The four behavioural tests stay green (**P2-2**). The implementor's SC-14/SC-15 "✓ **PROVEN**" is not supported by this test at the behavioural level; **it is supported by my runtime evidence instead** (§2 SC-14).

---

## 5. Tester adversarial test

**Path:** `mingla-business/src/utils/__tests__/orch_1375_adversarial_next_url_resolution.test.ts`
**Commit:** `4c7668004` (branch HEAD) · **39 tests, all green** · **NEW file — append-only**

**Different angle (not a rename of the implementor's).** His `nextRoute.test.ts` asserts string equality against **17 hand-written attack strings** — it can only catch attacks someone already imagined, and never asks *where an accepted value actually takes the browser*. Mine is a **differential test against the real WHATWG URL parser** (the algorithm `location.assign` uses) over a **32-string hostile corpus**, asserting a property rather than a list:

> for every input `sanitizeNextRoute` **accepts**, resolving it against **any** origin must land back on **that same origin** — plus no credential/host smuggling, and token bytes survive resolution.

That gap is real, not theoretical: `sanitizeNextRoute` returns the **raw** string, but every consumer **resolves** it (dot-segment removal, backslash + CR/LF/TAB normalisation) — so the string the validator judged and the URL the browser navigates to are different strings. The corpus includes dot-segment traversal, backslash mixing, encoded traversal, and control-character injection — **none present in the implementor's list**. It is also what **disproved** the off-origin escalation of P2-1 (evidence for the ceiling, not just the claim).

**fails-on-revert verified at `2a7151bab`:** replacing the `sanitizeNextRoute` body with the naive `return typeof raw === "string" ? raw : null` (the pre-ORCH-1375 world — 4 writers, 0 readers, raw `next` handed to the router):
```
✕ 16 failed —  expect(resolved.origin).toBe(ORIGIN)
   Expected: "https://business.usemingla.com"
   Received: "https://evil.com"
```
Restored → **39/39 PASS**; `git diff --exit-code src/utils/nextRoute.ts` → **byte-exact clean**.

**Both tests in the closing diff** (`git diff origin/main...HEAD --name-only`): implementor's 7 new files ✓ · `orch_1375_adversarial_next_url_resolution.test.ts` ✓.

**⚠️ Append-only token:** `[TEST-MOD-APPROVED ORCH-1377]` is carried on **`4c7668004` = branch HEAD** (my commit). Verified: `node .github/scripts/test-append-only-check.js` → **`Append-only check: 12 passed, 0 failed`** (EXIT 0). **Any later commit buries it — re-add on amend (the COMMS-0098 / PR #883 trap).**

---

## 6. Decorative-guard rule — both-directions proofs (SPEC §9.0, binding)

Every mutation applied to the **real shipped files**, restored byte-exact (`git diff --exit-code` clean after each).

### 6.1 `orch-1342-store-links-ssot.mjs` (EXTENDED) — SC-18 — **NOT decorative**

| # | Mutation | EXIT | Expected |
|---|---|---|---|
| 0 | clean tree | **0** | 0 ✓ |
| 1 | SPEC's decorative probe `const PROBE = "https://biz.usemingla.com/ZSCW";` → `guestFunnelLink.ts` | **1** | 1 ✓ |
| 2 | `"https://BIZ.USEMINGLA.COM/ZSCW"` (UPPERCASE) | **1** | 1 ✓ |
| 3 | `"https://minglabiz.onelink.me/ZSCW"` (raw vendor) | **1** | 1 ✓ |
| 4 | **T-24** — `apps.apple.com` literal re-added to the **de-grandfathered** `success.tsx` | **1** | 1 ✓ |
| 5 | restore all | **0** | 0 ✓ |

**I independently confirmed the implementor's "it WAS decorative" claim** rather than taking it: ran mutation 1 against the **`origin/main`** copy of the gate in a detached baseline worktree → **EXIT=0 (PASS)**. The hole was real; this PR genuinely closed it. **4/4 caught, both directions proven.**

### 6.2 `i-1378-web-shim-export-parity.mjs` (NEW) — SC-17 — **NOT decorative**

| # | Mutation | EXIT | Expected |
|---|---|---|---|
| 0 | clean tree | **0** | 0 ✓ |
| 1 | line-DELETE `subscribeOneLinkDeepLink` from `appsFlyerService.web.ts` | **1** | 1 ✓ |
| 2 | line-DELETE `syncPushPermissionTag` from `oneSignalService.web.ts` | **1** | 1 ✓ |
| 3 | **anti-decorative:** export deleted but named in a **comment** | **1** | 1 ✓ — a comment does **not** satisfy the gate |
| 4 | restore | **0** | 0 ✓ |

Mutation 1 emits the real diagnostic (`I-PROPOSED-1378-WEB-SHIM-EXPORT-PARITY FAIL — a '.web.*' shim does not export everything`). **3/3 caught incl. the anti-decorative case.**

### 6.3 `orch-1381-open-external-no-double-nav.mjs` — SC-19
Per dispatch, already independently re-verified upstream (4/4 incl. the `noreferrer`-only half-fix and uppercase). **Not duplicated.** I did independently reproduce the underlying *browser* contract it guards (§2 SC-11).

---

## 7. Device / parity matrix

| # | Surface | Verdict | Notes |
|---|---|---|---|
| 1 | Consumer iOS | **N/A** | No brand-invite route exists (verified: change set touches `mingla-business/**` only). |
| 2 | Consumer Android | **N/A** | Same. |
| 3 | **Buyer/anon Web (`mingla-business` web)** | **DRIVEN — PRIMARY** | Real Chrome 150, CDP **9376**, production-shaped export served as SPA on `:8176`. All runtime findings above. |
| 4 | Business iOS | **NOT VERIFIED** | Rides the next NATIVE build; **OTA forbidden (COMMS-0063)**. No native build produced. |
| 5 | Business Android | **NOT VERIFIED** | Same. |
| 6 | Admin Web | **N/A** | Separate app; untouched. |
| 7 | Business Web preview | **DRIVEN** | Same artifact as #3. |

**🔴 BLOCKED — physical Samsung `R58R54YV7JT` NOT connected.** `adb devices` empty; no USB match (`system_profiler SPUSBDataType`); no `adb mdns services`; `adb reconnect offline` no-op. **This is not a skip — it needs Seth: plug the Samsung in (USB, unlocked, USB-debugging authorised).** I did **not** silently downgrade: I substituted desktop Chrome 150 on CDP **9376** against the same web artifact the Samsung's Chrome would load, and the P0 is origin-independent (a routing predicate, not a device behaviour). **CDP 9222 confirmed alive and untouched** (other session). No global `pkill` used. Metro 8100 not needed (production export, not a dev server).

**🔴 BLOCKED — no OAuth credentials.** No Google/Apple credentials and no email-inbox access ⇒ **no real OAuth round-trip was performed** (SC-4) and **no authed session** could be established (SC-6 render, SC-10). Stating this plainly per dispatch rather than inferring. SC-4 nonetheless **FAILS** for a reason that needs no OAuth: the capture is unreachable (P0-1).

**Environment notes (mine, not the branch's):**
- `react-qr-code@^2.2.0` is declared in `package.json` **and present in `package-lock.json`**, but was **absent from `node_modules`** in both the worktree *and* the anchor — pre-existing staleness, not this branch. Resolved with `npm ci` (1272 pkgs). **`package.json` / `package-lock.json` verified byte-clean afterwards** (`git diff --exit-code`).
- The export initially crashed the app into the error boundary with `StripeModeMismatchError` — the ORCH-0954 **fail-close guard behaving correctly**: `app.config.ts:200` hard-codes a `pk_test_` fallback while the bundle's Supabase default is the **live** project. A **local-preview artifact, not a defect** (production sets a real `pk_live_`). Rebuilt with `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_ORCH1373_QA_PREVIEW_NOT_A_REAL_KEY` — prefix-only guard (`stripeModeHandshake.ts:26-43`), no Stripe surface under test.

---

## 8. My measured `origin/main` baseline

Measured **without `git stash`** — per **COMMS-0105** the stash stack is shared and holds a foreign entry (`stash@{0}: On main: anchor-uncommitted-pre-ORCH1318-build`). I used a **detached worktree** on `origin/main` at `/tmp/orch-1373/baseline-main` instead. **The foreign stash was never popped, dropped, or touched — verified still present.**

| Metric | `origin/main` `d344de987` | Branch `2a7151bab` | Δ |
|---|---|---|---|
| Failing jest **suites** | **149** (of 668) | **150** (of 675) | **+1** |
| Failing jest **tests** | **234** (of 5282) | **235** (of 5386) | **+1** |
| Passing tests | 5046 | 5149 | +103 |
| Suites total | 668 | 675 | +7 (the 7 new files) |

- Deps identical (`package.json`/`package-lock.json` untouched by the PR) → baseline is honest.
- **The implementor's "300 failing suites" is wrong** (actual: 149). His 235-failing-tests figure matches.
- **The "+1" is UNATTRIBUTED, and I say so rather than guessing:** all **7** new suites pass **104/104 in isolation**; the 4 rename-touched suites were re-run clean. My attempt to diff the two `FAIL` lists was invalidated when my own `npm install` mutated `node_modules` mid-run, so I discarded it rather than report a poisoned result. Most likely ordering/flake against a 234-failure baseline. **Not treated as blocking**, but "0 new" is **not** verified.
- **Confirmed pre-existing red (not this branch):** `AuthContext.timeout.test.ts` Case 18 — the implementor's Discovery #1 stands.
- **A 149-failing-suite baseline is itself the story.** Whatever CI runs, it is not this suite. "The tests are green" is a weak signal in this repo — supports folding into **ORCH-1351 [ci-dark-test-registry-audit]**.

---

## 9. OQ-2 — **OPEN** (not closed; not faked)

**Status: OPEN. No production write was performed. The narrow write authorization was NOT exercised.**

The dispatch authorised a minimal real invite round-trip **iff** Seth-controlled brand **and** Seth-controlled invitee **and** reversible. Conditions 1 and 2 are satisfiable — but the round-trip is **impossible for me**, and I will not manufacture it:

1. **The only invite in production is a real third party's.** `brand_invitations` = **1 row, 0 accepted** (confirmed — the 0% funnel is real). That row: `id 2a4c3083-6d8a-4e97-ba6b-602314a78329`, `email debranyakundi@gmail.com`, `role brand_owner`, brand **Rockstar Vibes**, `status pending`, expires 2026-07-21, **not expired**. Accepting it would hand away **brand ownership** to a non-owner. **Untouchable. I did not modify it.**
2. **The plaintext token cannot be obtained.** The schema stores `token_hash` only; the plaintext exists **solely in the invite email**. I have no inbox access.
3. **I cannot authenticate as any invitee.** Business auth is email-OTP (needs the inbox) or Google/Apple OAuth (needs credentials). I have neither. A service-key-minted session would be exactly the **synthetic session** the dispatch rejects — so I did not attempt it.
4. **Decisive: OQ-2 is currently unclosable BY ANYONE — including Seth — because of P0-1.** A real invitee taps "Sign in" and the token is destroyed before any session exists. **The live-fire must run AFTER the P0-1 rework**, or it will fail for the wrong reason.

**Seth-controlled assets confirmed for the post-rework live-fire:** `rambleawaypod@gmail.com` (`6c61590c-…`) is the `invited_by` on the Rockstar Vibes invite ⇒ a Seth-controlled brand exists. Spare Seth-controlled invitee emails: `sethogievabelgium@gmail.com` (`485addca-…`), `appreview@usemingla.com` (`8313d091-…`), `sethogieva@gmail.com` (`b17e3e15-…`).

### What Seth must do to close OQ-2 (~2 minutes) — **AFTER P0-1 is fixed and deployed to preview**

1. Sign in to business web as **`rambleawaypod@gmail.com`** → **Rockstar Vibes** → Team → invite **`sethogievabelgium@gmail.com`** as **`staff`** (⚠️ **not** `brand_owner` — that transfers the brand).
2. Open the invite email **in a different browser profile** and click **Accept invite**.
3. **The SC-4 check that matters:** sign in with **Google** (not email OTP). If you land back on the invite and it accepts → SC-4 closed. If you land on **home** → the OAuth leg is still dropping the token.
4. Confirm the screen says **"You're on the team"** (not "Ownership transferred") and shows a **Download the app** button.
5. **Read-back (the actual OQ-2 answer):**
   `select id, brand_id, account_id, role, created_at from brand_team_members where brand_id = (select id from brands where name='Rockstar Vibes');`
   — a real row for `485addca-58e0-400b-9ddc-7d2460210bc4` = **the membership grant has been observed end-to-end for the first time.**
6. **Reverse it:** delete that `brand_team_members` row, then
   `update brand_invitations set accepted_at = null, status = 'pending', accepted_by_account_id = null where id = <the new invite id>;`
   — or simply revoke the invite and remove the member from the Team UI. **Re-read both tables to prove the reversal.** Leave no test data (prod was deliberately wiped 2026-06-22).

---

## 10. Constitution — 14-rule matrix

| # | Rule | Verdict | Evidence |
|---|---|---|---|
| 1 | No dead taps | **FAIL** | **P0-1.** The "Sign in" button — the only control on the fixed screen — navigates and **destroys the token**. It is worse than dead: it looks like it worked. |
| 2 | One owner per truth | PASS | `BUSINESS_INVITE_ONELINK_URL` lands in `storeLinks.ts` SSOT; the 1342 gate now enforces it (§6.1). *(Advisory: P2-2's replica backstop is a second copy of the guard logic — an owner-duplication smell in test code.)* |
| 3 | No silent failures | **FAIL** | **P0-1** is definitionally a silent failure: no error, no message, token gone, looks like a normal navigation. |
| 4 | One query key per entity | N/A | No React Query surface touched. |
| 5 | Server state stays server-side | PASS | `sessionStorage` holds a **route string**, not server state; consume-once + re-validate on read. |
| 6 | Logout clears everything | PASS | Handoff key is per-tab `sessionStorage`, consumed on read; `captureNextRoute(null)` clears rather than leaving armed. |
| 7 | `[TRANSITIONAL]` labelled | PASS | None introduced. ORCH-1376 honestly labelled latent/inert 0/4. |
| 8 | Subtract before adding | PASS | Retry loop deleted (SC-8); dead `if (!isAuthReady)` gate removed; SPEC-CORRECTION-3 correctly refused to add a dead `detectClientPlatform()` call. |
| 9 | No fabricated data | PASS | All 7 outcome states map to real edge-fn codes; no invented copy; missing states are not faked. |
| 10 | Currency-aware | PASS | `invite_currency_mismatch` preserved incl. the ORCH-1052 `partner_gate` payload. |
| 11 | One auth instance | PASS | Branches on `authStatus` from the single `useAuth()`; no second client. |
| 12 | Validate at the right time | PASS | `next` re-validated at **every** read (URL *and* sessionStorage), not once at write. |
| 13 | Exclusion consistency | **FAIL** | **P0-1** is exactly this: `shouldRedirectToSignInFromRoute` (`:346`) and `_layout.tsx:752` consult **different** exemption sets. The SPEC named this inconsistency as "the whole defect" — and then only fixed one of the two branches. |
| 14 | Persisted-state startup gate | PASS | `bootstrapResolvedRef` is a `useRef`, not derived from stale-closure `loading`; ANTI-STALE-CLOSURE test verified. |

**3 FAILs, all the same root cause (P0-1).** Per the automatic-P0 triggers (constitutional violation + silent failure + broken contract), P0-1 is correctly severity-0.

---

## 11. Discoveries for the orchestrator (not fixed here)

1. **`AuthContext.timeout.test.ts` Case 18 fails on `origin/main`** — confirmed independently. Implementor Discovery #1 stands → **ORCH-1351**.
2. **149 failing jest suites / 234 failing tests on `origin/main`** (not the reported 300). A large dark-test surface; "green tests" is a weak signal repo-wide → fold into **ORCH-1351**. **The +1 delta on this branch remains unattributed** and should be isolated on a quiet machine.
3. **`react-qr-code` is in `package.json` + `package-lock.json` but was missing from `node_modules`** in the worktree *and* the anchor — any fresh `expo export` fails until `npm ci`. Worth a note in the worktree runbook.
4. **The foreign stash is still live** — `stash@{0}: On main: anchor-uncommitted-pre-ORCH1318-build` (COMMS-0105 / COMMS-0092 recurrence). I did not touch it. **An owner should claim or drop it.**
5. **`/auth` has never been reachable for a logged-out web visitor** (P0-1 provenance). Worth asking how many other routes assume `/auth` works — `rsvp/create.tsx:221` and `event/create.tsx:221` both already route there and are therefore **also broken today, on main**, independent of this ORCH. Candidate for its own ORCH.
6. **OQ-1 still needs Seth's ruling** (CTA on success only vs. also on the logged-out screen). The implementor's success-only reading is sound — a pre-install download button sends the invitee away from the only flow that works.

---

## 12. Routing

**FAIL → REWORK → `mingla-implementor`.**

**Blocking CLOSE:** **P0-1** only. P2-1 and P2-2 should ride the same rework (both are small and both are invariant-integrity issues the SPEC itself is about). P3-1/P3-2 are cleanup.

**Not blocking:** the Samsung and OAuth blockers are **environmental**, not code defects — but SC-4, SC-6-render, SC-10 and OQ-2 **cannot be signed off** until they are resolved, so this ORCH cannot reach PASS on evidence alone even after P0-1 is fixed. The post-rework retest needs: (a) the Samsung connected, (b) a real Google sign-in, (c) Seth's §9 live-fire.

---

# RETEST-1 DETAIL (2026-07-16) — mingla-tester

## R1. PRIORITY 1 — is P0-1 dead at runtime? **YES.**

Re-ran the exact probes that falsified the claim last time, against a **freshly built** web export (the `dist` on disk was **32 minutes older than the rework commit** — testing it would have proven nothing; rebuilt with `--clear`).

**`auth_direct.mjs` + `retest_auth_trace.mjs` — `/auth?next=<invite>`:**
```
URL   : http://127.0.0.1:8176/auth?next=%2Faccept-brand-invitation%3Ftoken%3DDIRECT1   <- RETAINED
ss    : "/accept-brand-invitation?token=DIRECT1"                                        <- NON-NULL
NAVS  : NAV /auth?next=… | SPA /auth?next=… | SPA /auth?next=… | SPA /auth?next=…       <- NEVER bounced to /
screen: "Continue with Apple / Continue with Google / Continue with Email"              <- real sign-in UI
errors: none
```

**`sc3_trace.mjs` — the BUTTON path (SC-3 end-to-end):**
```
click result: CLICKED
  @~150ms : url=/auth?next=…TRACE1   ss=null            <- capture effect not yet run
  @~400ms : url=/auth?next=…TRACE1   ss=/accept-brand-invitation?token=TRACE1
  @~1000ms: url=/auth?next=…TRACE1   ss=/accept-brand-invitation?token=TRACE1
  @~2500ms: url=/auth?next=…TRACE1   ss=/accept-brand-invitation?token=TRACE1
  @~4000ms: url=/auth?next=…TRACE1   ss=/accept-brand-invitation?token=TRACE1   <- STABLE
```
Both dispatch criteria met: **URL retained** + **sessionStorage non-null**. Prior run: URL → `/`, `ss` → `null`. **SC-3 closes.**

### R1.1 A false alarm I chased down rather than reported (method note)

My first clean-build run showed the URL rewritten to `/` and the body reading **"Something broke. We're on it."** That looks exactly like P0-1 surviving. It is not.

The **control** (`/`, which cannot be "bounced" anywhere) showed the **identical** error screen. Cause, from the console: `StripeModeMismatchError` — `app.config.ts:199` falls back to a **`pk_test_` sandbox key** when `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` is unset, while the live backend reports `pk_live_`, so the app **correctly fail-closes** (`feedback_mingla_business_pk_live_in_production.md`). This is **my local build's env, not the branch** — a global error boundary was masking every route.

Rebuilt with a **dummy** `pk_live_` string (prefix-only comparison; no real credential, local-only, never committed). The boundary cleared, the control rendered the welcome screen, and the real behaviour became observable. **Reporting the first run as a P0 would have been a fabricated finding.**

## R2. PRIORITY 2 — ORCH-1103 loop guard + `:750` ceiling. **HOLDS.**

The failure mode being defended: `isSignInRoute` returning **false** for `/` → the layout redirects `/` → `/` → re-render → React #185 → **white screen on sign-out**, which is worse than the bug fixed. Probe: `/tmp/orch-1373/retest_p2_loopguard.mts`, executed against the **real shipped module**.

```
--- ORCH-1103: self-redirect loop guard ---
PASS  redirect at pathname="/"          got=false
PASS  redirect at pathname=""           got=false
PASS  redirect at pathname=null         got=false
PASS  redirect at pathname=undefined    got=false
PASS  redirect at pathname="  "         got=false
PASS  redirect at pathname="/ "         got=false
PASS  redirect at pathname=" /"         got=false
--- trailing-slash / lookalike ---
PASS  isSignInRoute("/auth")=true   ("/auth/")=true   ("/auth/callback")=true   ("/auth/callback/")=true   (" /auth ")=true
PASS  isSignInRoute("/authorize")=false   ("/auth-settings")=false   ("/authorize/x")=false   ("/AUTH")=false
--- sign-out from a DEEP route must STILL redirect ---
PASS  /account, /hub/events, /brand/123/settings, /(tabs)/home, /analytics -> all true
--- :750 ceiling on /auth past 7s ---
PASS  spinner still up on /auth @8s = false   (renders welcome, never spins)
PASS  spinner still up on /    @8s = false
PASS  ceiling redirect suppressed on /auth, /accept-brand-invitation, /connect-onboarding
===== ALL LOOP-GUARD/CEILING CHECKS PASS =====
```
No white-screen path. The widened predicate can only ever **remove** a spinner, never add one — confirmed independently.

## R3. PRIORITY 3 — **I ORPHANED THE TEST. TWICE.** (P1-1)

The technique: `orch_1373_auth_route_gate.test.ts` reads `_layout.tsx`, regex-slices the `redirectToSignIn` declaration, and executes it via `new Function`. The orchestrator had already killed the two obvious mutations (empty `SIGN_IN_ROUTE_PREFIXES`; short-circuit the wiring). **Both shapes below are ones it did not try, and both work.**

### ORPHAN-1 — control-flow blindness (the realistic accidental regression)
A future dev adds a guard **above** the gate. The sliced expression is untouched:
```tsx
if (user === null && pathname != null && pathname.startsWith("/auth")) {
  return <Redirect href="/" />;      // P0-1 IS BACK: ?next= destroyed
}
if (redirectToSignIn) { … }          // <- the sliced expression, never reached for /auth
```
**Result: `Tests: 21 passed, 21 total`.** Green suite, dead funnel — the exact signature of the bug this ORCH exists to kill.

### ORPHAN-2 — slice integrity (`match()` cannot tell code from a comment)
`String.match()` returns the **first** occurrence:
```tsx
/* Historical reference (pre-ORCH-1373 shape), kept for context:
const redirectToSignIn = shouldRedirectToSignInFromRoute({ … pathname, });   <- the test slices THIS
*/
const redirectToSignIn = shouldRedirectToSignInFromRoute({
  … pathname: "/account",                                                     <- the REAL shipped gate: route-blind
});
```
**Result: `Tests: 21 passed, 21 total`.** The test executes a comment. The real gate evaluates every route as `/account` — `/auth` bounced (P0-1 back) **and** `/` would self-redirect (ORCH-1103 React #185 white screen).

### Verdict on the technique
Slice-and-execute is a genuine improvement over predicate-unit-testing — it caught what nothing else did. **But on its own it is orphanable**, because it verifies **the value of one expression**, not **that the expression governs the route**. Renaming the binding IS caught (`expect(m).not.toBeNull()`). Control flow and slice provenance are **not**. Closed by §5b.

## R4. PRIORITY 4 — the rest

### `/rsvp/create` + `/event/create` resume — the orchestrator's caution, resolved honestly
Both legs measured at runtime (`retest_p4_resume.mjs`):

| Leg | Result |
|---|---|
| **A — BUTTON path** `/auth?next=/rsvp/create` | URL **retained**, `ss` = `/rsvp/create` ✓ **FIXED** (same for `/event/create`) |
| **B — DIRECT sessionless visit** `/rsvp/create` | bounced → `/`, `ss` = `null` — **not fixed** |

**Which one matters: A. The implementor's "all three legs fixed" claim is CORRECT.** Proven, not assumed — **all four `?next=` writers are in-page buttons** (`accept-brand-invitation.tsx:138`, `accept-scanner-invitation.tsx:129`, `rsvp/create.tsx:221`, `event/create.tsx:221`), each doing `router.replace('/auth?next=X')`. That is Leg A.

Leg B is not the resume path at all. The `rsvp/create.tsx:221` button only renders when `terminalState === "signed_out" | "auth_timeout"`, which requires the page to **mount** — measured:
```
/rsvp/create  cold sessionless (hasStoredWebSession=false) -> bounced=true   => page never mounts, button unreachable
/rsvp/create  stale/expiring   (hasStoredWebSession=true)  -> bounced=false  => page mounts -> button reachable -> FIXED
```
So Leg B bounces a **cold, sessionless** visitor off an **authed** route — which is correct behaviour, destroys **no credential** (unlike `/auth?next=<token>`), and is unchanged from `main`. **Not a defect, not a regression, not attributable to this branch.** No finding raised.

### P2-1 traversal + SC-5 open redirect — **CLOSED**
22/22 payloads rejected: `//evil.com`, `https://evil.com`, `javascript:alert(1)`, `/\evil.com`, `%2f%2fevil.com`, `data:`, `vbscript:`, `\\evil.com`, `/accept-brand-invitation-evil` · traversal `/..`, `/../`, `/a/../../b`, `/./../x`, `/%2e%2e/admin`, `/%2E%2E/admin`, `/%2e%2E/admin`, `/auth/..%2fadmin`.

**A red in my own probe that was MY error, not a defect:** I expected `/hub/events` to be accepted; it returns `null`. `NEXT_ROUTE_ALLOWLIST` (`nextRoute.ts:42`) is exactly the 4 resume targets — **deny-by-default**. Correct behaviour. **Not a finding** (P4-3).

### P2-2 replica cure — **CONFIRMED REAL**
True line-deletion of the **REAL** guard `AuthContext.tsx:348` (`if (bootstrapResolvedRef.current) return;`):
```
✕ T-11a — the backstop body carries the bootstrapResolvedRef early-return guard
✕ T-11b — the guard is ordered BEFORE the log
✕ T-11c — the guard is ordered BEFORE the bootstrapTimedOutRef write
✕ T-11d — the guard sits AFTER the mounted check
✕ T-11 — RESOLVED boot: NO log, ref NOT armed, past 7s          <- the BEHAVIORAL one
Tests: 5 failed, 11 passed, 16 total
```
As a replica these stayed **green**. The tests now die when the real guard dies. Restored byte-identical (`3ba7eedc…`).

### Prior runtime passes — no regression
SC-1 **652 ms** (was 707 ms) · SC-9 scanner parity · SC-11 page **stays mounted** (Chrome 150) · SC-12/13 **zero** TypeErrors · SC-14 **no** backstop log after 9 s.

## R5. Step 0.5 — I re-ran the implementor's fails-on-revert proof myself

**Their claim (commit `5339baa24`):** *"M1 delete /auth arm → 5 fail incl 'THE BUG: invitee at /auth is NOT bounced'."*

**Run A — literal deletion** (`SIGN_IN_ROUTE_PREFIXES = [] as const`): suite fails, but at **COMPILE time** — `TS2339: Property 'endsWith' does not exist on type 'never'` (emptying an `as const` array makes `prefix: never`). Red in CI, but **not** the semantic proof.

**Run B — semantic equivalent** (`SIGN_IN_ROUTE_PREFIXES: readonly string[] = []`, compiles):
```
✕ THE BUG: a logged-out invitee at /auth is NOT bounced (the ?next= token survives)   Expected: false  Received: true
✕ THE OAUTH LEG: /auth/callback is NOT bounced                                        Expected: false  Received: true
✕ the predicate itself now recognises the app's OWN sign-in page                      Expected: true   Received: false
✕ ORCH-1292/1102-W2 PRESERVED: past the ceiling, /auth renders the Stack              Expected: false  Received: true
✕ ORCH-1376 PRESERVED: the ceiling redirect cannot destroy a self-auth credential     Expected: true   Received: false
Tests: 5 failed, 16 passed, 21 total
```
**Exactly 5 failures, including the named assertion. The implementor's proof is REAL** — independently reproduced at `eeba4b792`. Gates restored (`e8407898…`), suite back to 21/21.

## R5b. My adversarial test — a DIFFERENT angle (not a renamed copy)

**Path:** `mingla-business/src/utils/__tests__/orch_1373_layout_gate_control_flow.tester.test.ts` (**NEW** file; append-only respected).

**Their angle:** the **value** of the gate expression. **My angle:** the **control flow around it** + the **provenance of the slice** — i.e. the two properties that make their value mean anything. It asserts nothing about the expression's value.

| Mutation | Implementor's test | **My test** |
|---|---|---|
| ORPHAN-1 (early return above the gate) | **21/21 PASS** (blind) | **FAILS** — names the branch: `if (user === null && pathname != null && pathname.startsWith("/auth")) => return <Redirect href="/" />;` |
| ORPHAN-2 (comment shadow) | **21/21 PASS** (blind) | **FAILS** — `redirectToSignIn` declared twice |
| Pristine | 21/21 PASS | **5/5 PASS** |

`fails-on-revert verified at eeba4b792` — both directions, by re-injecting each mutation and restoring. Both tests appear in `git diff origin/main...HEAD --name-only` for the closing PR. `tsc`: **0** errors from this file.

## R6. Findings

### P1-1 — the ORCH-1373 route-gate test can be silently orphaned
- **Evidence:** §R3. Two mutations, each re-introducing P0-1 in the shipped `_layout.tsx`, both leaving `orch_1373_auth_route_gate.test.ts` at **21/21 green**.
- **Impact:** the regression contract for a P0 that already shipped past a fully green suite can itself go decorative. **Fourth decorative-check instance in this ORCH's lifetime.** The next dev to add a guard above the gate silently restores a 0%-funnel bug with CI green.
- **Required fix:** none from the implementor — **already closed** by §R5b, which fails on both shapes.
- **Retest:** re-inject ORPHAN-1/ORPHAN-2; `orch_1373_layout_gate_control_flow.tester.test.ts` must fail on each.

### P1-2 — **CI is red right now:** the TEST-MOD token is on HEAD~1, not HEAD (merge-blocking)
- **Evidence:** `.github/scripts/test-append-only-check.js` → **`Append-only check: 10 passed, 4 failed`**. The gate reads the token from **the commit at HEAD** (its own docstring: *"The 'latest commit body' is the commit at HEAD"*). `git log -1 --format=%B | grep -c TEST-MOD-APPROVED` → **0**. The token lives on `5339baa24` (**HEAD~1**); the A-1 amendment `eeba4b792` was committed on top and knocked it off.
- Files flagged: `orch1102Wave2LoadingTimeout.test.ts` (16 deleted), `AuthContext.bootPaintDecouple.orch1294.test.ts` (1), `authContext.adversarial.orch1204.test.tsx` (1), `authContext.sync-hydration.orch1204.test.tsx` (1).
- **The deletions themselves are LEGITIMATE — I verified rather than assumed:** a pure **16-for-16** rename from ORCH-1377's "names that lie" work (`AUTH_RESOLUTION_HARD_CEILING_MS` → `AUTH_LOADING_GATE_RELEASE_BACKSTOP_MS`, `AUTH_RESOLUTION_CEILING_MS` → `AUTH_UI_GATE_EXPIRY_MS`). Every assertion is re-asserted under the new name; suite passes **19/19**. **No test was weakened.**
- **Impact:** the PR cannot merge — this is exactly the **COMMS-0098 / PR #883 trap** the dispatch named.
- **Required fix:** `[TEST-MOD-APPROVED ORCH-1377]` must be in the body of **whatever commit is HEAD**. **My QA commit carries it forward and re-greens the gate** — but **any later commit (including the CLOSE commit) must carry it too**, or CI goes red again.
- **Retest:** `node .github/scripts/test-append-only-check.js` → must report `14 passed, 0 failed`.

## R7. Baseline — MEASURED, not assumed

| Metric | Branch @ `eeba4b792` | Branch changes REVERTED (≈`origin/main`) | Attributable? |
|---|---|---|---|
| `tsc` errors (mingla-business) | **796** | 796 (claimed) | **NO** — matches the stated baseline exactly; **0** from my new test |
| 3 adjacent auth suites | **3 failed / 4 tests / 37 passed / 41 total** | **3 failed / 4 tests / 37 passed / 41 total** | **NO — identical** |
| 7 touched + adjacent suites | **192/192 PASS** | — | — |

Baseline method (**no `git stash` — COMMS-0105**): reverted all **16** changed product files via `git show origin/main:<f> > <f>`, re-ran, then restored with `git checkout HEAD -- <f>`. Verified byte-identical afterwards: `_layout.tsx` `1f812f25…`, `AuthContext.tsx` `3ba7eedc…`, `coldLoadAuthGates.ts` `e8407898…`.

I did **not** re-measure the ~149 failing suites repo-wide (the correction is already tracked on ORCH-1383 / #920); the three named adjacent suites are the ones this branch could plausibly touch, and they are provably identical with the branch reverted.

## R8. What I CANNOT close — Seth's action required

### SC-4 — real Google/Apple OAuth round-trip · **OPEN**
No agent has the credentials. The `/auth/callback` leg is **structurally** proven (`isSignInRoute("/auth/callback") === true`, not bounced, `consumeNextRoute()` wired at `callback.tsx:53`) but the **real round-trip is unobserved**.
1. Open `https://business.usemingla.com/accept-brand-invitation?token=<a real pending invite>` in a **logged-out** browser.
2. Confirm "You're invited" + a "Sign in" button (not a spinner).
3. Tap **Sign in** → confirm the URL is `/auth?next=%2Faccept-brand-invitation%3Ftoken%3D…` — **it must NOT become `/`**.
4. Tap **Continue with Google** (or Apple), complete the real OAuth round-trip.
5. **Expected:** you land back on `/accept-brand-invitation?token=…` and it states an outcome. **Fail:** you land on home/`/` with the invite silently gone.

### OQ-2 — the authed happy path · **OPEN — never once observed by anyone**
The funnel is **0 of 1** lifetime. No one has ever watched an invite succeed.
1. From a Seth-controlled brand, send a **`staff`** invite (**never `brand_owner`** — that transfers the brand) to a Seth-controlled invitee address.
2. Open the emailed link **already signed in as the invitee**.
3. **Expected:** the accept resolves, states the outcome, and a "Download the app" CTA renders → `biz.usemingla.com/ZSCW?pid=business_web&c=brand_invite_accept`.
4. Confirm the invitee now appears on the brand's team.

**I performed NO production DB writes.** The narrow reversible round-trip needs a Seth-controlled brand + invitee; without certainty on both, I did not do it.

## R9. Device / parity matrix

| Surface | Result |
|---|---|
| Buyer/anonymous **Web** (the surface the invite email opens) | **PASS** — real Chrome 150 via CDP **9376**, freshly built export |
| Business **Web** preview | **PASS** — same run |
| Consumer iOS / Android | **N/A** — `mingla-business` only; ships nowhere near consumer |
| Business **iOS** / **Android** | **NOT COVERED** — web-only routes (`/accept-brand-invitation`, `/auth`) are not served by business native; the predicate's native consumer (`nativeRedirectToSignIn`) is source-verified + unit-covered |
| **Physical Samsung `R58R54YV7JT`** | **ABSENT** — `adb devices` empty this run. **I claim no device coverage.** Local Chrome used, as last time. |
| Physical iPhone (HITL) | **NOT REQUESTED** — no native surface in this change |
| Admin web | **N/A** — untouched |

## R10. Constitution — 14 rules vs the rework diff

| # | Rule | Result |
|---|---|---|
| 1 | No dead taps | **PASS** — the "Sign in" button was a dead trap; now runtime-proven to work |
| 2 | One owner per truth | **PASS** — `isSignInRoute` is the single predicate; 3 consumers all route through it |
| 3 | No silent failures | **PASS** — the silent token drop is the thing fixed |
| 4 | One query key per entity | N/A |
| 5 | Server state server-side | N/A |
| 6 | Logout clears everything | **PASS** — sign-out from deep routes still redirects |
| 7 | `[TRANSITIONAL]` labelled | N/A |
| 8 | Subtract before adding | **PASS** — one predicate arm fixed 3 legs; no new machinery |
| 9 | No fabricated data | **PASS** |
| 10 | Currency-aware | N/A |
| 11 | One auth instance | **PASS** — untouched |
| 12 | Validate at the right time | **PASS** |
| 13 | Exclusion consistency | **PASS** — segment-safe; `/authorize` not swept in |
| 14 | Persisted-state startup | **PASS** — `_hasHydrated` untouched |

## R11. Discoveries for the orchestrator (not fixed here)

- **D-1 (method, repo-wide):** slice-and-execute tests are **orphanable by default**. This repo now has **at least two** (`orch_1373_auth_route_gate.test.ts`, `AuthContext.diagnosticTruth.orch1377.test.ts`). Every one needs a companion asserting **(a)** the sliced declaration appears exactly once and **(b)** no earlier control-flow path pre-empts it. Worth an invariant (`I-SLICE-EXECUTE-NEEDS-PROVENANCE`) + a generic gate.
- **D-2:** the append-only gate's **HEAD-only** token read is a **rebase/amend footgun by design** — any commit landing on top of an approved test-mod silently re-reds CI. Third+ recurrence (COMMS-0098, PR #883, now here). Consider reading the token across `origin/main..HEAD` instead of HEAD only.
- **D-3:** a local `npx expo export` of `mingla-business` **fail-closes into a global error boundary** (`StripeModeMismatchError`) because `app.config.ts:199` defaults to a `pk_test_` sandbox key against the live backend. Every route shows "Something broke." This will mislead the next agent into reporting a phantom P0. Worth documenting the dummy-`pk_live_` export recipe in the sim/test reference.
- **D-4:** the foreign stash `anchor-uncommitted-pre-ORCH1318-build` (COMMS-0105) is still live; the untracked `Mingla_Artifacts/specs/SPEC_ORCH-1318_APPSFLYER_ONELINK.md` from that incident is still sitting in this worktree. Not mine; not committed. Owner should claim or drop it.

## R12. Accepted conditions

**None.** Both P1s are unaccepted → per the skill's rule this is **BLOCKED, not CONDITIONAL** → surfaced to Seth rather than routed to CLOSE. P1-2 is merge-blocking and trivially fixable (token on HEAD). P1-1 is already closed by my §R5b guard.
