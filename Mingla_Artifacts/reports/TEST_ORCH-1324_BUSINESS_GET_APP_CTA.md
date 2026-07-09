# TEST — ORCH-1324 [business "Get the app" → device-aware CTA; retire beta funnel]

**Phase:** TEST (independent verification) · **Verdict: PASS**
**Branch:** `orch-1324-business-get-app-cta` · HEAD `87c8b98e5` (impl commit `55d739cc3`) — tree clean, HEAD unchanged after test.
**Surface:** `mingla-marketing/` only (+ 2 retired guards/yml jobs + registry). No app/native/Supabase change.
**Tester method:** every gate re-run by me (not trusted from the report); client-side UA-driven routing driven in real browsers (Playwright 1.61.1 — WebKit iPhone 13 + Chromium Pixel 5/desktop) with `window.open`/`window.location.assign` intercepted and external navs route-aborted+recorded.

---

## 1. Gates — re-run independently (all GREEN)

| Gate | Command | Result |
|---|---|---|
| npm ci | `cd mingla-marketing && npm ci` | exit 0 |
| typecheck | `npm run typecheck` (`tsc --noEmit`) | exit 0, clean |
| build | `npm run build` (`next build`) | exit 0; 13/13 pages; `/business` 25.9 kB, prerendered `○ (Static)` (SSR-safe) |
| new guard self-test | `orch-1324-business-getapp-device-aware.mjs --self-test` | PASS 11/11 |
| new guard live | `orch-1324-business-getapp-device-aware.mjs` | PASS |
| ORCH-1319 G-1 | `orch-1319-getapp-cta-direct-store.mjs --self-test` | PASS 8/8 |
| ORCH-1319 G-2 | `orch-1319-download-route-ua.mjs --self-test` | PASS 6/6 |
| ORCH-1319 G-3 | `orch-1319-qr-encodes-download-url.mjs --self-test` | PASS 5/5 |
| ORCH-1319 G-4 | `orch-1319-no-testflight-anywhere.mjs --self-test` | PASS 4/4 |
| security guard | `i-proposed-1216-no-service-key-client.mjs --self-test` | PASS 4/4 |
| happy-path test | `business-getapp-cta.test.ts` (tsc+node) | PASS 10/10 |
| adversarial test | `business-getapp-cta.tester.test.ts` (tsc+node) | PASS 7/7 |
| device-platform | `lib/device-platform.test.ts` | PASS 7/7 (unchanged) |
| links-config | `lib/links-config.tester.test.ts` | PASS 10/10 |
| organiser-redesign | `organiser-redesign.test.ts` | PASS 5/5 (hero copy change did not break it) |
| copy-fidelity | `organiser-copy-fidelity.test.ts` | PASS 2/2 |
| beta-funnel grep | `grep -rn "BetaAccessModal\|beta-access-modal\|beta-access-submit\|Get Beta Access\|get_beta_access\|Free during beta" mingla-marketing/ --include="*.ts" --include="*.tsx"` | 0 hits |
| yml validity | ruby YAML.load | valid; 321 jobs; new job present; 2 retired jobs gone; no-service-key + 4× orch-1319 jobs intact |
| dangling refs | grep for deleted guard/beta-access filenames in code | 0 hits |

Scope of impl commit `55d739cc3` = exactly the 13 allowlisted files (3 created, 6 edited, 4 deleted). All 4 deleted files confirmed gone. Registry: `I-PROPOSED-1216-EXPLORER-ONLY-CTA` + `I-PROPOSED-1219-FORM-NO-AUTOADVANCE-MULTISELECT` DECOMMISSIONED; new `I-PROPOSED-1324-…` DRAFT registered.

---

## 2. RUNTIME PROOF — 17/17 browser checks (observed destination URLs)

Driven live against the production build served on `localhost:3124`. `window.open(dest,…)` stubbed to record `dest` (returns truthy so the happy path stays put); external navs to apps.apple.com / business.usemingla.com / play.google.com route-aborted+recorded.

**/business (organiser) surface — the two shipped CTAs:**
| Platform | CTA | Observed destination | QR / form |
|---|---|---|---|
| iOS (WebKit iPhone 13) | nav | `https://apps.apple.com/app/id6768737367` | — |
| iOS | hero | `https://apps.apple.com/app/id6768737367` | no email input, no QR |
| Android (Chromium Pixel 5) | nav | `https://business.usemingla.com` | — |
| Android | hero | `https://business.usemingla.com` | no QR |
| Desktop (Chromium macOS) | nav | `https://business.usemingla.com` | **NO QR panel** (verified via `Scan to get Mingla` heading + `[role=dialog][aria-modal=true]` = 0) |
| Desktop | hero | `https://business.usemingla.com` | **NO QR panel**; no email input |

Exactly **2** "Get the app" buttons on /business (nav + hero); no third/stray CTA; no beta form anywhere.
- **Popup-blocked path:** `window.open`→null → `window.location.assign` fallback fired → real nav to `https://business.usemingla.com` (caught by route abort). Fallback proven live.
- **Rapid double-tap:** idempotent — 2 opens, both `https://business.usemingla.com`.

**Explorer (`/`) regression — ORCH-1319 CTA NOT broken:**
| Platform | Observed |
|---|---|
| iOS | `https://apps.apple.com/app/id6760440898` (consumer App Store) |
| Android | `https://play.google.com/store/apps/details?id=com.mingla.app.v2` (Play) |
| Desktop | QR panel opens (`Scan to get Mingla` dialog present); no `window.open` — deliberate explorer-only behavior intact |

**Honest cap (analytics):** `captureMarketing('get_the_app_clicked', …)` is consent-gated (no-op without PostHog consent), so I did NOT observe the PostHog event on the network headlessly. The event *shape* (`surface:'organiser'`, `store`, `location:'nav'|'hero'`) is pinned by source + guard + happy-path test; the user-facing navigation destination IS runtime-proven. This is the only source-only-capped item and it is non-blocking.

---

## 3. Step 0.5 regression-test audit (CLOSE gate)

- **Happy-path (`business-getapp-cta.test.ts`)** — exists at the real allowlisted path; passes 10/10. **Fails-on-revert RE-VERIFIED by me:** reverted `hero.tsx` to the pre-impl (`08b630ded`) beta-modal version → **5/5 hero assertions FAILED** (missing `BUSINESS_APP_STORE_URL`, missing ternary, missing `get_the_app_clicked`, missing `window.location.assign`, button not wired), while the **5 nav assertions still PASSED** (independent per-CTA pinning). Tree then restored via `git checkout` → clean (`git status` 0 lines, HEAD `87c8b98e5`), happy-path back to 10/10. The strict-grep guard AND the adversarial test also fail on that revert.
- **Adversarial (`business-getapp-cta.tester.test.ts`)** — genuinely DIFFERENT angle (negative space), NOT a renamed copy of the happy-path: (a) neither surface contains beta-funnel tokens (built from string fragments so the test file stays grep-clean); (b) non-iOS destination is `BUSINESS_WEB_URL` + `store:'business_web'` and the REVERSED ternary is banned (catches the "everyone → App Store" regression that would strand Android/desktop owners); (c) NO QR panel scoped to the organiser handler/CTA branch + hero, plus a sanity assertion that the explorer branch KEEPS `AppQrPanel`/`setQrOpen`. Passes 7/7. Judged sufficient — no strengthening needed (no commit added).
- **Immutability:** both test files are NEW (absent at `08b630ded`), append-only; no pre-existing assertion in any file was weakened.

---

## 4. Adversarial edge probes

- **Popup-blocked** → `window.location.assign` fallback navigates to business web (runtime-proven).
- **Rapid double-tap** → idempotent navigation (runtime-proven).
- **SSR safety** → `detectClientPlatform()` returns `'other'` when `navigator` is absent; `/business` prerenders static in `next build` with no crash (build exit 0).
- **"everyone → App Store" mutation** → caught by guard G-b (requires `BUSINESS_WEB_URL` + `platform ===`) AND the adversarial test (bans reversed ternary) — both proven to fire on revert.

---

## 5. Findings

- **P0/P1/P2:** NONE.
- **P3 (non-blocking):** (a) `lib/unsubscribe-submit.ts:6` comment reword sits just outside the §10 named Edit allowlist, but spec §4.3 explicitly sanctions it; benign, no functional change. (b) Analytics event firing is consent-gated and not observed headlessly (source+guard proven) — recommend a one-tap eyeball in PostHog post-deploy for total closure.

**VERDICT: PASS.** All gates re-run green; both business CTAs route correctly on iOS→business App Store / Android+desktop→business web with no form and no QR on either nav or hero; explorer CTA regression clean on all three platforms; Step 0.5 triad satisfied (happy-path fails-on-revert real, adversarial genuinely different-angle, both immutable). Ready for CLOSE (Vercel `[deploy]` tag + flip `I-PROPOSED-1324-…` DRAFT→ACTIVE).
