# INVESTIGATION — ORCH-1324 [business-get-app-device-aware-cta]

**Phase:** INVESTIGATE (evidence-backed confirmation) → feeds SPEC.
**Surface:** `mingla-marketing/` ONLY — the business/organiser marketing surface (`usemingla.com/business`), Next.js 15 App Router. No app/native change.
**Anchor:** worktree rebased to `origin/main` tip `08b630ded` (verified up to date at investigation time).
**Method:** read every file in the CTA/guard/test/invariant chain at `origin/main`; live-verified the two external destinations (App Store listing + business web root) by URL + source.

---

## 0. One-line verdict

The change is well-formed and low-risk **IF done as a full retirement of the business beta funnel** (mirroring how ORCH-1319 retired the explorer beta funnel): the two business CTAs become device-aware "Get the app" actions (iOS → live business App Store, Android/desktop → `business.usemingla.com`), and the now-orphaned `BetaAccessModal` + `lib/beta-access-submit.ts` + their **two** CI guards + **two** registered invariants must be retired together, because those two guards hard-require the modal to exist and be mounted. The `beta_access_leads` table + `beta-access-lead-submit` edge function stay intact (kept dark, no client caller).

---

## 1. Confirmed / corrected findings (each with evidence)

### 1.1 CONFIRMED — the two business CTAs and their current wiring
- **Nav CTA** — `mingla-marketing/components/marketing/glass-nav.tsx`:
  - `surface === 'organiser'` branch (`:124-140`) renders `<Button variant="glass" size="sm">Get Beta Access</Button>`; `onClick` fires `captureMarketing('marketing_cta_clicked', { cta_id:'get_beta_access', location:'nav' })` then `setBetaOpen(true)`; `aria-haspopup="dialog"` + `aria-expanded={betaOpen}`.
  - `betaOpen` state at `:37`; `import { BetaAccessModal }` at `:7`; the modal mounts organiser-only at `:160-166` with `source="organiser_marketing_nav"`.
  - The `surface === 'explorer'` branch (`:141-155`) is the **ORCH-1319 template** — `handleGetTheApp()` (`:44-65`) calls `detectClientPlatform()`, branches iOS→`APP_STORE_URL` / Android→`PLAY_STORE_URL` (opens store, `window.open`→`window.location.assign` popup fallback), else opens `<AppQrPanel>` (desktop QR). **Do not alter the explorer branch.**
- **Hero CTA** — `mingla-marketing/components/sections/organiser-home/hero.tsx`:
  - `:85-88` renders `<Button variant="primary" size="lg" onClick={() => setBetaOpen(true)}>Get Beta Access <ArrowRight/></Button>`; subcopy `:89-91` "Free during beta. Two minutes to join."; `betaOpen` state `:24`; `import { BetaAccessModal }` `:6`; mount `:97-101` with `source="organiser_marketing_hero"`.

### 1.2 CONFIRMED — the reusable ORCH-1319 pieces exist and are correct to reuse
- `mingla-marketing/lib/device-platform.ts` — `detectClientPlatform()` (`:43-50`, SSR-safe), `resolvePlatform`, `resolvePlatformFromUa`, `isIosDevice`, `type Platform = 'ios'|'android'|'other'`. Reuse `detectClientPlatform()` verbatim; **no change to this file.**
- `mingla-marketing/lib/store-links.ts` — currently exports only the two explorer consts `APP_STORE_URL` (`id6760440898`) + `PLAY_STORE_URL`. This is the single-source-of-truth file to EXTEND with the two business consts.
- `mingla-marketing/lib/site.ts` — `SITE_ORIGIN` + `DOWNLOAD_URL` (explorer QR target). **Not needed** for business (no QR, no `/download` analog). No change.

### 1.3 CONFIRMED — the business App Store URL is a LIVE public listing
- `mingla-business/eas.json:88-89` → `"ios": { "ascAppId": "6768737367" }`. Matches the dispatch.
- Live fetch of `https://apps.apple.com/app/id6768737367` returns an **active, downloadable** listing: **"Mingla: Host, Sell & Grow"**, seller **MINGLA LLC**, category **Business**, free, iOS 15.1+ ("create events, sell tickets, process payments, QR check-in"). Not a 404 / "app not available". **This is the correct iOS destination.**

### 1.4 CONFIRMED — the correct non-iOS destination is `https://business.usemingla.com` (root)
**This was the single most important open question. Answer: the root IS owner-appropriate — it renders the business sign-in / get-started screen.**
- `business.usemingla.com` is served by the **`mingla-business/` Expo app web export** (`mingla-business/vercel.json`: `buildCommand: npx expo export -p web`, `outputDirectory: dist`), with a SPA catch-all rewrite `{"source":"/(.*)","destination":"/"}` (`vercel.json:59`). So `https://business.usemingla.com/` mounts the app's root route.
- Root route `mingla-business/app/index.tsx`:
  - `:90-99` — when `!user` (logged-out) → renders `<BusinessWelcomeScreen … />` (the sign-in/get-started screen). Comment `:87-89`: "Not signed in … show sign-in screen directly … so the user always lands somewhere actionable."
  - `:101-102` — when signed-in → `<Redirect href={AppRoutes.home}>` (dashboard).
- `BusinessWelcomeScreen` (`mingla-business/src/components/auth/BusinessWelcomeScreen.tsx`) renders a headline + **Continue with Apple** (`:606-621`) / **Continue with Google** (`:646-665`) / **Continue with Email** (`:688-692`). OAuth doubles as sign-up — an owner "gets started" here. **Owner-appropriate; NOT a buyer-only page or 404.**
- (WebFetch of the root returned only `<title>Mingla Business</title>` — it is a client-rendered SPA, so the source above is the authoritative evidence, not the fetched HTML.)
- **Decision:** non-iOS destination = `https://business.usemingla.com` (bare origin). Android (Play in review — no Play listing) and desktop/other both land here. No deeper path is needed; the root already resolves to the get-started screen.

### 1.5 CORRECTED — the two organiser copy tests do **NOT** assert "Get Beta Access" (they will NOT break)
The dispatch assumed `organiser-copy-fidelity.test.ts` + `organiser-redesign.test.ts` "almost certainly assert 'Get Beta Access'". **They do not** (verified by reading both in full):
- `components/sections/organiser-home/__tests__/organiser-copy-fidelity.test.ts` — asserts the 6 audience eyebrows (`audiences.tsx`) + the page-metadata sacred line (`app/business/page.tsx`). **No hero-CTA / beta assertion.** Untouched → stays green.
- `components/sections/organiser-home/organiser-redesign.test.ts` — runs a FORBIDDEN-phrase scan over `hero.tsx` (`FORBIDDEN = performance-based, charged when, no flat fees, within a week, first placements, push copy, SMS, RCS`) + requires `hero.tsx` to contain `HeroBookingWall` and a `(text|bg)-warm` accent. **No "Get Beta Access" assertion.** The proposed copy ("Get the app", "On iPhone now — or get started on the web.") contains none of the forbidden substrings, and the hero keeps `HeroBookingWall` + the `text-warm` "found." accent → **stays green with no edit.**
- **Net:** no existing organiser test needs updating. (The dispatch's "must be updated" premise is wrong.)

### 1.6 CONFIRMED — `lib/device-platform.test.ts` and `lib/links-config.tester.test.ts` are unaffected
- `device-platform.test.ts` pins `device-platform.ts` behavior, which is unchanged → green.
- `links-config.tester.test.ts` imports `APP_STORE_URL`/`PLAY_STORE_URL` from `store-links` and asserts the `/links` business tab CTA `=== '/business'` (`:70-79`). Adding the two **new** business consts to `store-links.ts` does not touch the two it reads → green. It also proves the `/links` business tab points at the marketing `/business` route (`LINKS_BUSINESS_PATH === BUSINESS_PATH === '/business'`), **not** at `business.usemingla.com` — see the consistency note in §4.

### 1.7 CONFIRMED — `BetaAccessModal` + `lib/beta-access-submit.ts` are orphaned once both CTAs change
Full import graph (grep of `mingla-marketing/**`):
- `beta-access-modal.tsx` is imported **only** by `hero.tsx:6` and `glass-nav.tsx:7`.
- `beta-access-submit.ts` is imported **only** by `beta-access-modal.tsx:22-24`.
- `lib/unsubscribe-submit.ts:6` references `beta-access-submit.ts` **in a comment only** ("mirroring lib/beta-access-submit.ts exactly") — not an import.
- No test file imports either (grep of `*.test.ts*` → empty).
→ Once nav + hero stop importing the modal, both files are fully dead. **Deleting them is safe from a runtime/import standpoint** — but see §2 (two CI guards hard-require them).

---

## 2. The load-bearing constraint — two CI guards + two invariants HARD-REQUIRE the beta modal

Deleting `beta-access-modal.tsx` and removing its `glass-nav` mount is **NOT free**: two live strict-grep guards will go red.

| Guard file | Job (yml lines) | What it requires in LIVE mode | Effect of ORCH-1324 |
|---|---|---|---|
| `i-proposed-1216-explorer-only-cta.mjs` | `orch-1216-explorer-only-cta` (`yml:3320-3331`) | `checkNav` requires `<BetaAccessModal` mounted inside a `surface === 'organiser'` guard in `glass-nav.tsx` (`:56-64`), AND requires `beta-access-modal.tsx` to exist (`:146-151`). | **RED** — we remove the mount + delete the file. |
| `i-proposed-1219-form-no-autoadvance-multiselect.mjs` | `orch-1219-form-no-autoadvance-multiselect` (`yml:3336-3347`) | Requires `beta-access-modal.tsx` to exist and be a multi-select toggle group; `if (!fs.existsSync(abs)) failures.push('not found')` (`:125-126`). | **RED** — file deleted. |

**Verdict:** these two guards must be **RETIRED** (delete `.mjs` + remove yml jobs), and their two registered invariants **DECOMMISSIONED**, exactly as ORCH-1319 retired the guards tied to the deleted explorer modal. This is the "subtract-before-adding" tail of the change.

**Two OTHER guards mention beta-access but are SAFE (do not scan the deleted client files):**
- `orch-1205-edge-cors-x-client-info.mjs:11` — "beta-access lead form" appears only in a comment. No scan. Untouched.
- `orch-0863-marketing-hub-phase-b.mjs:1353-1430` — scans the **edge function** `supabase/functions/beta-access-lead-submit/` + migration `20260817000000_orch_1045_beta_access_leads.sql` + `admin_beta_leads_list` RPC — **all KEPT** per the locked decision. Does not scan `beta-access-modal.tsx`/`beta-access-submit.ts`. Untouched.

---

## 3. The four ORCH-1319 guards — per-guard green/red under ORCH-1324

| Guard | Scans | ORCH-1324 status | Action |
|---|---|---|---|
| `orch-1319-getapp-cta-direct-store.mjs` (G-1) | `glass-nav.tsx` (comment-stripped): needs `APP_STORE_URL`+`PLAY_STORE_URL`, `detectClientPlatform(`, `platform ===`, `get_the_app_clicked`; bans `GetTheAppModal`/`get-the-app-modal`/`explorer-app-submit`/`submitExplorerAppLead`/`explorer-interest`/`get_the_app_submitted`/`testflight`/`type="email"`. | **STAYS GREEN.** The explorer branch keeps all required tokens; the business edit adds only `BUSINESS_APP_STORE_URL`/`BUSINESS_WEB_URL`/`detectClientPlatform`/`platform ===`/`get_the_app_clicked` and removes `BetaAccessModal` (not a banned token). No banned token is introduced. | No edit required. **But G-1 does NOT prove the business branch is device-aware** (it only checks the file contains the tokens, which the explorer branch already satisfies) → a NEW guard is needed (see §5). |
| `orch-1319-no-testflight-anywhere.mjs` (G-4) | Repo scan of `mingla-marketing/` + `supabase/functions/` for `testflight.apple.com`. | **STAYS GREEN.** Nothing added references testflight. | No edit. |
| `orch-1319-download-route-ua.mjs` (G-2) | `app/download/page.tsx` (explorer route). | **STAYS GREEN.** Not touched. | No edit. |
| `orch-1319-qr-encodes-download-url.mjs` (G-3) | `download-qr.tsx` (explorer QR). | **STAYS GREEN.** Not touched. | No edit. |

**Security guard (unrelated to ORCH-1319 numbering, keep):** `i-proposed-1216-no-service-key-client.mjs` (`I-PROPOSED-1216-NO-SERVICE-KEY-CLIENT`, registry `:5426`) scans ALL of `mingla-marketing/` for secrets — now also covers the edited nav/hero. No secret is added → **stays green.** Do not touch.

---

## 4. Affected invariants (ORCH-1045 framing corrected)

**Correction:** there is **no** registered `### I-1045-*` invariant section in `INVARIANT_REGISTRY.md`. The names `I-1045-ORGANISER-ONLY-CTA` and `I-1045-HERO-NO-VIDEO` appear only as **code comments** (`glass-nav.tsx:159`, `hero.tsx:17`, `beta-access-submit.ts:8,83`). The organiser-CTA/beta-modal protection is actually carried by the two **ORCH-1216/1219** registered invariants, which ORCH-1319 already narrowed to organiser-only:

| Invariant (registry line) | Enforcing guard | ORCH-1324 disposition |
|---|---|---|
| `I-PROPOSED-1216-EXPLORER-ONLY-CTA` (`:5429`, ACTIVE) — rule: `BetaAccessModal` mounts organiser-only, never cross-imports the deleted explorer modal. | `i-proposed-1216-explorer-only-cta.mjs` | **DECOMMISSION** — the business CTA no longer opens `BetaAccessModal`; the modal is deleted. This subsumes the code-comment `I-1045-ORGANISER-ONLY-CTA`. |
| `I-PROPOSED-1219-FORM-NO-AUTOADVANCE-MULTISELECT` (`:5439`, ACTIVE) — rule: the organiser beta form is a no-auto-advance multi-select toggle group. | `i-proposed-1219-form-no-autoadvance-multiselect.mjs` | **DECOMMISSION** — the form is deleted. |
| `I-PROPOSED-1216-NO-SERVICE-KEY-CLIENT` (`:5426`, ACTIVE) — repo-wide no-secret scan. | `i-proposed-1216-no-service-key-client.mjs` | **KEEP ACTIVE, unchanged.** Still scans the edited files. |
| `I-PROPOSED-1216-ANON-NO-SELECT` (`:5437`, ACTIVE — `explorer_app_leads`) | structural/live-fire | **Untouched** (different table). |
| code-comment `I-1045-HERO-NO-VIDEO` (`hero.tsx:17`) | none (no registered gate) | **Preserved by construction** — the hero change adds no video modal; it stays video-free. Keep the comment/intent. |

**New DRAFT invariant to pre-stage:** `I-PROPOSED-1324-BUSINESS-GETAPP-DEVICE-AWARE` (see SPEC §6).

---

## 5. Guard coverage gap → new ORCH-1324 guard required

G-1 (`orch-1319-getapp-cta-direct-store.mjs`) is satisfied by the explorer branch alone; it does **not** assert the business branch resolves device-aware, nor that the hero is rewired, nor that no beta funnel remains. Therefore ORCH-1324 needs a **new** strict-grep guard `orch-1324-business-getapp-device-aware.mjs` that scans BOTH `glass-nav.tsx` (organiser region) and `hero.tsx` for the two business consts + `detectClientPlatform()` + `platform ===` + `get_the_app_clicked`, and BANS `BetaAccessModal`/`beta-access`/`Get Beta Access`/`Free during beta`/`testflight`/`type="email"`. Full spec in SPEC §9.

---

## 6. `/links` business-tab consistency observation (no change — dispatch says leave)

`lib/links-config.tester.test.ts:70-79` confirms the `/links` **business** tab CTA = `LINKS_BUSINESS_PATH` = `BUSINESS_PATH` = `/business` (the marketing route), while the **explorer** tab CTA = `/download` (the device-smart route). After ORCH-1324, tapping `/links` → business → lands on `usemingla.com/business`, whose nav+hero CTAs are now themselves device-aware "Get the app" actions. So the funnel is consistent (one hop to the device-aware CTA). There is deliberately **no** business analog of `/download` (business has no QR/desktop split — non-iOS just goes to the web app). **Observation only:** a future ORCH could add a `/business/download` smart-redirect for parity, but it is out of scope and non-blocking. Leave `/links` untouched.

---

## 7. Files to touch (exhaustive) — full list feeds SPEC §10

**Create:** `.github/scripts/strict-grep/orch-1324-business-getapp-device-aware.mjs`; append-only tests under `mingla-marketing/**`.
**Edit:** `mingla-marketing/lib/store-links.ts` (add 2 consts); `mingla-marketing/components/marketing/glass-nav.tsx` (organiser branch → device-aware handler; drop BetaAccessModal import + betaOpen state + organiser mount); `mingla-marketing/components/sections/organiser-home/hero.tsx` (beta CTA → device-aware handler + new copy; drop BetaAccessModal import + state + mount); `.github/workflows/strict-grep-mingla-business.yml` (remove 2 jobs `:3320-3331` + `:3336-3347`, add the new job, prune gate-index comments); `Mingla_Artifacts/INVARIANT_REGISTRY.md` (decommission 2, add DRAFT).
**Delete:** `mingla-marketing/components/marketing/beta-access-modal.tsx`; `mingla-marketing/lib/beta-access-submit.ts`; `.github/scripts/strict-grep/i-proposed-1216-explorer-only-cta.mjs`; `.github/scripts/strict-grep/i-proposed-1219-form-no-autoadvance-multiselect.mjs`.
**Do NOT touch:** the explorer nav branch + `AppQrPanel` + `download-qr` + `/download` route; the 4 ORCH-1319 guards; `i-proposed-1216-no-service-key-client.mjs`; `beta_access_leads` table + `supabase/functions/beta-access-lead-submit/` edge fn (+ its config.toml block) + `admin_beta_leads_list` RPC (kept dark); `device-platform.ts`; `site.ts`; `/links` (`links-config.ts`).

---

## 8. Build / verify environment
- `mingla-marketing/node_modules` is **ABSENT** in the anchor and worktree. The implementor/tester MUST run `npm ci` (or `npm install`) inside `<worktree>/mingla-marketing/` before `tsc`/`next build`/tests. `react-qr-code@^2.0.15` is already in `package.json` deps (from ORCH-1319) — no dependency add needed.
- Verify commands: `npm run typecheck` (`tsc --noEmit`) + `npm run build` (`next build`) inside `mingla-marketing/`. The marketing package has **no jest harness** — its tests run via the repo's `tsc … && node` (or `npx tsx`) pattern (see `device-platform.test.ts` / `links-config.tester.test.ts` headers); ORCH-1324's append-only tests follow the same pattern.
- Strict-grep guards run with `node .github/scripts/strict-grep/<file>.mjs` and `… --self-test` from the repo root (they resolve `root` from cwd).

---

## 9. Ship channel
- Marketing client change → **Vercel `[deploy]` commit-tag REQUIRED** on merge (mingla-marketing touched; Vercel deploy gate).
- **No** Supabase/edge/migration change (the edge fn + table stay as-is). No `supabase functions delete`.
- `main` is PR-protected → PR + `gh pr merge --squash --admin`, all CI green first.
