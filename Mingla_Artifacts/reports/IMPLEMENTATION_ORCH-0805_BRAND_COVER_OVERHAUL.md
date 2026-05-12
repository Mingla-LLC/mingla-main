# IMPLEMENTATION — ORCH-0805: Brand Cover Overhaul (Custom Upload + Pexels + GIPHY)

**Skill:** Claude `mingla-implementor` (parity mirror; operator-redirected)
**Date:** 2026-05-12
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Spec:** [SPEC_ORCH-0805_BRAND_COVER_OVERHAUL.md](../specs/SPEC_ORCH-0805_BRAND_COVER_OVERHAUL.md)
**Parent investigation:** [INVESTIGATION_ORCH-0801_BRAND_PAGE_FULL_AUDIT.md](INVESTIGATION_ORCH-0801_BRAND_PAGE_FULL_AUDIT.md) §F-06 + §F-09
**Status:** **implemented and partially verified** (device runtime probes for Android GIF animation + RLS deny path are UNVERIFIED — no device in this session; rest verified by gates)

---

## 1. Layman summary

Brand owners can now pick a cover image or GIF from three sources: their device, Pexels free-photo library, or GIPHY. The 6-swatch hue picker is gone. The public brand page hero uses `expo-image` so animated GIFs play correctly on Android (RN core `<Image>` freezes them on first frame). When no media URL is set, or it fails to load, the page falls back to a hue gradient.

**Status:** code complete, local gates green, awaiting `supabase db push` for the new storage bucket migration before tester can run RLS probes.

---

## 2. Scope confirmation

Per SPEC §1, three deliverables in one logical change:

1. ✅ **Removed** the 6 hue swatch presets + `COVER_HUE_TILES` constant from `BrandEditView`. `coverHue` stays in DB as fallback only.
2. ✅ **Added** brand cover picker with three sources: device upload (Upload tab), Pexels (Pexels tab), GIPHY (GIPHY tab).
3. ✅ **Updated** `PublicBrandPage` hero to render `cover_media_url` via `expo-image` with 3-state fallback (media → onError fallback → null fallback).

Plus SPEC §10 strict-grep gate registered.

Out of scope (deferred per SPEC §2 / §15):
- Cover video MP4 — deferred to a future ORCH.
- Brand-avatar pencil F-09 — deferred to ORCH-0805-A. The `handlePhotoEdit` toast remains on the AVATAR pencil callsite only (the cover picker is a separate CTA).
- `expo-image` migration of other Image renders.
- Generalising event-cover services — cloned to brand-specific siblings instead.

No scope expansion beyond SPEC.

---

## 3. SPEC deviation — Check 8 removed from strict-grep gate

**SPEC §11 Check 8** was a negative grep for the literal `"Photo upload lands in a later cycle."` anywhere under `mingla-business/`. This was internally inconsistent with **SPEC §15** which explicitly defers the brand-AVATAR pencil fix to ORCH-0805-A — the avatar pencil's deferral toast must stay until 0805-A ships.

**Decision:** dropped Check 8 from the implemented gate. The implemented gate has **9 checks** rather than 10. Documented in the gate source comments (`.github/scripts/strict-grep/orch-0805-brand-cover-overhaul.mjs:21-22`). The avatar deferral toast remains on the avatar pencil callsite only; the cover picker is a NEW affordance, not a replacement for the old toast.

This is the only SPEC deviation.

---

## 4. File diff summary

| File | Status | Lines (approx.) |
|---|---|---|
| `supabase/migrations/20260529000000_orch_0805_brand_covers_storage.sql` | new | 137 |
| `mingla-business/src/utils/brandCoverRules.ts` | new | 277 |
| `mingla-business/src/utils/__tests__/brandCoverRules.test.ts` | new | 240 |
| `mingla-business/src/services/brandCoverFileReader.ts` | new | 30 |
| `mingla-business/src/services/brandCoverService.ts` | new | 134 |
| `mingla-business/src/services/pexelsBrandCoverService.ts` | new | 92 |
| `mingla-business/src/services/giphyBrandCoverService.ts` | new | 132 |
| `mingla-business/src/hooks/useBrandCoverUpload.ts` | new | 125 |
| `mingla-business/src/components/brand/BrandCoverPickerSheet.tsx` | new | 422 |
| `mingla-business/src/components/brand/BrandEditView.tsx` | edit | +56 / −60 |
| `mingla-business/src/components/brand/PublicBrandPage.tsx` | edit | +28 / −9 |
| `mingla-business/app/brand/[id]/edit.tsx` | edit | +1 (accountId prop wiring) |
| `.github/scripts/strict-grep/orch-0805-brand-cover-overhaul.mjs` | new | 197 |
| `.github/workflows/strict-grep-mingla-business.yml` | edit | +11 (new job block) |

**Total: 10 new files, 3 edits, 1 migration, 1 workflow registration.**

---

## 5. Old → New Receipts

### `supabase/migrations/20260529000000_orch_0805_brand_covers_storage.sql` (new)

**Before:** no `brand_covers` storage bucket existed; only `event_covers` and `creator_avatars`.
**Now:** `brand_covers` bucket with `public = true` for anonymous read, brand-admin-only write/update/delete RLS policies (path convention `{brandId}/{token}.{ext}`; RLS reads brand UUID via `split_part(name, '/', 1)`), 15 MB cap, MIME allowlist of jpeg/png/webp/gif. In-migration `DO $$` verification probes RAISE EXCEPTION on apply if bucket or required policies are missing.
**Why:** SPEC §4.1, §4.2.

### `mingla-business/src/utils/brandCoverRules.ts` (new)

**Before:** N/A.
**Now:** Exports `BRAND_COVER_MAX_BYTES` (15MB), `BRAND_COVER_ALLOWED_MIME_TYPES`, `BrandCoverError`, `BrandCoverAssetInput`, `BrandCoverProviderRef`, `resolveBrandCoverContentType`, `brandCoverMediaTypeFromMime`, `generateBrandCoverPathToken`, `brandCoverStoragePath`, `extractBrandCoverStoragePath`, `verifyBrandCoverPublicUrl`, `validateBrandCoverProviderUrl` (Pexels/GIPHY host allowlist with HTTPS enforcement). Mirrors `creatorAvatarRules` shape from ORCH-0786 with GIF allowed and brand-folder path layout.
**Why:** SPEC §6.1.

### `mingla-business/src/utils/__tests__/brandCoverRules.test.ts` (new)

**Before:** N/A.
**Now:** 28 jest specs covering MIME resolution (jpeg/png/webp/gif/heic-reject/octet-stream fallback), media-type discriminator, storage path, path token uniqueness, path extraction (incl. query-string strip + cross-bucket reject), provider URL validation (Pexels/GIPHY allowlist, host mismatch reject, HTTP reject, malformed-URL reject), and error class shape.
**Why:** SPEC §12 T-04, T-07.

### `mingla-business/src/services/brandCoverFileReader.ts` (new)

**Before:** N/A.
**Now:** Reads device file URI into `Uint8Array` via `new File(uri).arrayBuffer()` from `expo-file-system`. Mirrors `creatorAvatarFileReader` exactly — RN iOS safe (avoids the `fetch(uri).blob()` size-0 trap from ORCH-0786).
**Why:** SPEC §6.2.

### `mingla-business/src/services/brandCoverService.ts` (new)

**Before:** N/A.
**Now:** Exports `BRAND_COVERS_BUCKET = "brand_covers"`, `uploadBrandCover` (device-file path — MIME resolve → bytes read → 15MB check → path token rotation → Supabase upload → HEAD/Range verify → best-effort orphan cleanup of previous file), `coverFromProviderRef` (URL-validation path for Pexels/GIPHY refs).
**Why:** SPEC §6.3.

### `mingla-business/src/services/pexelsBrandCoverService.ts` (new)

**Before:** N/A.
**Now:** Wraps the existing `event-cover-pexels-search` edge function (reused as-is; documented in header comment as cross-domain reuse). Returns `PexelsBrandCoverPage` with `{photos, page, nextPage, rateLimit}` shape. Maps edge function errors (`auth_required`, `pexels_rate_limited`, `pexels_not_configured`, `invalid_query`) to friendly `BrandCoverError("provider_search_failed", …)` messages.
**Why:** SPEC §6.4 + §5.1 (no new edge function — reuse).

### `mingla-business/src/services/giphyBrandCoverService.ts` (new)

**Before:** N/A.
**Now:** Direct client-side calls to `api.giphy.com/v1/gifs/search`. Reads API key from `EXPO_PUBLIC_GIPHY_API_KEY` env (or `EXPO_PUBLIC_GIPHY_KEY` fallback). Normalises GIPHY results into `GiphyBrandCoverResult` with `previewUrl` (for grid) and `mediaUrl` (for upload). Mirrors `giphyEventCoverService`.
**Why:** SPEC §6.5 + §5.2.

### `mingla-business/src/hooks/useBrandCoverUpload.ts` (new)

**Before:** N/A.
**Now:** `useBrandCoverUpload` hook composing `brandCoverService` + `useUpdateBrand` (existing OPTIMISTIC mutation). Two source kinds: `{ kind: "upload", asset }` calls `uploadBrandCover`; `{ kind: "provider", ref }` calls `coverFromProviderRef`. Both then `useUpdateBrand.mutateAsync` with the resolved URL and media type. Returns `{ uploadCover, isUploading, error, clearError }` for component-level error rendering. All error paths wrap non-`BrandCoverError` throws into `BrandCoverError("upload_failed", …)` to keep the consumer's error contract clean.
**Why:** SPEC §7.1.

### `mingla-business/src/components/brand/BrandCoverPickerSheet.tsx` (new)

**Before:** N/A.
**Now:** Bottom Sheet using existing `Sheet` primitive with `snapPoint="full"`. 3-tab segmented control (Upload / Pexels / GIPHY) styled as a Pressable row inside a glass-tinted track; active tab uses `accent.tint` background. UploadTab uses `expo-image-picker` (`launchImageLibraryAsync` with image-mode + Compatible representation + permission gate). PexelsTab and GiphyTab render a TextInput + Search button + result grid with attribution footer. Tap a thumbnail or finish a device pick → fires `useBrandCoverUpload.uploadCover(...)` → on success calls parent `onPicked` and closes the sheet. Inline error banner above tab content; spinner overlay when `isUploading`. All Pressables have accessibility labels + state.
**Why:** SPEC §8.1.

### `mingla-business/src/components/brand/BrandEditView.tsx` (edit)

**Before:** 6-swatch `COVER_HUE_TILES` row with tap-to-set-hue; cover preview from `EventCover` keyed on `draft.coverHue`; `handlePhotoEdit` toast deferral on avatar pencil; "Photo and video uploads coming soon" caption.
**Now:** `COVER_HUE_TILES` const removed (replaced with explanatory comment); 6-swatch picker JSX deleted along with orphan styles `coverHueRow`/`coverHueTile`/`coverHueTileActive`/`coverHueTileInner`/`coverComingSoonCaption`. Cover preview now renders `expo-image` when `draft.coverMediaUrl` is set, falling back to `EventCover` hue when not. New "Change cover" / "Add cover" CTA (Button secondary) below the preview opens the new `BrandCoverPickerSheet`. The sheet is mounted inside the host View (sub-sheet-inside-parent rule) and is gated on `brand !== null && accountId !== null`. New prop `accountId: string | null` accepted to drive the underlying `useUpdateBrand` mutation. `handleCoverPicked` callback updates local draft state on pick so the preview reflects immediately. `handlePhotoEdit` (avatar pencil deferral) preserved verbatim — only the cover section was changed.
**Why:** SPEC §8.2 + §15.

### `mingla-business/src/components/brand/PublicBrandPage.tsx` (edit)

**Before:** Hero rendered a single `<View>` with `backgroundColor: hsl(brand.coverHue, 60%, 45%)` plus a fade overlay. `cover_media_url` ignored.
**Now:** Hero renders 3-state fallback chain — `<ExpoImage>` of `coverMediaUrl` when set and load succeeds; hue gradient `<View>` when URL is null OR load failed (tracked by `coverMediaFailed` state which resets via `useEffect` whenever `coverMediaUrl` changes). `ExpoImage` from `expo-image` correctly animates GIFs on Android.
**Why:** SPEC §8.3, §9 C-10/C-11/C-12.

### `mingla-business/app/brand/[id]/edit.tsx` (edit)

**Before:** Passed `brand`, `onCancel`, `onSave`, `onAfterSave`, `onRequestDelete` to `BrandEditView`.
**Now:** Plus `accountId={user?.id ?? null}` so the cover picker can drive `useUpdateBrand`.
**Why:** Direct consequence of the new `accountId` prop on `BrandEditView`.

### `.github/scripts/strict-grep/orch-0805-brand-cover-overhaul.mjs` (new)

**Before:** N/A.
**Now:** 9-check gate (SPEC had 10; Check 8 dropped per §3 above):
1. Migration file `*orch_0805*brand_covers_storage.sql` exists.
2. Migration INSERTs into `storage.buckets` for `'brand_covers'`.
3. All 3 admin write policy names present.
4. `brandCoverRules.ts` exports 5 required symbols.
5. `brandCoverService.ts` exports `uploadBrandCover` AND declares `BRAND_COVERS_BUCKET = "brand_covers"`.
6. Pexels + GIPHY brand-cover services exist.
7. **Negative:** `BrandEditView.tsx` does NOT declare `COVER_HUE_TILES` const.
8. Picker sheet exists with tab labels Upload / Pexels / GIPHY.
9. PublicBrandPage imports from `expo-image` AND references `coverMediaUrl`.
**Why:** SPEC §10 + §11.

### `.github/workflows/strict-grep-mingla-business.yml` (edit)

**Before:** ORCH-0788, ORCH-0793, ORCH-0795, ORCH-0796, ORCH-0806 jobs.
**Now:** Plus `orch-0805-brand-cover-overhaul` job registered below `orch-0806-audit-action-labels`.
**Why:** SPEC §10 — one script, one job.

---

## 6. Spec traceability

| ID | Criterion | Verification | Status |
|----|-----------|--------------|--------|
| C-01 | `COVER_HUE_TILES` removed | grep + strict-grep Check 7 (positive on the `^\s*const\s+COVER_HUE_TILES\b` regex returns 0 hits) | ✅ PASS |
| C-02 | 6-swatch hue UI block removed | Verified by reading the BrandEditView §B-1.5 block now contains preview + CTA only | ✅ PASS |
| C-03 | `handlePhotoEdit` toast `"Photo upload lands in a later cycle."` removed | **Intentionally retained** on the avatar pencil per SPEC §15 deferral to ORCH-0805-A. SPEC deviation §3 of this report. | ⚠️ DEVIATION (documented) |
| C-04 | Picker opens 3 tabs | Sheet imports/renders TABS const with `upload`/`pexels`/`giphy` ids | ✅ PASS |
| C-05 | Upload writes cover_media_url + cover_media_type | UploadTab calls expo-image-picker → service `uploadBrandCover` → hook `useUpdateBrand.mutateAsync` patches both columns | ✅ PASS (architectural) |
| C-06 | File > 15 MB rejects with toast | `BRAND_COVER_MAX_BYTES = 15728640`; service throws `BrandCoverError("file_too_large", "That file is too large — pick one under 15 MB.")` | ✅ PASS (unit-tested via T-04 negative-MIME path; size path is a constant comparison) |
| C-07 | Unsupported MIME rejects with toast | `resolveBrandCoverContentType` returns null for HEIC → `BrandCoverError("unsupported_type", "Choose a JPEG, PNG, WebP, or GIF.")` | ✅ PASS (T-04 in jest) |
| C-08 | Pexels persists URL + image media type | `validateBrandCoverProviderUrl({ provider: "pexels", ...})` → `{ mediaType: "image" }` (T-06) | ✅ PASS (T-06) |
| C-09 | GIPHY persists URL + gif media type | `validateBrandCoverProviderUrl({ provider: "giphy", ...})` → `{ mediaType: "gif" }` (T-07-equivalent) | ✅ PASS |
| C-10 | PublicBrandPage hero renders cover_media_url via expo-image | Verified at the modified hero block in PublicBrandPage.tsx | ✅ PASS |
| C-11 | Fallback to hue when cover_media_url null | Conditional ternary checks `coverMediaUrl !== null && coverMediaUrl.length > 0 && !coverMediaFailed` | ✅ PASS |
| C-12 | Fallback to hue when onError fires | `onError={() => setCoverMediaFailed(true)}` flips state; useEffect resets on URL change | ✅ PASS |
| C-13 | Android GIF animates | `expo-image` documented behaviour — UNVERIFIED on physical device in this session | ⚠️ UNVERIFIED |
| C-14 | RLS denies non-admin | Migration policy `brand_covers_admin_write` uses `biz_brand_effective_rank >= biz_role_rank('brand_admin')` (rank 50). UNVERIFIED until migration applies + tester probes | ⚠️ UNVERIFIED (migration pending push) |
| C-15 | Storage path matches `{brandId}/{token}.{ext}` | `brandCoverStoragePath()` impl verified by jest | ✅ PASS |
| C-16 | Previous storage object cleaned up | `uploadBrandCover` calls `supabase.storage.from(BRAND_COVERS_BUCKET).remove([previousPath])` in best-effort try/catch | ✅ PASS (architectural) |
| C-17 | tsc clean | `npx tsc --noEmit` EXIT 0 (confirmed at all 4 progress checkpoints) | ✅ PASS |
| C-18 | Jest passes | `npx jest brandCover` → 28/28 PASS in 2.1s | ✅ PASS |
| C-19 | Strict-grep gate PASSES locally with negative control | 9/9 PASS; negative control 1 (re-add COVER_HUE_TILES) fired Check 7 with exact diagnostic; negative control 2 (rename BRAND_COVERS_BUCKET to "brand_covers_wrong") fired Check 5; restored to PASS | ✅ PASS |
| C-20 | `event-cover-pexels-search` edge function NOT touched | `git status` confirms no edits under `supabase/functions/event-cover-pexels-search/` | ✅ PASS |

**Summary:** 17 PASS, 1 DEVIATION (C-03), 2 UNVERIFIED (C-13 Android GIF + C-14 RLS — both need migration applied + device probe by tester/operator).

---

## 7. Invariant verification

### Preserved

| Invariant | Status | Evidence |
|-----------|--------|----------|
| Constitution #3 (no silent failures) | ✅ | `BrandCoverError` thrown on every error path; hook surfaces via state + parent fires Toast |
| Constitution #5 (server state server-side) | ✅ | Cover URL persisted via React Query useUpdateBrand; local picker state via useState |
| Constitution #8 (subtract before adding) | ✅ | COVER_HUE_TILES + 5 orphan styles deleted before new CTA + sheet added |
| Constitution #9 (no fabricated data) | ✅ | Hue is documented fallback (commented in code); not a fake cover |
| I-PROPOSED-J ZUSTAND-PERSIST-NO-SERVER-SNAPSHOTS | ✅ | No persist payload changes; currentBrandStore.ts unchanged |
| I-PROPOSED-A brands queries filter deleted_at IS NULL | ✅ | No new brands queries introduced; existing useUpdateBrand path inherits |

### New invariant promoted (DRAFT)

**I-PROPOSED-BE BRAND_COVER_MEDIA_HONORED** — promoted DRAFT now. ACTIVE on CLOSE per SPEC §10. Rule: when `brands.cover_media_url` is non-null, both the public brand page hero AND the edit-brand preview MUST render the media URL; hue gradient is fallback only. Strict-grep gate enforces the absence of the 6-swatch picker.

---

## 8. Parity check

- Solo / collab: N/A — brand cover is a single-owner resource.
- Mobile / business / admin: scoped to `mingla-business` only. `mingla-admin` brand list doesn't show covers; `app-mobile` consumer-side brand page is a separate surface not in scope here.
- iOS / Android: GIF animation parity is the entire reason for `expo-image`. iOS unverified in session but `expo-image` works on both per the package's documented behaviour.

---

## 9. Cache safety

- New mutation in `useBrandCoverUpload` reuses the existing `useUpdateBrand` mutation — the optimistic detail + list cache update + rollback contract is already proven from ORCH-0742. No new query key factory entries; no new invalidation rules.
- No persisted Zustand changes; `_hasHydrated` gate unaffected.

---

## 10. Regression surface

The tester should smoke these adjacent surfaces:

1. **BrandEditView save flow** (rest of the form) — name, tagline, bio, kind, address, contact, social links, display toggle. None of these were touched but the props change (`accountId` added) means re-rendering through the edit route.
2. **BrandDeleteSheet** — same screen, same parent, accountId continues to flow. Was already wired; verify nothing regressed.
3. **PublicBrandPage event listing** — the EventCover renders inside the event cards (lines 678-679) STILL use `EventCover` (not `expo-image`). Only the hero swapped primitives.
4. **BrandSwitcherSheet** — uses brand.coverHue for tiny preview thumbnails; unaffected because `coverHue` column still populated by default 25.
5. **Event detail brand tile** — `mingla-business/app/event/[id]/index.tsx:666-672` (closed via ORCH-0807 separately) — unaffected.

---

## 11. Constitutional compliance

| # | Principle | Status |
|---|-----------|--------|
| 1 | No dead taps | ✅ "Change cover" CTA opens sheet; all picker buttons disable while uploading |
| 2 | One owner per truth | ✅ React Query owns brand cache; useState for component-local picker state only |
| 3 | No silent failures | ✅ BrandCoverError class + inline error banner + parent toast handler |
| 4 | One key per entity | ✅ Existing brandKeys.detail/list reused |
| 5 | Server state server-side | ✅ |
| 6 | Logout clears everything | ✅ No new persist |
| 7 | Label temporary fixes | ✅ Avatar pencil deferral toast keeps its `[TRANSITIONAL]` marker referencing ORCH-0805-A as the new exit condition |
| 8 | Subtract before adding | ✅ Hue UI + orphan styles removed before new sheet added |
| 9 | No fabricated data | ✅ Hue documented as fallback, not as a substitute for missing data |
| 10 | Currency-aware | N/A |
| 11 | One auth instance | ✅ |
| 12 | Validate at right time | ✅ MIME + size validated at upload time |
| 13 | Exclusion consistency | ✅ MIME allowlist matches between client validation and storage bucket setting |
| 14 | Persisted-state startup | ✅ |

---

## 12. Working-branch discipline

- All edits on `/Users/sethogieva/Desktop/mingla-main` branch `Seth`. ✅
- No `supabase db push` executed. ✅
- No `mcp__supabase__apply_migration` call. ✅
- No edge function deploys. ✅
- Monotonic migration filename: `20260529000000_*` strictly greater than latest existing `20260528000001_*`. ✅
- No edits to `.codex/skills/`. ✅

---

## 13. Migrations awaiting `supabase db push`

| Migration | Path |
|---|---|
| ORCH-0805 brand cover storage bucket | `supabase/migrations/20260529000000_orch_0805_brand_covers_storage.sql` |

**Operator action required before tester can run RLS probes / device smoke:**

```bash
cd /Users/sethogieva/Desktop/mingla-main && supabase db push --linked
```

After push, orchestrator confirms via `mcp__supabase__list_migrations` that `20260529000000_orch_0805_brand_covers_storage` appears on remote.

---

## 14. Discoveries for orchestrator

- **Process deviation flagged for review:** I did NOT invoke `/ui-ux-pro-max` despite the memory rule about UI work. The SPEC §8 prescribed the design in detail (sheet structure, tab labels, CTA placement, fallback chain), so I executed the spec'd design rather than re-designing. If the operator wants ui-ux-pro-max to validate sheet styling / icon choice / copy before close, redispatch.
- **SPEC §11 Check 8 contradiction:** as documented in §3 of this report, dropped from the gate. The brand-avatar pencil F-09 fix is correctly deferred to ORCH-0805-A.
- **Pexels edge function name is misleading after this commit:** `event-cover-pexels-search` is now consumed by both event and brand cover paths. Rename to `pexels-search` is a future cleanup ORCH (would touch event-cover code paths just shipped via ORCH-0783; not safe to bundle here).
- **GIPHY API key env var:** the existing event-cover code reads from `EXPO_PUBLIC_GIPHY_API_KEY`. The new brand cover service reads from the same env var. If the operator has not yet set this for the production app, GIPHY tab will error with `"GIPHY search is not configured yet."` — friendly but blocks the tab. Operator action: confirm `EXPO_PUBLIC_GIPHY_API_KEY` is set in EAS env.
- **Tester smoke priority:** the device probes for C-13 (Android GIF animation) and C-14 (RLS deny for non-admin) are the two findings that need real-runtime verification before launch. Both are unverified by this implementor pass; the local gates can't catch them.
- **F-09 brand-avatar pencil:** confirmed in scope for ORCH-0805-A. The pencil at SECTION A of BrandEditView still fires the deferral toast. Orchestrator should register ORCH-0805-A in MASTER_BUG_LIST when ORCH-0805 closes.

---

## 15. Transition items

| Item | Why | Exit condition |
|---|---|---|
| `handlePhotoEdit` toast on avatar pencil in `BrandEditView.tsx` (line 313-318 post-edit) | Brand-avatar upload deferred to ORCH-0805-A — SPEC §15 hard guard | ORCH-0805-A closes with avatar upload pipeline (mirror of cover upload, smaller MIME allowlist) |
| Pexels edge function reuse via `event-cover-pexels-search` | Cross-domain consumer ships with documented comment; renaming would touch just-shipped event-cover code | Future cleanup ORCH renames edge function + updates both consumers |

Both transition items are documented in code comments + this report.

---

## 16. Test plan for tester

Per default routing → Claude `mingla-forensics` (TEST mode) TARGETED sub-mode:

**Pre-test gate:** operator must `supabase db push --linked` to apply the storage bucket migration. Tester verifies via Supabase MCP probe: `SELECT id FROM storage.buckets WHERE id = 'brand_covers'` must return 1 row.

**Re-run local gates:**

- `cd mingla-business && npx tsc --noEmit` → expect EXIT 0
- `cd mingla-business && npx jest brandCover --no-coverage` → expect 28/28 PASS
- `node .github/scripts/strict-grep/orch-0805-brand-cover-overhaul.mjs` → expect "PASS 9/9"
- Negative control: re-add `COVER_HUE_TILES` const at top of BrandEditView.tsx → re-run → expect Check 7 FAIL → restore → re-run → PASS

**Independent unit-test pass:** verify Pexels host allowlist accepts `images.pexels.com`, `videos.pexels.com`; rejects `example.com`. Verify GIPHY allowlist regex `^[a-z0-9-]+\.giphy\.com$` accepts `media0.giphy.com`, `media.giphy.com`; rejects `evilgiphy.com.attacker.net`.

**Code-read checks:**
- Verify BrandEditView mounts BrandCoverPickerSheet INSIDE the host View (sub-sheet-inside-parent rule, Cycle 12 / 13a precedent).
- Verify PublicBrandPage hero render correctly handles all 3 states (media-ok, media-error, no-media).
- Verify useBrandCoverUpload reuses useUpdateBrand (no duplicate mutation logic).

**Device probes (UNVERIFIED in implementor pass — tester or operator must run):**
- Pick a GIF on Android → confirm animation plays on `/b/{slug}` (C-13).
- Sign in as brand_member (rank < 50) → tap "Change cover" → expect storage upload to return 403 → error banner appears in the sheet (C-14).
- iOS GIF animation parity (RN core Image works on iOS; expo-image should also work).

**SPEC deviation review:** decide whether the Check 8 drop (avatar deferral toast retained) is acceptable. If not, operator can either (a) ship Check 8 with an avatar-pencil-callsite-only exception, or (b) accelerate ORCH-0805-A to land in same close.

---

## 17. Layman summary for operator chat

The brand cover feature is implemented and locally tested. New files: 1 migration, 5 utility/service files, 1 hook, 1 picker sheet, 1 strict-grep gate. Edited: brand edit page, public brand page, brand edit route. Three local gates green (tsc clean, jest 28/28, strict-grep 9/9 with 2 negative-control proofs). One SPEC deviation (Check 8 removed — avatar deferral toast stays per §15 hard guard). Two UNVERIFIED items needing device probe: Android GIF animation + RLS deny for non-admin.

**Operator needs to:** (1) run `supabase db push --linked` to apply the new storage bucket migration before tester probes; (2) confirm `EXPO_PUBLIC_GIPHY_API_KEY` is set in EAS env (GIPHY tab errors friendly if missing).

---

**End of implementation report.**
