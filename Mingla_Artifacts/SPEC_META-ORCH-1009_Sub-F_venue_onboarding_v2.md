# SPEC — META-ORCH-1009 Sub-F: Unified venue onboarding + "Recommend me" engine + rich admin review

Status: DRAFT (post brutal code dive, 2026-06-01). Operator-confirmed scope.
Worktree: META-ORCH-1009-Sub-E-[business-app-supply-feeder].
Constraint: NO new dependencies. Drive autonomously; report only on genuine new product forks.

## 0. North star
A venue self-lists in ONE continuous flow, taps **Recommend me to users**, the AI compiles a full
profile (multi-image vision + full website scan + facet answers + signal pills → scores + consistency),
the user sees + can edit the AI output (≤3 resubmits), then ONE admin review (sees everything, can veto /
adjust scores / see deck impact) → approve flips it LIVE in the consumer deck, or reject with a message
that re-opens editing. No Tier-1/Tier-2/generate/confirm/refresh fragmentation; no "Am I ready?".

## 1. CRITICAL deck-integration truths (from the dive — these gate "does it actually work")
The consumer swipeable deck (`discover-cards` → RPC `query_servable_places_by_signal_intersection`) requires,
for a place_pool row to appear:
- `is_servable = true` (flipped ONLY by admin approve — see WS7) AND `is_active = true`
- `lat`/`lng` non-null
- `stored_photo_urls` non-empty (NOT `['__backfill_failed__']`) — **the deck reads `stored_photo_urls` for card images, NOT `business_gallery_urls`**
- a **`place_scores`** row per signal with `score >= filterMin` (~120) — **the deck ranks on `place_scores`, NOT `ai_signal_scores`**
- `opening_hours` for time filtering; `price_level` for the displayed price tier
Therefore the engine (WS6) MUST, beyond writing `ai_signal_scores`:
  (a) mirror hero+gallery into `stored_photo_urls`,
  (b) trigger `run-signal-scorer` per-place so `ai_signal_scores` blends into `place_scores`,
  (c) derive `price_level` from selected `price_tiers`,
  (d) ensure `opening_hours` is populated from the wizard hours.
`run-signal-scorer` per-place mode + `_shared/signalScorer.ts` already blend ai_signal_scores→place_scores (0.6 weight).

## 2. Workstreams

### WS1 — Brand-create address validation + gated progress  [mingla-business]
Files: `src/components/brand/BrandCreationFlow.tsx`, `src/services/brandsService.ts` (CreateBrandInput ~L221, createBrand ~L252), mapping already supports lat/lng/city/country_code/google_place_id (brandMapping.ts).
- Replace Step-2 free-text `<Input>` (L292–306) with `AddressAutocompleteInput` (+ `parseGooglePlaceResult`), storing formattedAddress/lat/lng/city/countryCode/googlePlaceId in flow state (extend BrandCreationState L51–71 + action L59 + reducer L112).
- Gate Step-2 Continue (L340/L360) on `address && lat!=null && lng!=null` (mirror venueWizardValidation case 0).
- Extend CreateBrandInput with lat/lng/city/countryCode/googlePlaceId; pass through createBrand→mapUiToBrandInsert.
- No schema change (brands columns exist).
Acceptance: brand-create Continue greys until a validated autocomplete address is picked; brand row persists lat/lng.

### WS2 — Brand cover preview render  [mingla-business]
File: `src/components/brand/BrandCreationFlow.tsx` Step-3 (L308–327). Reference working impl: `BrandEditView.tsx` L558–609.
- Add a preview block that renders `brand.coverMediaUrl` (Image/EventCoverMedia) when set; button label → "Change cover" when present (mirror BrandEditView). Upload/persist already work; only the preview is missing.
Acceptance: after choosing a brand cover, it renders in the cover section.

### WS3 — Bulk-set opening hours  [mingla-business]
Files: `src/components/venue/VenueStep4Hours.tsx` (L137–176 day cards; L91–130 picker), `src/store/draftVenueStore.ts` (add `setHoursRows(weekdays[], part)` mirroring setHoursRow L83), type `BrandHourEntry` (brand.ts L329).
- Add a day-multiselect + "Apply open/close to selected days" (and quick "Weekdays"/"Weekends"/"All"); reuse existing DateTimePicker; commit via setHoursRows.
- No new deps (RN Switch/Pressable + existing picker).
Acceptance: user sets one open/close time and applies to many days in 1–2 taps.

### WS4 — Cover picker: short labels + video-processing minimal UI  [mingla-business]
File: `src/components/ui/CoverPicker.tsx` (LibraryTab).
- L1009 label `"Upload image or GIF"`→`"Image"` (keep "Replace" when hasCover); L1020 `"Upload video"`→`"Video"`.
- While `activeVideoUpload` (L261–264): render ONLY the spinner/progress (L995–1002) + "Cancel upload" (L1050–1061); hide the image/video/remove action row (L1007–1041), helper text, error/retry, limit copy. Early-return branch in LibraryTab.
Acceptance: labels read "Image"/"Video"; during video processing only spinner + Cancel show.

### WS5 — "Get recommended" screen: layout + price + facets + gating + rename + remove "Am I ready?"  [mingla-business]
File: `src/components/venue/VenueCreatorWizard.tsx` (VenueDeckReadinessSetup), route `app/venue/deck-readiness.tsx`.
- **Layout (top safe-area):** the screen root must apply `paddingTop: insets.top` and sit flush like sibling screens. The durable route already wraps with insets; the INLINE post-submit render in VenueCreatorWizard uses `styles.root` (flex:1) with NO top inset → that's the bleed. Add `useSafeAreaInsets` + `paddingTop: insets.top` to the VenueDeckReadinessSetup root View.
- **Price:** replace budget/mid/premium single-select with the canonical 4 tiers MULTI-select, showing $ boundaries, persisted to `place_pool.price_tiers` (array) AND derive `price_level` (highest selected tier → Google level) for deck display. Source vocab = `app-mobile/src/constants/priceTiers.ts` (chill $50max / comfy $50–150 / bougie $150–300 / lavish $300+). Mirror a small constant in business (no cross-app import).
- **Facets questionnaire:** add yes/no questions by category. Universal core (8): good_for_groups, good_for_children, good_for_watching_sports, allows_dogs, outdoor_seating, live_music, has_restroom, reservable. Restaurant: all 23. Play: core + serves_coffee/beer/cocktails/dessert. Creative_arts: core + serves_coffee/wine/dessert. Persist answers into `business_authoring_inputs.facets` + the place_pool facet boolean columns.
- **Gate + rename:** "Create my listing with AI" → **"Recommend me to users"**, disabled until: cover present AND gallery ≥5 AND website non-empty AND ≥1 price tier selected. (Facets optional unless operator later says required.)
- **Remove "Am I ready?"** block entirely (checks fold into the gate + engine).
Acceptance: screen flush below status bar; price multi-select with boundaries; facet yes/no; button greyed until criteria met; no "Am I ready?".

### WS6 — The "Recommend me to users" engine  [edge: run-business-place-authoring-pipeline]
Collapse run_tier2_pipeline + confirm + refresh into a single `recommend_me` action (keep old actions as thin shims if referenced, else remove). Steps:
1. Load place + brand + inputs (facets, pills, price_tiers, website, gallery).
2. **Website scan:** fetch the website HTML; extract text; follow same-origin internal links whose text/href match about|menu|story|visit|contact (cap ~5 pages, ~8s budget, size cap); concatenate cleaned text. Plain `fetch` only (no dep).
3. **Vision:** send ALL gallery photos (could be >5) to Gemini as separate inline images (native multi-image — NO stitch, NO Supabase conversion cost). Cap a sane max (e.g. 12) to bound tokens; note dropped count.
4. **One Gemini call (structured output, existing GEMINI_RESPONSE_SCHEMA + extend):** inputs = website text + facet answers + selected pills + price tiers + slim place; images = gallery. Outputs: brand_description (the AI-written pitch/fields — NOT the name), per-signal scores for selected + other signals (full 16), and a **consistency** block (per-claim: claimed vs evidence vs verdict + confidence) — informational only.
5. Persist: `ai_signal_scores` (16, v4), `generative_summary` (AI description; **name preserved**), facets columns, `price_tiers` + derived `price_level`, `business_authoring_inputs` (website_scan summary, consistency, pills, answers), `stored_photo_urls` = [hero, ...gallery] (deck image source).
6. **Trigger `run-signal-scorer` per-place** for this place_pool id so place_scores is produced (deck ranking). (Service-role invoke or direct RPC; confirm per-place entrypoint.)
7. Status: set to `pending_review` (NOT live). is_servable stays false (admin gate). Increment nothing here.
- **Funny progress:** the call is the long op; the CLIENT shows a staged loader (WS8). Optionally the engine streams stage hints; simplest = client-side timed stages.
Acceptance: one action produces ai_signal_scores(16)+place_scores+bio+consistency+stored_photo_urls+price_level; status pending_review; venue NOT yet servable.

### WS7 — Results view + 3-edit cap + rich admin review + go-live + rejection  [mingla-business + mingla-admin + edge + migration]
- **Migration (new, ts>20260812000000):** add `place_pool.business_recommend_edit_count int not null default 0`; add `brands.rejection_reason` is present already (confirm); add `place_pool.ai_signal_scores_veto jsonb` for admin score adjustments; add `business_authoring_inputs.consistency`/`website_scan` are jsonb-in-jsonb (no column). Also persist a `business_recommend_status` if `business_authoring_status` enum can't hold `pending_review` (it can: needs_fix/processing/deck_eligible — add `pending_review` value or reuse `processing` as "submitted/pending"). DECISION: reuse `business_authoring_status='processing'` + brand.claim_status='pending_review' as the canonical "submitted, awaiting admin" state; `deck_eligible`+is_servable=true is post-approval.
- **Results view (business):** after Recommend, show scores-per-signal + AI fields (editable bio etc., name read-only) + consistency-free (operator doesn't see lie-check; admin does). "Edit details" re-runs the whole engine; **cap 3** (business_recommend_edit_count); at cap, disable edit with copy. Show this state until claim verified; show rejection_reason text + re-open edit on rejection.
- **Admin review (mingla-admin):** extend `adminClaimsService.CLAIM_SELECT` to join place_pool (ai_signal_scores, business_gallery_urls, stored_photo_urls, website, business_authoring_inputs, generative_summary, price_tiers, ai_signal_scores_veto). New `ClaimRichProfilePanel.jsx` in the detail modal: scores-per-signal (with reduce-only veto + reason), website link + scanned-content summary, photo grid, facet answers, pills, consistency flags, deck-impact hint (score vs ~120 threshold per signal). Approve applies vetoes + flips live; Reject requires a message.
- **RPC change (`biz_review_venue_claim`):** add `p_score_vetoes jsonb default null`; on approve: write vetoes to `place_pool.ai_signal_scores_veto`, set `place_pool.is_servable=true` (+ is_active=true) for the brand's place_pool_id, then the next scorer run (or inline) re-blends with veto applied. On reject: rejection_reason already set; ensure operator can resubmit (claim back to pending_review on a new Recommend, decrement nothing / allow edit).
- Rejection re-opens editing (operator edits → re-Recommend → claim_status back to pending_review).
Acceptance: user sees scores+editable AI fields, ≤3 edits; admin sees full profile, can veto/adjust + see deck impact, approve→live (is_servable=true + place_scores present → appears in deck), reject→message shown + edit re-opened.

### WS8 — Funny progress loader  [mingla-business]
While the Recommend call runs, show a staged loader/progress with rotating playful lines in Mingla voice:
"Fetching your website…", "Reading your vibe…", "Looking through your photos…", "Scoring your signals…", "Almost there…". Client-side timed rotation (no streaming dep). Cancel not required (it's one call).

## 3. Migrations (monotonic, >20260812000000)
- `2026081300000x_..._recommend_v2.sql`: `place_pool.business_recommend_edit_count int default 0`; `place_pool.ai_signal_scores_veto jsonb`; (verify `brands.rejection_reason` exists — yes). RPC `biz_review_venue_claim` add `p_score_vetoes` + is_servable flip on approve (CREATE OR REPLACE, monotonic file).
All additive/idempotent. Provide exact `supabase db push --linked` command in handoff.

## 4. Test plan
- Edge unit (deno): website-scan link-follow + text extract (pure fn); recommend_me output assembly; gallery→stored_photo_urls mirror; price_tiers→price_level derivation; veto application; gate reasons.
- Business jest: price multi-select state; facet questionnaire by category; Recommend gate (disabled until criteria); 3-edit cap; results render; bulk-hours setHoursRows; brand address gate; brand cover preview.
- Admin: CLAIM_SELECT join shape; review panel renders scores/photos/facets; approve sets is_servable; reject carries message.
- On-device (sim + bundle): full P2 self-list → Recommend (funny loader) → results → (admin approve via admin web) → confirm row is_servable + place_scores present (deck-eligible).

## 5. Implementation order (autonomous)
1. WS4 (picker labels/video) + WS2 (brand cover preview) + WS1 (brand address) + WS3 (bulk hours) — independent UI/bug fixes, fast wins.
2. WS5 (deck-readiness screen: layout + price + facets + gate + rename + remove Am-I-ready).
3. WS6 (engine: website scan + multi-image + scores + consistency + place_scores trigger + stored_photo_urls + price_level) + migration.
4. WS8 (funny loader).
5. WS7 (results + 3-edit cap; admin rich review + RPC veto/go-live; rejection message + re-open).
6. Tests throughout; deploy edge; provide db push; on-device verify.

## 6. Open product forks to surface only if hit
- Deck does not currently DISPLAY the AI bio (`description` hardcoded '') or AI reasoning — that's consumer-app (app-mobile) work; out of this scope unless operator wants it.
- Facets required vs optional for the gate (currently optional).
- Veto = reduce-only (admin can't inflate) — assumed.
