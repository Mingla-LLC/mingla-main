# QA — ORCH-1319 [Explorer "Get the app" → device-aware live-store links + desktop QR; kill beta gate & lead-capture]

**Phase:** TEST (independent adversarial verification) — brutal QA, assume-broken-until-proven.
**Branch:** `ORCH-1319-explorer-direct-store-links` · **Impl commit:** `d34c33a1a` (parent/pre-change anchor `4dee863b4`).
**Surface:** `mingla-marketing/` (+ `explorer-app-lead-submit` edge-fn decommission + listed guards/registry).
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-1319_EXPLORER_DIRECT_STORE_LINKS.md`.

---

## VERDICT: PASS ✅

**P0 (blocker): 0 · P1 (must-fix): 0 · P2/notes: 3 (all per-spec / cosmetic).**

The implementation matches the spec exactly. Every gate passes and re-proves fails-on-revert; `tsc --noEmit` and `next build` are green; the `/download` UA→redirect matrix is INDEPENDENTLY runtime-proven by my own `next start` + curl (not just the implementor's claim); the desktop QR page renders an inline-SVG QR encoding `usemingla.com/download` with both live store badges and **zero** form/email/testflight tokens; the organiser `BetaAccessModal` + its data path are 100% untouched and its two narrowed guards still enforce the organiser contract; there are no live imports of any deleted symbol anywhere in the repo.

The only surface not runtime-driven in this harness is the **nav DOM click** (no RTL/jest wired for `mingla-marketing`). Its store-selection logic runs the *same* `lib/device-platform` + `lib/store-links` code path that `/download` proves at runtime, and is pinned by G-1 + a new decision-matrix unit test — but the literal browser `window.open` / QR-dialog-open is **suspected-correct**, capped pending the physical-device smoke below.

---

## 1. Gates re-run independently (all GREEN)

| Gate | self-test | live |
|---|---|---|
| G-1 `orch-1319-getapp-cta-direct-store` | PASS 8/8 | PASS |
| G-2 `orch-1319-download-route-ua` | PASS 6/6 | PASS |
| G-3 `orch-1319-qr-encodes-download-url` | PASS 5/5 | PASS |
| G-4 `orch-1319-no-testflight-anywhere` | PASS 4/4 | PASS (738 files scanned, 0 testflight tokens) |
| `i-proposed-1216-explorer-only-cta` (AMENDED→organiser-only) | PASS 4/4 | PASS |
| `i-proposed-1219-form-no-autoadvance-multiselect` (AMENDED→organiser-only) | PASS 4/4 | PASS |
| `i-proposed-1216-no-service-key-client` (KEPT) | PASS 4/4 | PASS (106 files, 0 secrets) |
| `orch-0863-marketing-hub-phase-b` (pre-existing; references deleted edge-fn paths) | PASS | PASS — C7 skipped for non-0863 PRs; `ORCH_1216_BACKEND_ALLOWLIST` is a permissive same-commit path list, NOT a presence assertion → deletion is safe |

### Fails-on-revert re-proven (the two most important)
- **G-4 (no-testflight):** dropped a throwaway file carrying `testflight.apple.com` under `mingla-marketing/` → **exit 1** ("contains a `testflight.apple.com` token"); removed → **exit 0**. (No product-code edit — used a throwaway file.)
- **G-1 (platform-driven stores):** transiently rewrote `PLAY_STORE_URL`→`APP_STORE_URL` in `glass-nav.tsx` (everyone→App Store) → **exit 1** ("must reference BOTH APP_STORE_URL and PLAY_STORE_URL … play=false"); `git checkout` restore → **exit 0**. Tree clean after.

## 2. Build / typecheck / unit tests (INDEPENDENTLY re-run)
- `npx tsc --noEmit` → **exit 0** (including my appended test file).
- `npx next build` → **exit 0**; 12/12 pages; `/download` = **ƒ (Dynamic)** 628 B.
- `lib/device-platform.test.ts` → **7/7 PASS** (iPad-as-Mac→ios, real-Mac→other, Android, Windows, server UA-only + iPad-as-Mac fallback).
- `lib/site.test.ts` → **4/4 PASS** (DOWNLOAD_URL absolute, ends `/download`, no double slash).

## 3. `/download` runtime — INDEPENDENTLY PROVEN (my own `next start` + curl on :3919)

| UA | HTTP | Location | AC |
|---|---|---|---|
| iPhone 17.5 Safari | **307** | `https://apps.apple.com/app/id6760440898` | T-4 ✅ |
| Android 14 Pixel 8 | **307** | `https://play.google.com/store/apps/details?id=com.mingla.app.v2` | T-5 ✅ |
| Windows desktop | **200** HTML | — | T-6 ✅ |
| iPad-as-Mac (Mac UA, no iPad token) | **200** HTML | — (per-spec safe QR fallback) | ✅ |
| empty UA (curl) | **200** HTML | — | ✅ |
| Googlebot | **200** HTML | — (SEO-safe) | ✅ |
| lowercase `android` token | **307** | Play | ✅ (case-insensitive) |

Desktop `200` HTML body asserted: inline `<svg>` QR present; `role="img"` + "scan with your phone camera" aria-label present; App Store **and** Google Play badges (both aria-labels present); both live store URLs present; `usemingla.com/download` shown as selectable text; **`<form`=0, `type=email`=0, `testflight`=0**; no external asset host requested.

## 4. Adversarial review results (per dispatch §2)
- **(a) UA edge cases:** iPadOS-13+-as-Mac → desktop QR page server-side (documented, ACCEPTABLE per spec §4.0C/§4.2 — safe fallback still shows the App Store badge; client nav catches iPad via `maxTouchPoints`). Bots/empty UA → 200 (proven). Case-insensitivity: server `resolvePlatformFromUa` uses `/i` on both iOS and Android tokens (proven with lowercase `android`).
- **(b) One-QR contract:** `download-qr.tsx` binds `value={DOWNLOAD_URL}` (`${SITE_ORIGIN}/download`), NOT a store URL — so one QR serves both scanners. Enforced by G-3, confirmed in the rendered HTML.
- **(c) Organiser modal + data path:** `beta-access-modal.tsx`, `lib/beta-access-submit.ts`, `supabase/functions/beta-access-lead-submit/`, `config.toml` `[functions.beta-access-lead-submit]`, and the glass-nav organiser branch are **not in the diff** (untouched). The two narrowed guards' self-tests still FIRE on a reintroduced organiser auto-advance and on a `BetaAccessModal` mounted in the explorer branch (4/4 each).
- **(d) Leftover deleted symbols:** zero **live imports** of `get-the-app-modal` / `explorer-app-submit` / `explorer-interest` anywhere. Remaining textual hits are lineage comments + the guards' own ban-lists + the `orch-0863` permissive allowlist (all benign).
- **(e) No PII on any download path:** confirmed by grep + G-2 + runtime HTML — no `<form>`, `<input>`, or `type="email"` on `/download`, the QR panel, the QR, or the badges.

## 5. Per-AC: proven vs suspected

| AC | Status | Evidence |
|---|---|---|
| T-4 `/download` iPhone→App Store | **PROVEN** | my curl 307 |
| T-5 `/download` Android→Play | **PROVEN** | my curl 307 |
| T-6 `/download` desktop→200 QR+badges, no form | **PROVEN** | my curl + HTML body asserts |
| T-7 QR encodes `${SITE_ORIGIN}/download`, inline svg, role=img+aria-label | **PROVEN** | G-3 + build HTML + site.test 4/4 |
| T-8 resolver parity (iPad-as-Mac/Android/desktop/server) | **PROVEN** | device-platform.test 7/7 |
| T-9 no testflight anywhere | **PROVEN** | G-4 live, 738 files, 0 hits |
| T-11 beta modal untouched, amended gates green | **PROVEN** | diff + gates + self-tests |
| T-12 build/typecheck | **PROVEN** | tsc 0, next build 0 |
| T-1 nav iOS click→App Store + `get_the_app_clicked{ios,app_store}` | **SUSPECTED** | G-1 + decision-matrix test + identical `/download` runtime path; DOM click not browser-driven |
| T-2 nav Android click→Play | **SUSPECTED** | same |
| T-3 nav desktop click→QR dialog (ESC/focus-trap/restore) | **SUSPECTED** | source-review of a11y patterns; not DOM-driven |
| T-10 `explorer_app_leads` rows unchanged + anon SELECT denied | **SUSPECTED** | no migration touched (structural preservation); no live prod DB read performed in this harness |

## 6. Tester-authored adversarial regression test

**Path:** `mingla-marketing/lib/download-route-decision.tester.test.ts` (append-only; tsc-clean; runs via the repo tsc+node pattern).

**Different angle from G-1..G-4:** all four shipped gates are **token-presence greps** — they prove the constants/resolver/analytics *appear*, but NONE proves the **platform→store binding is correct**. A swapped ternary (iOS→Play, Android→App Store) or a swapped constant (APP_STORE_URL holding the Play URL) passes ALL FOUR grep-gates yet strands every user on the wrong store — the exact regression this ORCH exists to kill. My test replicates the `/download` decision (`app/download/page.tsx:35-39`) over the shared resolver + shared constants and pins:
- constant **distinctness** + exact canonical-URL integrity (not Play/App-Store/TestFlight cross-pollution);
- iOS UAs (iPhone/iPad/iPod) → App Store **and never** Play; Android UAs (incl. lowercase) → Play **and never** App Store;
- Windows / iPad-as-Mac / Googlebot / empty UA → no redirect (QR page);
- the **one-QR-both-platforms** contract (same URL, two scanners, two correct-and-different stores).

**On the fix:** **13/13 PASS**; `tsc --noEmit` on the whole package stays **exit 0**.
**Fails-on-revert:** transiently swapped `APP_STORE_URL`↔`PLAY_STORE_URL` in `lib/store-links.ts` → my test **FAILED (2 cases)** while G-1 grep-gate still **PASSED (exit 0)** — demonstrating the exact blind spot my test closes. Restored → 13/13 PASS, tree clean.

## 7. P2 / notes (non-blocking, all per-spec or cosmetic)
1. Client `isIosDevice`/`resolvePlatform` use `/iPad|iPhone|iPod/` **without** the `i` flag (server variant uses `/i`). This is byte-identical to the original per spec §4.0C ("verbatim, no drift"); real iOS UAs always use canonical case, so no practical impact. Documented, not a defect.
2. iPadOS-13+-as-Mac lands on the desktop QR page server-side (not a direct App Store 307). Explicitly accepted by spec §4.2 as a safe fallback (the page shows the App Store badge); the client nav still catches iPad via `maxTouchPoints`.
3. `orch-0863-marketing-hub-phase-b.mjs` still lists the deleted `explorer-app-lead-submit` files in `ORCH_1216_BACKEND_ALLOWLIST`. Verified harmless (permissive same-commit allowlist, and C7 is skipped for non-0863 PRs). Optional future cleanup, not required for this CLOSE.

## 8. Physical-device smoke checklist (closes T-1/T-2/T-3 + T-10; run before final sign-off)
1. **iPhone (real):** open `usemingla.com`, tap nav **"Get the app"** → must open App Store listing `id6760440898` (Mingla), **zero** form/modal.
2. **Android (real):** tap nav **"Get the app"** → must open Google Play `com.mingla.app.v2`, **zero** form.
3. **Desktop browser:** tap **"Get the app"** → QR dialog opens (role=dialog; ESC closes; focus trapped and restored to the CTA on close). Scan that QR with the iPhone → App Store; scan the **same** QR with Android → Play.
4. **Direct route:** visit `usemingla.com/download` on iPhone → App Store; on Android → Play; on desktop → QR + both badges page.
5. Confirm the QR panel and `/download` page carry **no** name/email/city/interest field.
6. **DB (live-fire):** `SELECT count(*) FROM public.explorer_app_leads` before/after a window of real traffic → **unchanged** (no new capture); confirm anon REST SELECT on `explorer_app_leads` returns `[]` (RLS deny-by-default holds).
7. **Analytics:** confirm PostHog receives `get_the_app_clicked { platform, store, location }` on each tap and **no** `get_the_app_submitted`.

---

### Guardrails honored
Added test files only (one, append-only); **no product-code edits** (all transient revert probes restored via `git checkout`; final tree carries only the untracked test). Organiser modal + its guards untouched and re-verified. No secret values touched. Did **not** merge / deploy / close. New invariants left **DRAFT**.
