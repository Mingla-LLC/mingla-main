# IMPLEMENTATION — ORCH-1319 [Explorer "Get the app" → device-aware live-store links + desktop QR; kill beta gate & lead-capture]

**Phase:** IMPLEMENT (complete) — awaiting TEST/CLOSE.
**Branch:** `ORCH-1319-explorer-direct-store-links` · **Base commit (fails-on-revert anchor):** `d34c33a1a`
**Surface:** `mingla-marketing/` only (+ the `explorer-app-lead-submit` edge fn decommission + listed guards/registry). No app/native change.
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-1319_EXPLORER_DIRECT_STORE_LINKS.md` — implemented exactly.

---

## Per-item status (DONE / evidence)

### 1. Nav "Get the app" CTA — device-aware — DONE
- `mingla-marketing/components/marketing/glass-nav.tsx:44-65` — `handleGetTheApp()`: `detectClientPlatform()` → iOS `window.open(APP_STORE_URL)` (fallback `location.assign`), Android `PLAY_STORE_URL`, desktop/other → `setQrOpen(true)`.
- CTA wired at `:146-154` (`onClick={handleGetTheApp}`, `aria-haspopup="dialog"`, `aria-expanded={qrOpen}`). `GetTheAppModal` import + `appOpen` state REMOVED; explorer mount replaced by `<AppQrPanel>` at `:170-172`.
- Platform detection extracted/reused from the deleted modal into `lib/device-platform.ts` (byte-identical `isIosDevice`/`resolvePlatform`/`detectClientPlatform`).
- Organiser branch (`:124-140`, `:160-166`) UNCHANGED.

### 2. New `/download` server route — DONE
- `mingla-marketing/app/download/page.tsx` — Server Component, `export const dynamic = 'force-dynamic'` (`:23`); `const ua = (await headers()).get('user-agent') ?? ''`; `resolvePlatformFromUa(ua)`; iOS→`redirect(APP_STORE_URL)`, Android→`redirect(PLAY_STORE_URL)` (307); else 200 QR + `<AppStoreBadges size="lg" />`. SSR-safe (no `navigator`/`window`). Build classifies it as `ƒ (Dynamic)`.

### 3. QR — DONE
- Dependency `react-qr-code@^2.0.15` added to `mingla-marketing/package.json:22` (+ lockfile: 2 new entries `react-qr-code`, `qrcode-generator`; `prop-types` already present — no churn).
- `mingla-marketing/components/marketing/download-qr.tsx` — `<QRCode value={DOWNLOAD_URL} fgColor="#0E0E10" bgColor="#FFFFFF" level="M">` inside a `role="img"` + `aria-label` wrapper; raw `/download` URL shown as selectable text beneath. Encodes exactly `${SITE_ORIGIN}/download` (from `lib/site.ts`). Inline SVG, zero network.

### 4. Kill email capture — DONE
- Deleted: `get-the-app-modal.tsx`, `lib/explorer-app-submit.ts`, `lib/explorer-interest.ts`, `lib/explorer-interest.test.ts`, `lib/explorer-interest.tester.test.ts`.
- Decommissioned edge fn: whole dir `supabase/functions/explorer-app-lead-submit/` (index + 3 `__tests__`) removed; `supabase/config.toml` `[functions.explorer-app-lead-submit]` block replaced with a decommission note (`config.toml:120-124`).
- **Data preserved:** NO migration; `public.explorer_app_leads` table + rows + RLS untouched. `admin_explorer_app_leads_list()` RPC path unchanged.

### 4b. TestFlight URL gone everywhere — DONE
- Both occurrences died with the deleted modal + edge fn. `grep -rniI "testflight.apple.com" mingla-marketing/ supabase/functions/` → **0 hits**. Enforced permanently by G-4.

### 5. Guards — classification followed EXACTLY — DONE
| Verdict | Guard | Result |
|---|---|---|
| RETIRE (file+job deleted) | `i-proposed-1216-testflight-behind-submit` | deleted |
| RETIRE | `i-proposed-1216-android-no-testflight-link` | deleted |
| RETIRE | `i-proposed-1216-success-mount-gated` | deleted |
| RETIRE | `i-proposed-1219-always-email-download-link` | deleted |
| RETIRE | `i-proposed-1221-allpill-selects-all` | deleted |
| AMEND → organiser-only | `i-proposed-1219-form-no-autoadvance-multiselect` | explorer half stripped, `checkOrganiser` kept; self-test 4/4 + live PASS |
| AMEND → beta/organiser-only | `i-proposed-1216-explorer-only-cta` | GetTheApp half stripped, BetaAccessModal-organiser-only + no-cross-import kept; self-test 4/4 + live PASS |
| KEEP unchanged | `i-proposed-1216-no-service-key-client` | untouched; self-test 4/4 + live PASS (104 files scanned, 0 secrets) |
- New gates G-1..G-4 added (files + yml jobs + comment-index entries). yml: 5 RETIRE jobs removed, 2 AMEND job names updated, 4 new jobs added, retirement documented in comments. 319 jobs, no duplicates.

### 6. Organiser/business waitlist NOT touched — DONE
- `beta-access-modal.tsx`, `lib/beta-access-submit.ts`, `supabase/functions/beta-access-lead-submit/`, `config.toml:113-118`, glass-nav organiser mount — all UNCHANGED (git status shows none modified). `[functions.beta-access-lead-submit]` block intact.
- `I-1216-ANON-NO-SELECT` reaffirmed ACTIVE (table preserved).

### 7. Analytics — DONE
- `captureMarketing('get_the_app_clicked', { platform, store, location })` on every nav branch (`glass-nav.tsx:48-52, 59-63`): `{ios,app_store}`, `{android,play}`, `{other,qr_panel}`, all `location:'nav'`. Old `marketing_cta_clicked{cta_id:'get_the_app'}` superseded; `get_the_app_submitted` gone with the transport. Organiser `marketing_cta_clicked{cta_id:'get_beta_access'}` untouched.

---

## Gates — fails-on-revert proof (base commit `d34c33a1a`)

Each: revert the guarded property → gate exits 1; restore → exits 0.

| Gate | Reverting edit | Revert result | Restored |
|---|---|---|---|
| **G-1** `orch-1319-getapp-cta-direct-store` | glass-nav: `PLAY_STORE_URL`→`APP_STORE_URL` (everyone→App Store) | **exit 1** — "must reference BOTH APP_STORE_URL and PLAY_STORE_URL … play=false" | exit 0 |
| **G-2** `orch-1319-download-route-ua` | /download: `redirect(PLAY_STORE_URL)`→inline `redirect('https://play.google.com/…')` | **exit 1** — "inlines a literal Play URL — use PLAY_STORE_URL (G-2b)" | exit 0 |
| **G-3** `orch-1319-qr-encodes-download-url` | download-qr: `value={DOWNLOAD_URL}`→literal App Store URL | **exit 1** — "the QR encodes a literal store URL — it must encode DOWNLOAD_URL" | exit 0 |
| **G-4** `orch-1319-no-testflight-anywhere` | add `testflight.apple.com` token under mingla-marketing/ | **exit 1** — "contains a `testflight.apple.com` token" | exit 0 |

All 8 gate `--self-test` suites PASS (G-1 8/8, G-2 6/6, G-3 5/5, G-4 4/4; amended 1219 4/4, amended 1216 4/4, kept security 4/4). Worktree clean after restore (0 uncommitted, no residue).

DRAFT invariants left DRAFT: `I-1319-GETAPP-CTA-LINKS-LIVE-STORES-NOT-TESTFLIGHT`, `I-1319-NO-DOWNLOAD-GATE`, `I-1319-DOWNLOAD-ROUTE-UA-REDIRECT`.

---

## `/download` runtime UA test (production server `next start`, real curl)

| UA | Result | Evidence |
|---|---|---|
| iPhone (iOS 17.5 Safari) | **307** → `https://apps.apple.com/app/id6760440898` | `HTTP/1.1 307` + `location:` header |
| Android (Pixel 8 Chrome) | **307** → `https://play.google.com/store/apps/details?id=com.mingla.app.v2` | `HTTP/1.1 307` + `location:` header |
| Desktop (Windows Chrome) | **200 HTML** — inline `<svg>` QR (role=img+aria-label), both live badges, `usemingla.com/download` shown, **no form / no email / no testflight** | `HTTP/1.1 200` + HTML content asserts |
| curl / empty UA | **200 HTML** (safe fallback) | `HTTP/1.1 200` |

Route-level ACs T-4/T-5/T-6 are **runtime-verified** (production server curl).

---

## Build / typecheck / tests

- `npx tsc --noEmit` → **exit 0** (no dangling imports; T-12).
- `npx next build` → **✓ compiled, 12/12 pages, `/download` = ƒ Dynamic** (628 B). Next also ran type-validation during build.
- Unit tests (repo tsc+node pattern): `lib/device-platform.test.ts` **7/7 PASS** (T-8 iPad-as-Mac/Android/desktop parity + server UA-only fallback); `lib/site.test.ts` **4/4 PASS** (DOWNLOAD_URL contract, T-7 logic).
- Zero remaining refs to deleted symbols: `grep` for `explorer-app-submit|explorer-interest|GetTheAppModal|get_the_app_submitted|submitExplorerAppLead` → only lineage COMMENTS remain (no live imports). `testflight.apple.com` → 0 in scanned dirs.
- **Lint:** `next lint` is not configured in this package (no eslintrc; it prompts interactive setup). Not run — not wired for mingla-marketing. Not a regression.

---

## Deviations from spec

- **Registry line numbers** in the spec Appendix (5308–5332) were stale; the actual entries are at ~5350–5375. Edited by invariant ID, not line number. No behavioral deviation.
- **yml "Currently registered gates" comment index** did **not** contain entries for the retired 1216/1219/1221 gates (nothing to prune there); added the 4 new ORCH-1319 entries per house style.
- **`[deploy]` tag / edge-fn delete:** NOT applied — those happen at MERGE/CLOSE (task said do not deploy/merge). The commit carries no `[deploy]` tag; the orchestrator must add it at merge and run `supabase functions delete explorer-app-lead-submit --project-ref gqnoajqerqhnvulmnyvv`.
- **`react-qr-code` pinned `^2.0.15`** (installed 2.2.0; peer `react:'*'` → React 19 OK; ships types; pure inline SVG, no network) — spec said "add `react-qr-code`", version chosen conservatively.

## Not runtime-verified (honest caps)

- **Nav click → store/QR (T-1/T-2/T-3):** the store-selection + analytics logic is proven by G-1 (platform-driven), the device-platform unit test (the exact resolver), typecheck + production build. The client DOM *click* firing `window.open` / opening the QR dialog was **not browser-driven** in this harness (no jest/RTL/Playwright wired for mingla-marketing). Same detection code path is runtime-proven server-side via `/download`. Suspected-correct for the DOM click; recommend the tester drive it in a real browser + scan the QR on physical iPhone/Android (T-10 DB row-count check also belongs to test/live-fire).

---

## Files

**Created:** `lib/store-links.ts`, `lib/site.ts`, `lib/device-platform.ts`, `lib/device-platform.test.ts`, `lib/site.test.ts`, `components/marketing/download-qr.tsx`, `components/marketing/app-qr-panel.tsx`, `app/download/page.tsx`, `.github/scripts/strict-grep/orch-1319-{getapp-cta-direct-store,download-route-ua,qr-encodes-download-url,no-testflight-anywhere}.mjs`.
**Edited:** `components/marketing/glass-nav.tsx`, `components/ui/app-store-badges.tsx`, `package.json`, `package-lock.json`, `.env.example`, `.github/workflows/strict-grep-mingla-business.yml`, `.github/scripts/strict-grep/i-proposed-1219-form-no-autoadvance-multiselect.mjs`, `.github/scripts/strict-grep/i-proposed-1216-explorer-only-cta.mjs`, `supabase/config.toml`, `Mingla_Artifacts/INVARIANT_REGISTRY.md`.
**Deleted:** `components/marketing/get-the-app-modal.tsx`, `lib/explorer-app-submit.ts`, `lib/explorer-interest.ts`, `lib/explorer-interest.test.ts`, `lib/explorer-interest.tester.test.ts`, `supabase/functions/explorer-app-lead-submit/**`, 5 retired strict-grep gate files.
