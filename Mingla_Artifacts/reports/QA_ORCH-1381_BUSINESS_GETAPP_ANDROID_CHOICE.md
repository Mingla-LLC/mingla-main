# QA — ORCH-1381 [business-getapp-android-choice]

> **⚠ THIS PASS-1 SECTION IS SUPERSEDED IN PART. The current verdict is in [RETEST 1](#retest-1--after-the-addendum-rework-d-a--d-a-2--d-b) at the bottom of this file.**
> Pass-1 findings **P2-1** (pill overflow) and **P2-2** (double-navigation) are **RESOLVED and PROVEN** by the addendum rework — do not act on them. **P1-1** (PostHog dark) and **P2-3** (consent banner) still stand.
> Retest verdict: **CONDITIONAL PASS** — P0: 0 · P1: 1 (carried, deferral documented) · P2: 2 · P3: 1 · P4: 3.

---

## PASS 1 (original) — superseded in part; see RETEST 1

**Mode:** TARGETED + SPEC-COMPLIANCE (mingla-tester). Independent verification. Nothing in the implementation report was accepted; every claim was re-derived.
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1381-[business-getapp-android-choice]` on branch `ORCH-1381-business-getapp-android-choice`
**Commits under test:** `e6dbe68f6` → `bceab9883` (5 impl commits) + `382c83042` (this tester's adversarial test)
**Ledger:** COMMS-0101 (WARN, OPEN) ingested — its API-verified launch state was independently re-confirmed (business Play HTTP 200; business App Store 301→listing).
**Date:** 2026-07-15

---

## 1. Verdict

> ## CONDITIONAL PASS — conditions NOT yet accepted by Seth
> **P0: 0 · P1: 1 · P2: 3 · P3: 1 · P4: 3**
>
> Per the skill's routing rule, a CONDITIONAL PASS whose conditions are not already accepted in the dispatch **does NOT route to CLOSE** — it stops here and is surfaced to Seth.

**The user-facing fix is real and is PROVEN on a real Android OS.** All four business get-app surfaces render the inline two-action choice, and on a real Android device a real touch event on "Download the app" opens the **real Google Play Store app** on the **correct business listing** ("Mingla: Host, Sell & Grow", Mingla Development Team, package `com.sethogieva.minglabusiness`). The most damaging possible bug — a business surface shipping owners the consumer Explorer app — **does not exist**: the consumer package appears **zero** times in the rendered HTML.

**The blocking condition is SC-7 (analytics).** The `action` discriminator is correctly wired *in the shipped production bundle*, but I could not obtain runtime proof, **and I verified that PostHog is entirely DARK on the production marketing site** — `usemingla.com` ships posthog-js but **no `phc_` key**, so `initPostHog()` no-ops and `get_the_app_clicked` can never fire in production. This is a **pre-existing Vercel env gap** (same class as ORCH-1379 / the business-web Sentry gap), not a defect in ORCH-1381's code — but it means the ORCH's stated rationale ("without `action` the fix is unmeasurable") is **not achieved on ship**. That is Seth's decision, not the implementor's rework.

---

## 2. SC-by-SC matrix

Evidence grade: **PROVEN** = live-fire on a real Android OS · **VERIFIED** = live HTTP/render against the branch build · **BUNDLE** = present in the compiled production artifact · **SUSPECTED** = source-only (never sufficient for PASS).

| SC | Verdict | Grade | Evidence |
|---|---|---|---|
| **SC-1-Android-Nav** | **PASS** | PROVEN | Real Android 15 (arm64), real `input tap` on the nav pill → `topResumedActivity=com.android.vending/…finsky.MainActivity`; listing title read from the UI hierarchy = `Mingla: Host, Sell & Grow` / `Mingla Development Team`. |
| **SC-1-Android-Hero** | **PASS** | PROVEN | Real tap at hero button bounds `[309,487][1035,658]` → Play Store, same business listing. |
| **SC-1-Android-Links** | **PASS** | PROVEN | `/links` → Business tab → real tap → Play Store, same business listing. Both CTAs share `y=1960` → genuinely side-by-side. |
| **SC-1-Android-Download** | **PASS** | PROVEN + VERIFIED | Android UA vs branch build → **HTTP 200 HTML** (not 307), anchors = business Play + `https://business.usemingla.com`. On-device tap → Play Store; Finsky log: `GMS-INS: Metadata response for package:com.sethogieva.minglabusiness`. |
| **SC-2-iOS-Download** | **PASS** | VERIFIED | iPhone UA → **200 HTML** with `<a href="https://apps.apple.com/app/id6768737367">` + web anchor. **No 307** — the auto-redirect is genuinely gone. |
| **SC-2-iOS-{Nav,Hero,Links}** | **PASS (capped)** | BUNDLE + VERIFIED | iOS-UA render + compiled handler. **Not exercised on a physical iPhone** — see §7 cap. |
| **SC-3-Web-Action** | **PASS** | PROVEN | Real Android tap on "Use on web" → Chrome URL bar reads `business.usemingla.com`. |
| **SC-4-Desktop** | **PASS** | VERIFIED | Mac/Googlebot/empty-UA/iPad UAs → 200, **exactly one** anchor (`business.usemingla.com`), `desktopNote`, `Download the app` label count **0**. No 500, no crash (§16 #10). |
| **SC-5-Note** | **PASS** | PROVEN | Rendered byte-exact from `BUSINESS_APP_CHOICE_COPY`; read off the real device screen. Phone → `moreNote`; desktop/bot → `desktopNote`. |
| **SC-6-Links-NoScroll** | **PASS** | VERIFIED | 375×667: `scrollHeight === clientHeight === 667` (no scroll); all **7** socials visible (`lastBottom=597 ≤ 667`); both CTAs share `top:394` (one row); note present. Also holds at 360×640, 390×844, 412×915. **See P2-1** for a 360px-width overflow. |
| **SC-7-Analytics** | **FAIL (not proven; prod dark)** | BUNDLE only | Payloads present in the compiled chunk: `action:"download"`, `action:"use_web"`, `surface:"organiser"`, `store:"business_web"`, `location:"nav"`/`"hero"`. **No runtime proof obtained** (harness limitation, §7) **and prod ships no `phc_` key** → cannot fire in production. **P1-1.** |
| **SC-8-Email-Href** | **PASS** | VERIFIED | `<a href="https://usemingla.com/business/download"` byte-exact; `business/download?` absent. 26/26 Deno tests green. |
| **SC-9-Email-Copy** | **PASS** | VERIFIED | Both HTML variants name "iPhone or Android"; the falsehood survives **only** in an explanatory code comment (`:278`), never in output. Plaintext variants were always platform-neutral → never carried the claim. |
| **SC-10-No-OneLink** | **PASS** | VERIFIED | Zero `minglabiz.onelink.me` / `go.usemingla.com` **usages**; only comments + negative test assertions. |
| **SC-11-SSOT** | **PASS** | VERIFIED | No `apps.apple.com` / `play.google.com` literal outside `lib/store-links.ts` (test files excepted, asserting). |
| **SC-12-Consumer-Untouched** | **PASS** | VERIFIED | `git diff origin/main...HEAD --stat` is **empty** for `app-mobile/`, `mingla-business/`, `mingla-admin/`, `lib/device-platform.ts`, `app/download/`. Consumer `/download` still 307s device-aware (Android→`com.mingla.app.v2`, iOS→`id6760440898`). |
| **SC-13-Popup-Fallback** | **PASS (with P2-2)** | PROVEN | No dead tap on any action. But the fallback **always** fires — see **P2-2**. |

---

## 3. Findings

### P1-1 — PostHog is DARK in production: `get_the_app_clicked` can never fire, so ORCH-1381 ships unmeasurable
- **Evidence.** `curl https://usemingla.com/business` + a scan of all 14 first-party chunks: **zero** `phc_` matches, while posthog-js code *is* present in 4 chunks. `posthog-provider.tsx:60-65` — `const key = process.env.NEXT_PUBLIC_POSTHOG_KEY; if (!key) return` (graceful no-op). A Playwright run against prod produced **zero** PostHog requests of any kind (vs. 4 asset GETs against a locally-keyed build) — PostHog never initialises in production.
- **Impact.** The `action` prop is the entire measurability rationale in SPEC §6.3 U-5: *"without it an Android owner who **chooses** web is indistinguishable from today's forced-web, and the fix becomes unmeasurable."* Shipped as-is, Seth cannot tell whether Android owners want the app — the question ORCH-1381 exists to answer. Also silently affects the pre-existing ORCH-1319/1328 events.
- **Not caused by ORCH-1381.** Pre-existing env gap, outside the SPEC §15 allowlist (Vercel env, not code). Same class as the ORCH-1379 business-web Sentry gap.
- **Required fix.** Set `NEXT_PUBLIC_POSTHOG_KEY` (+ `NEXT_PUBLIC_POSTHOG_HOST`) in the Vercel env for `mingla-marketing` and redeploy. **Not implementor rework** — an operator/orchestrator action, and arguably its own ORCH.
- **Retest.** After the env is set + deployed: accept the cookie banner on `usemingla.com/business` from an Android phone, tap each action, confirm PostHog receives `get_the_app_clicked` with `action:'download'` and `action:'use_web'` + `surface:'organiser'`.

### P2-1 — "Use on web" label overflows its pill at 360px width (very common Android)
- **Evidence.** At **360×800** and **360×740** (Galaxy A-series / S8 class — among the most common Android CSS widths): `"Use on web"` measures `clientHeight=54` but `scrollHeight=63` → **9px vertical overflow**; `overflow: visible` so the text visibly spills past the pill's rounded edge (screenshot `/tmp/orch-1381/clip-360x640.png` — the label wraps to three lines, "Use" above the pill and "web" below it). The same label wraps to two lines inside the **nav** pills on the real Pixel device.
- **Impact.** Cosmetic only — **not** a dead tap; the button works and the page still does not scroll (SC-6 holds). But it looks broken on an Android-facing fix, on the very platform this ORCH exists for.
- **Required fix.** Allow the pill to grow (drop the fixed `h-14` for a `min-h` + vertical padding), or `whitespace-nowrap` with a smaller `text-sm` at `<375px`, or shorten the label. Implementor's call — copy is pinned to `BUSINESS_APP_CHOICE_COPY`, so prefer the layout fix over changing the constant.
- **Retest.** 360×800, Business tab: `scrollHeight === clientHeight` on both buttons.

### P2-2 — `window.open(…, 'noopener')` returns `null` **on success**, so the "popup-blocked" fallback ALWAYS fires → double navigation
- **Evidence.** Measured in-browser: `window.open(url,'_blank','noopener,noreferrer')` → **`null`**; `window.open(url,'_blank')` → `a Window`. This is per the HTML spec (noopener ⇒ null return). The code in all 3 client surfaces is `const win = window.open(dest,'_blank','noopener,noreferrer'); if (!win) window.location.assign(dest)` → the `assign` branch is unconditional in practice. Observed live: one CTA click produced **two** `GET play.google.com/…minglabusiness` requests — a popup **and** the main page navigating; `page.url()` ended on the store.
- **Impact.** The owner gets two tabs both on the store and **loses the marketing page**. It directly contradicts ORCH-1328's own stated contract (`links-experience.tsx:48-49`: *"opens the store / web app directly, **so /links stays mounted**"*) — /links does **not** stay mounted.
- **PRE-EXISTING, not a 1381 regression.** Verified on `origin/main`: identical pattern at `glass-nav.tsx:58-59` (ORCH-1319) and `links-experience.tsx:165-166` (ORCH-1328). ORCH-1381 **replicated** it into two new helpers (`openBusinessDest`, `openDest`). `/business/download` is **immune** (plain `<a>`, no JS) — confirmed: 0 popups, single navigation.
- **Required fix.** Out of scope here (touches the ORCH-1319/1328 explorer path). → **Discovery D-T2**, own ORCH. If addressed: drop `noopener` from the feature string and use `rel`-equivalent hardening, or test `win === null` only after a `try`/feature-detect.
- **Retest.** Click any client CTA: exactly ONE navigation; the origin page survives.

### P2-3 — `/links` cookie banner overlays the business CTAs + note on first visit at 375×667
- **Evidence.** `/tmp/orch-1381/links-375x667-android.png` (pre-consent): the consent card covers the lower half — the note and socials row are hidden and "Download the app" is partially occluded. After Accept/Reject the layout is correct (`clip-375x667.png`).
- **Impact.** Minor/transient, consent-gated first visit only; pre-existing banner behaviour, not introduced here. SC-6 is specified post-consent and passes.
- **Required fix.** None demanded. Noted so it is not mistaken for a clipping regression.

### P3-1 — `mingla-marketing` has a `lint` script that cannot run (challenges implementor N-6)
- **Evidence.** N-6 claims "no lint setup". Re-derived: `package.json` **does** declare `"lint": "next lint"` and devDeps `eslint@^9.17.0` + `eslint-config-next@^15.1.6` — but there is **no** ESLint config file. Running `npm run lint` prints `next lint is deprecated…` and drops into an **interactive prompt** ("How would you like to configure ESLint?") — it would hang, not fail, in CI.
- **Verdict on N-6:** **substantively correct** (no runnable lint path exists) but **imprecisely stated** — a script and deps do exist; they are unconfigured. No lint gate was bypassed. Typecheck (`tsc --noEmit`) is the real gate and is **clean**, including with my added test.

### P4-1 — N-1 challenged and CONFIRMED: the SPEC's own gate-E G-b regex was genuinely decorative
- I executed the SPEC §10-E regexes against the **real multi-line revert shape**: `/'android'[^\n]*BUSINESS_WEB_URL/` → **false**; `/BUSINESS_WEB_URL[^\n]*'android'/` → **false**. The spec's guard **cannot fire** on the real code shape — it would have passed the very revert it claimed to catch. The implementor's structural replacement (reading the android branch's own `installHref:` and pinning it to `BUSINESS_PLAY_STORE_URL`) **does** fire. Correct judgement, correctly documented at `orch-1381-…mjs:39-52`, and pinned by self-test cases 4/4b. Good work.

### P4-2 — the copy is code-true (§16 #11 audit passed)
Re-derived independently: `scanTicket` has exactly **one** call site (`mingla-business/app/event/[id]/scanner/index.tsx:363`); the web twin imports it **zero** times. Copy says *"scan tickets"* (true) not *"check guests in"* (would be false — manual check-in exists on web, D-9). "Everything else works on the web too" correctly avoids app-superiority (Stripe Connect payouts is web-only, D-8). No invented claims.

### P4-3 — the new gate is load-bearing, independently confirmed
Gate E exits **1** on the real revert and **0** restored; all 5 gates green live + `--self-test`; registered in `strict-grep-mingla-business.yml:3427` (self-test step + live step) with the invariant docblock at `:179`.

---

## 4. Step 0.5 — independent re-run of the implementor's fails-on-revert proof

Re-run **by me**, not trusted from the report.

| Step | Commit | Action | Result |
|---|---|---|---|
| A | `bceab9883` (HEAD) | T-1 suite | **7/7 PASS**, exit 0 |
| B | `bceab9883` + true line-deletion revert of the android branch (`installHref: BUSINESS_WEB_URL`, `installStore: null`) | T-1 suite | **FAIL, exit 1** |
| C | same revert | gate E | **exit 1** — fires |
| C2 | same revert | gates 1324/1326/1328/1342 | exit 0 each (correct — only gate E owns this invariant) |
| D | `git checkout --` restore | diff vs pre-revert backup | **byte-identical**; T-1 **7/7 PASS**; all 5 gates exit 0 |

**Exact failing assertion on revert (B):**
```
FAIL  T-1: android resolves to the LIVE business Play listing — NEVER the web app:
  android installHref is "https://business.usemingla.com",
  expected the business Play listing "https://play.google.com/store/apps/details?id=com.sethogieva.minglabusiness"
FAIL  T-5: ... android resolves to a Play URL that is not the business package
2 test(s) failed
```
**Gate E failure text on revert (C):**
```
mingla-marketing/lib/business-app-target.ts: the 'android' branch resolves installHref to
BUSINESS_WEB_URL — it MUST be BUSINESS_PLAY_STORE_URL. ... (G-b).
```
**Conclusion:** the implementor's fails-on-revert claim is **TRUE and reproducible**. T-1 imports the real `resolveBusinessAppTarget` (not a source grep), so it exercises the real path.

---

## 5. Adversarial test added (tester-owned)

- **Path:** `mingla-marketing/lib/__tests__/business-app-target.tester.test.ts`
- **Commit:** `382c83042` (on the ORCH branch; append-only — a NEW file, no existing test modified)
- **In the closing diff:** yes — both `business-app-target.test.ts` (implementor) and `business-app-target.tester.test.ts` (tester) appear in `git diff origin/main...HEAD --name-only`.
- **Different angle from T-1** (T-1 pins one literal on the happy path; this treats the helper as a **state machine** and asserts invariants over **every** input):
  - **A-1 fake-choice invariant** — an install action must never share a destination with the web action. Catches *any* collapse, including future ones T-1 never enumerated (e.g. an iOS→web "simplification"), not just the one known literal.
  - **A-2 state coherence** — `canInstall` / `installHref` / `installStore` can never disagree; an install href must be an absolute `https` URL (the dead-install-button guard, Constitution #1 — every surface branches on `canInstall` then dereferences `installHref`).
  - **A-3 fail-closed on malformed input** — 16 hostile inputs (`'ANDROID'`, `'Android'`, `' android'`, `''`, `null`, `undefined`, `0`, `{}`, `[]`, `'Googlebot'`…) must degrade to **web-only**, never manufacture a wrong install target. The helper is fed by `resolvePlatformFromUa()` — a **raw request header** — so the TS union is a promise the runtime does not keep.
  - **A-4 no cross-app contamination** — compares against the **consumer constants by identity**, so it still fires if someone repoints `BUSINESS_PLAY_STORE_URL` at the consumer listing (T-5 only greps the package substring).
  - **A-5 purity** — call order cannot poison a later answer; the returned object is not a shared singleton (a Server Component module instance serves concurrent requests).
- **fails-on-revert verified at `bceab9883`:** reverting the android branch fires **three independent angles** — A-1 (`FAKE CHOICE — android: "Download the app" and "Use on web" both resolve to "https://business.usemingla.com"`), A-2 (`canInstall=true but installStore=null`), A-4 (`android resolves to something other than the business Play listing`) → **exit 1**. Restored → **5/5 PASS**.
- **Hygiene:** `npx tsc --noEmit` across `mingla-marketing` is **clean** with the test added (literal-type comparison widened to `string`, mirroring the ORCH-1329 email-tester convention).
- **Run:**
  ```
  cd mingla-marketing
  npx tsc lib/__tests__/business-app-target.tester.test.ts --outDir /tmp/o \
    --module commonjs --target es2020 --moduleResolution node \
    && node /tmp/o/__tests__/business-app-target.tester.test.js
  ```

---

## 6. Constitution — 14-rule matrix

| # | Rule | Verdict | Evidence |
|---|---|---|---|
| 1 | No dead taps | **PASS** | Real Android taps on all 4 surfaces reach the Play Store / business web. Desktop renders **no** install anchor at all (not disabled, not empty): `href="null"` / `href=""` / `href="#"` / `href="undefined"` all count **0**; `Download the app` label count **0** on desktop/bot/empty-UA. |
| 2 | One owner per truth | **PASS** | The platform→destination decision exists **only** in `lib/business-app-target.ts`; the 5-way triplication is gone; gate E enforces delegation on all 4 surfaces. |
| 3 | No silent failures | **PASS (note)** | `if (target.installHref === null) return` in the handlers is unreachable from the UI (the button only renders when `canInstall`), so it is a guard, not a swallow. `captureMarketing` swallows analytics errors **by design** (documented, non-fatal). |
| 4 | One query key per entity | **N/A** | No React Query. |
| 5 | Server state stays server-side | **N/A** | No Zustand. |
| 6 | Logout clears everything | **N/A** | Anonymous marketing surfaces. |
| 7 | `[TRANSITIONAL]` labelled | **N/A** | Nothing temporary introduced. |
| 8 | Subtract before adding | **PASS** | The redirect, the stale comment, the stale hero line and the stale `/links` body were **removed**, not layered over. |
| 9 | No fabricated data | **PASS** | Every copy claim re-derived against real code (P4-2). |
| 10 | Currency-aware | **N/A** | No money. |
| 11 | One auth instance | **N/A** | No auth on these surfaces. |
| 12 | Validate at the right time | **PASS** | Handlers re-read `detectClientPlatform()` fresh on the tap rather than trusting mounted state — a tap can never resolve a stale platform. |
| 13 | Exclusion consistency | **PASS** | `canInstall === false` consistently means no install action on all 4 surfaces. |
| 14 | Persisted-state startup | **PASS** | SSR-safe: `useState<Platform>('other')` + effect swap keeps server HTML and first client render in agreement (no hydration mismatch); the server route reads the UA header directly. |

**No constitutional violations → no automatic P0.**

---

## 7. Device / parity matrix

| Surface | Verdict | Evidence / reason |
|---|---|---|
| **Consumer iOS** (`app-mobile/`) | **N/A — skipped** | Not shipped to. `git diff --stat app-mobile/` **empty** (SC-12). |
| **Consumer Android** (`app-mobile/`) | **N/A — skipped** | As above. |
| **Buyer/anon Web** (`mingla-business/` public routes) | **N/A — skipped** | Not shipped to; `mingla-business/` diff **empty**. |
| **Business iOS (native)** | **N/A — skipped** | No get-app CTA; `mingla-business/` untouched. |
| **Business Android (native)** | **N/A — skipped** | As above. |
| **Admin Web** | **N/A — skipped** | No get-app CTA; `mingla-admin/` diff **empty**. |
| **Business Web preview** | **N/A — skipped** | `business.usemingla.com` is the destination, not a CTA host. |
| **Marketing web — real ANDROID** | **PASS — PROVEN** | Pixel_8_Pro AVD, **Android 15**, arm64-v8a, `google_apis_playstore` image (real Play Store app installed). Branch build served on `:3811` via `adb reverse`. Real `input tap` events on all 4 surfaces → Play Store app opens the business listing; "Use on web" → `business.usemingla.com`. |
| **Marketing web — iOS UA** | **PASS (capped)** | HTTP-level VERIFIED (200 + App Store anchor, no 307). **Not run on a physical iPhone.** |
| **Marketing web — desktop/bot** | **PASS — VERIFIED** | Mac / Googlebot / empty-UA / iPad-Safari UAs → 200, web-only, `desktopNote`, no install anchor, no 500. |
| **Email (`invite-brand-member`)** | **PASS — VERIFIED** | `deno test` 26 passed / 0 failed, incl. the new T-11 and the unweakened T-10 href pin. |

### Honest evidence caps (per the skill's confidence ladder)

1. **"Physical Samsung" was NOT used — no physical device was attached.** `adb devices` returned an empty list for the entire run; I could not attach Seth's Samsung myself. I resolved this rather than record a blocker: I drove a **real Android 15 OS** (Pixel_8_Pro AVD with the Google Play system image) with **real touch events**, a **real Chrome**, and the **real Play Store app**. The Play Store's own Finsky service resolved `com.sethogieva.minglabusiness` and rendered the live business listing — so the install path is proven end-to-end on Android. Residual risk that a physical Samsung differs is **very low** (same Chrome, same intent handling), but this is emulated hardware, not Seth's handset. **Grade: PROVEN on real Android OS; NOT confirmed on Seth's physical Samsung.**
2. **SC-7 has NO runtime evidence.** PostHog capture was silent in my harness — I proved this is a **harness limitation, not a defect**: a minimal control page using the official PostHog snippet + the same key + explicit `opt_in_capturing()` + `capture()` also produced **zero** POSTs, while Google Analytics POSTed normally from the same browser. Autocapture was silent too. I therefore **cannot** attribute the silence to ORCH-1381's code and **do not** claim SC-7 fires. Best available evidence is **BUNDLE**-grade (payloads in the compiled artifact). Per the skill rule, source/bundle-only reasoning **caps at "suspected" and can never be a PASS** — hence SC-7 = FAIL, not a soft pass.
3. **Everything tested locally is the branch build, not production.** Production still 307s Android → `business.usemingla.com` (I re-confirmed the live bug: `HTTP/2 307, location: https://business.usemingla.com`). The fix is **undeployed**; the CLOSE commit must carry `[deploy]`. Any claim of "verified on usemingla.com" would be false today.

---

## 8. Discoveries for the orchestrator

| ID | Discovery |
|---|---|
| **D-T1** | **Marketing-web PostHog is DARK in production** (no `NEXT_PUBLIC_POSTHOG_KEY` in the Vercel env → `initPostHog()` no-ops). Kills SC-7 and silently voids the pre-existing ORCH-1319/1328 marketing events too. Same class as the ORCH-1379 business-web Sentry env gap — worth handling together. **Own ORCH / operator action.** |
| **D-T2** | **`window.open(url,'_blank','noopener,noreferrer')` returns `null` on success**, so the `if (!win) window.location.assign(dest)` "popup-blocked fallback" is unconditional across `glass-nav` (ORCH-1319), `links-experience` (ORCH-1328) and now ORCH-1381's `openBusinessDest`/`openDest`. Result: two tabs + the origin page destroyed, and **ORCH-1328's own "/links stays mounted" invariant is violated in production today**. Pre-existing; needs its own ORCH (touches the DO-NOT-TOUCH explorer branch). |
| **D-T3** | **SPEC §10-E's G-b regex was decorative** — the SPEC shipped a guard that cannot fire against its own prescribed multi-line implementation (proven, P4-1). Worth a process note: gate regexes in a SPEC should be executed against the *prescribed code shape*, not only against a hypothetical one-liner. |
| **D-T4** | **`/links` still has no CI gate for its single-viewport no-scroll contract** (SPEC D-4 predicted this). It passed today by measurement only. The 360px overflow (P2-1) is exactly the class of regression a gate would catch. Candidate invariant + gate. |
| **D-T5** | **`mingla-marketing` `lint` script is a trap** (P3-1): declared, dependencies installed, no config → interactive prompt. Either wire an `eslint.config.mjs` or remove the script so nobody believes lint runs. |

---

## 9. Accepted conditions (NOT yet accepted — Seth must decide)

This CONDITIONAL PASS carries conditions that are **not** accepted in the dispatch. Per routing, this does **not** go to CLOSE until Seth rules:

| # | Condition | Ask |
|---|---|---|
| **C-1** | **SC-7 is not met** — analytics cannot fire in production (D-T1). The code is correct; the env is not. | Either (a) set `NEXT_PUBLIC_POSTHOG_KEY` in the marketing Vercel env, deploy, and let me re-verify SC-7 live on Android — then this becomes a clean PASS; or (b) accept that ORCH-1381 ships **unmeasurable** and register D-T1 as a follow-up ORCH. |
| **C-2** | **P2-1** — "Use on web" label overflows its pill at 360px (common Android). | Accept as cosmetic, or send back to the implementor for a small layout fix (do not change the pinned copy constant). |
| **C-3** | **P2-2 / D-T2** — the always-firing popup fallback (pre-existing, replicated here). | Accept for this ORCH + register D-T2, or widen scope (not recommended — touches DO-NOT-TOUCH paths). |

**If Seth accepts C-1(b), C-2 and C-3 → this becomes a CONDITIONAL PASS routable to CLOSE.** Nothing here blocks the core user-facing fix, which is proven working on real Android.

---

## 10. Routing

- **Not CLOSE-ready as-is** — conditions unaccepted (§9).
- **No implementor REWORK is required for P1-1** (env, not code). P2-1 is the only finding a reworking implementor could act on, and only if Seth wants it.
- **On acceptance → `mingla-orchestrator` CLOSE:** flip `I-PROPOSED-1381-BUSINESS-GETAPP-ANDROID-CHOICE` → ACTIVE; amend the three ACTIVE invariants (1324/1326/1328) per SPEC §8; 1342 needs no amendment (independently re-verified: `parseConst` still resolves the consumer `PLAY_STORE_URL` with `BUSINESS_PLAY_STORE_URL` present, and all 5 gates are green); register D-T1…D-T5; resolve COMMS-0101. **The CLOSE commit MUST carry `[deploy]`** — the fix is not live until it does, and production still 307s every Android owner to the web today.

---
---

# RETEST 1 — after the ADDENDUM rework (D-A + D-A-2 + D-B)

**Mode:** RETEST (mingla-tester). Assumed broken until proven. Every claim in the dispatch, the addendum and the implementation report was **re-derived by execution**; none was accepted.
**Commits under test:** `ce9d951a9` → `7830636bd` (addendum spec + 4 rework commits), tree clean at `7830636bd`.
**Rebase base:** `git merge-base origin/main HEAD` = `438aeef887` = `origin/main` exactly (branch genuinely rebased, not stale).
**Attack list:** addendum §12 (all 12 attacked).
**Harness:** real Chromium via Playwright 1.61.1 against a branch dev build on an isolated port (`localhost:3781`). Seth's Chrome on `:9222` untouched; no global `pkill`; scratch confined to `/tmp/orch-1381/`.
**Ledger:** COMMS-0101 (WARN, OPEN, `to:` includes ORCH-1381) ingested and factored — see §R8.
**Date:** 2026-07-15

---

## R1. RETEST VERDICT

> ## CONDITIONAL PASS — the rework is CORRECT and PROVEN
> **P0: 0 · P1: 1 (carried; deferral documented in the dispatch) · P2: 2 · P3: 1 · P4: 3**
>
> **The D-A, D-A-2 and D-B rework all hold under real-viewport, real-browser attack.** Every defect I raised last pass is fixed, and I proved each fix in **both directions** (passes on the fix, fails on a true line-deletion revert).
>
> The **only** blocking item is the carried **P1-1 (SC-7 PostHog dark in production)**, which the dispatch explicitly rules out of scope for this retest ("Seth's action, not a rework"). That documented deferral is what makes this CONDITIONAL PASS rather than BLOCKED.
>
> **One NEW P2 (P2-4)** was found: every existing guard is **case-blind**. It does not affect the shipped code (which is correct) and I have closed it at the test layer with my adversarial test.

**Layman summary.** The two problems I raised last time are genuinely fixed, and I proved it in a real browser rather than by reading code. The Mingla Business logo is now full-size (84px) at every phone width, nothing spills, and tapping any "Download the app" / "Use on web" / "Get the app" button now opens the store in a new tab **while the Mingla page stays put** — previously every single tap destroyed the page. I also proved the business buttons send business owners to the **Mingla Business** app and never to the consumer app. The one thing still outstanding is analytics (PostHog), which is your Vercel setting, not a code fix.

---

## R2. The delta, re-derived (dispatch items 1–7)

### D-A — pill overflow (`/links`) — **FIXED, PROVEN**

Measured the **rendered** geometry of the business pills in real Chromium at **320 / 360 / 375 / 390 / 412 / 768 + landscape 667×375**, Android UA:

| vp | pill | `scrollHeight` vs `clientHeight` | spills? | page h-scroll |
|---|---|---|---|---|
| 375×667 | Download the app | 56 vs 56 | **no** | no |
| 375×667 | Use on web | 54 vs 54 | **no** | no |
| 320×568 | both | 56/54 vs 56/54 | **no** | no |
| 360×640 | both | 56/54 vs 56/54 | **no** | no |
| 390 / 412 / 768 / landscape | both | equal | **no** | no |

The original 9px pill-INTERNAL spill past the fixed `h-14` is **gone at every width tested**. My original framing (pill-internal, not row overflow) is confirmed by measurement.

### D-A-2 / OQ-1 option B — one action + full 84px logo — **FIXED, PROVEN**

Measured `/business` nav at 320/360/375/390/412/640/768/1280 × {Android UA, iOS UA, desktop} + 2 landscape viewports:

- **Logo = 84.00px border-box at EVERY width and every UA** (img 80px + `px-0.5` ×2). The `shrink-0` holds; no squashing to 30px anywhere.
- **The logo genuinely RENDERS** — I did not accept the 84px number alone, because a *broken* `<img>` lays out at exactly `h-20 w-20` too. `naturalWidth=2000, naturalHeight=2000, complete=true` ⇒ the real 2000×2000 brand asset loads. Screenshot at 360 and 320 confirms the full "Mingla BUSINESS" lockup.
- **Exactly ONE action on a phone** (`Download the app`) at 320/360/375/390/412 under both Android and iOS UA. Both actions return at ≥640 as designed. Desktop (`canInstall=false`) correctly shows only `Use on web` — never a dead install button.
- **Zero page horizontal scroll and zero pill spill at every width/UA/orientation.**

> **§12 #8 landscape** — tested (915×412 and 667×375). Both ≥640 ⇒ both actions render, no overflow. No landscape defect.

### D-B — double navigation — **FIXED, PROVEN IN BOTH DIRECTIONS**

This is the headline evidence. Real Chromium, one real click per CTA, external hosts stubbed:

| CTA | with the FIX | with the fix REVERTED |
|---|---|---|
| nav /business Download (android) | tab opens `…id=com.sethogieva.minglabusiness`, **origin survives** | tab opens **AND origin navigates away** |
| nav /business Download (ios) | tab opens `…id6768737367`, **origin survives** | **origin destroyed** |
| nav /business Use on web (desktop) | tab opens `business.usemingla.com`, **origin survives** | **origin destroyed** |
| links business Download (android) | **origin survives** | **origin destroyed** |
| links business Use on web (android) | **origin survives** | **origin destroyed** |
| nav explorer Get the app (android) | **origin survives** | **origin destroyed** |
| nav explorer Get the app (ios) | **origin survives** | **origin destroyed** |

**7/7 survive with the fix. 7/7 destroyed on revert.** `framenavigated` on the main frame fired **zero** times with the fix and **once per tap** on the revert. This is ORCH-1328's own "/links stays mounted" invariant, and it was violated on every tap in production.

### §12 #1 + C-4 — the `noreferrer` half-fix trap — **CONFIRMED REAL**

I did not trust the addendum's browser claim. Executed in real Chromium:

```
window.open(u,'_blank')                        -> Window   (safe)
window.open(u,'_blank','')                     -> Window   (safe)
window.open(u,'_blank','noopener')             -> null     (bug shape)
window.open(u,'_blank','noreferrer')           -> null     (bug shape)  <-- the C-4 trap
window.open(u,'_blank','noopener,noreferrer')  -> null     (bug shape)  <-- the shipped bug
```

Then I patched the module to the half-fix (`'noreferrer'` alone, `noopener` dropped) and ran the live tap test: **7/7 CTAs still double-navigated**. The trap is real and the shipped fix correctly carries **neither** token. `openExternal` severs the opener with `win.opener = null` instead — verified in a real browser, cross-origin: the write **does not throw** and `win.opener === null` afterwards, so **dropping `noopener` was not a security regression** (§12 #7 satisfied).

**The implementor's suite correctly FAILS the half-fix** (T-A, T-B, T-D red) — so the fake `Window` is genuinely modelling the spec and the contract is **not** decorative (§12 #1 satisfied, with one exception: see **P2-4**).

### §12 #4 — the 4th (and a 5th?) call site — **SWEPT INDEPENDENTLY, NO 5th**

Independent sweep of `mingla-marketing/` for `.open(` and `location.(assign|href|replace)` across all `.ts/.tsx/.js/.jsx`, excluding `node_modules` / `.next`:

- **Exactly ONE** raw `.open(` in non-test source: `lib/open-external.ts:47`.
- **Exactly ONE** `location.assign(` in non-test source: `lib/open-external.ts:53`.
- All 8 `openExternal` invocations across the 4 call-site files (`glass-nav.tsx` ×3, `links-experience.tsx` ×3, `hero.tsx` ×2) delegate to the one owner.

**The single-owner extraction is complete. No 5th call site exists.**

### §12 #5 — EXPLORER BLAST (cross-app contamination = P0) — **CLEAN**

The widening deliberately touched the consumer CTA. Verified by real tap:

| surface | UA | destination |
|---|---|---|
| explorer nav | android | `play.google.com/…?id=`**`com.mingla.app.v2`** (CONSUMER) ✅ |
| explorer nav | ios | `apps.apple.com/app/`**`id6760440898`** (CONSUMER) ✅ |
| explorer /links | android | **`com.mingla.app.v2`** ✅ |
| explorer /links | ios | **`id6760440898`** ✅ |
| business nav/links | android | **`com.sethogieva.minglabusiness`** ✅ |
| business nav/links | ios | **`id6768737367`** ✅ |

**No business URL leaked into the explorer path; no consumer URL leaked into the business path. Zero cross-app contamination — no P0.**

All 4 listings live-verified under an Android UA (`SM-S918B`): **HTTP 200** each. App Store titles confirm they are distinct apps — business = *"Mingla: Host, Sell & Grow"*, consumer = *"Mingla – Date Plans & City Gems"*.

### §12 #6 — desktop QR regression — **CLEAN**

Desktop `Get the app` → QR panel dialog opens (`aria-expanded` `false`→`true`, dialog `1280×900`, heading *"Scan to get Mingla"*, 4 QR visuals), URL **unchanged**, tab count stays **1**. Desktop does **not** navigate away and does **not** open a popup. Correct.

### §12 #9 — consent-gated first paint — **NO CHANGE FROM `px-4`**

`ORCH-1381` touches **no** consent/cookie/banner file (`git diff origin/main...HEAD --name-only | grep -iE 'consent|cookie|banner'` ⇒ empty). `px-4` is horizontal padding on a fixed-height pill; it cannot move the banner or change vertical coverage. The banner *does* overlay the CTAs + socials pre-consent at 375×667 — that is the **carried, pre-existing P2-3**, unchanged by this rework, not a new defect.

### §12 #10 — `twMerge` order — **VERIFIED ON THE RENDERED ATTRIBUTE**

I did not trust `cn()`'s contract. Read the **rendered `class` attribute** and the **computed style**:

- `px-4` present: **true** · `px-7` present: **false** (twMerge correctly stripped the base padding — not both)
- `getComputedStyle(...).paddingLeft` / `paddingRight` = **`16px`** (= `px-4`), at every width tested.

### §12 #11 — SC-12 — **PASS**

`git diff origin/main...HEAD --name-only` ⇒ **zero** files under `app-mobile/`, `mingla-business/`, `mingla-admin/`, and **zero** touches to `lib/device-platform.ts`. DO-NOT-TOUCH honoured.

---

## R3. Gate verification — BOTH DIRECTIONS (the "third decorative guard" check)

The dispatch told me not to re-derive the orchestrator's gate claim but to **challenge it with contrary evidence**. I executed all four quadrants. **I found contrary evidence.**

| | vs the **SHIPPED BUG** | vs the **CORRECTED FIX** |
|---|---|---|
| **ORIGINAL** gates (`origin/main`) | **PASS — genuinely BLIND** ✅ *(claim confirmed)* | **FAIL** ❌ *(claim REFUTED)* |
| **AMENDED** gates (branch) | **FAIL — for the right reason** ✅ | **PASS** ✅ |

- **Blind half — CONFIRMED by execution.** I checked out `origin/main` (`438aeef88`) into a throwaway worktree, confirmed the buggy source is present verbatim (`window.open(store, '_blank', 'noopener,noreferrer')` + `if (!win) window.location.assign(store)`), and ran the **original** `orch-1324` / `orch-1328` gates against it: **both exit 0**. The gates were green while the bug shipped to production. The orchestrator's core claim is **true**.
- **"Not prohibitive" half — REFUTED.** The original gates **FAIL** against the branch's corrected pattern (exit 1), because the §5.3 `openExternal` extraction and the base spec's `business-app-target` extraction moved the tokens they presence-grep for (`window.location.assign(`, `BUSINESS_APP_STORE_URL`, `BUSINESS_WEB_URL`) out of the components. So the original gates are **both blind to the bug AND prohibitive of the fix**. This does not weaken the amendment — it makes it **mandatory rather than optional**. Filed as **P4-4** (a correction to the record, not a code defect).
- **The amended gates are NOT decorative.** Against the shipped bug they fail citing the *actual mechanism*, not a missing file:
  > `passes noopener/noreferrer to window.open — per the HTML spec it then returns null EVEN ON SUCCESS, so the popup-block fallback fires unconditionally and the page double-navigates (ORCH-1381 ADDENDUM D-B)`
- **All 6 gates + all 6 `--self-test`s exit 0 on the pristine branch.**

### §12 #12 — gate teeth (per-call-site, stricter than asked)

The addendum asked for the **4** call sites reverted individually. I went finer and reverted **each of the 8 `openExternal` invocations** individually to the exact shipped buggy inline pattern, running all 6 gates after each:

| # | call site reverted | gate that fired |
|---|---|---|
| 1 | nav EXPLORER store | `orch-1324` ✅ |
| 2 | nav BUSINESS install | `orch-1324` ✅ |
| 3 | nav BUSINESS web | `orch-1324` ✅ |
| 4 | links BUSINESS install | `orch-1328` ✅ |
| 5 | links BUSINESS store | `orch-1328` ✅ |
| 6 | links EXPLORER cta | `orch-1328` ✅ |
| 7 | hero install | `orch-1324` ✅ |
| 8 | hero web | `orch-1324` ✅ |

**8/8 — no blind spot. These gates have teeth, not one tooth.** Tree verified clean after every restore.

---

## R4. Step 0.5 — independent re-run of the implementor's fails-on-revert proof

Re-run by me, by true line-deletion, at `7830636bd`:

| state of `lib/open-external.ts:47` | implementor's suite |
|---|---|
| **pristine** `w.open(dest, '_blank')` | **All 4 pass** (T-A/T-B/T-C/T-D) |
| **reverted** `w.open(dest, '_blank', 'noopener,noreferrer')` | **T-A, T-B, T-D FAIL** — exact message: *"DOUBLE NAVIGATION — the popup opened AND the current tab navigated to …"* |
| **half-fix** `w.open(dest, '_blank', 'noreferrer')` | **T-A, T-B, T-D FAIL** — *"THE HALF-FIX TRAP: noreferrer IMPLIES noopener…"* |

**The implementor's fails-on-revert claim is independently CONFIRMED.** File restored byte-identical after each mutation (`git status` clean).

**All 9 ORCH-1381 suites green on the pristine branch: 62 PASS / 0 FAIL.** Package `tsc --noEmit` exits 0 with my new test included.

---

## R5. Tester adversarial test (NEW, this retest)

**Path:** `mingla-marketing/lib/__tests__/open-external.tester.test.ts` (NEW file — append-only; no existing test modified).

**A different angle from the implementor's — and it found a real blind spot.**

The implementor's suite models the HTML rule **case-sensitively**:
```ts
if (/\bnoopener\b|\bnoreferrer\b/.test(features)) return null   // no /i
```
**HTML window-feature names are ASCII case-INSENSITIVE.** I proved the divergence in real Chromium — every one of these returns `null` (bug shape):
```
'noopener' 'NOOPENER' 'NoOpener' ' noopener ' 'noopener,' 'noopener=yes'
'noreferrer' 'NOREFERRER' 'NoReferrer' ' noreferrer ' 'noreferrer=yes'
'noopener,noreferrer' 'noreferrer,noopener' 'NOOPENER,NOREFERRER'
```
…while `''`, `'width=100'`, `'popup=1'` return a real `WindowProxy`.

**The exploit (executed end-to-end):** patching the module to `w.open(dest, '_blank', 'NOOPENER')` — a pure case change —
- leaves **all 4** tests in `open-external.test.ts` **GREEN**,
- leaves **all 6** strict-grep gates **GREEN** (their regexes are likewise case-sensitive: `/\bno(?:opener|referrer)\b/`, no `/i`),
- while a real Chromium **double-navigated on 7 of 7 CTAs**.

Tests green, gates green, bug shipped — the exact D-A3/C-2 failure class. Filed as **P2-4**; my test closes it at the test layer.

**My test's 4 cases:**
- **A-1** — drives `openExternal` against a **browser-accurate (case-insensitive)** fake Window and asserts no same-tab navigation on a successful open. *(the load-bearing difference)*
- **A-2** — static, case-insensitive ban on the feature argument of the real `.open(` call (comment-stripped, so the docblock may still name the tokens).
- **A-3** — **idempotency across repeated taps** (a different axis entirely — phones double-tap): N taps ⇒ N opens, **0** same-tab navigations, correct url + `_blank` every time.
- **A-4** — the other direction: a genuine popup block still falls back **exactly once**, to the **same** destination (no dead tap, no double-assign).

**Both-direction proof (all executed at `7830636bd`):**

| module state | my adversarial suite |
|---|---|
| **pristine fix** | **All 4 PASS** |
| `'NOOPENER'` (beats every other guard) | **A-1, A-2, A-3 FAIL** ✅ |
| `'noopener,noreferrer'` (classic revert) | **A-1, A-2, A-3 FAIL** ✅ |

`fails-on-revert verified at 7830636bd` (and on the case-variant mutation that no other guard catches).

**Both tests appear in the closing diff:** `mingla-marketing/lib/__tests__/open-external.test.ts` (implementor) and `mingla-marketing/lib/__tests__/open-external.tester.test.ts` (tester) are both in `git diff origin/main...HEAD --name-only`.

**Run recipe** (from `mingla-marketing/`):
```
npx tsc lib/__tests__/open-external.tester.test.ts --outDir /tmp/oet \
  --module commonjs --target es2020 --moduleResolution node --skipLibCheck \
  && node /tmp/oet/__tests__/open-external.tester.test.js
```

---

## R6. Retest findings

### P2-4 (NEW) — every guard is CASE-BLIND: a one-character mutation reships D-B with CI fully green

- **Evidence.** `mingla-marketing/lib/__tests__/open-external.test.ts:48` (`/\bnoopener\b|\bnoreferrer\b/` — no `/i`), `.github/scripts/strict-grep/orch-1328-links-cta-opens-store-clientside.mjs:90` (`/\.open\([^)\n]*\bno(?:opener|referrer)\b[^)\n]*\)/` — no `/i`), and the equivalents in `orch-1324` / `orch-1381-open-external-no-double-nav`. Executed: with `w.open(dest,'_blank','NOOPENER')` all 4 tests and all 6 gates exit 0 while real Chromium double-navigates 7/7.
- **Impact.** The regression protection for the *entire* D-B fix has a bypass. A future author "fixing" this feature string in any other casing reships the production bug with a green PR. Low likelihood, but the C-4 trap already proved authors fumble this exact string.
- **Required fix.** Add the `/i` flag to the noopener/noreferrer regexes in the 4 gate files and to the fake-Window model in `open-external.test.ts:48`; add an uppercase self-test case to each gate.
- **Retest.** `w.open(dest,'_blank','NOOPENER')` must turn each gate red.
- **Status.** **Closed at the test layer by my adversarial test A-1/A-2** (which fail on the case-variant). The **strict-grep gates remain case-blind** → recommend a follow-up ORCH. **Non-blocking:** the shipped code is correct.

### P4-4 (NEW) — record correction: the original gates were blind **AND** prohibitive

- **Evidence.** ORIGINAL `orch-1324`/`orch-1328` vs branch HEAD ⇒ **exit 1**, citing `must reference BOTH BUSINESS_APP_STORE_URL and BUSINESS_WEB_URL — got store=false, web=false` and `missing the window.location.assign( popup-blocked fallback`.
- **Impact.** None on the code. The dispatch's framing ("BLIND, **not prohibitive**") is half right: the blind half is confirmed, the not-prohibitive half is refuted. The amendment was **mandatory**, not a convenience.

### P4-5 (NEW) — 320px: 1px row overflow, absorbed by the gutter, invisible

- **Evidence.** At 320px the nav row measures `scrollWidth=289` vs `clientWidth=288` (logo 84 + `gap-3` 12 + pill 193.11 = 289.11 vs 288 available). Page-level `overflowX=false`; the pill's right edge does **not** pass the viewport; screenshot at 320 is visually clean.
- **Impact.** Cosmetic only — the 16px gutter becomes 15px on the smallest live device. **Not a defect.** Noted so nobody "discovers" it later as a regression.

### Carried findings — status after rework

| ID | Status |
|---|---|
| **P1-1** SC-7 PostHog dark in production | **STILL OPEN — not retested per dispatch.** Seth's Vercel action (`NEXT_PUBLIC_POSTHOG_KEY`), independently re-verified by the orchestrator (no `phc_` key in any of the 17 prod chunks). Not a rework item. |
| **P2-1** pill overflow @360 | **RESOLVED — PROVEN** at 320/360/375/390/412/768 + landscape. |
| **P2-2** double-navigation | **RESOLVED — PROVEN in both directions**, all 4 call sites (7 CTAs). |
| **P2-3** `/links` consent banner overlays CTAs | **STILL OPEN — pre-existing, untouched by 1381**, unaffected by `px-4` (§12 #9). |
| **P3-1** `mingla-marketing` lint script cannot run | **STILL OPEN** (addendum D-T5, deliberately deferred). |
| **P4-1 / P4-2 / P4-3** | Unchanged, informational. |

---

## R7. SC matrix — retest delta only

| SC | Retest verdict | Grade | Evidence |
|---|---|---|---|
| **SC-1-Android-*** | **PASS (capped)** | PROVEN (prior pass, real Android 15 OS) + VERIFIED (this pass) | **Physical Samsung ABSENT — see the cap in §R9.** Store-resolution code path (`business-app-target.ts`) is **byte-unchanged** by the addendum, so the prior pass's real-Android-OS proof stands. This pass re-proved destination resolution by real click in Chromium (→ `com.sethogieva.minglabusiness`) + live listing HTTP 200 under an `SM-S918B` UA. |
| **SC-6-Links-NoScroll** | **PASS** | VERIFIED (real viewport) | 375×667: `scrollHeight === clientHeight === 667`, **no** vertical scroll, **no** horizontal scroll; **7/7** socials visible (`maxBottom=647 ≤ 667`); both CTAs share `top=394` (one row). Also holds at 320×568, 360×640, 390×844, 412×915, 768×1024, landscape 667×375. |
| **SC-7-Analytics** | **BLOCKED — NOT RETESTED** | — | Excluded by dispatch. P1-1 stands. Seth's action. |
| **SC-12-Consumer-Untouched** | **PASS** | VERIFIED | Diff empty for all 4 DO-NOT-TOUCH paths. |
| **SC-13-Popup-Fallback** | **PASS (P2-2 now RESOLVED)** | PROVEN | Fallback now fires **only** on a genuine block (A-4 + T-C); on success it never fires (7/7 origin-survival). |
| **D-A** (addendum) | **PASS** | PROVEN | §R2. |
| **D-A-2** (addendum, OQ-1=B) | **PASS** | PROVEN | Logo 84.00px + genuinely loaded (naturalWidth 2000); exactly one phone action; no spill. §R2. |
| **D-B** (addendum, OQ-2=drop noreferrer) | **PASS** | PROVEN both directions | 7/7 survive w/ fix, 7/7 destroyed on revert; `noreferrer` confirmed dropped (neither token present); opener severed cross-origin without throwing. §R2. |

---

## R8. COMMS_LEDGER union-merge audit (dispatch item 7)

**Challenged and CONFIRMED — no ack was lost.**

- Branch diff vs `origin/main` touches COMMS_LEDGER.md by **exactly one line** (the COMMS-0101 row), 1 insertion / 1 deletion.
- Row count identical: **102 `COMMS-` rows on both** `origin/main` and HEAD → no row dropped, none duplicated.
- `acked_by` on COMMS-0101: **5 acks on `origin/main` → 6 on HEAD.** The union **added** `mingla-forensics+claude (ORCH-1381 SPEC ADDENDUM …)` and **preserved all 5 pre-existing** acks verbatim (`mingla-orchestrator+claude`; `mingla-forensics+claude (ORCH-1381 SPEC)`; `mingla-implementor+claude (ORCH-1381 BUILD)`; `mingla-orchestrator+claude (ad-engine battle-test)`; `mingla-implementor+claude (ORCH-1381 ADDENDUM BUILD)`).
- **Net: +1, −0.** The union resolution is correct.

**COMMS-0101 (WARN, OPEN) factored this turn:** business Android stays on the PLAIN Play URL — verified by real click (`play.google.com/store/apps/details?id=com.sethogieva.minglabusiness`); **zero** `minglabiz.onelink.me` (dead on Android) and **zero** `go.usemingla.com` (consumer-owned) usages anywhere in the branch — the only occurrences are comments and negative test assertions banning them. Invite-email href untouched. `BUSINESS_APP_CHOICE_COPY` byte-frozen.

---

## R9. Honest evidence caps — what was PROVEN on a real device/viewport vs not

**Proven on a real browser at real viewports (this retest):**
- D-A pill overflow — real Chromium, 7 viewports + landscape, rendered geometry + computed style.
- D-A-2 one-action nav + **84px logo** + image genuinely loaded — real Chromium, 8 widths × 3 UAs + 2 landscape, screenshots.
- D-B single-navigation + origin survival — **real clicks**, 7 CTAs, both directions.
- C-4 `noreferrer` trap + `window.open` return matrix + cross-origin opener severing — **real Chromium**.
- Explorer/business cross-app separation — real clicks; live store listings HTTP 200 under an Android UA.
- Desktop QR panel — real click, real dialog.
- SC-6 no-scroll @375×667 + 7 socials visible — real viewport.
- Gate teeth (8/8), gate 4-quadrant matrix, Step 0.5, my adversarial test both-direction — **all by execution**.

**NOT proven on Seth's physical Samsung — BLOCKED, capped honestly:**
- `adb kill-server && adb start-server && adb devices -l` ⇒ **empty**. `system_profiler SPUSBDataType` ⇒ **no Android/Samsung/Galaxy/SM-\* USB device**. No emulator running.
- I did **not** substitute a weaker proxy and claim device authenticity. **SC-1's physical-Samsung re-proof did not happen this pass.**
- **Why the SC-1 PASS still stands:** the store-resolution path (`lib/business-app-target.ts`, `lib/store-links.ts`) is **byte-unchanged** by the addendum — the rework touched only `open-external.ts` (new), the 4 call sites' delegation, and nav/pill CSS. The prior pass **PROVED** SC-1 on a real Android 15 OS with a real `input tap` reaching the real Play Store app on the business listing. The addendum cannot regress that resolution, and this pass re-proved the resolved destination by real click.
- **Operator-unblock ask:** connect the Samsung via USB with debugging enabled and re-run `adb devices`; I will re-drive the 4 CTAs and confirm `/links` survives on back.

**Chromium-only cap:** all pixel + `window.open` measurements are Chromium. `window.open` return semantics are HTML-spec-mandated (WebKit will agree); **pixel measurements on iOS Safari were not taken**. No claim here is production-verified — the fix is undeployed, and **D-B is live on `usemingla.com` today**.

---

## R10. Constitution — re-verified against the addendum diff

| # | Rule | Verdict | Evidence |
|---|---|---|---|
| 1 | No dead taps | **PASS** | A-4 + T-C: a genuine block still falls back exactly once. 7/7 CTAs fire in a real browser. |
| 2 | One owner per truth | **PASS** | `openExternal` is the single owner — swept: exactly one `.open(` and one `location.assign(` in non-test source. |
| 3 | No silent failures | **PASS** | The fallback is preserved for real blocks; nothing swallowed. |
| 4–7 | Query keys / server state / logout / `[TRANSITIONAL]` | **N/A** | No data, cache, auth or transitional code in this diff. |
| 8 | Subtract before adding | **PASS** | The addendum **removed** 4 copy-pasted blocks and replaced them with one module; `CTA_BASE` and `button.tsx` left untouched per §7.2. |
| 9 | No fabricated data | **PASS** | `BUSINESS_APP_CHOICE_COPY` byte-frozen; every claim still code-verified. |
| 10–14 | Currency / auth instance / validate timing / exclusion / hydration | **N/A** | Not touched. Hydration seeding (`'other'` → effect) unchanged and still SSR-safe. |

---

## R11. Discoveries for the orchestrator

| ID | Discovery |
|---|---|
| **R-D1** | **The case-blind guard class (P2-4) is repo-wide, not 1381-local.** Any strict-grep banning a *string literal that the HTML/CSS/JS spec treats case-insensitively* has this hole. Worth a sweep of the strict-grep corpus for case-sensitive bans on case-insensitive specs. |
| **R-D2** | **Corroborates addendum D-A2 and escalates it.** `window.open(…, 'noopener')` returning null on success is a general trap; `mingla-admin/` and the RN webviews are **still unswept**. My live proof (7/7 origin destruction) shows the production impact is total, not marginal — every marketing CTA destroyed the page on every tap. The repo-wide sweep ORCH should be prioritised, not filed. |
| **R-D3** | **A `/links` + nav layout gate still does not exist** (addendum D-T4 remains open). D-A and D-A-2 are both **implemented-and-now-tester-verified but CI-unguarded** — nothing stops a future padding/copy edit from reintroducing the spill or re-squashing the logo. My proof is a point-in-time measurement, not a standing guard. Recommend a follow-up ORCH for a rendered-geometry gate (the `shrink-0` + one-action-under-`sm` invariants are cheap to pin). |
| **R-D4** | **P2-3 (consent banner overlays the `/links` CTAs + socials at first paint)** is pre-existing and still open. At 375×667 the banner covers `y=439–655`, and the CTAs sit at `y=394–450` — a real 11px overlap on the primary action, plus total coverage of the socials row. Worth its own ORCH; it silently taxes every first-time `/links` visitor. |

---

## R12. Accepted conditions (CONDITIONAL PASS)

| ID | Condition | Basis for acceptance |
|---|---|---|
| **P1-1** | SC-7 PostHog dark in production → `get_the_app_clicked` cannot fire; the `action` discriminator ships unmeasurable. | **Deferral documented in the retest dispatch:** *"SC-7 (PostHog) IS STILL BLOCKED — do NOT retest it… Leave it as the known open condition; it is Seth's action, not a rework."* Unblock = set `NEXT_PUBLIC_POSTHOG_KEY` in Vercel + redeploy. |
| **P2-3** | `/links` consent banner overlays the business CTAs at first paint. | Pre-existing, untouched by 1381, unaffected by `px-4` (proven §12 #9). → R-D4. |
| **P2-4** | Strict-grep gates remain case-blind (test layer closed by my adversarial test). | Shipped code is correct; no production impact. → follow-up ORCH. |
| **P3-1** | `mingla-marketing` lint script cannot run. | Addendum D-T5, deliberately deferred. |

---

## R13. Routing

**CONDITIONAL PASS with conditions whose deferral IS documented in the dispatch (P1-1) → routes to `mingla-orchestrator` CLOSE**, with P2-4 / R-D1 / R-D3 / R-D4 registered as follow-up ORCHs. No rework required of the implementor: **every defect from the prior pass is fixed and proven.**

**CLOSE reminders (unchanged):** flip `I-PROPOSED-1381-…` → ACTIVE; propose `I-PROPOSED-1381-OPEN-EXTERNAL-SINGLE-OWNER`; resolve **D-T2**; keep **D-T1** (PostHog), **D-T4** (no layout gate → R-D3), **D-T5** (lint) open; **CLOSE commit MUST carry `[deploy]`** — D-B is live in production today and every marketing CTA is destroying the page on every tap until this ships.
