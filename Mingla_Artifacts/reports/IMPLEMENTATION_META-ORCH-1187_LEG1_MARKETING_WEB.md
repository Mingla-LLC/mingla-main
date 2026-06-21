# IMPLEMENTATION — META-ORCH-1187 [Growth Analytics Hub] — Phase 1, LEG 1 (Marketing Web)

**Skill:** mingla-implementor (Claude)
**Date:** 2026-06-21
**Worktree:** `~/Desktop/mingla-orchs/META-ORCH-1187-[growth-analytics-hub]/` on branch `META-ORCH-1187-growth-analytics-hub`
**Spec (binding):** `Mingla_Artifacts/specs/SPEC_META-ORCH-1187_GROWTH_ANALYTICS_PHASE1.md` (v2, commit `1d93b6bce`; dispatch cited `7637415ab`)
**Scope:** §8 sequence STEP 1 ONLY — marketing web (`mingla-marketing/`, Next.js 15 app-router). Buyer web (LEG 2) and native apps (LEG 3) are explicitly NOT built this pass.
**Status:** implemented and verified (build + typecheck + 6 gates green; 3 structural fails-on-revert proofs captured).

---

## 1. Summary (plain English)

The marketing site `usemingla.com` now has analytics — but only after the visitor agrees. On first visit a Mingla-branded cookie banner appears at the bottom of the page (Accept all / Reject). Until "Accept all" is clicked, PostHog stores nothing and captures nothing, and Google Analytics 4 is held in a default-denied "no cookies" state. On Accept, PostHog opts in and GA4 consent flips to granted; on Reject, both stay off. PostHog session replay is on but every input is masked (the beta-access email field can never appear in a recording), and replay is sampled to ~20% to protect the free tier. Three marketing conversion signals now fire (primary-CTA taps, nav CTA tap, successful beta-access submit). The stale footer Privacy/Terms links were corrected to the real routes.

---

## 2. SPEC success-criteria coverage (LEG-1 subset)

| SC | Criterion | Status | Evidence / commit |
|----|-----------|--------|-------------------|
| SC-1-Marketing | Homepage sends `$pageview` to PostHog 479999 + GA4 realtime hit | IMPLEMENTED, runtime-unverified | provider inits with `capture_pageview:true`; `<GoogleAnalytics>` mounted. Live verification = Seth/tester on prod (needs Vercel env + SA-1/SA-2). |
| SC-2-Marketing | CTA tap fires `marketing_cta_clicked`; beta submit fires `beta_access_submitted` | IMPLEMENTED, runtime-unverified | capture calls in `cta-banner.tsx`, `glass-nav.tsx`, `beta-access-modal.tsx`, `beta-access-submit.ts`. |
| SC-9-SecretHygiene | No `phx_*` in any committed file / client bundle; only `phc_*` + `G-Z4W3B9900S` ship | VERIFIED | gate `i-proposed-1187-no-phx-in-client.mjs` PASS (2933 files, 0 phx_). Key referenced via env only, never hardcoded. |
| SC-10-Consent-Marketing | Fresh visit: banner shows, NO cookies / NO `$pageview` until Accept; Reject = stays off | IMPLEMENTED, runtime-unverified | `opt_out_capturing_by_default:true` + GA4 consent default-denied (pre-GA). Structural gate PASS; runtime cookie inspection = tester (T-13/14/15). |
| SC-13-Flags / SC-14-Surveys / SC-15-Errors | power-feature smoke | PARTIAL | `autocapture:true` + `capture_exceptions:true` enabled (error tracking + autocapture wired). Feature-flag/survey reads are SDK-available; explicit smoke reads are not on the marketing site this leg (no flag call site specified for marketing). Tester verifies via PostHog UI after SA-2. |
| SC-16-CostGuard | replay sampling configured; $0 billing cap (Seth) | IMPLEMENTED (code) + SA-1 (Seth) | `sampleRate: 0.2` set (`PH_REPLAY_SAMPLE_RATE`). $0 billing cap = SA-1 Seth action. |
| SC-Security-Web (config) | masking never false | VERIFIED | gate `i-proposed-1187-replay-masks-pii.mjs` PASS; `maskAllInputs:true` + email/password masking. Runtime recording inspection (T-16) = tester. |
| I-PROPOSED-1187-POSTHOG-HOST-US | US host at init | VERIFIED | gate PASS; `api_host:'https://us.i.posthog.com'`. |
| I-PROPOSED-1187-CONSENT-GATE-BEFORE-COOKIES | opt-out-default + GA consent-default-denied pre-GA | VERIFIED | gate PASS + fails-on-revert proof. |
| I-PROPOSED-1187-REPLAY-MASKS-PII | masking on everywhere | VERIFIED | gate PASS + fails-on-revert proof. |
| I-PROPOSED-1187-ANALYTICS-WEB-ONLY-VIA-WEB-TS | web-only isolation | VERIFIED (marketing leg) | gate PASS; marketing posthog-js only in `'use client'` components. Buyer-web/native rules zero-violation today, guarding later legs. |

NOTE: SC-3..SC-8, SC-11, SC-12, SC-Security-Native, T-19 are LEG-2/LEG-3 (buyer web + native) — out of scope this pass.

---

## 3. Files changed

**Modified (10):**
- `mingla-marketing/package.json` (+`posthog-js@^1.205.0`, +`@next/third-parties@^15.1.6`)
- `mingla-marketing/package-lock.json` (npm install resolution — posthog-js@1.391.2, @next/third-parties@15.5.19)
- `mingla-marketing/app/layout.tsx` (+36) — GA4 Consent-Mode-v2 default-denied `<Script beforeInteractive>`, mount `<PostHogProvider>` + `<ConsentBanner>` + `<GoogleAnalytics>`
- `mingla-marketing/components/marketing/footer.tsx` (~8) — `/privacy`→`/privacy-policy`, `/terms`→`/terms-of-service` (both column sets)
- `mingla-marketing/components/marketing/cta-banner.tsx` (+25) — `marketing_cta_clicked` on delegated CTA tap (+ optional `ctaId` prop)
- `mingla-marketing/components/marketing/glass-nav.tsx` (+24) — `marketing_cta_clicked` on nav CTA (organiser + explorer; explorer button stays dead-locked, observe-only)
- `mingla-marketing/components/marketing/beta-access-modal.tsx` (+8) — `marketing_cta_clicked` on submit success
- `mingla-marketing/lib/beta-access-submit.ts` (+11) — `beta_access_submitted` on successful POST
- `mingla-marketing/.env.example` (+13) — `NEXT_PUBLIC_POSTHOG_KEY/HOST` + `NEXT_PUBLIC_GA4_MEASUREMENT_ID`
- `.github/workflows/strict-grep-mingla-business.yml` (+23) — added `mingla-marketing/**` to trigger paths + a new `i-proposed-1187-growth-analytics` job running all 6 gates

**New (8):**
- `mingla-marketing/components/marketing/posthog-provider.tsx` (129) — consent-gated PostHog init + capture/opt-in/opt-out helpers
- `mingla-marketing/components/marketing/consent-banner.tsx` (175) — branded banner; PostHog opt-in/out + GA4 Consent-Mode-v2 update; localStorage `mingla_consent_v1`
- `.github/scripts/strict-grep/i-proposed-1187-posthog-host-us.mjs` (112)
- `.github/scripts/strict-grep/i-proposed-1187-no-phx-in-client.mjs` (84)
- `.github/scripts/strict-grep/i-proposed-1187-consent-gate-before-cookies.mjs` (152)
- `.github/scripts/strict-grep/i-proposed-1187-replay-masks-pii.mjs` (123)
- `.github/scripts/strict-grep/i-proposed-1187-analytics-web-only-via-web-ts.mjs` (133)
- `.github/scripts/strict-grep/i-proposed-1187-marketing-layout-mounts-analytics.mjs` (81) — happy-path regression

All within the SPEC §allowlist (Marketing section + Infra/tests). No DO-NOT-TOUCH file touched: `next.config.ts` CSP untouched, no `mingla-admin`, no edge functions, no Mixpanel/AppsFlyer, no buyer-web/native files.

---

## 4. Data-model changes
None. LEG 1 is client-side web only — no migrations, no RLS, no SQL.

## 5. Edge functions touched
None. (Spec DO-NOT-TOUCH: no server-side capture this phase.)

---

## 6. Regression tests + fails-on-revert proof

**Happy-path regression (implementor-owned):** `.github/scripts/strict-grep/i-proposed-1187-marketing-layout-mounts-analytics.mjs` — asserts `app/layout.tsx` mounts `<PostHogProvider>` + `<ConsentBanner>` + `<GoogleAnalytics gaId>` and the provider init uses the US host. This is the §9 marketing fails-on-revert contract. (The marketing project has no jest/vitest harness; a Node structural gate is the in-CI-runnable form and matches the §9 "unit/lint test" intent.)

**fails-on-revert verified at commit `<FILLED ON COMMIT>` (see commit hash list in Section 0 of chat):**
- CONSENT gate: deleted the `opt_out_capturing_by_default: true` line → `i-proposed-1187-consent-gate-before-cookies.mjs` exit 1 (FAIL). Restored → exit 0 (PASS).
- REPLAY-MASKS-PII gate (SECURITY): flipped `maskAllInputs: true`→`false` → `i-proposed-1187-replay-masks-pii.mjs` exit 1 (FAIL). Restored → exit 0.
- POSTHOG-HOST-US gate: replaced US host with `eu.i.posthog.com` → `i-proposed-1187-posthog-host-us.mjs` exit 1 (FAIL). Restored → exit 0.
- Layout-mount regression: deleted `<GoogleAnalytics gaId` mount → exit 1; deleted `<PostHogProvider />` → exit 1; restored → exit 0.

All reverts were TRUE LINE DELETION / value-flip (not comment-out). All gates comment-strip before structural checks so doc-comment prose does not produce false positives.

---

## 7. Old → New receipts

### app/layout.tsx
- **Before:** root layout mounted fonts + skip-link + `{children}` + `<ContentProtection/>`. No analytics, no `<head>` block.
- **Now:** adds a `<head>` with a `beforeInteractive` GA4 Consent-Mode-v2 default-DENIED snippet (runs before GA loads), and mounts `<PostHogProvider/>`, `<ConsentBanner/>`, `<GoogleAnalytics gaId={…}/>` in the body.
- **Why:** SC-1, SC-10, consent-gate-before-cookies invariant. Server component stays server (the analytics children are client components).

### components/marketing/posthog-provider.tsx (new)
- **Now:** `'use client'` provider; `initPostHog()` (idempotent, no-ops on missing key) with `opt_out_capturing_by_default:true`, US host, autocapture, `capture_exceptions`, masked session_recording (`maskAllInputs:true`, email/password mask, `sampleRate:0.2`). Exports `captureMarketing`, `posthogOptIn/Out`.
- **Why:** SC-1/2/9/10/13-15/16/Security; the 5 invariants.

### components/marketing/consent-banner.tsx (new)
- **Now:** branded bottom-anchored banner (glass-strong surface, existing `<Button>` variants, framer-motion + reduced-motion, `role="dialog"`, `data-theme="light"`). Accept → PostHog opt-in + GA consent update granted; Reject → opt-out + GA stays denied. Persists `mingla_consent_v1` in localStorage; re-applies on reload; links to `/privacy-policy`.
- **Why:** §4.E. No third-party CMP, no new design system. Accept/Reject covers the single analytics category; `applyConsent(value)` structure allows a future granular "Manage" panel.

### footer.tsx / cta-banner.tsx / glass-nav.tsx / beta-access-modal.tsx / beta-access-submit.ts
- **footer:** href corrections only (real routes confirmed to exist: `app/privacy-policy/page.tsx`, `app/terms-of-service/page.tsx`).
- **cta-banner:** `onClickCapture` delegated capture of `marketing_cta_clicked` (cta_id/location/label) when a CTA inside the banner is tapped.
- **glass-nav:** capture on the organiser "Get Beta Access" CTA and (observe-only) on the dead-locked explorer "Get the app" — the dead button's behavior is unchanged (NG-1 honored).
- **beta-access-modal:** capture `marketing_cta_clicked` on submit success.
- **beta-access-submit:** capture `beta_access_submitted` (surface_role:'organiser') on a successful POST.
- All captures are consent-gated no-ops (PostHog drops while opted-out) and never throw.

---

## 8. Cross-surface impact

| Surface | Affected | Note |
|---------|----------|------|
| Marketing Web (`mingla-marketing`) | YES | This leg. Standalone Next.js app. |
| Buyer/anon Web (`mingla-business` web) | NO | LEG 2 — not touched. |
| Consumer iOS / Android (`app-mobile`) | NO | LEG 3 — not touched. |
| Business iOS / Android (`mingla-business` native) | NO | LEG 3 — not touched. |
| Admin Web (`mingla-admin`) | NO | Phase-2 surface; DO-NOT-TOUCH. |
| Business Web preview | NO | LEG 2. |

Parity: marketing is a standalone app — no parity surface this leg. The 4 gates that scan all client trees (`mingla-business`, `app-mobile`) are zero-violation today and lock the contract for the later legs.

---

## 9. Smoke result (what was run)
- `npm install` in `mingla-marketing` — added 346 packages, posthog-js@1.391.2 + @next/third-parties@15.5.19 resolved.
- `npm run typecheck` (`tsc --noEmit`) — PASS, no errors.
- `npm run build` (clean `.next` removed first) — `✓ Compiled successfully`, `✓ Generating static pages (12/12)`. All routes build, no regressions.
- All 6 strict-grep gates — PASS.
- 3 fails-on-revert proofs + the layout-mount regression deletion proofs — captured above.
- `next lint` is NOT configured in this project (interactive setup prompt; pre-existing — no eslint config present). typecheck + build are the authoritative compile gates and both pass.

Runtime/live verification (events landing in PostHog 479999 + GA4 realtime, cookie inspection on a fresh visit, replay-recording PII inspection) requires Vercel env + the Seth actions below and is the tester's job.

---

## 10. Known issues / deferred
- No live-fire runtime evidence captured (no prod deploy / Vercel env from the implementor). Tester runs T-1/T-2/T-13/T-14/T-15/T-16 against a deployed build.
- "Manage" granular consent panel not built (spec: "may be a single combined toggle"; structure allows adding it later).
- Feature-flag/survey explicit smoke reads (SC-13/SC-14) are not wired on the marketing site (no marketing flag call site in the spec); SDK is available. Tester verifies via PostHog UI after SA-2.
- `next lint` not set up in the project (pre-existing).

---

## 11. Operator action required (Seth / orchestrator)

Migration `db push`: NONE (no migration this leg).
Edge-fn deploy: NONE.

**Seth actions to make analytics live (from §10 of spec):**
1. **Vercel env (mingla-marketing project, Production + Preview):**
   - `NEXT_PUBLIC_POSTHOG_KEY` = the `phc_*` project key (project 479999) — from the master keys doc.
   - `NEXT_PUBLIC_POSTHOG_HOST` = `https://us.i.posthog.com`
   - `NEXT_PUBLIC_GA4_MEASUREMENT_ID` = `G-Z4W3B9900S`
   (Without the PostHog key the provider gracefully no-ops — the site never crashes.)
2. **SA-1 ($0 billing cap):** PostHog project 479999 → Billing → set $0 limit on every product + ensure no card on file.
3. **SA-2 (project settings):** enable Session Replay + Surveys in PostHog project settings; create one smoke survey + one smoke experiment.
4. **SA-3 (privacy policy):** confirm `mingla-marketing/lib/privacyContent` mentions PostHog/GA analytics + cookies (the banner links to `/privacy-policy`).
5. Deploy mingla-marketing (Vercel) after env is set.

**Orchestrator:** route to mingla-tester for §SC + §7 runtime verification, then CLOSE (flip the 5 I-PROPOSED-1187-* invariants ACTIVE once all legs land — only the marketing-relevant assertions are exercised this leg). LEGs 2/3 still to dispatch.

---

## 12. Discoveries for Orchestrator
- The `Strict Grep Gates` workflow did NOT include `mingla-marketing/**` in its trigger paths. I added it so marketing-only changes (e.g. a consent-gate revert) trigger the gates. The gates also trigger via the `.github/scripts/strict-grep/**` path, so they run on any gate edit regardless.
- `mingla-marketing` has no test runner (jest/vitest) and no configured `next lint`. The §9 regression is delivered as an in-CI Node structural gate. If the program wants a JSX-rendering unit test for the banner, that's a separate tooling-setup ORCH.
- COMMS ledger: read on entry. No BLOCK rows. WARN rows COMMS-0048 (anchor pre-commit hook — I work on a branch in a worktree, compliant), COMMS-0050/0049 (branch-hygiene / ID-collision — not applicable to this leg). No new COMMS warranted (this leg touches only marketing files no other in-flight ORCH owns).
