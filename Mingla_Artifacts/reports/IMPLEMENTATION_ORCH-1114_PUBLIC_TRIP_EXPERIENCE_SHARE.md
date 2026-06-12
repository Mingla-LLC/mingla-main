# IMPLEMENTATION — ORCH-1114 [public trip + experience Share button is a dead tap on web]

- **Mode:** IMPLEMENT (mingla-implementor) — executes the binding SPEC verbatim.
- **Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1114-[trip-share-link]/` · branch `ORCH-1114-trip-share-link`
- **Date:** 2026-06-11
- **Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-1114_PUBLIC_TRIP_EXPERIENCE_SHARE.md`
- **Investigation:** `Mingla_Artifacts/investigations/INVESTIGATE_ORCH-1114_PUBLIC_TRIP_SHARE.md`
- **Single commit:** `e8c45511dd069f209b6ebde6070d5a2a3603b84d`
- **Status:** implemented and verified (web routing via source-guard tests + typecheck; native parity preserved by construction — runtime device proof is the tester's gate per spec §11).

---

## 1. Summary

The public buyer-anon **trip** page (`/t/{brandSlug}/{tripSlug}`) and **experience** page (`/exp/{brandSlug}/{experienceSlug}`) previously called react-native `Share.share` with an empty `catch {}`. On `react-native-web` (all desktop browsers, where `navigator.share` is undefined) that call rejects and the empty catch swallowed it — a dead tap with no share sheet, no copy-link, no toast.

Both pages now open the existing web-aware `ShareModal` (the same primitive the event `/e/` and brand `/b/` pages already use), which offers Copy link, Share via…, QR, and platform deep-links with success/failure toasts on every browser. A net-new `experiencePublicUrl` (+ `experiencePublicPath`) helper was added to `publicUrls.ts`, mirroring the existing trip helpers; the trip page reuses the existing `tripPublicUrl`. Frontend-only — no DB, edge, migration, or deploy.

---

## 2. SPEC success-criteria coverage

All criteria satisfied by commit `e8c45511`.

| SC | Criterion | How verified | Result |
|----|-----------|--------------|--------|
| SC-1-Web (trip) | Tap Share on `/t/…` opens ShareModal (Copy link / Share via… / URL / QR) | Source-guard A-PUBLIC-9 (`<ShareModal` + `setShareModalVisible` + `tripPublicUrl(`); ShareModal already renders all elements (DO-NOT-TOUCH, verified verbatim) | ✓ (runtime browser proof = tester gate) |
| SC-2-Web (trip copy) | Copy link → "Link copied" toast | Delivered by reused `ShareModal` (unmodified) | ✓ (tester gate) |
| SC-3-Web (trip native-share fallback) | Share via… without `navigator.share` → "Native share not supported" toast | Reused `ShareModal` (unmodified) | ✓ (tester gate) |
| SC-4-Web (experience) | Same as SC-1 for `/exp/…` | Source-guard A-EXP-9 (`<ShareModal` + `experiencePublicUrl(`) | ✓ (tester gate) |
| SC-5-iOS (native parity) | Business iOS Share opens ShareModal; Share via… → OS sheet | `ShareModal`→`sharePublicUrl` native branch unchanged; no web-only guard added | ✓ preserved by construction (tester device gate) |
| SC-6-Android (native parity) | Same via Android `sharePublicUrl` branch | same | ✓ preserved by construction (tester device gate) |
| SC-7 (helper) | `experiencePublicUrl({brandSlug:"acme",experienceSlug:"sunset-sail"})` → `https://business.usemingla.com/exp/acme/sunset-sail`; throws `PublicUrlError` on empty segment; `tripPublicUrl` unchanged | jest T-1/T-2/T-3/T-4/T-5 PASS | ✓ |
| SC-8 (no bare Share.share) | Neither route imports/calls `Share`; both reference `ShareModal` | jest A-PUBLIC-9 / A-EXP-9 (`.not.toMatch(/Share\.share/)` + no `Share` import) PASS | ✓ |
| SC-9 (no silent catch) | No empty `catch {}` around share path | empty-catch handler deleted from both routes (source) | ✓ |

---

## 3. Files changed

| File | Status | Δ (approx) |
|------|--------|-----------|
| `mingla-business/src/constants/publicUrls.ts` | M | +16 |
| `mingla-business/app/t/[brandSlug]/[tripSlug].tsx` | M | +10 / −20 |
| `mingla-business/app/exp/[brandSlug]/[experienceSlug].tsx` | M | +12 / −19 |
| `mingla-business/src/constants/__tests__/publicUrls.test.ts` | M | +27 |
| `mingla-business/app/t/__tests__/public-trip-page.test.ts` | M | +18 |
| `mingla-business/app/exp/__tests__/public-experience-page.test.ts` | A (new) | +81 |

Only the 6 spec-allowlist files were touched. No DO-NOT-TOUCH file modified.

---

## 4. Data-model changes applied

None. Frontend-only ORCH (no migration, table, constraint, index, or RLS change).

---

## 5. Edge functions touched

None.

---

## 6. Regression tests added

- `mingla-business/src/constants/__tests__/publicUrls.test.ts` — T-1/T-2 (canonical trip + experience URLs), T-3 (segment encoding), T-4/T-5 (empty/whitespace segment → `PublicUrlError`). +3 tests.
- `mingla-business/app/t/__tests__/public-trip-page.test.ts` — A-PUBLIC-9 (trip share routes through `ShareModal`, no bare `Share.share`, no `Share` import). +1 test.
- `mingla-business/app/exp/__tests__/public-experience-page.test.ts` — NEW. A-EXP-1..7 (anon-tolerance + mounts mirror) + A-EXP-9 (experience share routes through `ShareModal` + `experiencePublicUrl`, no bare `Share.share`). +8 tests.

**Test run (fix in place):**
```
PASS app/exp/__tests__/public-experience-page.test.ts
PASS src/constants/__tests__/publicUrls.test.ts
PASS app/t/__tests__/public-trip-page.test.ts
Test Suites: 3 passed, 3 total
Tests:       23 passed, 23 total
```

**fails-on-revert verified at `e8c45511dd069f209b6ebde6070d5a2a3603b84d`** (true line-deletion, not comment-out):
- Reverted `app/t/[brandSlug]/[tripSlug].tsx` ShareModal mount → `Share.share` call, AND `experiencePublicUrl` → hand-rolled concat without `requireSegment`. Result:
```
FAIL app/t/__tests__/public-trip-page.test.ts
  ● A-PUBLIC-9: trip share routes through ShareModal, not bare Share.share
FAIL src/constants/__tests__/publicUrls.test.ts
  ● T-4/T-5: experience helper rejects empty/whitespace segments (fails-on-revert)
Tests:       2 failed, 13 passed, 15 total
```
- Restored via `git checkout` → all 23 PASS again (shown above). The tests exercise the actual regression.

---

## 7. Old → New receipts

### `src/constants/publicUrls.ts`
- **Before:** had `tripPublicPath`/`tripPublicUrl` but NO experience helper.
- **Now:** adds `experiencePublicPath` + `experiencePublicUrl` after the trip helpers, using shared `requireSegment` + `BUSINESS_PUBLIC_ORIGIN` (mirror of trip pair). `tripPublicUrl` and all other exports unchanged.
- **Why:** SC-7; the experience page needs a canonical, guard-checked share URL (none existed).
- **Lines:** +16.

### `app/t/[brandSlug]/[tripSlug].tsx`
- **Before:** `handleShare` async called `Share.share` (Platform-branched) with empty `catch {}`; share `IconChrome` `onPress` wrapped `void handleShare()`. Imported `Share` + `Platform`.
- **Now:** `handleShare` is a synchronous 1-liner `setShareModalVisible(true)`; share `IconChrome` `onPress={handleShare}`; added `useState` + `<ShareModal url={tripPublicUrl({brandSlug,tripSlug})} title={payload.trip.title} description={payload.trip.description?.slice(0,200)} />` gated on `typeof brandSlug/tripSlug === "string"`. Removed `Share`, `Platform` imports.
- **Why:** SC-1/SC-8/SC-9 — kill the dead-tap + silent catch; route through web-aware modal.
- **Lines:** +10 / −20.

### `app/exp/[brandSlug]/[experienceSlug].tsx`
- **Before:** identical `Share.share` + empty-catch dead-tap pattern with `void handleShare()` wrapper; imported `Share` + `Platform`.
- **Now:** same swap as trip, with `<ShareModal url={experiencePublicUrl({brandSlug,experienceSlug})} title={experience.title} description={experience.description?.slice(0,200) ?? undefined} />` gated on string slugs. Removed `Share`, `Platform` imports.
- **Why:** SC-4/SC-8/SC-9.
- **Lines:** +12 / −19.

---

## 8. Cross-surface impact table

| # | Surface | Affected | What changes | Parity |
|---|---------|----------|--------------|--------|
| 1 | Consumer iOS (`app-mobile/`) | NO | routes don't exist there | — |
| 2 | Consumer Android (`app-mobile/`) | NO | routes absent | — |
| 3 | Buyer/anon Web (`mingla-business/` `/t/`, `/exp/`) | YES (primary) | Share opens ShareModal (copy/QR/share-via/toasts) — no dead tap | Automatic (shared ShareModal) |
| 4 | Business iOS (native) | YES (parity-preserve) | Share opens ShareModal; Share via… → OS sheet via `sharePublicUrl` native branch | Automatic |
| 5 | Business Android (native) | YES (parity-preserve) | same via Android branch | Automatic |
| 6 | Admin Web (`mingla-admin/`) | NO | no such routes | — |
| 7 | Business Web preview (adjacent) | NO | public buyer routes, not in-app preview | — |

Parity is automatic across all affected surfaces — the shared `ShareModal` (DO-NOT-TOUCH, unmodified) already branches native internally. No web-only guard was added that could suppress the modal on native (spec §3 native-parity note honored).

---

## 9. Smoke result

- jest (the 3 touched specs): 23/23 PASS.
- `tsc --noEmit` (business `typecheck`): ZERO errors in any touched file (the 4 source files + 2 test files). The 303 pre-existing tsc errors are all in unrelated files (`packages/*`, marketing ComposerV2, checkout flows) — the known business-app baseline, not introduced here.
- Runtime browser/device verification (desktop Chrome modal open + Copy-link/Share-via toasts + native OS-sheet parity) is the tester's gate per spec §11 (Constitution #1 demands real-browser proof, not source-only). Labeled: web routing structurally verified; runtime behavior delivered by the unmodified, already-shipped `ShareModal`.

---

## 10. Known issues / deferred

- Pre-existing unused import `glass` in `app/t/[brandSlug]/[tripSlug].tsx` (line 31) — present before this ORCH, NOT in the spec allowlist scope, left untouched (no scope creep). Not introduced by this change.
- No `[TRANSITIONAL]` markers added.

---

## 11. Operator action required

- **Migration `db push`:** none (frontend-only).
- **Edge-function deploy:** none.
- **OTA:** per spec §11 + `feedback_eas_ota_publish_per_platform.md`, this is pure-JS (business-app + buyer-web) — no native rebuild needed. OTA is orchestrator/operator-owned at CLOSE (per-platform: `eas update --platform ios` then `--platform android`). The implementor does NOT deploy/merge/OTA.
- **Next:** route to `mingla-tester` for the device/runtime gate, then `mingla-orchestrator` CLOSE (flip `I-PROPOSED-PUBLIC-SHARE-VIA-SHAREMODAL` DRAFT → ACTIVE).

---

## 12. Discoveries for Orchestrator

- The route-guard regression tests are intentionally worded to avoid the literal string `Share.share` in the protective comments (the comment now says "the bare react-native share API"), because A-PUBLIC-9/A-EXP-9 assert `.not.toMatch(/Share\.share/)` over the whole source file — a comment containing `Share.share` would (correctly) fail the test. Future edits to these route files must keep the literal `Share.share` out of comments to satisfy the guard.
- COMMS_LEDGER: scanned on entry. The OPEN entries addressed to `ALL` are WARN-level only (COMMS-0003 external-API docs, COMMS-0021 Stripe seller-surface copy, COMMS-0022 business-web phone-browser routes) — all N/A to this frontend-only share-button change (no external API, no Stripe copy, no BottomNav/route-shell touch). Factored, no acks written (no BLOCK to action; no cross-ORCH discovery to register).
