# IMPLEMENTATION — ORCH-1324 [business "Get the app" → device-aware live-store link + business web; retire the beta gate]

**Phase:** IMPLEMENT (complete) — awaiting TEST/CLOSE.
**Branch:** `orch-1324-business-get-app-cta` · **Impl commit (fails-on-revert anchor):** `55d739cc3`
**Surface:** `mingla-marketing/` only (+ the two retired guards/yml jobs + registry). No app/native/Supabase change.
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-1324_BUSINESS_GET_APP_DEVICE_AWARE_CTA.md` — implemented exactly, in the §8 order.
**Seth-locked at REVIEW:** both CTA labels "Get the app"; hero subcopy "On iPhone now — or get started on the web."; iOS → `BUSINESS_APP_STORE_URL`, Android+desktop/other → `BUSINESS_WEB_URL`.

---

## Per-file change summary (DONE / evidence)

### §4.0 `mingla-marketing/lib/store-links.ts` — EDIT — DONE
Appended below `APP_STORE_URL`/`PLAY_STORE_URL` (unchanged): `BUSINESS_APP_STORE_URL = 'https://apps.apple.com/app/id6768737367'` + `BUSINESS_WEB_URL = 'https://business.usemingla.com'` (no trailing slash), with the SSOT header comment. `links-config.tester.test.ts` still reads the two explorer consts → green.

### §4.1 `components/marketing/glass-nav.tsx` — EDIT (organiser branch) — DONE
- Removed the `BetaAccessModal` import; removed `betaOpen` state + its comment; removed the organiser `<BetaAccessModal … />` mount block.
- Extended the `store-links` import to add `BUSINESS_APP_STORE_URL` + `BUSINESS_WEB_URL`.
- Added `handleGetTheBusinessApp()` (`:76-88`): `detectClientPlatform()` → `dest = platform === 'ios' ? BUSINESS_APP_STORE_URL : BUSINESS_WEB_URL`; `captureMarketing('get_the_app_clicked', { platform, store, surface:'organiser', location:'nav' })`; `window.open(dest,…)` → `window.location.assign(dest)` popup fallback.
- Organiser `<Button>` now `onClick={handleGetTheBusinessApp}`, label "Get the app", **`aria-haspopup`/`aria-expanded` dropped** (it navigates, no dialog). Old `marketing_cta_clicked{cta_id:'get_beta_access'}` removed.
- Explorer branch + `handleGetTheApp` + the `<AppQrPanel>` mount + `qrOpen`/`setQrOpen` **UNCHANGED**. No `BetaAccessModal` remains.

### §4.2 `components/sections/organiser-home/hero.tsx` — EDIT — DONE
- Removed the `BetaAccessModal` import, the `useState` import (its only use was `betaOpen`), the `betaOpen` state, and the `<BetaAccessModal … />` mount.
- Added imports: `detectClientPlatform`, `{ BUSINESS_APP_STORE_URL, BUSINESS_WEB_URL }`, `captureMarketing`.
- Added `handleGetTheBusinessApp()` mirroring the nav handler with `location:'hero'`.
- Button → `onClick={handleGetTheBusinessApp}`, label "Get the app"; subcopy → "On iPhone now — or get started on the web."
- ORCH-1045 header comment updated to an ORCH-1324 note; `I-1045-HERO-NO-VIDEO` intent preserved (hero stays video-free — no video modal added). `HeroBookingWall`, overlays, `text-warm` "found." accent, `useMinglaReducedMotion` untouched → `organiser-redesign.test.ts` stays green (no FORBIDDEN phrase in the new copy).

### §4.3 Retire the beta funnel — DELETE — DONE
- Deleted `components/marketing/beta-access-modal.tsx` + `lib/beta-access-submit.ts`.
- `supabase/functions/beta-access-lead-submit/` + its `config.toml` block + `beta_access_leads` table/migration + `admin_beta_leads_list` — **NOT touched** (kept dark).
- `lib/unsubscribe-submit.ts:6` comment reworded (dropped the now-dangling `lib/beta-access-submit.ts` reference — spec §4.3 permits; needed for the grep-clean gate).

### §4.4/§9 Guards + yml — DONE
- Deleted `.github/scripts/strict-grep/i-proposed-1216-explorer-only-cta.mjs` + `i-proposed-1219-form-no-autoadvance-multiselect.mjs`.
- `strict-grep-mingla-business.yml`: deleted the `orch-1216-explorer-only-cta` + `orch-1219-form-no-autoadvance-multiselect` jobs, left a RETIRED breadcrumb comment (kept the pre-existing ORCH-1319 RETIRED comment intact), added the `orch-1324-business-getapp-device-aware` job + a gate-index comment entry. `orch-1216-no-service-key-client` + all four `orch-1319-*` jobs untouched. Job count now 321.
- Added `.github/scripts/strict-grep/orch-1324-business-getapp-device-aware.mjs` (model: `orch-1319-getapp-cta-direct-store.mjs`; comment-stripped; scans both targets; `--self-test` 11/11 = GOOD + 9 violation fixtures + comment-strip case).

### §6 `Mingla_Artifacts/INVARIANT_REGISTRY.md` — DONE
- Registered DRAFT `I-PROPOSED-1324-BUSINESS-GETAPP-DEVICE-AWARE` (appended at the tail).
- `I-PROPOSED-1216-EXPLORER-ONLY-CTA` → **DECOMMISSIONED (ORCH-1324, 2026-07-09)** with reason + superseding pointer to I-PROPOSED-1324; historical rule line kept.
- `I-PROPOSED-1219-FORM-NO-AUTOADVANCE-MULTISELECT` → **DECOMMISSIONED (ORCH-1324, 2026-07-09)**, no superseder (form deleted); historical rule line kept.

### §7 Tests — CREATE (append-only) — DONE
- `components/marketing/__tests__/business-getapp-cta.test.ts` (happy-path, 10/10) — reads `glass-nav.tsx`+`hero.tsx` source; asserts each references both `BUSINESS_*` consts via the `platform === 'ios' ? BUSINESS_APP_STORE_URL : BUSINESS_WEB_URL` ternary, calls `detectClientPlatform()`, fires `get_the_app_clicked { surface:'organiser', location }`, has the `window.location.assign` fallback, right label + (hero) locked subcopy. Nav checks scoped to the `handleGetTheBusinessApp` body (never the explorer handler).
- `components/marketing/__tests__/business-getapp-cta.tester.test.ts` (adversarial, 7/7) — comment-stripped (mirrors the guard); asserts (a) no beta-funnel tokens, (b) non-iOS = `BUSINESS_WEB_URL` + `store:'business_web'` + no reversed ternary (guards "everyone → App Store"), (c) NO QR panel scoped to the ORGANISER handler/CTA branch + hero (NOT a whole-file grep — the explorer branch legitimately keeps `AppQrPanel`/`setQrOpen`, asserted present as a scoping sanity). Banned-token regexes built from fragments so the test file itself stays grep-clean.

---

## Gates — command + result

| Gate | Command | Result |
|---|---|---|
| npm ci | `cd mingla-marketing && npm ci` | exit 0 (node_modules was absent) |
| typecheck | `npm run typecheck` (`tsc --noEmit`) | **exit 0**, clean, no dangling imports |
| build | `npm run build` (`next build`) | **✓ compiled 8.8s, 13/13 pages**; `/business` 25.9 kB; no dangling imports |
| new guard self-test | `node …/orch-1324-business-getapp-device-aware.mjs --self-test` | **PASS 11/11** |
| new guard live | `node …/orch-1324-business-getapp-device-aware.mjs` | **PASS** (both targets device-aware, no funnel) |
| ORCH-1319 G-1 self-test | `…/orch-1319-getapp-cta-direct-store.mjs --self-test` | **PASS 8/8** (explorer parity intact) |
| ORCH-1319 G-2 self-test | `…/orch-1319-download-route-ua.mjs --self-test` | **PASS 6/6** |
| ORCH-1319 G-3 self-test | `…/orch-1319-qr-encodes-download-url.mjs --self-test` | **PASS 5/5** |
| ORCH-1319 G-4 self-test | `…/orch-1319-no-testflight-anywhere.mjs --self-test` | **PASS 4/4** |
| security guard self-test | `…/i-proposed-1216-no-service-key-client.mjs --self-test` | **PASS 4/4** |
| happy-path test | `tsc … && node …/business-getapp-cta.test.js` | **10/10 PASS** |
| adversarial test | `tsc … && node …/business-getapp-cta.tester.test.js` | **7/7 PASS** |
| device-platform test | `tsc … && node …/device-platform.test.js` | **7/7 PASS** (unchanged) |
| links-config test | `tsc … && node …/links-config.tester.test.js` | **10/10 PASS** (store-links additions don't break the two read consts) |
| beta-funnel grep | `grep -rn "BetaAccessModal\|beta-access-modal\|beta-access-submit\|Get Beta Access\|get_beta_access\|Free during beta" mingla-marketing/ --include=*.ts --include=*.tsx` | **0 hits — PASS** |

---

## Fails-on-revert proof

**fails-on-revert verified at `fda32dbab`.**

Method: from impl commit `55d739cc3`, restored `hero.tsx` to the `origin/main` (beta-modal) version and committed it as `fda32dbab` ("TEMP fails-on-revert proof"). The happy-path test then FAILED **5/5 hero assertions** — first/representative failing assertion:

> `FAIL  hero: references BOTH BUSINESS_APP_STORE_URL and BUSINESS_WEB_URL: hero missing BUSINESS_APP_STORE_URL`

(also `hero button is not wired to handleGetTheBusinessApp`, missing ternary / `get_the_app_clicked` / `window.location.assign`). The 5 nav assertions still passed (only hero was reverted), proving each CTA is independently pinned. The tree was then `git reset --hard 55d739cc3` (revert commit orphaned to reflog) and the happy-path re-run → **10/10 PASS**. Working tree clean.

---

## Deviations from spec

- **`lib/unsubscribe-submit.ts:6` comment reworded** (dropped the `lib/beta-access-submit.ts` mention). Spec §4.3 explicitly permits this ("optionally reword; non-blocking"); it is also now a dangling reference (I deleted that file), and the §4.3 grep-clean gate requires zero hits across `mingla-marketing/`. Not in the §10 Edit allowlist as a named file, but §4.3 sanctions the touch. No functional change.
- **Adversarial test token list built from string fragments** (`frag('Beta','AccessModal')` …) so the banned literals never appear verbatim in the test file — otherwise the §4.3 grep (which scans `*.ts` including test files) would return hits. Behaviourally identical: `frag` re-joins at runtime, so a real reverted CTA still fires the assertion.
- **Branch name** is `orch-1324-business-get-app-cta` (the worktree branch), not the `orch-1324-business-getapp-device-aware` string used loosely in the dispatch's Gates section. Committed on the actual worktree branch.
- **No `[deploy]` tag / no merge / no deploy** — per dispatch, those happen at MERGE/CLOSE.

## Not runtime-verified (honest caps)

- **DOM click → store/web navigation + PostHog event (T-1…T-5):** proven by the guard (device-driven + `surface:'organiser'` + fallback), the happy/adversarial source tests, `device-platform.test.ts` (the exact resolver), typecheck + production build. The browser *click* firing `window.open`/`window.location.assign` and the PostHog capture were NOT browser-driven here (no jest/RTL/Playwright wired in `mingla-marketing`). Recommend the tester drive nav+hero on a physical iPhone (→ business App Store) + Android/desktop (→ `business.usemingla.com`) and confirm one `get_the_app_clicked` per tap in PostHog.

---

## Files

**Created:** `.github/scripts/strict-grep/orch-1324-business-getapp-device-aware.mjs`; `mingla-marketing/components/marketing/__tests__/business-getapp-cta.test.ts`; `mingla-marketing/components/marketing/__tests__/business-getapp-cta.tester.test.ts`.
**Edited:** `mingla-marketing/lib/store-links.ts`; `mingla-marketing/components/marketing/glass-nav.tsx`; `mingla-marketing/components/sections/organiser-home/hero.tsx`; `mingla-marketing/lib/unsubscribe-submit.ts`; `.github/workflows/strict-grep-mingla-business.yml`; `Mingla_Artifacts/INVARIANT_REGISTRY.md`.
**Deleted:** `mingla-marketing/components/marketing/beta-access-modal.tsx`; `mingla-marketing/lib/beta-access-submit.ts`; `.github/scripts/strict-grep/i-proposed-1216-explorer-only-cta.mjs`; `.github/scripts/strict-grep/i-proposed-1219-form-no-autoadvance-multiselect.mjs`.

**Commits:** impl `55d739cc3` (all of the above) + docs `<see git log>` (this report + spec + investigation artifacts). Orphaned proof commit `fda32dbab` (fails-on-revert, reset out).
