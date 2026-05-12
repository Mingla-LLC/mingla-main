# QA — ORCH-0805: Brand Cover Overhaul (Custom Upload + Pexels + GIPHY)

**Skill:** Claude `mingla-tester` (parity mirror, operator-redirected)
**Mode:** TARGETED
**Date:** 2026-05-12
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Spec:** [SPEC_ORCH-0805_BRAND_COVER_OVERHAUL.md](../specs/SPEC_ORCH-0805_BRAND_COVER_OVERHAUL.md)
**Implementation report:** [IMPLEMENTATION_ORCH-0805_BRAND_COVER_OVERHAUL.md](IMPLEMENTATION_ORCH-0805_BRAND_COVER_OVERHAUL.md)

---

## Verdict

**CONDITIONAL PASS**

- **P0:** 0
- **P1:** 0
- **P2:** 1 (SPEC §11 Check 8 deviation — needs operator acceptance per §3 of impl report)
- **P3:** 2
- **P4:** 5 (praise)

Zero blocking defects in the code. The CONDITIONAL is for one documented SPEC deviation (Check 8 dropped because keeping the avatar deferral toast contradicts §15 — operator must accept that trade-off to upgrade to PASS). Two UNVERIFIED criteria (C-13 Android GIF animation, C-14 RLS deny for non-admin) are explicit per spec — both need device runtime + an applied migration that this code-review-only test cannot probe.

---

## Layman summary

Brand cover overhaul implementation is solid. Resolver pipeline mirrors ORCH-0786 avatar pattern faithfully, MIME allowlist matches between client and Supabase Storage bucket (Constitution #13 ✓), Pexels/GIPHY URL host validation correctly matches the actual response URLs (verified by tracing through `event-cover-pexels-search` edge function which returns `https://images.pexels.com/...` URLs that pass the new allowlist), no cross-domain blast outside the brand surface, hook composition reuses the proven `useUpdateBrand` optimistic mutation rather than duplicating logic.

One real concern flagged for operator: the SPEC §11 Check 8 (negative grep for `"Photo upload lands in a later cycle."`) was dropped during implementation because keeping the literal contradicts §15's hard guard to defer F-09 avatar pencil to ORCH-0805-A. The implementor documented this in §3 of the impl report. **Operator must explicitly accept this trade-off** to upgrade the verdict to PASS. If unacceptable, options: (a) accelerate ORCH-0805-A into the same close commit, or (b) carve out an exception in Check 8 that allows the literal only on the avatar callsite.

Two items genuinely need device runtime to verify and cannot be proven in this code-review pass: GIF animation on a real Android device, and the RLS deny path for brand_member users attempting cover uploads (requires the new migration to be live on remote).

---

## Independent verification — gates re-run

| Gate | Command | Result |
|---|---|---|
| tsc | `cd mingla-business && npx tsc --noEmit` | ✅ EXIT 0 |
| jest brandCover | `cd mingla-business && npx jest brandCover --no-coverage` | ✅ 28/28 PASS in 2.3s |
| strict-grep | `node .github/scripts/strict-grep/orch-0805-brand-cover-overhaul.mjs` | ✅ PASS 9/9 |
| Negative control (independent, different from implementor's) | Temporarily move `pexelsBrandCoverService.ts` aside; expect Check 6 FAIL | ✅ Fired with exact diagnostic `"Check 6 FAIL: pexelsBrandCoverService.ts missing"`; restored to PASS |

Implementor's negative controls used Check 7 (re-add COVER_HUE_TILES) and Check 5 (rename bucket constant). I independently chose Check 6 (delete provider service) so the gate is proven on three different paths.

---

## Cross-domain blast verification

- **Files importing the new modules:** grep across `mingla-business/` for `brandCoverRules` / `brandCoverService` / `useBrandCoverUpload` / `BrandCoverPickerSheet` / `pexelsBrandCoverService` / `giphyBrandCoverService` returns **only the new files themselves + BrandEditView.tsx** as the consumer. Zero leakage outside the brand surface.
- **Event-cover code paths NOT touched:** confirmed via `git status` — no edits to `mingla-business/src/services/pexelsEventCoverService.ts`, `giphyEventCoverService.ts`, `eventCoverFileReader.ts`, `eventCoverMediaService.ts`, or any `event-cover-*` edge function. SPEC criterion C-20 PASS.
- **PublicBrandPage parity:** only the hero render adopts `expo-image`. All other image renders on that page remain on existing primitives (verified by grep — only one `<Image as ExpoImage>` import, used only in the hero block). Implementor's scope discipline is correct.

---

## Spec compliance matrix

| ID | Criterion | Verification path | Status |
|----|-----------|-------------------|--------|
| C-01 | `COVER_HUE_TILES` removed | `grep -nE "^\s*const\s+COVER_HUE_TILES" mingla-business/src/components/brand/BrandEditView.tsx` returns 0 hits (only the explanatory replacement comment); strict-grep Check 7 enforces | ✅ PASS |
| C-02 | 6-swatch hue UI block removed | Verified by reading the §B-1.5 block: preview + CTA only, no Pressable map over hues, no `accessibilityLabel="Cover hue …"` strings remain | ✅ PASS |
| C-03 | `handlePhotoEdit` toast removed | **DEVIATION** — toast retained on the AVATAR pencil per SPEC §15. Documented in impl report §3. Operator must accept or reject. | ⚠️ DEVIATION |
| C-04 | Picker opens 3 tabs | `BrandCoverPickerSheet.tsx:56-60` defines TABS as `[{id:"upload",label:"Upload"},{id:"pexels",label:"Pexels"},{id:"giphy",label:"GIPHY"}]`; strict-grep Check 8 verifies labels | ✅ PASS |
| C-05 | Upload writes cover_media_url + cover_media_type | UploadTab calls `expo-image-picker` → service `uploadBrandCover` returns `{publicUrl, mediaType}` → hook passes `coverMediaUrl` + `coverMediaType` to `useUpdateBrand.mutateAsync` | ✅ PASS (architectural; runtime UNVERIFIED) |
| C-06 | File > 15 MB rejects with toast | `brandCoverService.ts` checks `byteLength > BRAND_COVER_MAX_BYTES` → throws `BrandCoverError("file_too_large", "That file is too large — pick one under 15 MB.")`; sheet's `fireSource` catches BrandCoverError and calls `onErrorToast` | ✅ PASS (architectural) |
| C-07 | Unsupported MIME rejects | Jest T-04 (HEIC) confirms `resolveBrandCoverContentType` returns null → service throws `BrandCoverError("unsupported_type", ...)` | ✅ PASS (jest-tested) |
| C-08 | Pexels persists URL + image media type | Jest specs in `brandCoverRules.test.ts` for `validateBrandCoverProviderUrl({provider:"pexels", …})` → `{mediaType:"image"}`; allowlist accepts `images.pexels.com` + `videos.pexels.com`; rejects `evil.example.com` (P4 below: confirmed Pexels edge fn returns `images.pexels.com/...` matching the allowlist) | ✅ PASS |
| C-09 | GIPHY persists URL + gif media type | Jest for `provider:"giphy"` allowlist regex `^[a-z0-9-]+\.giphy\.com$` accepts `media.giphy.com` + `media0.giphy.com`; rejects `evilgiphy.com.attacker.net` | ✅ PASS |
| C-10 | PublicBrandPage hero renders cover_media_url via expo-image | `PublicBrandPage.tsx:262-269` ternary on `coverMediaUrl !== null && coverMediaUrl.length > 0 && !coverMediaFailed` renders `<ExpoImage>` | ✅ PASS |
| C-11 | Fallback to hue when cover_media_url null | Else branch at `:270-277` renders `<View>` with `hsl(brand.coverHue, …)` | ✅ PASS |
| C-12 | Fallback to hue when onError fires | `onError={() => setCoverMediaFailed(true)}` at `:266`; `useEffect` at `:111` resets when `coverMediaUrl` changes (prevents stale-failure on URL switch) | ✅ PASS |
| C-13 | Android GIF animates | `expo-image` package documented behaviour; no device probe in this session | ⚠️ UNVERIFIED |
| C-14 | RLS denies non-admin | Migration policy `brand_covers_admin_write` predicate `biz_brand_effective_rank(btm.role::text) >= biz_role_rank('brand_admin')`; needs migration applied + brand_member user attempt to probe | ⚠️ UNVERIFIED (migration awaiting `supabase db push`) |
| C-15 | Storage path matches `{brandId}/{token}.{ext}` | `brandCoverStoragePath()` impl + jest specs verify the format | ✅ PASS |
| C-16 | Previous storage object cleaned up | `uploadBrandCover` calls `supabase.storage.from(BRAND_COVERS_BUCKET).remove([previousPath])` inside try/catch (non-blocking); `extractBrandCoverStoragePath` correctly returns null for non-bucket URLs so switching from Pexels → upload doesn't try to delete a Pexels URL (good defensive behaviour, jest-verified) | ✅ PASS |
| C-17 | tsc clean | Re-run independently: EXIT 0 | ✅ PASS |
| C-18 | Jest passes | Re-run independently: 28/28 PASS in 2.3s | ✅ PASS |
| C-19 | Strict-grep gate PASSES locally with negative control | Re-run independently: PASS 9/9; independent negative control on Check 6 fired with exact diagnostic | ✅ PASS |
| C-20 | `event-cover-pexels-search` edge function NOT touched | `git diff supabase/functions/event-cover-pexels-search/` returns empty; cross-domain reuse documented in `pexelsBrandCoverService.ts` header comment | ✅ PASS |

**Summary: 17 PASS, 1 DEVIATION (C-03), 2 UNVERIFIED (C-13, C-14).**

---

## Constitution sweep (14 rules)

| # | Principle | Status | Evidence |
|---|-----------|--------|----------|
| 1 | No dead taps | ✅ | "Change cover" CTA opens sheet; all picker buttons disable while `isUploading` |
| 2 | One owner per truth | ✅ | React Query owns brand cache; useState for component-local picker state only |
| 3 | No silent failures | ✅ | `BrandCoverError` class thrown on every error path; sheet shows inline banner + parent fires toast |
| 4 | One key per entity | ✅ | Existing `brandKeys.detail` / `brandKeys.list` reused; no new keys |
| 5 | Server state server-side | ✅ | Cover URL via React Query mutation; no Zustand additions |
| 6 | Logout clears everything | ✅ | No new persist payload |
| 7 | Label temporary | ✅ | Avatar deferral toast keeps `[TRANSITIONAL]` marker with ORCH-0805-A as new exit condition |
| 8 | Subtract before adding | ✅ | `COVER_HUE_TILES` + 5 orphan styles deleted BEFORE the new CTA + sheet added (verified by diff) |
| 9 | No fabricated data | ✅ | Hue gradient documented in-code as fallback; not displayed as a substitute for missing data |
| 10 | Currency-aware | N/A | No money on this surface |
| 11 | One auth instance | ✅ | No auth changes |
| 12 | Validate at right time | ✅ | MIME + size validated at upload time (not display time, not load time) |
| 13 | **Exclusion consistency** | ✅ | **Critical check — MIME allowlist matches between client (`BRAND_COVER_ALLOWED_MIME_TYPES`) and Supabase bucket setting (`allowed_mime_types ARRAY`). Both list jpeg/png/webp/gif. Size cap matches too: `15 * 1024 * 1024 = 15728640` = bucket `file_size_limit`.** |
| 14 | Persisted-state startup | ✅ | No new persist |

14/14 compliant. Constitution #13 is the standout — exact match between client validation and bucket setting prevents the failure mode where a client-allowed MIME gets rejected at upload, or worse, a client-rejected MIME slips past into the bucket.

---

## Findings

### P2 — SPEC §11 Check 8 deviation (avatar deferral toast retained)

**File:** `.github/scripts/strict-grep/orch-0805-brand-cover-overhaul.mjs:80-82` (Check 8 dropped) + `mingla-business/src/components/brand/BrandEditView.tsx:313-318` (`handlePhotoEdit` retained)

**Issue:** SPEC §11 enumerated 10 strict-grep checks; the implementor dropped Check 8 (negative grep for the literal `"Photo upload lands in a later cycle."`) because that literal must remain on the avatar pencil callsite per SPEC §15's hard guard deferring F-09 brand-avatar pencil to ORCH-0805-A. The two SPEC sections genuinely contradict — Check 8 would have forced removal of the avatar deferral toast that §15 explicitly preserves.

**Severity:** P2 — non-blocking, documented in impl report §3. The deviation is internally consistent with §15 (the more specific hard guard wins); the gate is stronger if Check 8 is permanently dropped than if reinstated with a half-baked exception.

**Fix options for operator:**

1. **Accept the deviation** (recommended) → upgrade verdict to PASS. The gate has 9 checks rather than 10; Check 8's intent (preventing accidental reintroduction of the toast as a cover deferral) is no longer relevant because the toast stays anchored to the avatar pencil.
2. **Reject the deviation** → either accelerate ORCH-0805-A to land in the same close commit (removes the avatar toast at the same time as the cover overhaul, reinstates Check 8), or rewrite Check 8 to allow the literal ONLY on the avatar callsite (positive grep for the toast on the avatar pressable; negative grep elsewhere — more code, marginal gain).

### P3 — Cover writes to DB immediately on pick (separate from form save)

**File:** `mingla-business/src/hooks/useBrandCoverUpload.ts:92-107`

**Issue:** When the user picks a cover (upload or Pexels/GIPHY), the change persists to `brands.cover_media_url` immediately via `useUpdateBrand.mutateAsync` — before the user taps Save on the rest of the form. This means: pick a cover, change the brand name, tap Cancel → the cover persists, the name change is lost. Mirrors the avatar precedent from ORCH-0786 (avatar also saves on pick) but worth noting as UX consideration.

**Severity:** P3 — by design per SPEC §7.1 (the SPEC explicitly says "the upload hook ... persists to brands.cover_media_url"). Document for user-facing release notes if the inconsistency with other form fields surprises operators.

**Fix instructions:** none required. If operator wants form-wide save instead, refactor `useBrandCoverUpload` to only return the URL + mediaType and let `handleSave` write them along with the rest — that's a non-trivial change in scope.

### P3 — `isDirty` may briefly pulse true after cover pick before optimistic cache lands

**File:** `mingla-business/src/components/brand/BrandEditView.tsx:261-264` + `:329-340`

**Issue:** Between `handleCoverPicked` updating local draft (t=1) and `useBrandCoverUpload`'s underlying `useUpdateBrand.onMutate` writing the optimistic cache update that re-renders this component with the new `brand` prop (t=2), there's a ~1-render window where `isDirty` evaluates to `true` (because `draft !== brand` on the cover field) even though the cover is being persisted right now. Could cause a brief flash of "Discard changes?" affordance, or the Save button enabling, before settling.

**Severity:** P3 — visual flicker only, no incorrect behaviour. React Query's optimistic mutation pattern makes this window microscopic in practice.

**Fix instructions:** if it surfaces as a real UX bug post-ship, gate `isDirty` on cover fields differently (exclude `coverMediaUrl` / `coverMediaType` from the JSON.stringify comparison since they're saved out-of-band). Not worth touching now.

### P4 — Praise: MIME allowlist Constitution #13 exact match

**Observation:** The MIME allowlist in `brandCoverRules.ts:13-18` (`["image/jpeg","image/png","image/webp","image/gif"]`) exactly matches the migration's bucket setting (`allowed_mime_types ARRAY['image/jpeg','image/png','image/webp','image/gif']`). The size cap also matches exactly (`15 * 1024 * 1024 = 15728640` = bucket `file_size_limit`). Constitution #13 exclusion-consistency satisfied cleanly — no drift between client validation and server enforcement.

### P4 — Praise: Cross-domain blast verified zero

**Observation:** Independent grep across `mingla-business/` confirmed only `BrandEditView.tsx` imports any of the new modules. No event-cover code path touched. SPEC criterion C-20 verified by `git diff` returning empty for `supabase/functions/event-cover-pexels-search/`.

### P4 — Praise: Pexels URL host allowlist matches edge function response shape

**Observation:** Traced through `supabase/functions/event-cover-pexels-search/index.ts:152-153` which maps Pexels API `photo.src.landscape` (always a `https://images.pexels.com/...` URL per Pexels API contract) into the `mediaUrl` field returned to the client. The new `PEXELS_HOST_ALLOWLIST` in `brandCoverRules.ts:241-244` accepts `images.pexels.com` exactly. Verified by reading the edge function test fixture at `index.test.ts:105`. No host-mismatch bug latent.

### P4 — Praise: Hook composition reuses proven mutation, no duplicate logic

**Observation:** `useBrandCoverUpload` does NOT reinvent the optimistic mutation contract — it calls the existing `useUpdateBrand` which already has the proven rollback contract from ORCH-0742. Just adds two source-kind branches before the DB write. Clean composition.

### P4 — Praise: In-migration verification probes

**Observation:** The migration's `DO $$ ... RAISE EXCEPTION ... $$` block (lines 110-134) RAISES EXCEPTION on apply if the bucket or required policies are missing. Apply-time fail-fast prevents a runtime mystery if the migration partial-applies. Mirrors the ORCH-0795 / ORCH-0793 v2 precedent.

---

## What I did not test

- **Device runtime perf** — no device probe available in this session for the cover hero load time or GIF frame rate.
- **Live RLS deny path** — requires the migration to be applied via `supabase db push` AND a brand_member user. Tester cannot run this code-review pass.
- **Live Supabase MCP probe of the bucket** — same prerequisite as RLS.
- **VoiceOver / TalkBack screen reader passes** — accessibility labels exist in code but not run through actual readers.
- **EAS env var `EXPO_PUBLIC_GIPHY_API_KEY`** — if not set in production EAS, GIPHY tab errors friendly (`"GIPHY search is not configured yet."`); not a code defect but a deployment prerequisite the implementor flagged in their report's §14.
- **iOS GIF animation** — RN core Image already animates GIFs on iOS, so `expo-image` is not strictly required for iOS animation. Implicit assumption; no risk if `expo-image` keeps the same behaviour.

If operator wants any of these covered before close, they can run the device smoke themselves or redispatch to forensics TEST mode after the migration applies.

---

## Discoveries for orchestrator

- **SPEC §11 Check 8 should be permanently removed from the SPEC text** so the spec history matches the gate. Suggest the operator + orchestrator update the SPEC §11 to enumerate 9 checks (or have a "checks removed during implementation: …" note). The current state has the SPEC saying 10 checks but the gate saying 9 — drift risk for future maintainers.
- **ORCH-0805-A is registered** as the avatar pencil follow-up (per impl report §15 and the new transition item). Orchestrator should add a banner in MASTER_BUG_LIST on CLOSE.
- **`event-cover-pexels-search` rename to `pexels-search`** is queued as a future cleanup ORCH (orthogonal to ORCH-0805-A — different scope). Orchestrator should track.
- **Independent + implementor negative controls cover 3 different checks (5, 6, 7).** Gate's robustness across the check space is well-proven now.

---

## What needs operator/orchestrator action

1. **Decide on SPEC §11 Check 8 deviation** (P2):
   - Accept → upgrade verdict to PASS, proceed to CLOSE.
   - Reject → either bundle ORCH-0805-A or rewrite Check 8 with callsite scope.
2. **Apply the new migration** via `supabase db push --linked` before any operator-side smoke or future tester re-probe of C-14 (RLS deny).
3. **Confirm `EXPO_PUBLIC_GIPHY_API_KEY` is set in EAS env** before OTA — otherwise GIPHY tab is dead-on-launch (friendly error but blocking).
4. **Update SPEC §11** to reflect the 9-check gate state (drift cleanup).
5. **Register ORCH-0805-A** in MASTER_BUG_LIST on CLOSE banner.

---

## What needs rework (FAIL findings)

**None.** Verdict is CONDITIONAL PASS — the deviation is documented and operator-decidable, not a code defect.

If the operator rejects the Check 8 deviation, the rework is small: either (a) accelerate ORCH-0805-A's avatar upload pipeline into this commit, or (b) rewrite Check 8 to scope to the avatar callsite only. Implementor would need direction from orchestrator on which path.

---

**End of QA report.**
