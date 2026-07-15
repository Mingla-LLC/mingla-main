# QA — ORCH-1381 [business-getapp-android-choice]

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
