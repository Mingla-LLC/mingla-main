# TESTER DISPATCH — ORCH-0964 [Public-page theme customization + consumer-app brand screen + Universal/App Links]

**Dispatched:** 2026-05-26 by Claude `mingla-orchestrator` (REVIEW APPROVED `5ed83d99c`)
**Target skill:** Claude `mingla-tester` (canonical TEST owner per `feedback_tester_canonical_and_platform_parity.md`)
**Sub-mode:** SPEC-COMPLIANCE + TARGETED (touches 5 primary surfaces, needs Step 7 parity enforcement)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-0964-[public-page-theme-customization]/`
**Branch:** `ORCH-0964-public-page-theme-customization` (HEAD `5ed83d99c`)
**Severity:** S2-medium

---

## Goal

Independently verify ORCH-0964's implementation against the 23 success criteria in SPEC + amendments, on 4 devices (buyer-web Chromium + iOS Simulator + Android Emulator + Seth's physical iPhone). Produce a PASS / CONDITIONAL PASS / FAIL verdict with evidence per gate.

## Binding contract — READ ALL FOUR

1. `Mingla_Artifacts/specs/SPEC_ORCH-0964_PUBLIC_PAGE_THEME_CUSTOMIZATION.md` — base SPEC (15 success criteria, 4 new invariants).
2. `Mingla_Artifacts/specs/SPEC_ORCH-0964_AMENDMENT_POST_0961_0962_0963.md` — view-layer + kind-branched IA awareness.
3. `Mingla_Artifacts/specs/SPEC_ORCH-0964_AMENDMENT_2_CONSUMER_BRAND_SCREEN_AND_DEEP_LINKS.md` — consumer-app screen + Universal/App Links (adds SC-16..SC-23).
4. `Mingla_Artifacts/specs/SPEC_ORCH-0964_AMENDMENT_3_POST_META_ORCH_0972.md` — data-driven tabs + `ExperienceMiniCard` + RPC threading.

Supporting:
- Implementation report: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0964_PUBLIC_PAGE_THEME_CUSTOMIZATION.md` (claims to verify independently).
- REVIEW verdict: `Mingla_Artifacts/reports/REVIEW_IMPLEMENTATION_ORCH-0964_PUBLIC_PAGE_THEME_CUSTOMIZATION.md` (APPROVED with 3 discoveries — D-2 is YOURS to verify).
- Step 0.5 proof commit: `9d3ce22e68c0fe977b9b346205fdb473ecbc4c43` (verify the fails-on-revert claim holds when you re-run independently).

## What's already verified by orchestrator (do NOT re-verify; trust + cite)

- Migration applied on remote — `brands.theme_color/theme_font/theme_animation` + `events.theme_color_override/theme_font_override/theme_animation_override` columns exist with CHECK constraints.
- Edge functions untouched (no deploys needed — `supabase/functions/` zero modifications across ORCH-0964 commits).
- 6 new ORCH-0964 strict-grep gates PASS.
- 6 hard guards G1-G6 all CLEAN.
- DEC-179 commit-hash verification PASS.
- Step 0.5 fails-on-revert proof phrase recorded at impl-report line 95.

## What you MUST verify

### 4-device matrix (MANDATORY per `feedback_tester_3sims_plus_operator_physical.md`)

| Device | Surfaces |
|---|---|
| Buyer-web Chromium + Safari (Playwright) | SC-1, SC-2-buyer-web, SC-3, SC-8, SC-11, SC-12 cross-browser parity |
| iOS Simulator (iPhone 17 Pro or 16 Pro) | SC-2-consumer-iOS, SC-19, SC-20, SC-21 |
| Android Emulator (Pixel 8 Pro) | SC-2-consumer-Android, SC-19 parity, SC-21 parity |
| Seth's physical iPhone (Universal Link real-device) | SC-16, SC-18, SC-23 — these CANNOT be reproduced in simulator |

When blocked (sim missing, dev build stale, Vercel deploy gap, missing credentials), ASK Seth with a specific actionable unblock per `feedback_tester_canonical_and_platform_parity.md` — do NOT silently CONDITIONAL PASS.

### Success criteria mapping (23 total)

Walk each SC in the SPEC + amendments and produce a PASS / FAIL / BLOCKED row with evidence:

| SC | Verifiable by |
|---|---|
| SC-1 | Set brand theme via DB OR Theme Editor; verify public brand page renders all 3 knobs (color hero + font headings + Lottie animation on first load). Screenshot + Maestro/Playwright assertion. |
| SC-2-buyer-web | Same brand on Chromium AND Safari. Pixel-diff tolerance acceptable. |
| SC-2-consumer-iOS | Same brand on iOS Sim event-sheet (`ExpandedBusinessEventSheet` → tap brand → `/brand/<slug>`). |
| SC-2-consumer-Android | Same on Android Emulator. |
| SC-3 | Brand-level + event-level override; verify event-override wins for event page, brand-default still renders for brand page. |
| SC-4-business-iOS / SC-4-business-Android | Theme Editor section appears + 3 controls functional. Color hex input, font dropdown, animation dropdown all save. |
| SC-5 | Unit test on `computeForeground('#FFFF00')` → `#000000`. |
| SC-6 | Unit test on `resolveTheme(null, null)` → Mingla default (orange `#eb7825` + Inter + none). |
| SC-7 | Unit test on partial override resolution. |
| SC-8 | Open `/checkout/<eventId>` for a themed brand's event → checkout chrome stays Mingla-neutral. Screenshot diff vs unthemed brand's checkout. |
| SC-9 / SC-10 / SC-11 | Direct SQL with invalid hex/font/animation → CHECK constraint violation. |
| SC-12 | Compare `eas build` size diff vs prior build. ≤ 6 MB increase target. May DEFER until native rebuild fires. |
| SC-13 | Cold-start app on iOS sim with cleared font cache → no FOUT flicker. |
| SC-14 | Open event-sheet, animation plays. Close + re-open within session → animation does NOT replay. |
| SC-15 | Force invalid theme value into DB (bypass CHECK via direct insert in test DB) → resolver falls through, no crash. |
| **SC-16 (Universal Link cold)** | Real iPhone — tap `https://business.usemingla.com/b/<slug>` from Messages → app launches into `/brand/<slug>`. **Requires Vercel deploy AFTER PR merges + fresh dev build on iPhone.** |
| **SC-17 (App Link cold)** | Real Android device — same. **REQUIRES Android SHA256 fingerprint in `assetlinks.json` — currently OPEN, see "Awareness items" below.** |
| SC-18 | Uninstall app, tap URL → browser opens buyer-web themed brand page. |
| SC-19 | Tap brand identity in `ExpandedBusinessEventSheet` → navigates to `/brand/<slug>`, sheet stays mounted under. |
| SC-20 | Side-by-side screenshot diff of buyer-web `/b/leggothis` vs consumer-app `/brand/leggothis` — same theme, same kind-branched IA. |
| SC-21 | Logout from consumer app → `['consumerBrand', ...]` React Query cache cleared. Verify via React Query devtools or by re-login + fresh fetch. |
| SC-22 | `curl -I https://business.usemingla.com/.well-known/apple-app-site-association` → HTTP 200 + `Content-Type: application/json`. **Requires PR merged to main + Vercel deploy. CAN DEFER if PR not yet merged.** |
| SC-23 | Strict-grep gate `orch-0964-brand-rendering-self-contained` PASS (already verified by orchestrator — cite from REVIEW). |

### Discovery D-2 verification (REQUIRED)

REVIEW raised this as a P3 to confirm: Codex created BOTH `app-mobile/app/brand/[slug].tsx` AND `app-mobile/app/b/[slug].tsx`. **Read both files. Confirm:**
- Both mount the same screen via the same `useBrandBySlug` hook.
- Both pass the same props to the shared `<PublicBrandPage>`.
- Neither has divergent logic, divergent loading states, or divergent error handling.

If they diverge: flag as P1 finding. If they're identical pass-throughs: confirm in QA report and downgrade D-2 to "verified clean."

### Step 0.5 fails-on-revert independent verification (REQUIRED)

Re-run the fails-on-revert proof yourself; do NOT trust Codex's claim alone:

```bash
cd ~/Desktop/mingla-orchs/ORCH-0964-[public-page-theme-customization]
# 1. note current HEAD
git rev-parse HEAD
# 2. checkout the revert proof commit
git checkout 9d3ce22e68c0fe977b9b346205fdb473ecbc4c43
# 3. run the test
cd mingla-business && npx jest src/utils/__tests__/themeResolver.orch_0964.test.ts --runInBand
# 4. confirm FAIL on at least one assertion
# 5. return to HEAD
cd .. && git checkout 5ed83d99c
# 6. re-run
cd mingla-business && npx jest src/utils/__tests__/themeResolver.orch_0964.test.ts --runInBand
# 7. confirm PASS 4/4
```

Cite the commit hashes + assertion that failed in your QA report. **You will also write an adversarial regression test per ORCH-0840** — Step 0.5(b) gate. Suggested adversarial angles (pick ONE that attacks a different surface than the happy-path test):

- Boundary luminance: hex exactly at the WCAG 0.179 threshold (`#777777` and adjacent values).
- Race condition: brand-theme query loads AFTER event-override query — verify resolver doesn't flicker.
- Malformed input: hex with wrong length, missing `#`, uppercase variants.
- Invariant violation attempt: try to write theme keys into `events.theme` JSONB via the patch path — confirm rejection.

## Awareness items (do NOT block on these — surface as conditions)

| Item | Status | Tester action |
|---|---|---|
| **Android SHA-256** | OPEN — Seth pulls from Google Play Console (Setup → App integrity → App signing key certificate → SHA-256) | If still open when you reach SC-17, mark SC-17 BLOCKED with operator-unblock-needed flag. CONDITIONAL PASS acceptable. |
| **`.well-known/` Vercel deploy** | OPEN — requires PR-merge to main first | If still open when you reach SC-22, mark SC-22 BLOCKED-pending-CLOSE. Run the curl post-CLOSE. |
| **`usemingla.com` host placement** | OPEN — Seth's decision | If still open, mark as N/A (only `business.usemingla.com` is wired today; if `usemingla.com/b/<slug>` URLs are ever produced, that's future-ORCH scope). |
| **Pre-merge rebase** | Branch is 4 commits behind main | Confirm at TEST time whether Codex rebased. If not, run gates on the rebased tree to confirm META-ORCH-0972's 2 new gate files still PASS post-rebase. |
| **`orch-0962-brand-field-map-coverage` gate broken on `main`** | Pre-existing per REVIEW D-1 | NOT ORCH-0964's responsibility. Cite in "Discoveries for Orchestrator". |

## Dev build context (relevant for sim verification)

Seth is producing fresh `eas build --profile development` builds for BOTH apps in parallel with this dispatch. Once he confirms the dev builds are installed on his iPhone, you can:
1. Publish an EAS Update to the development channel: `cd app-mobile && eas update --branch development --platform ios --message "ORCH-0964 tester preview"`.
2. Have Seth force-close + reopen both apps to pull the bundle.
3. Validate consumer iPhone surfaces (SC-19, SC-20 partial, SC-21 partial) against his real device BEFORE store submission.

This is preview-only — production native rebuild still happens post-CLOSE. But it gets you real-device evidence for SC-16/SC-19/SC-23 ahead of store review.

## Expected output

`Mingla_Artifacts/reports/QA_ORCH-0964_PUBLIC_PAGE_THEME_CUSTOMIZATION_REPORT.md` with:

1. Verdict (PASS / CONDITIONAL PASS / FAIL).
2. SC-by-SC mapping with PASS / FAIL / BLOCKED + evidence per row.
3. P0..P4 finding count.
4. Discovery D-2 verification result.
5. Step 0.5 independent re-run with commit hashes cited.
6. Adversarial regression test added (filename + commit hash + `fails-on-revert verified at <hash>` proof phrase).
7. Constitution 14-rule pass/fail/N-A matrix.
8. Discoveries for Orchestrator (new findings).
9. If CONDITIONAL PASS: explicit list of conditions accepted with operator-flagging-needed indicator.

## Downstream routing

After QA report return:
- Claude `mingla-orchestrator` adjudicates verdict.
- If PASS or CONDITIONAL PASS with accepted conditions → CLOSE protocol (commit-hash verify + dep walk + DIAG reap + 7 artifact updates + commit with `[deploy]` tag + EAS build trigger + store submission queue).
- If FAIL → REWORK dispatch back to Codex `implementor-mingla` with specific findings.
