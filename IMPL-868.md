# IMPL-868 — Cover Gallery (ordered images-only additional-photos gallery)

**Issue:** #868 `[cover-gallery]` · **Worktree:** `~/Desktop/mingla-orchs/868-[cover-gallery]/` · **Branch:** `868-cover-gallery` @ `7e0232d3f`
**Status:** implemented, self-verified; NOT deployed/merged. Rebased onto latest `origin/main` (clean scope). SPEC-868.md untracked (local only, per Operating Model V2).

## 1. Summary (plain English)
A brand can now attach a set of EXTRA photos (up to 8, images + GIFs) to an event / RSVP / trip / experience, in addition to the one primary cover. On the public page the cover becomes a swipeable pager and a row of rounded photo cards sits directly beneath it — swipe or tap to flip through cover → photos. The single primary cover (image OR video) is completely UNCHANGED and INDEPENDENT: a video cover keeps autoplaying at position 0 and coexists with a photo gallery; nothing syncs or clears one from the other. Offerings with no extra photos render exactly as today (byte-identical). Also fixed a pre-existing bug where the RSVP web page had no `og:image` share preview.

## 2. Commits
| Hash | Scope |
|------|-------|
| `9ed02fb83` | DB layer: migration `20270116000868` (additive `cover_media_gallery` column + array-shape CHECK) + `20270116000869` (read layer: 4 anon hero RPCs + 2 views re-published VERBATIM + `coverGallery`) |
| `54416fa29` | Types + write paths: `types.ts`/`index.ts` (`OfferingGalleryImage`, `PublicEventProps.coverGallery`), `CoverPatch`, `draftEventStore` (+persist v12→v13), `tripsService`, `eventCoverMediaService.setEventCoverGallery`, `serverDraftEventMapper`, migration `20270116000870` (write layer: 3 publish/live RPCs re-published VERBATIM + additive `cover_media_gallery`) |
| `d03e82efe` | Renderer + authoring + mounts + RSVP fix: `CoverGalleryRow.tsx`, `ParallaxCoverShell` pager/row wiring, `CoverPicker` Additional-photos manager, `CoverPickerSheet`, `CreatorStep4Cover`, `FoundationEventPreview`/`FoundationRsvpPreview`/`TripPreview` passthroughs, `PublicEventPage` RSVP `og:image` |
| `99cbbd953` | Buyer-web/experience read threading + tests + gate + DRAFT invariants |
| `7e0232d3f` | untrack SPEC-868.md |

## 3. Files changed (all in-scope; DO-NOT-TOUCH list verified untouched)
**DB (new migrations):** `supabase/migrations/20270116000868_issue_868_cover_gallery.sql`, `…000869_..._read_layer.sql`, `…000870_..._write_layer.sql`
**Shared package:** `packages/offering-rendering/CoverGalleryRow.tsx` (NEW), `ParallaxCoverShell.tsx`, `types.ts`, `index.ts`
**mingla-business:** `components/ui/CoverPicker.tsx`, `CoverPickerSheet.tsx`, `components/event/CreatorStep4Cover.tsx`, `PublicEventPage.tsx`, `components/event/FoundationEventPreview.tsx`, `FoundationRsvpPreview.tsx`, `components/trip/TripPreview.tsx`, `components/experience/ExperiencePreview.tsx`, `services/eventCoverMediaService.ts`, `tripsService.ts`, `publicEventsService.ts`, `publicExperienceService.ts`, `store/draftEventStore.ts`, `store/liveEventStore.ts`, `utils/serverDraftEventMapper.ts`
**Tests/gates/docs:** `packages/offering-rendering/__tests__/coverGalleryRow.test.ts` (NEW), `parallaxCoverGallery.test.ts` (NEW), `mingla-business/src/services/__tests__/coverGalleryPersist.test.ts` (NEW), `.github/scripts/strict-grep/issue-0868-cover-gallery.mjs` (NEW) + `MANIFEST.json`, `docs/INVARIANT_REGISTRY.md`

## 4. Data-model change
`public.events.cover_media_gallery jsonb NOT NULL DEFAULT '[]'` + `events_cover_media_gallery_is_array` CHECK (array-shape only). Additive, no backfill, no RLS change (inherits `events` policies). Rollback = drop column after reverting the read/write-layer amendments. **Not applied** (operator applies via Management API).

## 5. Edge functions
**NONE deployed / changed.** `event-cover-video-apply/index.ts` is UNCHANGED (a video cover coexists with the gallery; the strict-grep gate NEGATIVE-asserts it never references `cover_media_gallery`).

## 6. Gates (self-verified)
| Gate | Result |
|------|--------|
| `issue-0868-cover-gallery.mjs --self-test` | **PASS** 7/7 |
| `issue-0868-cover-gallery.mjs` (main, real files) | **PASS** |
| `coverGalleryRow.test.ts` + `parallaxCoverGallery.test.ts` (deno) | **PASS** 11/11 |
| `coverGalleryPersist.test.ts` (jest) | **PASS** 3/3 |
| Locked suites (serverDraftEventMapper, serverDraftLifecycleGuards, eventCoverMediaService, CoverPicker ×13 suites) | **PASS** 108/108 |
| Regression batch (publicEventsService, publicExperienceService, tripsService, eventDrafts, businessEventsPublish, paidPublishGuards/orch_1075, draftEventPristine) | **PASS** 100/100 (22 suites) |
| `tsc --noEmit` (mingla-business src, non-test) | 6 errors — ALL pre-existing (marketing composer ×2, IconChrome, Sheet.web, useExperienceDraftAdapter rsvp fields, platformFileSystem); **0 new from #868** |
| MANIFEST parity (`meta-1383-manifest-parity.mjs`) | not run locally (missing `yaml` dep in worktree root); counters updated per P3 (`expectedStrictGrepMjsFiles` 449→450 = disk) + P7 (`selfTestWiredFloor` 264→265) |

Note on shared-package `tsc`: the worktree's symlinked node_modules mis-resolves `react`/`react-native` for `packages/*` (hits pre-existing files like ChipGroup/CountAwareGallery identically), so a standalone package tsc reports "Cannot find module 'react'" cascades + 3 `position:"fixed"/"sticky"` intersection artifacts on the PRE-EXISTING `webStyle` lines. These resolve in CI (real install). The package's real behavioral gate is the deno suite above (passing).

## 7. Fails-on-revert PROOF
Test: `mingla-business/src/services/__tests__/coverGalleryPersist.test.ts` · verified at commit `7e0232d3f` (restored = committed state).
- **Compile revert:** true line-deletion of `cover_media_gallery: draft.coverGallery ?? []` in `draftToServerUpdate` → suite FAILS (the required `ServerDraftEventUpdate.cover_media_gallery` field makes the omission a ts-jest compile error). Restored → PASS.
- **Runtime revert:** replacing the value with `[]` (compiles) → the two additive-persistence assertions FAIL (`Received []` vs `Expected GALLERY`). Restored → PASS.
Both package suites are likewise fails-on-revert (source-structural over the exact wiring; each assertion cites the line whose deletion trips it).

## 8. Cross-surface coverage
| Surface | Gallery renders? | How |
|---|---|---|
| Buyer/anon Web (event, rsvp, trip, experience) | YES | view/RPC mapper → LiveEvent/PublicEventProps/PublicExperience → ParallaxCoverShell `galleryImages` |
| Business iOS/Android (event, rsvp, trip, experience previews) | YES | same shared shell (automatic parity) |
| Admin Web / Business Web preview (adjacent) | Web path (same shell) | — |
| Consumer iOS/Android | **NO (deferred — see §9 D-1)** | consumer screens mount `EventCoverMedia` directly, NOT `ParallaxCoverShell` |
| Marketing preview pages | **NO (deferred — see §9 D-2)** | bespoke HTML replicas, no shared renderer |

Authoring (create/edit) is wired for event + RSVP (`CreatorStep4Cover`). Trip/experience authoring steps NOT yet wired (see §9 D-3).

## 9. Deviations / stops / discoveries (for the orchestrator)
- **D-1 (MAJOR — spec-assumption divergence): Consumer mobile does not use `ParallaxCoverShell`.** `ConsumerEventDetailScreen` / `ConsumerTripDetailScreen` / `ConsumerExperienceDetailScreen` render the pinned cover via `EventCoverMedia` (an absolute sibling). `CoverGalleryRow`/the pager are injected ONLY by `ParallaxCoverShell`, so the gallery does NOT reach consumer without either extending `EventCoverMedia` (a DO-NOT-TOUCH file) or adding a screen-level row+pager to each consumer screen. I did NOT force this (would violate DO-NOT-TOUCH or needs a design decision). Consumer renders the single cover — safe, zero regression. **Needs a forensics/spec amendment** before consumer gallery ships.
- **D-2: Marketing previews (`TripPreviewClient`/`EventPreviewClient`) are bespoke HTML replicas** with no shared renderer / no `coverMediaUrl` field — the gallery cannot be threaded without extending the growth-tools render payload + bespoke JSX. Deferred; flagged.
- **D-3: Trip/experience AUTHORING steps not wired.** `CreatorStep4Cover` (event/rsvp) persists `coverGallery`. `TripCreatorStep1Basics`/`EditPublishedTripScreen`/`ExperienceCoverStep` were NOT wired to host the extended manager in this pass. Trip live-edit persistence IS wired (`updateTripBasics` + `biz_update_live_trip`); trip/experience INITIAL publish goes through `business_publish_trip_draft` (NOT in the SPEC §G scope) which does not yet carry the gallery. Deferred.
- **D-4: Authoring adds device images/GIFs only.** The "Additional photos" manager appends via the device picker (images + GIFs, never video) — this covers "images + GIFs allowed". SPEC §F.1's GIPHY/Pexels-DIRECT-to-gallery is NOT wired (the primary-cover flow still supports all providers). Minor deviation; the emit contract + move-menu (Make cover / Move earlier / Move later / Remove) + OQ-3 confirm are complete.
- **D-5: `coverGallery` made OPTIONAL on `Trip` and `DraftEvent` (not required).** Required would have broken ~4 existing append-only test mocks that construct these types. Optional + default `[]` at every read is semantically equivalent and preserves append-only. (Cover-field write interfaces keep it required.)
- **D-6: `serverDraftEventMapper.ts` edited (not explicitly in the §K allowlist).** Compile-FORCED by the in-scope `draftEventStore` type change (`serverRowToDraft` builds a full `DraftEvent`) AND required by SPEC §G draft-autosave + publish persistence (the mapper output feeds both). Strictly additive; the locked `serverDraftLifecycleGuards` + `serverDraftEventMapper` suites stay green.
- **OQ-3 implemented as specified:** "Make cover" on a gallery photo while a VIDEO cover exists shows a confirm banner ("Replace your video cover with this photo?"); on confirm the photo becomes the cover and the video is discarded. Image/GIF cover → the prior cover is demoted into the vacated gallery slot (no confirm, no data loss).
- **RISK-1 (native swipe) — as SPEC §L flagged:** the pinned-pager swipe on native is wired (spacer `pointerEvents:none` in gallery mode + `pagingEnabled` pager) but the ROW-TAP → `scrollTo` is the guaranteed control. Native swipe + the vertical-scroll-over-cover interaction MUST be runtime-validated; if degraded, the SPEC fallback is tap chevrons. Web uses independent scroll-snap axes (low risk).

## 10. Operator action required
1. **Apply migrations via the Supabase Management API (project `gqnoajqerqhnvulmnyvv`), IN ORDER — NOT `db push`, NOT auto-apply:**
   - `20270116000868_issue_868_cover_gallery.sql` (column + CHECK) — purely additive, no `RAISE`/backfill/guard, so no read-only probe needed.
   - `20270116000869_issue_868_cover_gallery_read_layer.sql` (4 anon RPCs + `business_public_events_view` + `business_management_events_view`).
   - `20270116000870_issue_868_cover_gallery_write_layer.sql` (`business_publish_event_draft`, `business_publish_rsvp_draft`, `biz_update_live_trip`).
   (If applying via CLI instead: `cd "/Users/sethogieva/Desktop/mingla-orchs/868-[cover-gallery]" && /Users/sethogieva/bin/supabase db push --linked` — re-run the monotonicity/drift check first.)
2. **Edge deploy: NONE.**
3. **Verify:** `curl` each of the 4 anon RPCs (`pg_public_event_by_slug` / `_rsvp_ / _trip_ / _experience_by_slug`) and confirm the response contains `coverGallery` AND the UNCHANGED `coverMediaUrl`/`coverMediaType`. Round-trip a gallery write (author → publish → read) and confirm the cover fields are unchanged + a video cover coexists with a non-empty gallery.
4. **Runtime-test 3 surfaces** (buyer-web + business iOS + plugged-in Android): hero sequence = [cover]++gallery; swipe flips cover→photos + updates the ring; a video cover at index 0 plays; tapping a card flips the shown item; card 0 shows ▶ only for a video cover; the body scrolls the row away over the pinned pager; the page body never scrolls sideways. Eyeball with Seth DURING test before PASS.
5. **CLOSE:** flip the 3 DRAFT invariants ACTIVE; confirm the strict-grep gate + MANIFEST registration in the 10-job batch; ship-log line in `REPORTS.md`.

## 11. Next phase
mingla-tester — adversarial coexistence test (video cover + reordered 3-photo gallery through author→publish→read-back; `coverMediaType` stays `video`, `coverGallery` order preserved, image/gif only; SSR `og:image` = cover) across buyer-web + business iOS + Android + Seth eyeball. Then orchestrator CLOSE. Resume D-1..D-4 (consumer/marketing/trip+experience authoring) via a forensics spec amendment.
