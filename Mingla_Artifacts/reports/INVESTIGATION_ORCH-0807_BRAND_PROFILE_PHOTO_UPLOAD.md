# INVESTIGATION — ORCH-0807: Brand profile photo upload + native square crop

**Skill:** Claude `mingla-forensics` (INVESTIGATE mode)
**Date:** 2026-05-12
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Dispatch:** Operator orchestrator paragraph 2026-05-12, parameters locked:
- Surface: `BrandEditView.tsx` only
- Crop: enforced square via `expo-image-picker` + `expo-image-manipulator` fallback
- Display: round circle
- Storage: new `brand_avatars` Supabase bucket
- File cap: 5MB
- MIME: JPEG/PNG/WEBP
- New invariant I-PROPOSED-BG + CI gate
- Implementor uses `/ui-ux-pro-max` pre-flight

## TL;DR

This is a small, well-scoped feature — most of the architecture is already in place. Schema columns exist (`brands.profile_photo_url` + `brands.profile_photo_type`), the `Avatar` UI primitive already supports a `photo?: string` prop, `BrandEditView` already has the pencil-edit button wired to a `handlePhotoEdit` callback (currently fires a transitional toast `"Photo upload lands in a later cycle."`), and `PublicBrandPage` already renders the photo when `brand.photo` is populated. **The 14 production brands all have `profile_photo_url = NULL` today** — clean slate, no data migration.

The work is: build the upload pipeline (sheet + hook + service + edge fn + storage bucket + RLS), replace the transitional toast with a sheet open, wire `photo={...}` to two more Avatar render sites, flip the `Avatar` hero variant from rounded-square to circle, and add the new invariant + CI gate. Pattern mirrors ORCH-0805 (brand cover) with simpler scope — only Upload tab, no Pexels/GIPHY, no GIF/video, enforced square.

## Investigation manifest

Read in order:

1. `Mingla_Artifacts/CLOSE_NOTE_ORCH-0805.md` — brand cover overhaul context (the canonical sibling pattern)
2. `Mingla_Artifacts/CLOSE_NOTE_ORCH-0802.md` — Wave 4 part 2 close; understand what's just shipped
3. Live Supabase SQL probes (2026-05-12):
   - `SELECT profile_photo_type, COUNT(*) FROM brands GROUP BY` → all 14 brands NULL
   - `SELECT … FROM information_schema.columns WHERE table_name='brands' AND column_name IN ('profile_photo_url','profile_photo_type')` → both exist
4. `mingla-business/src/types/brand.ts` lines 211 + 286-290 — Brand TS interface: `photo?: string` + `profilePhotoType?: "image" | "video" | "gif"`
5. `mingla-business/src/services/brandMapping.ts` lines 33, 50, 62, 79, 213-222, 258, 282-283 — DB ↔ TS column mapping
6. `mingla-business/src/components/brand/BrandEditView.tsx` lines 52, 315-330, 413-440, 865-880 — Avatar render + pencil button + `handlePhotoEdit` stub + `heroAvatarWrap` style
7. `mingla-business/src/components/brand/BrandProfileView.tsx` lines 42, 355-356, 639 — Avatar hero render
8. `mingla-business/src/components/brand/PublicBrandPage.tsx` lines 76, 236, 252, 339-352, 826 — Avatar hero + cover-band overlap + already wires `photo={brand.photo}`
9. `mingla-business/src/components/ui/Avatar.tsx` lines 1-141 — primitive with `photo?: string` prop + `hero`/`row` size variants; **hero is `radius.lg` (rounded square) NOT circle**
10. `mingla-business/src/components/brand/BrandCoverPickerSheet.tsx` lines 1-150 — sibling sheet pattern (3 tabs)
11. `mingla-business/src/hooks/useBrandCoverUpload.ts` — hook signature + cache invalidation pattern
12. `mingla-business/src/services/brandCoverService.ts` — service shape + storage path token
13. `mingla-business/src/utils/creatorAvatarRules.ts` — ORCH-0786 precedent for `*AvatarRules.ts` validation shape (resolveContentType / path-token / public-URL verify)
14. `supabase/migrations/20260529000000_orch_0805_brand_covers_storage.sql` — RLS pattern to mirror (column-detection fallback, public read, brand-admin write via name's first '/'-segment)
15. `supabase/functions/brand-cover-upload-intent/index.ts` (implied by name) — edge fn signature pattern
16. `mingla-business/package.json` — confirmed `expo-image-picker ~17.0.11` installed; `expo-image-manipulator` NOT installed
17. `app-mobile/package.json` — `expo-image-manipulator ~14.0.8` present (same Expo SDK 51 generation; install in mingla-business is additive)

## Findings (classified)

### 🔵 OBSERVATION-1 — Schema is ready, no migration needed for columns

`brands.profile_photo_url text NULL` and `brands.profile_photo_type text NULL` exist as of migration `20260506000000_brand_kind_address_cover_hue_media.sql`. Live SQL probe 2026-05-12 confirms 14 brands, 100% NULL across both columns. The TS Brand interface already has `photo?: string` + `profilePhotoType?: "image" | "video" | "gif"` (the union type was future-proofed in DEC-109 / Q1=B amendment for animated avatars; v1 of ORCH-0807 writes `"image"` only).

**Implication for SPEC:** zero ALTER TABLE statements needed for the existing columns. The only DB migration is the new `brand_avatars` storage bucket + RLS policies (mirrors `20260529000000_orch_0805_brand_covers_storage.sql`).

### 🔵 OBSERVATION-2 — UI scaffolding is already in place

`BrandEditView.tsx`:
- Line 419-428: `<View style={styles.heroAvatarWrap}>` wrapping the Avatar + a `<Pressable onPress={handlePhotoEdit} accessibilityLabel="Edit brand photo">` pencil-edit overlay. The pencil button already exists, hit-slop already configured, styles already defined (lines 865-880).
- Line 318-320: `handlePhotoEdit` currently fires a transitional toast `"Photo upload lands in a later cycle."` — exactly what the implementor replaces with the new sheet open trigger.
- Line 322-340: `handleOpenCoverPicker` / `handleCloseCoverPicker` / `handleCoverPicked` callbacks for the cover picker — the exact pattern the new avatar picker mirrors with `setDraft({...prev, photo: result.publicUrl, profilePhotoType: "image"})`.

**Implication for SPEC:** no new JSX scaffolding in `BrandEditView` beyond the sheet mount + 4-callback set + `photo={draft.photo}` prop on the existing Avatar. Maybe ~25 net new lines + remove the transitional toast call.

### 🟡 HIDDEN-FLAW-1 — Avatar `hero` variant is rounded-square, not circle

`mingla-business/src/components/ui/Avatar.tsx` lines 69-74:

```ts
hero: {
  width: 84,
  height: 84,
  borderRadius: radiusTokens.lg,   // ← rounded-square, NOT a circle
  fontSize: 36,
},
```

Operator chose "round circle" display for avatars. `radius.lg` is approximately 16-24px (depending on the design token), giving a rounded-square iOS app-icon look. A circle requires `borderRadius: 999` (or `width/2`).

**Blast radius of changing hero to circle:** affects 4 render sites that currently use `size="hero"`:
- `BrandProfileView.tsx:356` — brand profile hero (correct to be a circle per operator)
- `BrandEditView.tsx:420` — brand edit hero (correct)
- `BrandMemberDetailView` (per Avatar header comment line 17) — team-member detail (semantically a person; circle is correct)
- `PublicBrandPage.tsx:341` — public brand page hero (correct)

All four are profile-photo semantics. None render a non-person/non-brand entity. The flip from `radiusTokens.lg` → `999` is universally appropriate.

**Implication for SPEC:** one-line change at `Avatar.tsx:71`. Constitutional #13 (exclusion consistency) preserved — all hero avatars get the same shape.

### 🔵 OBSERVATION-3 — `expo-image-manipulator` missing from mingla-business

`mingla-business/package.json` has `expo-image-picker ~17.0.11` but NOT `expo-image-manipulator`. `app-mobile/package.json` has `expo-image-manipulator ~14.0.8` (same Expo SDK 51 generation). Adding to `mingla-business` is an additive npm install with no native build requirement (Expo SDK package, pre-built).

**Implication for SPEC:** SPEC §3 (Assumptions) names the dep; implementor adds to `mingla-business/package.json` as `"expo-image-manipulator": "~14.0.8"` matching the app-mobile version.

### 🔵 OBSERVATION-4 — `profile_photo_type` column semantics resolved

The column was added in `20260506000000_brand_kind_address_cover_hue_media.sql` alongside `cover_media_type` (which has values `"image" | "gif" | "video"`). The DEC-109 Q1=B amendment future-proofed the same union for `profilePhotoType`. As of 2026-05-12 it's never been written to.

**Implication for SPEC:** ORCH-0807 writes `profile_photo_type = "image"` on every upload (v1 supports JPEG/PNG/WEBP only — no GIF, no video). `NULL` continues to mean "no photo / use initials placeholder." Column is NOT retired. A future ORCH could add GIF/video avatar support by extending the picker; the column already accommodates it.

### 🔵 OBSERVATION-5 — Three avatar render sites; one already wires `photo`, two need wiring

- `PublicBrandPage.tsx:343`: **already** passes `photo={brand.photo}` ✓ (auto-works when DB column populates)
- `BrandEditView.tsx:420`: passes `name` only; SPEC adds `photo={draft.photo}`
- `BrandProfileView.tsx:356`: passes `name` only; SPEC adds `photo={brand.photo}`

**No further consumer changes needed.** Per the `Avatar` primitive header comment, `BrandMemberDetailView` and `BrandTeamView` use Avatar for team-member identity (not brand identity), out of ORCH-0807 scope. The `ticket-confirmation-dispatch` edge function references `profile_photo_url` for buyer emails — already reads from the same DB column; no Mingla code change needed there.

### 🔵 OBSERVATION-6 — `expo-image-picker` aspect hint is iOS-advisory only

Verified against Expo docs (current Expo SDK 51 behavior): `ImagePicker.launchImageLibraryAsync({ allowsEditing: true, aspect: [1, 1] })` enforces 1:1 crop on **Android** but is an advisory hint on **iOS** — iOS shows a free-form crop UI with a 1:1 overlay, but the user can produce a non-square crop if they ignore the overlay.

**Implication for SPEC:** belt-and-braces approach. After `launchImageLibraryAsync` returns a result, `expo-image-manipulator.manipulateAsync` performs a center-crop to square based on the picker result's reported `width` / `height` (use `Math.min(width, height)` as the side). This ensures every uploaded file is exactly square regardless of iOS user behavior. Server-side validation (edge fn) can also reject non-square uploads as a final guard.

### 🟡 HIDDEN-FLAW-2 — `Avatar` primitive lacks a `circle` shape variant

Today the shape is hardcoded inside `SIZE_TOKENS`. If a future ORCH wants a square hero somewhere (e.g., team-member detail might want square + initials only), our one-line `hero → 999` flip will need a new variant. Not blocking ORCH-0807 — operator's choice covers every existing hero site — but worth noting as a future-flexibility gap.

**Recommendation:** address only if/when a future ORCH explicitly needs a non-circle hero. For now, the universal-circle decision matches every current usage.

### 🔵 OBSERVATION-7 — Storage path RLS pattern is well-established

The `20260529000000_orch_0805_brand_covers_storage.sql` migration is the canonical mirror. Path convention `{brandId}/{token}.{ext}`, RLS reads brand UUID from name's first '/'-segment, public read for anonymous buyers, brand-admin-only write via `biz_brand_effective_rank_for_caller((split_part(name, '/', 1))::uuid) >= biz_role_rank('brand_admin')`. Column-detection fallback at lines 36-79 handles the CI Postgres test-image's older `storage.buckets` schema.

**Implication for SPEC:** new migration `<timestamp>_orch_0807_brand_avatars_storage.sql` clones this structure exactly. Bucket id `brand_avatars`, public read, `file_size_limit = 5242880` (5MB), `allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp']`.

## Five-Layer Cross-Check

| Layer | What it says today | Contradicts? |
|-------|---------------------|--------------|
| Docs (operator request 2026-05-12) | "Upload a square brand photo with native crop if not square" | — |
| Schema | `profile_photo_url`, `profile_photo_type` exist; no brand_avatars bucket; brand_covers RLS pattern available to mirror | — |
| Code (Mingla today) | UI scaffolding partial: pencil button + handlePhotoEdit stub exist; Avatar prim. supports `photo` prop; 1 of 3 render sites already wires it | — |
| Runtime | Tap "Edit brand photo" → toast "Photo upload lands in a later cycle." No actual upload path. | — |
| Data | 14 brands, 100% NULL on both columns; clean slate | — |

No layer contradictions. This is a feature-add, not a bug investigation.

## Blast radius

| Surface | Touched? | How |
|---------|----------|-----|
| `mingla-business/src/components/brand/BrandEditView.tsx` | Yes (small) | Replace transitional toast in `handlePhotoEdit` with sheet trigger; mount new sheet outside ScrollView; pass `photo={draft.photo}` to Avatar |
| `mingla-business/src/components/brand/BrandProfileView.tsx` | Yes (1 line) | Add `photo={brand.photo}` to Avatar |
| `mingla-business/src/components/brand/PublicBrandPage.tsx` | No | Already wires `photo` ✓ |
| `mingla-business/src/components/ui/Avatar.tsx` | Yes (1 line) | Flip hero `borderRadius` from `radiusTokens.lg` → `999` |
| `mingla-business/src/components/brand/BrandAvatarPickerSheet.tsx` (NEW) | Add | Single-purpose Upload sheet (no tabs) |
| `mingla-business/src/hooks/useBrandAvatarUpload.ts` (NEW) | Add | Mutation hook with status/balances/brand cache invalidation |
| `mingla-business/src/services/brandAvatarService.ts` (NEW) | Add | Storage upload + sign-URL helper |
| `mingla-business/src/utils/brandAvatarRules.ts` (NEW) | Add | MIME / size / square / path-token utilities (mirror creatorAvatarRules.ts) |
| `mingla-business/package.json` | Yes (1 line) | Add `expo-image-manipulator: ~14.0.8` |
| `supabase/functions/brand-avatar-upload-intent/index.ts` (NEW) | Add | Signed upload URL + audit log emit |
| `supabase/functions/_shared/audit.ts` (or wherever audit slugs live) | No | The slug `brand_avatar.uploaded` etc. is implementor's choice; resolver update may be needed |
| `mingla-business/src/utils/auditActionLabels.ts` | Yes (small) | Add audit slug(s) to KNOWN_STATIC_SLUGS + resolver case |
| `supabase/migrations/<timestamp>_orch_0807_brand_avatars_storage.sql` (NEW) | Add | Storage bucket + RLS |
| `.github/scripts/strict-grep/orch-0807-brand-avatar-square.mjs` (NEW) | Add | CI gate enforcing I-PROPOSED-BG |
| `.github/workflows/strict-grep-mingla-business.yml` | Yes (add job) | Register the new gate |
| `Mingla_Artifacts/INVARIANT_REGISTRY.md` | Yes (add invariant) | I-PROPOSED-BG BRAND_AVATAR_SQUARE_ONLY |

| Out of scope | Why |
|--------------|-----|
| `app-mobile/` | Operator dispatch: mingla-business only |
| `mingla-admin/` | Operator dispatch: mingla-business only |
| Brand cover surface (BrandCoverPickerSheet, etc.) | Locked — ORCH-0805 just shipped |
| Team member avatars (BrandTeamView, BrandMemberDetailView) | Separate identity (person, not brand) |
| Ticket-confirmation email avatar render | Already reads same DB column; auto-works |
| GIF / video avatar support | Future ORCH; column already accommodates |

## Invariant analysis

| Invariant | Affected | How preserved |
|-----------|----------|--------------|
| Constitution #3 (no silent failures) | YES | Upload errors surface as toast in BrandAvatarPickerSheet + mutation onError; non-square (post-manipulator) edge fn rejection returns 4xx with friendly message |
| Constitution #9 (no fabricated data) | YES | Avatar primitive's initials fallback only fires when `photo` prop is null/undefined — no fake placeholder URL |
| Constitution #13 (exclusion consistency) | YES | The `Avatar` hero shape flip applies to ALL four hero render sites identically |
| I-PROPOSED-BE BRAND_COVER_MEDIA_HONORED | NO — cover surface untouched | — |
| I-PROPOSED-BD AUDIT_LOG_HUMAN_READABLE | YES | New audit slug(s) must resolve to non-`other` category |
| I-PROPOSED-T STRIPE_COUNTRY (and other Stripe invariants) | NO | No Stripe surface |

### NEW invariant proposed at this SPEC: I-PROPOSED-BG BRAND_AVATAR_SQUARE_ONLY

The new invariant will state: every `brands.profile_photo_url` value stored MUST point at a square image stored in the `brand_avatars` Supabase Storage bucket. Client upload pipeline MUST center-crop to square via `expo-image-manipulator` before upload (belt-and-braces against iOS picker aspect-hint advisory behavior). Edge function MUST reject non-square uploads server-side as a final guard. Enforced by strict-grep gate that asserts the manipulator center-crop call exists in `useBrandAvatarUpload` / `brandAvatarService` and that the edge function reads dimensions before persisting.

## Discoveries for orchestrator

1. **Avatar primitive shape variant is a HIDDEN-FLAW-2.** Not blocking ORCH-0807 because every current `hero` usage wants circle, but the lack of a `shape` prop means any future surface wanting a non-circle hero would need a refactor. Register as `ORCH-0807-followup-1` if useful.
2. **DEC-109 / Q1=B amendment already future-proofed `profilePhotoType` for `"image" | "video" | "gif"`.** ORCH-0807 v1 writes `"image"` only. A follow-up to support GIF avatars (parallel to the cover GIF support from ORCH-0805) is a tiny scope expansion — could be queued as `ORCH-0807-followup-2` if operator wants it later.
3. **Pencil-button affordance is already in BrandEditView and styled.** Implementor should NOT rewrite that scaffolding — only replace `handlePhotoEdit`'s body and add the sheet mount. This is one of those "the spec author already drafted half the implementation for you" cases.

## Confidence

| Aspect | Confidence | Reasoning |
|--------|-----------|-----------|
| Schema is ready | **HIGH** | Live SQL probe confirms columns exist + are NULL |
| UI scaffolding is reusable | **HIGH** | Read BrandEditView lines 318-340 + 413-440 + 865-880 directly |
| Avatar primitive shape change is safe globally | **HIGH** | All 4 hero usages are profile-photo semantics; circle is universally correct |
| `expo-image-manipulator` install path | **HIGH** | Same Expo SDK 51 in both packages; app-mobile already has the dep |
| iOS aspect-hint advisory-only behavior | **MEDIUM** | Documented Expo behavior; SPEC names belt-and-braces center-crop as the mitigation |
| 5MB cap is appropriate | **MEDIUM** | Avatars render at 84×84 (168px @2x retina); 512×512 source is generous; 5MB allows uncompressed source. Could revise post-launch if metrics show bandwidth issues |
| RLS pattern from brand_covers transfers cleanly | **HIGH** | Same brand-id-as-first-path-segment shape, same brand-admin write gate |

## Fix strategy (direction only — not a spec)

Mirror ORCH-0805 (brand cover) tightly with simpler scope:

1. **Storage tier**: new `brand_avatars` Supabase bucket migration mirroring `20260529000000`, 5MB cap, JPEG/PNG/WEBP only.
2. **Edge function**: new `brand-avatar-upload-intent` mirroring `brand-cover-upload-intent` — signed upload URL + audit log + server-side square verification (read uploaded file's reported dimensions via Storage HEAD or accept client-asserted dims with a square-check guard).
3. **Service + Hook + Rules**: three new files mirroring the cover trio, single Upload source (no Pexels/GIPHY), enforced square via `expo-image-manipulator` between picker and upload.
4. **Sheet**: `BrandAvatarPickerSheet.tsx` — much simpler than the cover sheet (no tabs, just an Upload button + state machine for picking → cropping → uploading).
5. **Avatar primitive**: 1-line change to hero `borderRadius`.
6. **BrandEditView**: replace transitional toast in `handlePhotoEdit`, mount sheet, pass `photo` prop.
7. **BrandProfileView**: 1-line `photo={brand.photo}` addition.
8. **Audit + invariant + CI gate**: standard pattern from ORCH-0804/0805/0806/0802.

## Regression prevention

- Strict-grep gate enforcing manipulator center-crop in the upload pipeline.
- Server-side square check in edge fn as a final guard.
- Unit tests for the new `brandAvatarRules.ts` (MIME resolution, path token, square assertion).
- Constitutional #9 honored: Avatar primitive's initials fallback only fires when `photo` is null/undefined.

## End of investigation.
