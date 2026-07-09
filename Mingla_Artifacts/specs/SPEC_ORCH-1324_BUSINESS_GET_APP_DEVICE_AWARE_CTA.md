# SPEC — ORCH-1324 [business "Get the app" → device-aware live-store link + business web; retire the beta gate]

**Phase:** SPEC → IMPLEMENT
**Surface:** `mingla-marketing/` ONLY — the business/organiser marketing surface (`usemingla.com/business`), Next.js 15 App Router. **No app/native change, no explorer/consumer marketing change, no Supabase/edge/migration change.**
**Pattern parent:** ORCH-1319 (explorer "Get the app" direct store links). Study `SPEC_ORCH-1319_EXPLORER_DIRECT_STORE_LINKS.md` — this is the business twin, minus the QR/`/download` route.
**Ship channel:** Vercel — **`[deploy]` commit tag REQUIRED** on merge (marketing touched). `main` is PR-protected → PR + `gh pr merge --squash --admin`, all CI green first.

**Live destinations (canonical, single-source-of-truth constants):**
- iOS App Store (business): `https://apps.apple.com/app/id6768737367` (App Store ID `6768737367`; live listing "Mingla: Host, Sell & Grow", MINGLA LLC — verified live).
- Android + desktop/other: `https://business.usemingla.com` (bare origin — its root renders the business owner sign-in/get-started screen; verified via `mingla-business/app/index.tsx:90-99` + `vercel.json` SPA rewrite). Google Play is still in review (no Play listing), so Android goes to web too.

---

## 1. Executive summary (layman first)

The Mingla Business app was just approved on the App Store. Today the business marketing site (`usemingla.com/business`) has two **"Get Beta Access"** buttons — one in the top nav, one in the hero — that open a multi-step form to join a waitlist. That waitlist made sense before the app existed. **It's now live on iPhone (and usable on the web everywhere else)**, so both buttons should become **"Get the app"** and do the obvious thing:
- **On an iPhone** → open the business App Store listing.
- **On Android or a computer** → open `business.usemingla.com` (the business web app, whose front door is the owner get-started/sign-in screen). No QR panel (that's the deliberate difference from the Explorer version — business owners work on desktop, so we send them straight into the web app).

We keep measuring taps (a `get_the_app_clicked` analytics event), and we retire the now-dead waitlist form + its two CI guards. The waitlist **database + its edge function stay** (they hold real leads) — we simply stop collecting new ones from the business site.

---

## 2. Scope & non-goals

### In scope
- Add two SSOT constants to `lib/store-links.ts` (§4.0).
- Rewire the **nav** organiser CTA (`glass-nav.tsx` `surface === 'organiser'` branch) to a device-aware "Get the app" action (§4.1).
- Rewire the **hero** CTA (`components/sections/organiser-home/hero.tsx`) to the same action + honest new copy (§4.2).
- Retire the business beta funnel: delete `beta-access-modal.tsx` + `lib/beta-access-submit.ts`; remove all dead imports/state/mounts (§4.3).
- Retire the two now-broken CI guards + their yml jobs; decommission their two invariants (§4.4, §6).
- New ORCH-1324 strict-grep guard proving BOTH business CTAs are device-aware with no beta funnel (§9).
- Analytics: `get_the_app_clicked` on both CTAs, `surface:'organiser'`, `location:'nav'|'hero'` (§4.5).
- New DRAFT invariant `I-PROPOSED-1324-BUSINESS-GETAPP-DEVICE-AWARE` (§6).

### Non-goals (DO NOT TOUCH)
- The **explorer** nav branch (`glass-nav.tsx` explorer path), `AppQrPanel`, `download-qr.tsx`, `app/download/page.tsx`, `lib/site.ts`, `lib/device-platform.ts`. Unchanged.
- The four ORCH-1319 guards + `i-proposed-1216-no-service-key-client.mjs`. Unchanged.
- **The `beta_access_leads` table + `supabase/functions/beta-access-lead-submit/` edge fn (+ its `supabase/config.toml` block) + `admin_beta_leads_list` RPC.** KEEP intact — kept dark (no client caller), holds real leads. No migration, no `functions delete`. (Guard `orch-0863-marketing-hub-phase-b.mjs` scans these — leave them so it stays green.)
- `/links` (`lib/links-config.ts`) — its business tab already routes to `/business` (this marketing surface). Leave (see §11 observation).
- Admin lead-viewing (mingla-admin) — reads the table, unaffected.
- No new npm dependency (`react-qr-code` already present; not used here).

---

## 3. Retire-the-beta-modal verdict (REQUIRED read result)

**VERDICT: DELETE `beta-access-modal.tsx` + `lib/beta-access-submit.ts`, and RETIRE the two guards + two invariants that hard-require them.**

Evidence:
- `beta-access-modal.tsx` is imported ONLY by `hero.tsx:6` + `glass-nav.tsx:7`; `beta-access-submit.ts` ONLY by `beta-access-modal.tsx:22-24`; `unsubscribe-submit.ts:6` names it in a comment only; no test imports either. Once both CTAs change, both files are fully dead (subtract-before-adding requires their removal).
- **BUT** two live guards hard-require them and will go RED if the files are deleted / the mount removed:
  - `i-proposed-1216-explorer-only-cta.mjs` (`checkNav` requires `<BetaAccessModal` mounted organiser-only + the file to exist).
  - `i-proposed-1219-form-no-autoadvance-multiselect.mjs` (requires the file to exist + be multi-select).
  → Both must be **retired** (delete `.mjs` + yml job) and their invariants **decommissioned** — exactly as ORCH-1319 retired the guards tied to the deleted explorer modal. This is a scope expansion beyond "just the CTA"; it is unavoidable and correct.
- The `beta_access_leads` table + edge fn stay (locked decision). Deleting the client transport leaves the edge fn dark with no caller — identical to how ORCH-1319 left `explorer-app-lead-submit` dark.

---

## 4. Layered specification

### 4.0 Shared constants — `mingla-marketing/lib/store-links.ts` (EDIT)

Append below the existing `APP_STORE_URL`/`PLAY_STORE_URL`:

```ts
// ORCH-1324 [business "Get the app" → device-aware] — the LIVE business App Store
// listing + the business web app origin. iOS → the business App Store; Android
// (Google Play still in review — no Play listing yet) + desktop/other → the
// business web app, whose root renders the owner get-started/sign-in screen.
// NEVER hardcode these inline in a component (mirrors the ORCH-1319 SSOT rule).
export const BUSINESS_APP_STORE_URL = 'https://apps.apple.com/app/id6768737367'
export const BUSINESS_WEB_URL = 'https://business.usemingla.com'
```

Acceptance: exact strings above; no trailing slash on `BUSINESS_WEB_URL`. (No change to `APP_STORE_URL`/`PLAY_STORE_URL` — `links-config.tester.test.ts` reads those.)

---

### 4.1 NAV CTA — `mingla-marketing/components/marketing/glass-nav.tsx` (EDIT, organiser branch only)

**Remove:**
- `import { BetaAccessModal } from '@/components/marketing/beta-access-modal'` (`:7`).
- The `betaOpen` state + its comment (`:36-37`).
- The organiser `<BetaAccessModal … />` mount block (`:159-166`).

**Add** to the existing ORCH-1319 imports (`:13-14`) the two business consts:
```ts
import { APP_STORE_URL, PLAY_STORE_URL, BUSINESS_APP_STORE_URL, BUSINESS_WEB_URL } from '@/lib/store-links'
```

**Add** a business handler alongside `handleGetTheApp` (the explorer one stays untouched):
```ts
// ORCH-1324 — the business "Get the app" CTA is a device-aware DIRECT action:
// iOS → the live business App Store, Android/desktop/other → the business web
// app (business.usemingla.com root = owner get-started). No QR panel, no beta
// funnel. Runs only on a real browser click (SSR-safe: detectClientPlatform
// returns 'other' when navigator is absent).
const handleGetTheBusinessApp = (): void => {
  const platform = detectClientPlatform()
  const dest = platform === 'ios' ? BUSINESS_APP_STORE_URL : BUSINESS_WEB_URL
  captureMarketing('get_the_app_clicked', {
    platform,
    store: platform === 'ios' ? 'app_store' : 'business_web',
    surface: 'organiser',
    location: 'nav',
  })
  // Popup-blocked (window.open → null) → same-tab navigation fallback.
  const win = window.open(dest, '_blank', 'noopener,noreferrer')
  if (!win) window.location.assign(dest)
}
```

**Replace** the organiser `<Button>` (`:124-140`) with (note: it now NAVIGATES, so drop `aria-haspopup`/`aria-expanded` — no dialog opens):
```tsx
{surface === 'organiser' ? (
  <Button
    variant="glass"
    size="sm"
    onClick={handleGetTheBusinessApp}
  >
    Get the app
  </Button>
) : (
  … explorer branch UNCHANGED …
)}
```

Keep the explorer `<AppQrPanel>` mount (`:170-172`) exactly as-is. After the edit, `glass-nav.tsx` mounts NO `BetaAccessModal`.

---

### 4.2 HERO CTA — `mingla-marketing/components/sections/organiser-home/hero.tsx` (EDIT)

**Remove:**
- `import { BetaAccessModal } from '@/components/marketing/beta-access-modal'` (`:6`).
- `const [betaOpen, setBetaOpen] = useState(false)` (`:24`) — and the now-unused `useState` import if nothing else uses it (verify: `useState` is used only for `betaOpen` here → remove the `import { useState } from 'react'` line `:2`).
- The `<BetaAccessModal … />` mount (`:97-101`).
- Update the ORCH-1045 header comment (`:15-18`) to an ORCH-1324 note (hero CTA is now device-aware "Get the app"; keep the `I-1045-HERO-NO-VIDEO` intent — the hero stays video-free).

**Add** imports:
```ts
import { detectClientPlatform } from '@/lib/device-platform'
import { BUSINESS_APP_STORE_URL, BUSINESS_WEB_URL } from '@/lib/store-links'
import { captureMarketing } from '@/components/marketing/posthog-provider'
```

**Add** the handler inside `OrganiserHero` (mirror §4.1, `location:'hero'`):
```ts
const handleGetTheBusinessApp = (): void => {
  const platform = detectClientPlatform()
  const dest = platform === 'ios' ? BUSINESS_APP_STORE_URL : BUSINESS_WEB_URL
  captureMarketing('get_the_app_clicked', {
    platform,
    store: platform === 'ios' ? 'app_store' : 'business_web',
    surface: 'organiser',
    location: 'hero',
  })
  const win = window.open(dest, '_blank', 'noopener,noreferrer')
  if (!win) window.location.assign(dest)
}
```

**Replace** the button + subcopy (`:85-91`):
```tsx
<Button variant="primary" size="lg" onClick={handleGetTheBusinessApp}>
  Get the app
  <ArrowRight className="h-4 w-4" aria-hidden="true" />
</Button>
<p className="mt-4 text-sm text-white/70">
  On iPhone now — or get started on the web.
</p>
```

Keep `<HeroBookingWall/>`, the overlays, the headline (`text-warm` "found." accent), and `useMinglaReducedMotion`. (`organiser-redesign.test.ts` still passes: `HeroBookingWall` + `(text|bg)-warm` present; no FORBIDDEN phrase in the new copy.)

**Edge cases (both CTAs):** reduced-motion irrelevant (no animation on the action); `navigator` undefined → handler only runs on a real click; popup-blocked → `window.location.assign` fallback; rapid double-tap → idempotent navigation.

---

### 4.3 Retire the beta funnel (DELETE)

- **Delete** `mingla-marketing/components/marketing/beta-access-modal.tsx`.
- **Delete** `mingla-marketing/lib/beta-access-submit.ts`.
- **Do NOT** touch `supabase/functions/beta-access-lead-submit/`, its `supabase/config.toml` block, the `beta_access_leads` migration/table, or the `admin_beta_leads_list` RPC (locked decision — kept dark).
- `lib/unsubscribe-submit.ts:6` names `beta-access-submit.ts` in a comment only — leave the comment (or optionally reword; non-blocking, no functional link).

Acceptance: after the change, `grep -rn "BetaAccessModal\|beta-access-modal\|beta-access-submit\|Get Beta Access\|get_beta_access\|Free during beta" mingla-marketing/ --include=*.ts --include=*.tsx` returns nothing (outside git history); `tsc --noEmit` + `next build` pass with no dangling imports.

---

### 4.4 Retire the two now-broken guards + yml jobs (see §6 for invariants)

- **Delete** `.github/scripts/strict-grep/i-proposed-1216-explorer-only-cta.mjs`.
- **Delete** `.github/scripts/strict-grep/i-proposed-1219-form-no-autoadvance-multiselect.mjs`.
- **In `.github/workflows/strict-grep-mingla-business.yml`:** delete the `orch-1216-explorer-only-cta` job (`:3320-3331`) and the `orch-1219-form-no-autoadvance-multiselect` job (`:3336-3347`). Replace them with a single RETIRED breadcrumb comment (mirror the existing `:3333-3334` style), e.g.:
  ```yaml
  # ORCH-1324 RETIRED: orch-1216-explorer-only-cta + orch-1219-form-no-autoadvance-
  # multiselect — both scanned the now-deleted business BetaAccessModal. The business
  # CTA is now a device-aware "Get the app" action (see orch-1324-business-getapp-
  # device-aware). Obsolete.
  ```
- **Add** the new `orch-1324-business-getapp-device-aware` job (§9).
- Prune any "Currently registered gates" index comment lines at the top of the yml that name the two retired gates; add the new one.
- **Leave** the `orch-1216-no-service-key-client` job (`:3313-3318`) and all four `orch-1319-*` jobs untouched.

---

### 4.5 Analytics

- **New/reused event:** `captureMarketing('get_the_app_clicked', { platform, store, surface, location })`:
  - `platform ∈ {'ios','android','other'}` (from `detectClientPlatform()`).
  - `store`: `'app_store'` for iOS; `'business_web'` for android/other (both non-iOS land on the business web).
  - `surface: 'organiser'` (distinguishes from the explorer CTA, which omits `surface`).
  - `location: 'nav'` (glass-nav) | `'hero'` (hero).
- **Removed event:** the old `captureMarketing('marketing_cta_clicked', { cta_id:'get_beta_access', location:'nav' })` in the nav organiser branch (`:130-133`) — superseded by `get_the_app_clicked`.
- `captureMarketing` is the existing consent-gated, never-throws helper (`components/marketing/posthog-provider.tsx`). No new analytics plumbing.

Acceptance: a tap on nav/hero on each of iOS / Android / desktop emits exactly one `get_the_app_clicked` with the correct `platform`+`store`+`surface`+`location`.

---

## 5. Cross-surface impact

| # | Surface | Covered | Behavior | Parity |
|---|---------|---------|----------|--------|
| 1 | Business marketing (`/business`) desktop | YES | nav+hero "Get the app" → `business.usemingla.com`. | primary |
| 2 | Business marketing (mobile browser) | YES | iOS → business App Store; Android → `business.usemingla.com`. | same code |
| 3 | Explorer marketing | NO | ORCH-1319 CTA untouched; G-1 stays green. | verify green |
| 4 | `/links` business tab | NO | still `/business` (this surface); one hop to the new CTA. | observation §11 |
| 5 | Business native / web app (`business.usemingla.com`) | NO | destination only; no code change. | n/a |
| 6 | Backend (`beta_access_leads` + edge fn) | NO | kept dark; no migration/delete. | preserved |

**Ship channel:** Vercel `[deploy]` (REQUIRED). No Supabase change.

---

## 6. Invariants

**New (DRAFT → ACTIVE at CLOSE):**
- **`I-PROPOSED-1324-BUSINESS-GETAPP-DEVICE-AWARE`** — The business (organiser / `usemingla.com/business`) marketing CTAs — the `glass-nav.tsx` `surface === 'organiser'` branch AND the `components/sections/organiser-home/hero.tsx` CTA — resolve **device-aware**: iOS → the live business App Store (`apps.apple.com/app/id6768737367`, via `BUSINESS_APP_STORE_URL`), Android + desktop/other → the business web app (`business.usemingla.com`, via `BUSINESS_WEB_URL`), driven by `detectClientPlatform()` with a popup-blocked `window.location.assign` fallback. There is **NO** beta/lead-capture funnel (no `BetaAccessModal`, no `beta-access-*`, no "Get Beta Access", no email input) and **NO** desktop QR panel on the business surface. Both CTAs fire `get_the_app_clicked { platform, store, surface:'organiser', location }`. **Enforcement:** strict-grep `.github/scripts/strict-grep/orch-1324-business-getapp-device-aware.mjs` (`--self-test`) wired as job `orch-1324-business-getapp-device-aware` + the append-only jest/tsc triad (§7/§9). Register as `I-PROPOSED-1324-…` DRAFT now; flip to bare `I-1324-…` ACTIVE at CLOSE (house style strips the `I-PROPOSED-` prefix on activation; the gate FILENAME keeps its name).

**DECOMMISSIONED at CLOSE (were ACTIVE):**
- `I-PROPOSED-1216-EXPLORER-ONLY-CTA` (registry `:5429`) — the business CTA no longer opens `BetaAccessModal`; the modal is deleted. Mark **DECOMMISSIONED (ORCH-1324, 2026-07-09)** with a one-line reason + superseding `I-PROPOSED-1324-BUSINESS-GETAPP-DEVICE-AWARE`; keep the historical rule line. Gate file + yml job deleted.
- `I-PROPOSED-1219-FORM-NO-AUTOADVANCE-MULTISELECT` (registry `:5439`) — the organiser beta form is deleted; no form to protect. Mark **DECOMMISSIONED (ORCH-1324, 2026-07-09)**; no superseding invariant (the form no longer exists). Gate file + yml job deleted.

**PRESERVED (unchanged, still ACTIVE):**
- `I-PROPOSED-1216-NO-SERVICE-KEY-CLIENT` (`:5426`) — repo-wide no-secret scan; still covers the edited nav/hero. No wording change.
- `I-PROPOSED-1216-ANON-NO-SELECT` (`:5437`) — `explorer_app_leads`; unrelated table; untouched.
- code-comment `I-1045-HERO-NO-VIDEO` (`hero.tsx`) — the hero stays video-free (no video modal added). Intent preserved; keep the comment.
- The ORCH-1045 `beta_access_leads` deny-by-default + `admin_beta_leads_list` protection (referenced by `orch-0863-marketing-hub-phase-b.mjs`) — untouched (table + edge fn kept).

---

## 7. Test cases (regression triad + coverage)

| Test | Scenario | Expected | Layer |
|------|----------|----------|-------|
| T-1 | nav CTA, iOS UA | navigates to `BUSINESS_APP_STORE_URL`; one `get_the_app_clicked {platform:'ios',store:'app_store',surface:'organiser',location:'nav'}` | client |
| T-2 | nav CTA, Android UA | navigates to `BUSINESS_WEB_URL`; `{platform:'android',store:'business_web',…,location:'nav'}` | client |
| T-3 | nav/hero CTA, desktop UA | navigates to `BUSINESS_WEB_URL` (NOT App Store, NO QR panel); `{platform:'other',store:'business_web'}` | client |
| T-4 | hero CTA, iOS UA | navigates to `BUSINESS_APP_STORE_URL`; `{…,location:'hero'}` | client |
| T-5 | popup-blocked (`window.open`→null) | falls back to `window.location.assign(dest)` | client |
| T-6 | no beta funnel remains | no `BetaAccessModal`/`beta-access-*`/`Get Beta Access`/email input anywhere under `mingla-marketing/` | CI (G) |
| T-7 | store SSOT | destinations equal the `store-links` consts, never hardcoded inline | CI (G) |
| T-8 | explorer untouched | ORCH-1319 G-1 still green; explorer CTA unchanged | CI |
| T-9 | build/typecheck | `next build` + `tsc --noEmit` pass, no dangling imports | CI |

**Regression triad for `I-PROPOSED-1324-BUSINESS-GETAPP-DEVICE-AWARE`:**
1. **Strict-grep guard** `orch-1324-business-getapp-device-aware.mjs` (§9) with `--self-test` (GOOD passes / each violation fires), wired as a yml job. (fails-on-revert at the source level.)
2. **Implementor happy-path** (append-only) — `mingla-marketing/components/marketing/__tests__/business-getapp-cta.test.ts` (tsc+node/tsx pattern): reads `glass-nav.tsx` + `hero.tsx` sources and asserts each references `BUSINESS_APP_STORE_URL` + `BUSINESS_WEB_URL` via the ternary `platform === 'ios' ? BUSINESS_APP_STORE_URL : BUSINESS_WEB_URL`, calls `detectClientPlatform()`, fires `get_the_app_clicked` with `surface: 'organiser'` and the right `location`, and has the `window.location.assign` popup fallback. **Fails-on-revert:** reverting either CTA to `setBetaOpen`/`BetaAccessModal` makes an assertion fail.
3. **Tester adversarial (different angle)** — `mingla-marketing/components/marketing/__tests__/business-getapp-cta.tester.test.ts`: asserts the **negative/adversarial** space — (a) neither file imports `BetaAccessModal` or contains `Get Beta Access`/`beta-access`/`type="email"`; (b) the non-iOS destination is `BUSINESS_WEB_URL` and the handler does **not** send Android/desktop to `BUSINESS_APP_STORE_URL` (guards an "everyone → App Store" regression that would strand Android/desktop owners); (c) the business surface opens **no** QR panel (`AppQrPanel`/`setQrOpen` never appears in the organiser handler/branch or the hero) — the deliberate difference from explorer. Different angle than the happy-path (which proves presence; this proves the funnel + the wrong-destination + the QR are absent).

Runtime proof (physical-device-first, tester): load the marketing build; on a physical iPhone tap nav + hero → business App Store listing opens; on Android / desktop → `business.usemingla.com` (owner get-started screen) opens; confirm no form, no QR, and one `get_the_app_clicked` per tap in PostHog.

---

## 8. Implementation order

1. **Constants (§4.0):** add `BUSINESS_APP_STORE_URL` + `BUSINESS_WEB_URL` to `lib/store-links.ts`.
2. **Nav (§4.1):** rewire `glass-nav.tsx` organiser branch; drop BetaAccessModal import + betaOpen state + mount.
3. **Hero (§4.2):** rewire `hero.tsx`; drop BetaAccessModal import + state + mount; new copy.
4. **Delete beta funnel (§4.3):** delete `beta-access-modal.tsx` + `lib/beta-access-submit.ts`.
5. **Guards (§4.4/§9):** delete the 2 broken `.mjs` + their yml jobs; add `orch-1324-business-getapp-device-aware.mjs` + its job (+ `--self-test`); prune the yml gate-index comments.
6. **Registry (§6):** decommission the 2 invariants; register the DRAFT `I-PROPOSED-1324-…`.
7. **Tests (§7):** add the append-only happy-path + tester-adversarial tests.
8. **Verify (§10):** `npm ci` in `mingla-marketing/`; `npm run typecheck`; `npm run build`; run the new guard live + `--self-test`; run every remaining strict-grep `--self-test`; run the 2 new tests; run `device-platform.test.ts` + `links-config.tester.test.ts` (must stay green); physical-device eyeball. Merge with `[deploy]`.

---

## 9. The new strict-grep guard (§9 detail)

**File:** `.github/scripts/strict-grep/orch-1324-business-getapp-device-aware.mjs` (model: `orch-1319-getapp-cta-direct-store.mjs`; comment-stripped; `--self-test` with GOOD + one fixture per violation).

**Scans TWO targets (comment-stripped):**
- `mingla-marketing/components/marketing/glass-nav.tsx`
- `mingla-marketing/components/sections/organiser-home/hero.tsx`

**Per target, REQUIRE (happy-path):**
1. references BOTH `BUSINESS_APP_STORE_URL` and `BUSINESS_WEB_URL` (imported from `lib/store-links`; not hardcoded URLs).
2. calls `detectClientPlatform(`.
3. branches on `platform ===` (device-driven, not a single hardcode) — **G-b adversarial.**
4. contains a `get_the_app_clicked` capture AND a `surface: 'organiser'` prop (distinguishes the business event).
5. contains the popup fallback `window.location.assign(` (no dead tap).

**Per target, BAN (funnel must be gone):**
- `BetaAccessModal`, `beta-access-modal`, `beta-access-submit`, `Get Beta Access`, `Free during beta`, `type="email"`, `testflight` (case-insensitive).

**G-b adversarial nuance:** FAIL if `BUSINESS_WEB_URL` is absent (would mean non-iOS has nowhere to go / everyone → App Store), or if the file lacks `platform ===` (single hardcoded destination). This is the different-angle assertion vs. the happy-path presence check.

**Live-mode robustness:** the guard scans the whole `glass-nav.tsx` file (the explorer branch also contains `detectClientPlatform`/`platform ===`/`get_the_app_clicked`, which is fine — the file-level presence is the floor; the BAN list + the `surface: 'organiser'` + `BUSINESS_*` requirements are what pin the business branch). For `hero.tsx` the checks are unambiguous (no explorer code there). If `fs.existsSync` fails for either target → FAIL (path out of sync).

`--self-test` cases (≥8): GOOD (both consts + detect + `platform ===` + `get_the_app_clicked` + `surface:'organiser'` + assign fallback, no banned tokens) → pass; each of: missing `BUSINESS_WEB_URL` → fire; missing `detectClientPlatform` → fire; missing `platform ===` → fire; missing `get_the_app_clicked` → fire; missing `surface: 'organiser'` → fire; re-added `BetaAccessModal` → fire; re-added `Get Beta Access` → fire; `testflight` token → fire; a banned token inside a comment → stripped → still passes (comment-strip works).

---

## 10. Allowlist + DO-NOT-TOUCH

### Allowlist (create/edit/delete)
**Create:** `.github/scripts/strict-grep/orch-1324-business-getapp-device-aware.mjs`; `mingla-marketing/components/marketing/__tests__/business-getapp-cta.test.ts`; `mingla-marketing/components/marketing/__tests__/business-getapp-cta.tester.test.ts`.
**Edit:** `mingla-marketing/lib/store-links.ts`; `mingla-marketing/components/marketing/glass-nav.tsx` (organiser branch); `mingla-marketing/components/sections/organiser-home/hero.tsx`; `.github/workflows/strict-grep-mingla-business.yml`; `Mingla_Artifacts/INVARIANT_REGISTRY.md`.
**Delete:** `mingla-marketing/components/marketing/beta-access-modal.tsx`; `mingla-marketing/lib/beta-access-submit.ts`; `.github/scripts/strict-grep/i-proposed-1216-explorer-only-cta.mjs`; `.github/scripts/strict-grep/i-proposed-1219-form-no-autoadvance-multiselect.mjs`.

### DO-NOT-TOUCH
- The explorer nav branch + `handleGetTheApp` + `AppQrPanel` mount in `glass-nav.tsx`; `download-qr.tsx`; `app/download/page.tsx`; `lib/site.ts`; `lib/device-platform.ts`; `lib/store-links.ts` lines `APP_STORE_URL`/`PLAY_STORE_URL`.
- The four `orch-1319-*` guards + `i-proposed-1216-no-service-key-client.mjs` + their yml jobs.
- `supabase/functions/beta-access-lead-submit/` + its `config.toml` block; `beta_access_leads` migration/table; `admin_beta_leads_list` RPC.
- `orch-0863-marketing-hub-phase-b.mjs`, `orch-1205-edge-cors-x-client-info.mjs`.
- `/links` (`lib/links-config.ts`) + `links-config.tester.test.ts` + `device-platform.test.ts`.
- Any app-mobile/mingla-business/mingla-admin code, store listings, other marketing routes/sections.

---

## 11. Decisions for orchestrator (REVIEW — flag for Seth)

1. **[COPY — needs Seth approval]** Proposed microcopy:
   - Both CTA labels: **"Get the app"** (matches Explorer; matches the locked label).
   - Hero subcopy (replacing "Free during beta. Two minutes to join."): **"On iPhone now — or get started on the web."** — honest to reality (iOS live; Android/desktop → web; Play in review). Alternatives if Seth prefers: "Now on iPhone. Or run it in your browser." / "Download on iPhone, or open it in your browser." Passes the `organiser-redesign.test.ts` FORBIDDEN scan.
2. **[SCOPE confirmation]** ORCH-1324 expands slightly beyond the two CTAs: it also deletes `BetaAccessModal` + `beta-access-submit.ts` and retires **two** CI guards + **two** invariants (`I-1216-EXPLORER-ONLY-CTA`, `I-1219-FORM-NO-AUTOADVANCE-MULTISELECT`), because those guards hard-require the deleted modal. The `beta_access_leads` table + edge fn stay. This is the correct subtract-before-adding path (mirrors ORCH-1319) — confirm at REVIEW.
3. **[OBSERVATION — non-blocking]** The `/links` business tab routes to `/business` (this surface), not to `business.usemingla.com`; there is no business analog of `/download`. Consistent (one hop to the device-aware CTA). A future ORCH could add a `/business/download` smart-redirect for full parity — out of scope here. Leave `/links`.

---

## 12. Build/verify environment (record)
- `mingla-marketing/node_modules` is **ABSENT** in anchor + worktree → run `npm ci` inside `<worktree>/mingla-marketing/` before `tsc`/`next build`/tests. `react-qr-code` already in deps (unused here — no add).
- Verify: `cd mingla-marketing && npm run typecheck && npm run build`. No jest harness in the marketing package — the two new tests use the repo's `tsc … && node` / `npx tsx` pattern (see `device-platform.test.ts` header for the exact invocation form).
- Strict-grep: `node .github/scripts/strict-grep/orch-1324-business-getapp-device-aware.mjs` and `… --self-test` from repo root.
- Verify explorer parity unaffected: run `node .github/scripts/strict-grep/orch-1319-getapp-cta-direct-store.mjs` + the other 3 `orch-1319-*` + `i-proposed-1216-no-service-key-client.mjs` — all must stay green.

---

## Appendix — file:line evidence index
- Nav organiser CTA (change): `glass-nav.tsx:7` (import), `:36-37` (state), `:124-140` (button), `:159-166` (mount). Explorer template (keep): `:11-14`, `:44-65`, `:141-155`, `:170-172`.
- Hero CTA (change): `hero.tsx:2` (useState import), `:6` (import), `:15-18` (comment), `:24` (state), `:85-91` (button+subcopy), `:97-101` (mount).
- Business App Store: `mingla-business/eas.json:88-89` (`ascAppId 6768737367`) + live listing "Mingla: Host, Sell & Grow".
- Business web root: `mingla-business/app/index.tsx:90-99` (logged-out → `BusinessWelcomeScreen`), `:101-102` (signed-in → dashboard); `mingla-business/vercel.json:59` (`/(.*)`→`/` SPA rewrite); `BusinessWelcomeScreen.tsx:606-692` (Apple/Google/Email get-started).
- SSOT constants: `lib/store-links.ts:6-8` (existing) → append business consts.
- Guards that break: `i-proposed-1216-explorer-only-cta.mjs:56-64,146-151`; `i-proposed-1219-form-no-autoadvance-multiselect.mjs:125-126`. yml jobs: `:3320-3331`, `:3336-3347`.
- Guards that stay green: `orch-1319-getapp-cta-direct-store.mjs` (file-level tokens satisfied by explorer branch); `i-proposed-1216-no-service-key-client.mjs`.
- Guards that mention beta-access but are safe: `orch-1205-edge-cors-x-client-info.mjs:11` (comment), `orch-0863-marketing-hub-phase-b.mjs:1353-1430` (edge fn + migration — kept).
- Invariants: `INVARIANT_REGISTRY.md:5426` (NO-SERVICE-KEY, keep), `:5429` (EXPLORER-ONLY-CTA, decommission), `:5437` (ANON-NO-SELECT, untouched), `:5439` (FORM-NO-AUTOADVANCE, decommission).
- Tests that stay green (no edit): `organiser-copy-fidelity.test.ts`, `organiser-redesign.test.ts`, `device-platform.test.ts`, `links-config.tester.test.ts`.
- `/links` business tab: `links-config.tester.test.ts:70-79` (`LINKS_BUSINESS_PATH === BUSINESS_PATH === '/business'`).
