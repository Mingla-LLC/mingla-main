# ORCH-1377 [business-web-auth-7s-stall] — INVESTIGATION

**Mode:** INVESTIGATE (no fix proposed, no product code changed)
**Dispatched by:** mingla-orchestrator (conductor)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1373-[accept-invite-infinite-loader]/` on `ORCH-1373-accept-invite-infinite-loader` (SHARED with a parallel ORCH-1378 agent — no git operations performed)
**Date:** 2026-07-14
**Source issue:** GitHub #888. **Seed:** ORCH-1373 investigation §8 C-4.
**Confidence:** **PROVEN** — live repro on Seth's physical Samsung `R58R54YV7JT` against **production** `business.usemingla.com`, n=4 captures, instrumented from document-start.

---

## 1. VERDICT ON THE CONTRADICTION (stated first — it gates everything else)

> **RESOLVED. The orchestrator's option (b) is correct: the ceiling log fires regardless of whether it was needed. There is NO genuine stall. C-4's framing is REFUTED.**
>
> **There are THREE distinct 7000 ms ceilings with near-identical names. The one that LOGS is not the one that GATES the UI.** ORCH-1373 read the log emitted by ceiling #1 and attributed to it the *semantics* of ceiling #2. They are different code paths with different arming conditions.
>
> The `[auth] resolution-hard-ceiling` message comes from an **unconditional `setTimeout`** (`AuthContext.tsx:297-308`) whose callback checks **only `if (!mounted) return;`** — it never checks whether auth actually resolved. It therefore fires on **every** business-web page load where the tab stays open ~7.5 s, including loads where auth resolved in well under a second. **The log's text is false.** Auth resolves before first paint.
>
> **The real measured time-to-actionable-outcome on business web, logged out, is ~0.9 s** (916 / 920 ms to a painted "Continue" button). Not 7 s. The 2128 ms in ORCH-1373 was **an artifact of its own probe** — a 2000 ms polling interval, so 2128 ms was simply its *first sample*, not the flip time.

**Both numbers in the contradiction were true and neither meant what it appeared to mean.** `loading` was already `false` at 2128 ms because it had flipped long before (before first paint); the 7000 ms ceiling logged afterwards because it is a dumb wall-clock timer that fires unconditionally. There is no race, no second resolution path, and no stall.

### The scope-shrinking headline

**"Every business-web cold load costs ~7 s of auth limbo" (C-4(a)) is FALSE.** Cold load to actionable is **~0.9 s**. Seth's *"this should load lightning fast"* is **already satisfied**. The 7 s number never existed as user-visible time — it is a log line with no observable effect. **This ORCH is not a performance bug.** What remains is a real but much smaller defect: a **lying log** plus one **latent state-corruption side effect** (F-3), on which I deliberately do not overclaim.

---

## 2. The three ceilings — which does what (dispatch item 3)

This table is the key to the contradiction. All three constants are `7000`; all three are about "auth resolution"; only one logs the message ORCH-1373 saw.

| # | Constant | Defined | Consumers | Conditional? | Logs what | Fired in my captures? |
|---|---|---|---|---|---|---|
| **1** | `AUTH_RESOLUTION_HARD_CEILING_MS` | `AuthContext.tsx:105` | The bare `setTimeout` at `AuthContext.tsx:297-308` | **NO — unconditional.** Guard is `if (!mounted) return;` only. Never reads `loading`. | **`[auth] resolution-hard-ceiling: auth did not resolve within 7000ms …`** ← **the message in C-4** | **YES — 4/4 captures, ~7505-7666 ms** |
| **2** | `AUTH_RESOLUTION_CEILING_MS` | `coldLoadAuthGates.ts:396` | `isAuthResolutionExpired` (`:398-415`) → `_layout.tsx:437` → **the UI gate at `_layout.tsx:737`**; also `app/index.tsx:25` boot deadline | **YES — correctly conditional.** `if (!stillResolving) return false;` (`:413`). Anchor only stamped when `authResolving && user === null` (`_layout.tsx:430`) / `loading` (`index.tsx:57`). | `[_layout] auth-resolution-deadline …` / `[index] boot-loading-deadline …` (**different text**) | **NO — 0/4 captures.** Correctly never armed. |
| **3** | `BRAND_RESOLVE_AUTH_CEILING_MS` | `coldLoadAuthGates.ts:23` | `isBrandRouteResolving` → `/brand/[id]` `index`/`edit`/`team` only | YES (`elapsedMs < authCeilingMs`) | nothing | N/A — route-scoped, not on home or accept |

**Ceiling #1 gates nothing conditionally. Ceiling #2 gates the UI and behaved perfectly — it never armed, because for a logged-out user `isWebAuthResolving` is `false` (`loading=false`, `hasStoredWebSession=false` → `coldLoadAuthGates.ts:360-376`), which is exactly correct.** ORCH-1373's C-4 quoted #1's log text and reasoned about #2's redirect semantics. That conflation *is* the contradiction.

> This also **retires** ORCH-1373's C-3 concern in its current form: C-3 worried that `_layout.tsx:737` could bounce an invitee and destroy the URL token. That gate is driven by ceiling **#2**, which is correctly conditional and provably inert here. C-3's *trap-for-the-fix* warning nonetheless stands (see §7).

---

## 3. Measured cold-load auth timeline (real numbers)

**Method.** A recorder installed via CDP `Page.addScriptToEvaluateOnNewDocument` — i.e. **before document creation**, so every number is relative to the *real navigation start* rather than to whenever the prober attached (the precise flaw that produced ORCH-1373's 2128 ms). It patches `console.*` and `window.fetch` with `performance.now()` stamps and samples the live `AuthContext` off the React fiber every **20 ms**, recording **transitions only**. **No product code was modified** — this reads the unmodified production bundle.

**Harness:** `/tmp/orch-1377/timeline.mjs` · **Captures:** `/tmp/orch-1377/capture-*.json` · **Device:** Samsung `R58R54YV7JT` via adb + CDP **port 9374** (9222/9373 untouched). Chrome was genuinely logged out — **`storedSbKeys: []`** in every capture.

### Capture A — `https://business.usemingla.com/` (home, logged out) — verbatim

```
storedSbKeys: []
recorder installed: YES

--- AUTH STATE TRANSITIONS (ms from document start) ---
     1ms | fiber=NONE |
   604ms | ready=false status=signed_out loading=false user=false |
   916ms | ready=false status=signed_out loading=false user=false | List experiences, reach guests, and grow — simply. Continue

--- CONSOLE (ms from document start) ---
   353ms | warn | [sentry] EXPO_PUBLIC_SENTRY_DSN absent in a production bundle — crash reporting is OFF
   920ms | warn | Animated: `useNativeDriver` is not supported …
  7542ms | warn | [auth] resolution-hard-ceiling: auth did not resolve within 7000ms — releasing the loading gate …

--- AUTH/NETWORK CALLS ---
   534ms ->    906ms (372ms) 200 GET https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/stripe-mode
```

### Capture B — `/accept-brand-invitation?token=ORCH1377PROBETOKEN` (logged out) — verbatim

```
storedSbKeys: []
--- AUTH STATE TRANSITIONS ---
     0ms | fiber=NONE |
   584ms | ready=false status=signed_out loading=false user=false |
   885ms | ready=false status=signed_out loading=false user=false | Accepting your invitation…
--- CONSOLE ---
  7505ms | warn | [auth] resolution-hard-ceiling: auth did not resolve within 7000ms …
--- AUTH/NETWORK CALLS ---
   495ms ->    815ms (320ms) 200 GET …/functions/v1/stripe-mode
```

### The timeline, consolidated (n=4)

| Milestone | Home (A) | Home (rerun) | Accept (B) | What it means |
|---|---|---|---|---|
| First readable `AuthContext` | 604 ms | 578 ms | 584 ms | **`loading` is ALREADY `false`.** Auth resolved before this. |
| `authStatus` settles | `signed_out` **at first sample** | same | same | Never observed in `bootstrapping` even at 20 ms sampling. |
| **User sees something actionable** | **916 ms** ("Continue") | **920 ms** | 885 ms (spinner — ORCH-1373's bug, not auth's) | **Time-to-actionable ≈ 0.9 s.** |
| `[auth] resolution-hard-ceiling` | 7542 ms | 7510 ms | 7505 ms | **6.6 s AFTER the user could already act.** |
| **State changes after 7000 ms** | **0** | **0** | **0** | **The ceiling has zero observable effect.** |
| `/auth/v1/*` network calls | **0** | **0** | **0** | Nothing network-gated auth. |

**Answering the dispatch's question directly — "why would `getSession()` on a browser with `storedSbKeys: []` take longer than milliseconds?"** — **It doesn't.** With no stored session it makes **zero network calls** (0 `/auth/v1/*` requests in 4/4 captures) and is a purely local read. The ~580 ms before auth is first *observable* is **JavaScript bundle parse + React mount**, not auth work. **Auth is not on the critical path at all.** The only boot network call is `stripe-mode` (320-372 ms), which does not gate auth and completes before paint.

**The ceiling's arrival time is itself the proof of unconditionality:** 7505 / 7510 / 7542 / 7666 ms ≈ **AuthProvider mount (~510-660 ms) + exactly 7000 ms**. That is a fixed timer armed at mount, firing on schedule — not a measurement of anything.

---

## 4. Findings (six-field evidence)

### F-1 — The `[auth] resolution-hard-ceiling` log is a FALSE ALARM: the timer is unconditional — **CONFIRMED ROOT CAUSE** (of the *reported symptom*, which is the log itself)

1. **Symptom** — `[auth] resolution-hard-ceiling: auth did not resolve within 7000ms` on every business-web load, including loads where auth demonstrably resolved in <0.6 s. The message asserts a stall that did not happen.
2. **Layer** — code + runtime.
3. **Probe** — `node /tmp/orch-1377/timeline.mjs 144 "https://business.usemingla.com/" home-loggedout-v2 12000`
4. **Evidence** — `AuthContext.tsx:297-308`, verbatim. **The callback contains no `loading` guard:**
   ```js
   const hardCeilingTimer = setTimeout(() => {
     if (!mounted) return;                                   // ← the ONLY guard
     console.warn(
       `[auth] resolution-hard-ceiling: auth did not resolve within ${AUTH_RESOLUTION_HARD_CEILING_MS}ms — releasing the loading gate (treating as logged-out so the user lands on sign-in, never an infinite spinner)`,
     );
     bootstrapTimedOutRef.current = true;                    // ← REAL side effect (F-3)
     setLoading(false);                                      // ← no-op when already false
   }, AUTH_RESOLUTION_HARD_CEILING_MS);
   ```
   Runtime, capture A: `loading=false` at **604 ms**; log at **7542 ms**; **0** state changes after 7000 ms. 4/4 captures identical.
5. **Mechanism** — the timer is armed unconditionally at AuthProvider mount and never cancelled on successful resolution (cleanup at `:786-792` clears it only on **unmount**). `setLoading(false)` is idempotent, so on the overwhelmingly common path where auth already resolved, the callback's only effects are (a) a false log and (b) F-3's ref write. The log is emitted **because 7 s elapsed**, not because anything failed.
6. **Severity** — **CONFIRMED ROOT CAUSE** of the reported symptom. But the symptom is **a lying log line, not a stall** — user impact from the log alone is **zero**.

### F-2 — No genuine stall exists; time-to-actionable is ~0.9 s — **RULED OUT** (the stall)

1. **Symptom** — C-4 alleged "every business-web cold load costs ~7 s of auth limbo."
2. **Layer** — runtime.
3. **Probe** — as F-1, plus `/accept-brand-invitation`, n=4.
4. **Evidence** — actionable paint at **916 / 920 ms**; `loading=false` at first readable sample (**578-604 ms**); **0** `/auth/v1/*` calls; **0** post-7000 ms state changes; neither conditional ceiling (#2) ever logged (`0/4` for `auth-resolution-deadline` and `boot-loading-deadline`).
5. **Mechanism** — for a logged-out browser `readStoredWebSession()` → `null` → `getSession()` is a local read with no network → `setLoading(false)` at `AuthContext.tsx:386` (the ORCH-1294 boot-paint-decouple release) → `deriveBusinessAuthStatus` → `signed_out`, all before first paint. The ORCH-1100 GoTrue lock, the ORCH-0887-A 3 s race, and the ORCH-1106 `GET /auth/v1/user` boot probe are **all inert on this path**: the probe lives only inside `if (bootUser)` (`:388`), and there is no `bootUser`.
6. **Severity** — **RULED OUT.** The candidate paths named in the dispatch are traced and excluded by runtime evidence.

### F-3 — The ceiling arms `bootstrapTimedOutRef` on EVERY load, corrupting its meaning — **SUSPECTED CONTRIBUTOR (latent). NEW — not in C-4.**

1. **Symptom** — none observed. Latent.
2. **Layer** — code (source-reasoned; **not** runtime-reproduced — see confidence).
3. **Probe** — source trace `AuthContext.tsx:306` → `:540-571`. I did **not** reproduce this: it needs a session to die while a tab sits open >7 s, which I could not stage without real credentials and a production session-revocation (a prod write — refused).
4. **Evidence** — `AuthContext.tsx:306` sets `bootstrapTimedOutRef.current = true` unconditionally at 7 s. Its reader (`:540-552`):
   ```js
   if (bootstrapTimedOutRef.current) {
     const isPassiveLateEcho = _event === "INITIAL_SESSION" || _event === "TOKEN_REFRESHED" || _event === "USER_UPDATED";
     if (isPassiveLateEcho) {
       if (!hasUsableBusinessSession(s)) {
         …
         return;              // ← skips setSession/setUser (:580-581) AND setLoading(false) (:783)
       }
   ```
5. **Mechanism** — the ref's name and contract mean *"bootstrap timed out"*, and its reader uses it to discard **stale echoes of a failed bootstrap**. But the unconditional ceiling sets it `true` **7 s after every load, including bootstraps that succeeded in 600 ms**. For any user sitting on the page >7 s (i.e. everyone), a subsequent passive `TOKEN_REFRESHED` / `USER_UPDATED` / `INITIAL_SESSION` carrying an **unusable** session is silently dropped instead of clearing `session`/`user` — the app would keep rendering an authed shell under a dead token. **Narrow exposure:** supabase-js fires `SIGNED_OUT` for most revocations, which is *not* a passive echo and correctly clears the ref (`:566-570`). The gap is specifically a passive event delivering a null/unusable session.
6. **Severity** — **SUSPECTED CONTRIBUTOR**, latent. Capped at *suspected* per Prime Directive 7 — source-only, deliberately not overclaimed. **This is the one genuinely defective behavior behind the log**, and it is a correctness bug, not a performance one. **Blast radius includes native:** ORCH-1292 de-gated the ceiling from web-only to native too (`:283-294`), so business iOS/Android arm this ref 7 s after every cold start as well.

### F-4 — C-4(b) is causally INACCURATE: `signed_out` arrives independently of the ceiling — **RULED OUT** (dispatch item 4)

1. **Symptom** — C-4(b) claimed the ceiling's *"never an infinite spinner"* purpose is **inverted** on the invite route because *"the `signed_out` verdict it force-releases is exactly what pins `isAuthReady=false`."*
2. **Layer** — runtime + code.
3. **Probe** — `node /tmp/orch-1377/timeline.mjs 144 "https://business.usemingla.com/accept-brand-invitation?token=ORCH1377PROBETOKEN" accept-loggedout 12000`
4. **Evidence** — capture B: `authStatus=signed_out` at **584 ms**; spinner painted at **885 ms**; ceiling log at **7505 ms**; **0** state changes after 7000 ms.
5. **Mechanism** — the ceiling does **not** "force-release" `signed_out`. `signed_out` is produced **6.9 s earlier** by the normal bootstrap path: `getSession()` → `null` → `setLoading(false)` at `:386` → `deriveBusinessAuthStatus({loading:false, session:null, user:null})` → `"signed_out"` (`authReadiness.ts:105`). The ceiling's `setLoading(false)` is a **no-op on an already-false flag**. **Delete the ceiling entirely and the ORCH-1373 spinner is bit-for-bit unchanged.**
6. **Severity** — **RULED OUT.** The ceiling is a **non-actor** in ORCH-1373. C-4(b)'s "the safety net manufactures the symptom it was built to prevent" is a compelling narrative that the runtime does not support.

> **Consequence for ORCH-1373 (this is the load-bearing part for the conductor):** its fix **must not fight, preserve-around, or reason about this mechanism** — the mechanism is not involved. ORCH-1373's *verdict* is untouched and remains correct (its §4 Arm A/Arm B contrast and its exhaustive dead-code proof stand on their own); only the C-4 *explanation* in its §1 nuance paragraph and §8 C-4 is wrong. ORCH-1373's §1 hedge — *"the verdict is unchanged either way"* — is precisely right, and this investigation confirms which way it is.

---

## 5. Five-Truth-Layer reconciliation

| Layer | Finding | Contradiction |
|---|---|---|
| **Docs** | `AuthContext.tsx:88-104` describes ceiling #1 as a *"LAST-RESORT backstop"* that fires *"if bootstrap has not resolved by the ceiling"* and is *"deliberately well ABOVE the normal warm path … so it is a true LAST-RESORT backstop."* | **CONTRADICTED BY CODE + RUNTIME.** It is not last-resort and not conditional: it fires on **100%** of loads (4/4), overwhelmingly on loads that resolved in <1 s. The comment describes an intent the code does not implement. |
| **Schema** | N/A — no DB involvement. | — |
| **Code** | `AuthContext.tsx:297-308` — `setTimeout` with `if (!mounted) return;` and **no `loading` guard**. | **The defect.** A guard as small as `if (!loading) return;` is the entire delta between the comment and the code. (Naming only — **not a fix**; SPEC owns the decision.) |
| **Runtime** | 4/4: `loading=false` by ~0.6 s; actionable ~0.9 s; ceiling logs ~7.5 s; **0** post-ceiling state changes; **0** `/auth/v1/*` calls; **0** fires of conditional ceiling #2. | Agrees with Code; **contradicts Docs**; **refutes C-4**. |
| **Data** | N/A — read-only; no DB probe needed (no DB in this path). | — |

**Truth holder:** Runtime, corroborated by Code. The Docs layer (the ceiling's own comment block) is the source of the misunderstanding — **it is what ORCH-1373 believed, and it is wrong.** A future reader of that comment will make the same mistake.

---

## 6. Blast radius

| Surface | Affected? | Detail |
|---|---|---|
| **Business Web** (all routes) | **YES — the log, 100% of loads** | Ceiling #1 fires ~7.5 s after every load with the tab open. **User-visible impact: NONE** (0 state changes). Impact is on **console noise + engineering trust**. |
| **Business iOS / Android (native)** | **YES — F-3 only** | ORCH-1292 de-gated the ceiling to native (`:283-294`), so `bootstrapTimedOutRef` is armed 7 s after every native cold start too. **Not runtime-verified on native** (out of scope). |
| **Consumer iOS / Android** | **NO** | Separate `AuthContext`; this ceiling is `mingla-business`-only. |
| **Admin Web** | **NO** | Not in this path. |
| **Buyer/anonymous Web** | **YES — log only** | Same root layout; same cosmetic log; no functional impact. |

**Severity assessment — honest.** The *performance* claim (C-4(a)) is **refuted**: there is no user-facing cost. What is real:
1. **A production log line that asserts a falsehood on 100% of loads.** Its measurable cost is already demonstrated: **it manufactured this ORCH.** A `console.warn` that lies is an active forensics hazard — it burned an investigation cycle and injected a false "7 s stall" into ORCH-1373's report, the World Map, and issue #888. It will do so again.
2. **F-3's latent ref corruption** — narrow, unproven, but a genuine correctness smell.
3. If Sentry is ever enabled on business web (note capture A: `EXPO_PUBLIC_SENTRY_DSN absent` — **G3 Sentry is done per memory but this bundle has no DSN**, a separate discrepancy), this warn would become a breadcrumb on 100% of sessions.

**Suggested severity: S3** (was suggested S2 in C-4 on the strength of the now-refuted 7 s claim). Not a launch blocker. **Recommend de-prioritizing relative to ORCH-1373.**

---

## 7. Consequences for ORCH-1373 (read before its SPEC)

1. **C-4 must be corrected in the ORCH-1373 record.** Both (a) and (b) are refuted. ORCH-1373's §1 nuance paragraph — *"On business web the auth bootstrap **never resolves natively** and is force-released by the 7000 ms hard ceiling"* — is **false**. Auth resolves natively in <0.6 s. Its final verdict is unaffected.
2. **The ceiling is a non-actor.** Do not design around it. Do not "avoid arming" it. It cannot be armed or disarmed by anything the accept route does.
3. **C-3's trap is narrower than feared** — `_layout.tsx:737` is driven by conditional ceiling **#2**, which requires `stillResolving` (`isWebAuthResolving` → needs `loading` or `hasStoredWebSession`). A logged-out invitee satisfies neither, so it cannot arm today. **But C-3's warning survives**: a fix that gives the accept route a *stored session* or holds `loading` true **would** arm #2 and bounce to `/`, destroying the URL token. The trap is real; only its trigger is different.
4. **C-6 gains support.** The 10×150 ms `getSession()` retry loop is even less justified than C-6 argued: `getSession()` costs ~0 ms with no network on this path.

---

## 8. Discoveries for Orchestrator (NEW collateral — flagged separately per dispatch)

### N-1 — `bootstrapTimedOutRef` armed on every load (F-3) — **suggested S3, folds into this ORCH's fix**
See F-3. Same root line (`:306`), so any fix touching the ceiling should resolve both. Latent, source-only, **suspected**. Includes native.

### N-2 — `EXPO_PUBLIC_SENTRY_DSN` absent in the production business-web bundle — **suggested S2, NEW, unrelated to auth**
```
353ms | warn | [sentry] EXPO_PUBLIC_SENTRY_DSN absent in a production bundle — crash reporting is OFF
```
4/4 captures on **production** `business.usemingla.com`. **Business web is shipping with crash reporting OFF.** Memory records G3 Sentry as *done* (`project_g3_g4_sentry_dr_gates.md`) — a live contradiction between the tracker and the deployed bundle. Likely an EXPO_PUBLIC inlining/env gap at web build time (`reference_expo_public_env_inlining_gotchas.md` is prior art). **Not investigated further — out of scope.** Recommend its own ORCH.

### N-3 — ORCH-1373's C-5 (`subscribeOneLinkDeepLink is not a function`) did NOT reproduce
Not present in any of my 4 captures (ORCH-1373 saw it 2/2). Possibly route-dependent, load-order-dependent, or already changed. **Not a refutation** — my recorder patched `console` but page-level uncaught rejections surface via `Runtime.exceptionThrown`, which this harness recorded to a different channel than ORCH-1373's. **Flagged as "unconfirmed on re-observation"; C-5 should be re-verified before anyone builds on it.**

### N-4 — Three 7000 ms constants with confusable names (the structural cause of this ORCH)
`AUTH_RESOLUTION_HARD_CEILING_MS` / `AUTH_RESOLUTION_CEILING_MS` / `BRAND_RESOLVE_AUTH_CEILING_MS` — same value, adjacent concepts, two of them emitting similar-sounding "no infinite spinner" logs from different layers. **This naming collision is what made ORCH-1373's misattribution the natural reading.** Worth a naming/consolidation pass. Documentation/ergonomics, not behavior.

---

## 9. Guard compliance

- **NO git operations.** No `commit`/`add`/`rebase`/`checkout`/`stash`. Shared worktree with ORCH-1378 respected; only this one report file written.
- **No product code modified.** All measurement was CDP-side instrumentation of the **unmodified production bundle** — nothing to reap.
- **No production DB writes.** No DB access needed (no DB in this path). Zero SQL run.
- **CDP port 9374 only.** 9222 / 9373 untouched. No global `pkill`. `adb forward tcp:9374` added.
- **Device left clean.** Read-only; no localStorage mutation, no synthetic session planted (unlike ORCH-1373 Arm B, this investigation needed none). `storedSbKeys: []` before and after.
- **No fix proposed or written.** INVESTIGATE only — §10 is direction, not a spec.

---

## 10. Fix direction (direction only — NOT a spec, NOT code)

1. **Decide what the ceiling is FOR, then make the code say it.** The comment block (`:88-104`) describes a conditional last-resort backstop; the code implements an unconditional timer. Reconcile them in **one** direction. The backstop's *purpose* — protecting against a GoTrue lock deadlock holding `loading` true — is legitimate and should not be discarded on the strength of this finding; what must change is that it announces and mutates state when that deadlock **did not happen**.
2. **F-3 is the real defect; the log is the loud one.** Any change must stop `bootstrapTimedOutRef` being armed on successful bootstraps. Fixing only the log while leaving the ref write would fix the *symptom that has no impact* and leave the *impact that has no symptom*.
3. **Do not simply raise the ceiling.** It would still fire, just later — the falsehood is unconditionality, not the number.
4. **Cover native** — the ceiling is armed on native since ORCH-1292; do not regress the iPad hang that de-gating fixed.
5. **Regression contract (CLOSE HARD MUST).** The natural guard is a unit test over the real `AuthContext` boot: with `getSession()` resolving immediately to `{session: null}`, assert the hard-ceiling log is **NOT** emitted and `bootstrapTimedOutRef`'s observable effect (dropping a passive null-session event) does **NOT** occur after the ceiling elapses under fake timers. `AuthContext.timeout.test.ts` and `AuthContext.authLockDeadlock.orch1254.test.ts` already exist and are the right home. It **fails on revert** by construction: restoring the unguarded `setTimeout` re-emits the log.
6. **Consider N-4** (naming) in the same pass — cheap, and it is the structural reason this cost two investigations.

---

## 11. Confidence

**PROVEN** for F-1, F-2, F-4 (the contradiction verdict, the ~0.9 s real number, and the C-4(b) refutation): live repro on the reserved physical device against production, n=4, instrumented from document-start, with the decisive negative controls all captured (0 post-ceiling state changes, 0 `/auth/v1/*` calls, 0 fires of conditional ceiling #2). The unconditionality is additionally proven by construction from the verbatim source and corroborated by the ceiling's arrival time (mount + exactly 7000 ms).

**SUSPECTED** for F-3 (`bootstrapTimedOutRef` corruption) — source-only. Capped honestly per Prime Directive 7.

**Known limits, stated plainly:**
- **Only the logged-out / no-stored-session arm was measured.** This is the exact population C-4 made its claim about (*"for a logged-out user with no stored session, where `getSession()` should return `null` in milliseconds"*), so the refutation is on-target. But a **signed-in** cold boot could plausibly behave differently (it runs the `GET /auth/v1/user` probe, `ensureCreatorAccount`, and can contend the GoTrue lock). **I did not measure it** — real OAuth needs Seth's credentials, and I declined to plant a synthetic session because it would have invalidated the very latency measurement I was making. **If anyone wants "is business web fast for a signed-in user?", that is an unanswered question and a separate dispatch.** Note ORCH-1294 exists specifically to decouple paint from that chain.
- **Native not verified** (F-3's native blast radius is source-reasoned).
- **N-3:** ORCH-1373's C-5 did not re-observe; treat C-5 as unconfirmed.

---

## 12. Next phase

**Orchestrator triage, not SPEC-yet.** This ORCH shrank: no stall, no performance defect, ~0.9 s real cold load. What remains (a lying log + latent F-3) is **suggested S3** and should be re-prioritized below ORCH-1373. **Correct C-4 in the ORCH-1373 record before its SPEC is written** — that is the urgent action here, so the SPEC does not design around a mechanism that is not involved. **N-2 (Sentry OFF in production business web) is the highest-value discovery in this investigation** and deserves its own ORCH on the NOW horizon — it is unrelated to auth and materially more serious than the thing I was sent to investigate.
