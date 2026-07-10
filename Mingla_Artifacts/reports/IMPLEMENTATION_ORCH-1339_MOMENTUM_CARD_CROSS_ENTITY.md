# IMPLEMENTATION — ORCH-1339 [momentum-card-cross-entity]

**META:** META-ORCH-1337 [social-proof-guest-list] · Leg 2 of 5
**Binding contract:** `Mingla_Artifacts/specs/SPEC_ORCH-1339_MOMENTUM_CARD_CROSS_ENTITY.md` (commit `780244dcc`)
**Upstream frozen API:** `packages/offering-rendering/socialProofTypes.ts` @ `208d8ca7e` (imported, never modified)
**Worktree:** `~/Desktop/mingla-orchs/META-ORCH-1337-[social-proof-guest-list]` on branch `META-ORCH-1337-social-proof-guest-list`
**Code commit:** `8d795f96c` (40 files, +2482/−32)
**Status label:** implemented, partially verified (all static/structural suites + strict-grep gates green locally; live-fire RPC, sim/device runtime, and cross-platform parity proof are the tester's per SPEC §7 T-6…T-14; NOTHING was applied to prod)
**Date:** 2026-07-10

---

## 1. Summary (plain English)

Ticketed events, trips, and experiences now show the same honest "N going" momentum card that RSVP pages already had — count, optional spots-left line, capacity meter, and an anonymous glyph cluster — on every surface (consumer iOS/Android, buyer web, business app), fed by the ORCH-1338 `pg_public_social_proof` backend. The two host privacy toggles finally DO something everywhere they should: "Private guest list" hides the cluster (the count stays), "Hide remaining count" hides the scarcity line and real meter fill (the count stays) — server-authoritative on every card, including the existing RSVP surfaces (so the live host with `privateGuestList=true` stops being silently ignored — F-4). Trips and experiences get the two toggles in their wizards for the first time (trip Step 5 + published-trip Settings; experience Pricing accordion, create AND edit), persisted through a brand-new no-clobber leaf-write RPC so the big edit RPCs are never re-emitted (COMMS-0029 class avoided). All four wizard toggle homes now carry copy that promises exactly what D2 delivers. The cluster stays glyph-only and tap-free in this leg (avatars = ORCH-1340; tap/sheet = ORCH-1341).

## 2. SPEC success-criteria coverage

| SC | What | How verified here | Status |
|---|---|---|---|
| SC-1-iOS/Android/Web | Standard event: momentum unit between pills and ticket box; hidden at 0 sold | T-4 mount+order assertions + T-1 derivation (visible=false at 0) — static; shared-body render is surface-automatic | ✓ static `8d795f96c` · runtime = tester T-14 |
| SC-2-iOS/Android/Web | Trip ("are on this trip" / "Trip full") | T-1 trip copy + T-4 trip mount — static | ✓ static `8d795f96c` · runtime = tester |
| SC-3-iOS/Android/Web | Experience ("booked" / "have booked this" / "Fully booked") | T-1 experience copy + T-4 experience mount — static | ✓ static `8d795f96c` · runtime = tester |
| SC-4-* | F-4 live host: RSVP surfaces render momentum WITHOUT cluster; count/sub/meter/decision unchanged | T-5 gate expressions + per-surface config threading (consumer rsvpConfig; PublicEventPage config literal; both read ONE config object so inline body + floating bar gate together) — static | ✓ static `8d795f96c` · live proof = tester T-9 |
| SC-5-* | hideRemainingCount: RSVP → "Open invite" + fixed fill + count; ticketed → sub-line OMITTED + fixed fill + count | T-5 (`hideRemainingCount ? null : capacity`) + T-1 hidden-capacity case (subLabel null, meter 18) | ✓ static `8d795f96c` · live proof = tester T-10 |
| SC-6 | ≥80% "filling fast", below "filling up", per-entity full string, NO stray digit | T-1 + the adversarial 0..cap×2 sweep across all 3 entities × both hide states | ✓ `8d795f96c` |
| SC-7 (biz-iOS/Android) | Trip wizard Step 5 + published-trip Settings show toggles; persist + hydrate; NO refund-gate/reason prompt for toggle-only edit | Trip jest suite: Step5 card + copy; wizard persists ×2 via leaf RPC; edit screen side-channel (`guestPrivacyChanged` never enters `patch`); toggle-only save bypasses the modal (direct-persist branch inside the empty-patch early return); seeds from `trip.guestPrivacy` | ✓ static `8d795f96c` · SQL/e2e = tester T-8 |
| SC-8 (biz-iOS/Android) | Experience Pricing accordion (create AND edit); persistence + hydration | Experience jest suite: accordion rows + copy; wizard persists on publish/save AND live-save; edit-mode hydration via one owner-scoped `events.theme` read (see §10 deviation D-3) | ✓ static `8d795f96c` · e2e = tester T-8 |
| SC-9 | RPC guards: `not_authorized` / `authentication_required`; partial call leaves the sibling flag | Migration static suite §C (guard order), §D (COALESCE param → existing leaf → false) — static; live SQL proof = tester T-6/T-7 | ✓ static `8d795f96c` |
| SC-10 | §4.8 wizard sub-copy byte-exact on all four toggle homes | Byte-exact `toContain` assertions in both business jest suites (trip Step5 + trip accordion + CreatorStep6Settings + RsvpStep5Setup + experience accordion) + legacy over-promising strings asserted GONE | ✓ `8d795f96c` |
| SC-11 | Business RSVP draft preview reflects the draft's own toggles | `app/rsvp/[id]/preview.tsx` config literal extended with `draft.privateGuestList` / `draft.hideRemainingCount` (goingCount stays 0) | ✓ static `8d795f96c` · sim = tester |
| SC-12 | ALL existing gates green, ZERO existing test files edited | 86/86 across orch_1157×2, 1163, 1174 §1-order, 1183, 1303 + the two new 1339 suites; 19 strict-grep gates PASS (incl. orch-1292 taxonomy, i-proposed-1120 gated-RPC, meta-orch-0827 isolation, meta-orch-0991 gorhom, orch-1167 family, orch-1303, orch-1004); `git diff --name-only` shows zero existing test files touched | ✓ `8d795f96c` (pre-existing anchor-red exceptions in §12) |
| SC-13 | Fetch failure → page renders exactly as today | Every query site: error → `data` undefined → `socialProof={... ?? null}` → body renders null-gated mount (nothing); services throw so React Query owns retry; T-4 null-gate assertion pins the `{socialProof ? ( … ) : null}` shape | ✓ static `8d795f96c` · runtime = tester T-11 |

## 3. Files changed (40; +2482/−32)

**Backend (2):** `supabase/migrations/20261226000000_orch_1339_set_event_guest_privacy.sql` (+135, NEW) · `supabase/migrations/__tests__/orch_1339_set_event_guest_privacy.test.ts` (+147, NEW)

**Package (10):** `socialProofMomentum.ts` (+165 NEW) · `OfferingMomentum.tsx` (+219 NEW) · `index.ts` (+9) · `RsvpMomentumDecision.tsx` (+26/−) · `RsvpOfferingBody.tsx` (+10) · `EventOfferingBody.tsx` (+22) · `TripOfferingBody.tsx` (+22) · `ExperienceOfferingBody.tsx` (+23) · `__tests__/orch_1339_momentum_cross_entity.test.ts` (+272 NEW) · `__tests__/orch_1339_momentum_adversarial.test.ts` (+214 NEW)

**Consumer (5):** `services/socialProofService.ts` (+31 NEW) · `hooks/queryKeys.ts` (+8) · `ConsumerEventDetailScreen.tsx` (+23/−) · `ConsumerTripDetailScreen.tsx` (+17/−) · `ConsumerExperienceDetailScreen.tsx` (+17/−)

**Business (23):** `services/socialProofService.ts` (+41 NEW) · `businessEvents.ts` (+36) · `tripsService.ts` (+34) · `experiencesService.ts` (+34) · `tripToLiveEvent.ts` (+8/−) · `useExperienceDraftAdapter.ts` (+31/−) · `PublicEventPage.tsx` (+34) · `FoundationEventPreview.tsx` (+9) · `TripPreview.tsx` (+14) · `ExperiencePreview.tsx` (+14) · `app/t/[brandSlug]/[tripSlug].tsx` (+22) · `app/exp/[brandSlug]/[experienceSlug].tsx` (+27) · `app/rsvp/[id]/preview.tsx` (+5) · `TripCreatorStep5Policy.tsx` (+143/−) · `TripCreatorWizard.tsx` (+37/−) · `EditPublishedTripScreen.tsx` (+100/−) · `EditPublishedTripSettingsAccordion.tsx` (+72/−) · `ExperiencePricingStep.tsx` (+53/−) · `ExperienceCreatorWizard.tsx` (+89/−) · `CreatorStep6Settings.tsx` (+8/−) · `RsvpStep5Setup.tsx` (+12/−) · `trip/__tests__/orch_1339_trip_guest_privacy.test.ts` (+203 NEW) · `experience/__tests__/orch_1339_experience_guest_privacy.test.ts` (+128 NEW)

Every path is inside the SPEC allowlist except `app-mobile/src/hooks/queryKeys.ts` — orchestrator-sanctioned (deviation D-1, §10).

## 4. Data-model changes

- **NEW RPC `public.biz_set_event_guest_privacy(p_event_id uuid, p_private_guest_list boolean DEFAULT NULL, p_hide_remaining_count boolean DEFAULT NULL) RETURNS jsonb`** — `plpgsql VOLATILE SECURITY DEFINER SET search_path = public`. Guard-first: `authentication_required` → `event_not_found` (`SELECT * FROM events WHERE id = p_event_id AND deleted_at IS NULL`, spec-verbatim, entity-agnostic) → `not_authorized` (`biz_brand_effective_rank(brand_id, uid) < biz_role_rank('event_manager')`, the 1334/1150 predicate). Write = ORCH-1172/1296 no-clobber pattern byte-followed (20261222000000:225-250): COALESCE param → existing leaf → false; `jsonb_set` create_missing on EXACTLY `{business_event}` container, `{business_event,settings}` container, and the two leaves; `UPDATE events SET theme, updated_at` only. Returns the final persisted `{privateGuestList, hideRemainingCount}` echo. `REVOKE ALL FROM PUBLIC; GRANT EXECUTE TO authenticated` only (no anon — it's a write).
- **No table DDL, no RLS change, no realtime change** (statically pinned by the migration suite §H).
- Migration version `20261226000000` — frontier re-scanned at IMPLEMENT: local+sibling-worktree max = remote prod head = `20261225000000` (ORCH-1338; confirmed via read-only `SELECT version FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 6` against `gqnoajqerqhnvulmnyvv`); no remote-only version. Satisfies the orchestrator floor (> `20261225000000`).
- **Read-only remote probe:** not required — the migration is a pure function CREATE with no backfill/data-shape guard that could abort against existing rows.

## 5. Edge functions touched

None. (Client reads go to the already-live `pg_public_social_proof` RPC; the write goes to the new SQL RPC. No `supabase/functions/` change; no `verify_jwt` values to preserve.)

## 6. Regression tests added (all NEW files; zero existing tests edited)

| Path | Tests |
|---|---|
| `packages/offering-rendering/__tests__/orch_1339_momentum_cross_entity.test.ts` | 16 (T-1 table incl. cluster-constant parity pin, T-4 mounts+order+null-gate, T-5 gates, barrel) |
| `packages/offering-rendering/__tests__/orch_1339_momentum_adversarial.test.ts` | 12 (T-2 source contract, T-3 single-owner separation, no-digit 0..50×2 sweep ×3 entities ×2 hide states, meter clamps, digit-free full strings) |
| `supabase/migrations/__tests__/orch_1339_set_event_guest_privacy.test.ts` | 11 (§A protocol, §B signature, §C guard order, §D leaf-write-only jsonb_set path set-equality, §E UPDATE column set, §F echo, §G grants, §H no-DDL, §I monotonic) |
| `mingla-business/src/components/trip/__tests__/orch_1339_trip_guest_privacy.test.ts` | 13 (Step5 card+copy, wizard persistence ×2, accordion props+copy, side-channel/SC-7 bypass, hydration, service wrapper, CreatorStep6Settings + RsvpStep5Setup §4.8 copy) |
| `mingla-business/src/components/experience/__tests__/orch_1339_experience_guest_privacy.test.ts` | 9 (accordion props/rows/copy, wizard state+hydration+persistence ×2, adapter threading, mapper) |

**Total: 61 new tests, all passing.** Final battery output (verbatim tails):

```
packages (6 existing gate suites + 2 new):  ok | 86 passed | 0 failed (364ms)
migrations (1339 new + 1338 pair):          ok | 33 passed | 0 failed (126ms)
business jest (2 new suites):               Tests: 22 passed, 22 total
```

**fails-on-revert verified at 8d795f96c** — one TRUE LINE-DELETION revert-run per SPEC §9 family, each FAIL→restore→PASS:

1. **Mount family** — deleted the `EventOfferingBody` `<OfferingMomentum …/>` block → `T-4: EventOfferingBody mounts … FAILED` → restored → `ok | 16 passed`.
2. **Gate family** — deleted both D2 expressions in `RsvpMomentumDecision` (`hideRemainingCount ? null : capacity` → `capacity`; `&& !privateGuestList` removed) → `T-5 … null DISPLAY capacity FAILED` + `T-5 … suppresses the cluster FAILED` → restored → `ok | 16 passed`.
3. **Copy-table family** — deleted the `trip` row from `ENTITY_COPY` → `T-1: trip copy FAILED` → restored → `ok | 28 passed`.
4. **RPC host-guard family** — deleted GUARD 3 from the migration → `§C guard-FIRST ordering FAILED` + `§C2 host gate FAILED` → restored → `ok | 11 passed`.

## 7. Old → New receipts

### supabase/migrations/20261226000000_orch_1339_set_event_guest_privacy.sql (NEW)
**Before:** no leaf-write path existed for the two gates on trips/experiences — persisting them would have required re-emitting `biz_update_live_trip`/`biz_update_live_experience` (COMMS-0029 clobber class). **Now:** one host-gated, guard-first, no-clobber leaf-write RPC, entity-agnostic across all four event_types; NULL params preserve; echo returned. **Why:** SPEC §4.2. ~135 lines.

### packages/offering-rendering/socialProofMomentum.ts (NEW)
**Before:** only `rsvpMomentum.ts` existed (RSVP-only derivation). **Now:** dep-free cross-entity derivation with the §4.3 copy table (event/trip/experience), `visible:false` at 0 count, D2 display-capacity nulling, omitted sub-line for null/hidden capacity, cluster sizing in byte-parity with `RSVP_CLUSTER_SHOWN` (local constant, parity pinned by test), lookup-miss (rsvp) → invisible — COMMS-0057 single-owner preserved. **Why:** §4.3. ~165 lines.

### packages/offering-rendering/OfferingMomentum.tsx (NEW)
**Before:** no cross-entity momentum unit. **Now:** pure props-only card (count+label, optional sub, STATIC meter — no Animated at all, glyph cluster with +N overflow, cluster suppressed under `privateGuestList`), styles byte-following `RsvpMomentumDecision`'s momentum block, opaqueCardFill (Android `palette.page`, else `opaqueSurfaceColor`), palette-only colors, a11y labels, testIDs `orch-1339-momentum{,-sub,-meter,-cluster}`, no Pressable/Image/uri/checkout tokens. **Why:** §4.4-A. ~219 lines.

### packages/offering-rendering/RsvpMomentumDecision.tsx
**Before:** derived momentum from raw `capacity` and always rendered the cluster when `hasGoing`; the stored host gates were ignored (F-4/F-11). **Now:** two optional display-gate props (default false); derive call = `deriveMomentum(goingCount, hideRemainingCount ? null : capacity)`; cluster condition = `momentum.hasGoing && !privateGuestList`; two header sentences added (glyph-only paragraph untouched); ctaState/decision math untouched. **Why:** §4.4-B / D2. ~26 lines.

### packages/offering-rendering/RsvpOfferingBody.tsx
**Before:** `RsvpOfferingConfig` had no privacy fields. **Now:** `privateGuestList?`/`hideRemainingCount?` on the config; `DecisionUnit` forwards both with `?? false` — the inline box and the floating bar read the SAME config so they gate together. **Why:** §4.4-C. ~10 lines.

### EventOfferingBody / TripOfferingBody / ExperienceOfferingBody
**Before:** no social proof anywhere on the three non-RSVP bodies. **Now:** optional `socialProof` prop (default null) + one null-gated `<OfferingMomentum/>` mount per body at the spec's exact anchors (event: pills→ticket-box; trip: meta-pills→Presented-By; experience: after stateBanner, before Presented-By — banner stays above); no existing anchor moved (ascending-indexOf gates stay green: 86/86). **Why:** §4.4-D / Q11. ~22 lines each.

### app-mobile: socialProofService (NEW) + queryKeys + 3 detail screens
**Before:** no social-proof read; no factory key; screens had no payload. **Now:** `fetchSocialProof` (null→null, error→throw); `socialProofKeys` factory entry (deviation D-1); each screen adds ONE `useQuery` (`socialProofKeys.summary(id)`, `staleTime 60_000`, `enabled` id-gated) and passes `socialProof={query.data ?? null}` into its body; the event screen's RSVP branch extends `rsvpConfig` with the two gates from the payload (`?? false`), reaching body + floating bar via the one config object. **Why:** §4.5-A / §4.6. ~96 lines.

### mingla-business: socialProofService (NEW) + businessEvents + PublicEventPage + previews + routes
**Before:** no read/write service; public pages had no payload; previews had no passthrough. **Now:** business `fetchSocialProof` + a co-located `socialProofKeys` factory (D-1 second half — business has no central factory; the entity's keys live with its service, single owner); `setEventGuestPrivacy` wrapper (leaf RPC, NULL-preserving partial patch, persisted-echo return, throws); PublicEventPage queries once per page — ticketed branch threads payload → FoundationEventPreview → body; RSVP branch extends the config literal binding the LiveEvent-parsed flags (non-optional booleans, populated on both authed + anon paths — OQ-3 resolved, payload kept as documented fallback); TripPreview/ExperiencePreview add FOUNDATION-mode passthrough (legacy wizard previews untouched → `socialProof` absent → hidden, honest zero-state); `/t` + `/exp` routes fetch keyed on the resolved event id and thread down; `/rsvp/[id]/preview` reflects the draft's own toggles. **Why:** §4.5-B/C, §4.6. ~166 lines.

### tripsService / experiencesService / tripToLiveEvent / useExperienceDraftAdapter
**Before:** trip/experience models never surfaced the gates; `tripToLiveEvent` and the experience When-adapter hard-coded both to `false`. **Now:** `Trip.guestPrivacy?` + `VenueExperience.guestPrivacy?` (optional like `pricingSwitches` — required would break out-of-allowlist constructors incl. an append-only test fixture) parsed via `readGuestPrivacy`/`readExperienceGuestPrivacy` (`theme.business_event.settings.*`, false defaults); `tripToLiveEvent` maps `trip.guestPrivacy?.* ?? false`; the adapter takes a third `guestPrivacy` param threaded into the synthetic draft (create-mode defaults false). **Why:** §4.5-D. ~107 lines.

### Trip wizard (Step5Policy + TripCreatorWizard)
**Before:** Step 5 = refund policy + deadline only; no privacy anywhere in the trip wizard. **Now:** `Step5Draft` + the two booleans; a third "Guest privacy" GlassCard with a local ToggleRow mirroring CreatorStep6Settings' pattern (label+sub+44×26 track), §4.8 copy byte-exact, testIDs `trip-step5-{private-guestlist,hide-count}`; wizard seeds from `trip.guestPrivacy`, counts toggles in the pristine check, persists via `setEventGuestPrivacy` on Step-5 autosave AND publish success — both NON-BLOCKING (toast `Couldn't save guest privacy — check Settings after publishing.`, flow continues; display prefs never block publish). **Why:** §4.7. ~180 lines.

### Trip edit (SettingsAccordion + EditPublishedTripScreen)
**Before:** accordion = refund/deadline/closed; every Settings save rode `biz_update_live_trip` behind the reason prompt. **Now:** accordion adds two controlled Switch rows (its existing Switch pattern, §4.8 copy); screen state + seeds; `buildLiveTripPatch` diffs the toggles into a `guestPrivacyChanged` SIDE-CHANNEL (dirty keys only — mirrors `pricingSwitchesChanged`; the two keys NEVER enter `patch`, so `biz_update_live_trip`, its refund gate, and the reason prompt never see them); `handleSavePress` gains a toggle-ONLY direct-persist branch (no modal, no reason — SC-7) with its own submitting/toast/nav; `handleConfirmSave` persists changed toggles AFTER the gated patch succeeds and in the switches-only empty-patch branch (failure → non-rollback toast `Saved, but guest privacy didn't update. Try again from Settings.`); new handlers added to the memoized `renderSectionBody` deps (the ORCH-1122 stale-closure class in THIS file — pre-empted). **Why:** §4.7. ~172 lines.

### Experience wizard (PricingStep + CreatorWizard)
**Before:** Pricing step ended at WhoCoversCosts; no privacy toggles for experiences; adapter hard-coded false. **Now:** Pricing step appends a "GUEST PRIVACY" section using the file's OWN ToggleRow (extended with an optional `sub` line + testID), §4.8 copy byte-exact, controlled props (wizard owns state — the file's pattern); wizard owns `guestPrivacy` state, hydrates in edit mode via ONE owner-scoped `events.theme` read (see D-3), threads the state into the When-adapter, and persists via `setEventGuestPrivacy` after `biz_publish_experience` success (create/draft-save) AND after `biz_update_live_experience` success (live edit) — both non-blocking; the two keys never ride the big-RPC payloads (test-pinned). **Why:** §4.7 / D5. ~142 lines.

### CreatorStep6Settings + RsvpStep5Setup (copy only)
**Before:** `Hide attendee count from buyers.` / `Don't show 'X tickets left'.` / `Only you see who's coming.` / label `Hide the Going count from guests` + `Guests won't see how many are coming.` — all over- or mis-promising vs D2. **Now:** the §4.8 byte-exact strings; the RSVP label corrected to `Hide the spots-left count`. **Why:** §4.8 / D10. ~20 lines.

## 8. Cross-surface impact

| Surface | Affected | Parity |
|---|---|---|
| Consumer iOS | YES — momentum on standard-event/trip/experience detail; RSVP D2 gates live | body render automatic (shared package); config plumbing manual per screen (done ×3) |
| Consumer Android | YES — same code; opaque fill via `palette.page` branch | automatic with iOS; runtime proof manual (tester) |
| Buyer/anon Web | YES — momentum on `/e`, `/t`, `/exp`; RSVP `/e` gates live; anon-safe RPC, queries ungated (ORCH-1004 honored) | body automatic; route/config plumbing manual (done ×3 routes + PublicEventPage) |
| Business iOS | YES — public pages same code as web + wizard toggles (trip Step5/edit accordion, experience Pricing accordion, copy fixes) | public pages automatic with web; wizards manual (done) |
| Business Android | YES — same as Business iOS | same code; runtime proof manual (tester) |
| Admin Web | NOT affected — zero offering-rendering mounts (F-2) | — |
| Business Web preview | YES — `/rsvp/[id]/preview` honors the draft's own toggles; trip/experience wizard previews stay LEGACY mode → no unit (honest zero-state) | manual (done) |

**Parity note for tester:** the body render is single-source (shared package) but the fetch/config plumbing is per-surface — T-14's per-platform SC checkboxes are the proof this leg can't provide statically.

## 9. Smoke result

No simulator/device run in this session (background implement leg; per the delivery constraints the business app is NATIVE-BUILD-ONLY and consumer OTA is orchestrator-owned). Static verification only:

- 86/86 package deno (six existing gate suites + 2 new), 33/33 migration deno (new + both 1338 suites), 22/22 new business jest, 83/84+11/12 pre-existing adjacent business jest (both failures pre-exist on the anchor byte-identically — §12), 19/19 strict-grep gates.
- `npx tsc --noEmit`: **zero new errors in either app.** app-mobile: worktree 884 vs anchor 876 errors — non-package error sets IDENTICAL (147=147); the delta is my two new package files erroring with the exact environmental class every `../packages/*` file shows in this workspace (react types unresolvable through the symlinked node_modules — pre-existing; the anchor shows the identical wall). mingla-business: worktree 763 vs anchor 750 — my-file scan shows only the pre-existing `useExperienceDraftAdapter` TS2740 (line-shifted; present on anchor at :71) plus IconChrome/Sheet.web branch-vs-main drift in files I never touched. Strict-probe: both NEW package files compile CLEAN under `--strict` with real react/react-native types (exit 0). The package's own `tsconfig.json` cannot run standalone from the package dir in this workspace (`expo/tsconfig.base` unresolvable — environmental, same on anchor).
- Biz-web export smoke (SPEC §8-8) NOT run — an `expo export` from the symlinked worktree risks the COMMS-0027 shared-Metro-cache poisoning and the change adds no `<Image>`/new dep to the web bundle (T-2 pins no `<Image>`); flagged for the tester/orchestrator to run with `--clear` per house rule.

## 10. Sanctioned deviations + resolutions (cite-as-approved)

- **D-1 (orchestrator-sanctioned, Constitution #4):** the spec's literal `useQuery(["socialProof", eventId])` shorthand replaced by factory keys everywhere. app-mobile: `socialProofKeys` added to `app-mobile/src/hooks/queryKeys.ts` (file outside the spec allowlist — explicitly sanctioned in the dispatch) following the file's exact idiom. mingla-business (no central factory exists): `socialProofKeys` exported from the new allowlisted `src/services/socialProofService.ts` and consumed by all three business query sites — zero hardcoded key strings anywhere. No `guestListKeys` created (ORCH-1341's).
- **D-2 (orchestrator-sanctioned):** migration version `20261226000000` — frontier re-scanned live (see §4); strictly > `20261225000000`. NOT applied to prod.
- **D-3 (spec-gap resolution, inside allowlist — flagged for orchestrator review):** SPEC §4.5-D routes experience edit-mode hydration through the `experiencesService` mapper + the When-adapter, but the edit route (`app/experience/[id]/edit.tsx`) builds its `initialDraft` from `experienceDetailService` — BOTH outside the allowlist, so the spec's letter cannot deliver SC-8 hydration. Resolution: the allowlisted `ExperienceCreatorWizard` self-hydrates with ONE owner-scoped `supabase.from("events").select("theme").eq(id).maybeSingle()` read in edit mode (same object path the RPCs read; RLS-covered; create mode keeps false defaults). The §4.5-D mapper additions (VenueExperience.guestPrivacy) and adapter threading were still implemented exactly as specified. No out-of-allowlist file touched.
- **D-4 (minor):** `Trip.guestPrivacy` / `VenueExperience.guestPrivacy` are OPTIONAL (spec didn't specify optionality) because required fields would break out-of-allowlist constructors (`usePublicTripBySlug`, `publicEventsService` — DO-NOT-TOUCH) and an existing append-only test fixture (`globalSearch.test.ts` builds a `VenueExperience`). All consumers read `?? false`.
- **D-5 (minor copy):** the experience wizard reuses the trip wizard's non-blocking failure toast string (`Couldn't save guest privacy — check Settings after publishing.`) — §4.7 specified it only for the trip wizard; reused verbatim rather than inventing new copy. Note: on experience flows the toast fires just before `onComplete` navigation and may not be seen — acceptable for a non-blocking display-pref failure; flagged for Seth's copy veto alongside §10-1 of the spec.
- **D-6 (test-shape):** SPEC §9 asks the business suites to assert persistence "mock-level"; the default business jest config has no RTL (render harnesses are per-ORCH dedicated configs per `jest.config.cjs`). The suites are SOURCE-STRUCTURAL (the repo's established pattern for these files); the runtime half is the tester's T-8.
- **Dispatch note honored:** worktree NOT rebased (built on the branch as-is, per dispatch override of Pre-Flight Step 1).

## 11. Operator action required (orchestrator, at SHIP — nothing for Seth now)

1. **Apply the migration to prod via the Management API** (per SPEC §4.2 — do NOT `db push` from a worktree): execute `supabase/migrations/20261226000000_orch_1339_set_event_guest_privacy.sql` against `gqnoajqerqhnvulmnyvv`, then one-curl verify, e.g. anon call must fail closed:
   `curl -s -X POST "https://gqnoajqerqhnvulmnyvv.supabase.co/rest/v1/rpc/biz_set_event_guest_privacy" -H "apikey: <anon>" -H "Content-Type: application/json" -d '{"p_event_id":"00000000-0000-0000-0000-000000000000"}'` → expect the `authentication_required` error shape.
   (If the CLI path is ever preferred instead: `cd "/Users/sethogieva/Desktop/mingla-orchs/META-ORCH-1337-[social-proof-guest-list]" && /Users/sethogieva/bin/supabase db push --linked` — the worktree is currently NOT linked.)
2. **Register the applied version** in `supabase_migrations.schema_migrations` if the Management-API path doesn't (1338's apply did register — mirror it).
3. Edge functions: none to deploy.
4. Delivery at SHIP (unchanged constraints): consumer = per-platform OTA; business = NATIVE BUILD ONLY (COMMS-0052/0063); buyer-web = `[deploy]` tag. Run the biz-web export smoke with `--clear` before the web deploy (see §9).

## 12. Discoveries for Orchestrator (side issues — NOT fixed here, all reproduced byte-identically on the anchor)

1. **Latent local red in `orch_1157_round8/round9` + `orch_1163_r3` (§6b):** 9 tests fail on BOTH anchor main and this branch when run locally (BaseBottomSheet filler assertions + the consumer RSVP paddingBottom check). CI likely never re-runs them (changed-files-only collection). Possibly the docs-only-CLOSE latent-red class.
2. **`EditPublishedTripScreen.save.test.ts` "six sections in the locked order" fails on main:** the screen now renders 7 sections (ORCH-0880 added `intake`) but the ORCH-0876 test still expects 6. Anchor-red.
3. **`PublicEventPage.orch_0964_design_rework.test.ts` cannot RUN on main:** it reads `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx`, deleted by ORCH-1138 (whose own gate asserts the deletion). Anchor-red.
4. **`orch_1138_reserve_straight_to_cart.test.ts` cannot RUN on main:** reads `ConsumerTripReserveBar.tsx`, which no longer exists (retired by META-ORCH-1174) — anchor and worktree identical.
5. **Workspace toolchain:** `npx tsc --noEmit` in both apps drowns in ~750-880 pre-existing errors because react types don't resolve through the symlinked `../packages/*` (anchor identical); the packages' own tsconfig can't resolve `expo/tsconfig.base` standalone. Worth a small toolchain ORCH if local tsc signal matters.
6. **`app.config.ts` (mingla-business) has duplicate object keys** (TS1117 ×2) on main — silent config-override footgun.

## 13. Constitutional + invariant quick-scan

All 14 Constitution rules checked — no violations (no dead taps: the new unit has NO tap by design this leg; one owner per truth: derivations split by COMMS-0057; no silent failures: every catch toasts; factory keys; server state in React Query only; no fabricated data: invisible at 0/null; currency untouched; single auth instance untouched). Invariants (SPEC §6) preserved: I-PROPOSED-1157-NO-CHECKOUT-AFFORDANCE ✓ (T-2), -DECISION-IS-HERO ✓ (mount above §5, no second decision), -SOCIAL-PROOF-ANON-ONLY ✓ (glyphs only, `sample` unread — T-2), -USES-BRAND-THEME-DIAL ✓ (no hex — T-2), ANDROID_GLASS_USES_OPAQUE_FALLBACK ✓ (T-2), ORCH-1303 ✓ (no Animated at all + conditional assert), ORCH-1292 ✓ (gate PASS), I-MOR-0827 ✓ (props-only; isolation gate PASS), COMMS-0057 ✓ (T-3), ORCH-1172 no-clobber ✓ (§D set-equality; sibling keys — incl. `hideAddressUntilTicket` — untouched by construction), section-order gates ✓ (86/86). Proposed DRAFT invariants I-PROPOSED-1339-GUEST-PRIVACY-GATES-LIVE + I-PROPOSED-1339-HONEST-ENTITY-MOMENTUM are now implementable-true; orchestrator flips at CLOSE.

## 14. Test-first priorities for the tester

1. T-9 (F-4 live host: cluster absent, count/decision intact, all RSVP surfaces) and T-6/T-7 live-fire RPC (no-clobber before/after theme diff incl. `hideAddressUntilTicket` survival; the three error tokens; partial-call sibling preservation).
2. T-8 wizard e2e on sim (trip Step5 → publish → re-edit hydration; toggle-only trip edit → NO reason prompt; experience create+edit).
3. T-14 cross-platform SC-1..5 (esp. Android opaque fill + web anon path) and T-11 fetch-failure degradation.
