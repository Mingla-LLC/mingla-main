# IMPLEMENT ORCH-1150 — RSVP Event (Partiful-style) — Steps 9–12 + SQL tests

**Phase:** IMPLEMENT (continuation — steps 1–9a were already committed; orchestrator rebased onto origin/main with ORCH-1138 absorbed).
**Worktree:** `~/Desktop/mingla-orchs/orch-1150-[rsvp-event-wizard]/` · branch `orch-1150-rsvp-event-wizard`.
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-1150_RSVP_EVENT_WIZARD.md`.
**Status:** READY FOR TEST. Steps 9, 10, 11, 12 + the 4 SQL tests all built + committed. Gates green.

---

## 1. Summary

Finished the public-facing + Hub + edit + consumer-deck + SQL-test legs of the RSVP event. A guest can now reply Going/Not-going on the public `/e/` page (with a real waitlist / pending / full / contact-capture flow), a host opting an RSVP onto the discover feed gets a Going/Not-going deck card in the consumer app, the Hub list-card shows "N going" instead of revenue, and editing a published RSVP drops the Tickets section + notifies going guests. The ticketed checkout path is byte-identical throughout.

---

## 2. SPEC success-criteria coverage

| SC | What | Status | Commit |
|----|------|--------|--------|
| Step 0 | tsc clean for ORCH-1150 code; committed jest/Deno green | ✓ | `eef6d25ea` |
| Step 9 (web) | Going/Not-going via `resolveRsvpCta`; +1; inline name+email+phone REQUIRED for anon (Going disabled until valid); logged-in skip; submit → `public-submit-rsvp`; all states; non-RSVP checkout byte-identical | ✓ | `eef6d25ea` |
| Step 10 (deck) | discover supply confirm (eventType through `pg_discover_business_events`→card); RSVP card variant + Going/Not-going (discoverable only) | ✓ | `711fcb776` |
| Step 11 (Hub) | list-card `event_type='rsvp'` → "N going"; manual-mode pending badge (badge shipped Step 8) | ✓ | `d8f6ad649` |
| Step 12 (edit) | RSVP-aware edit; drop Tickets + refund gate; "N going — they'll be notified" notice; published date/venue edit enqueues §5.2 `rsvp_event_updated` via `biz_update_live_rsvp` | ✓ | `f57e1e1b2` |
| SQL tests | T1/T2/T4(+host-remove)/T6 | ✓ (await orchestrator DB run) | `6cad4f8e2` |

---

## 3. Files changed (this dispatch)

**Step 0 + Step 9** (`eef6d25ea`)
- `mingla-business/src/store/liveEventStore.ts` — LiveEvent `event_type` +`'rsvp'`; added `rsvp*` host-control + `rsvpGoingCount` (optional, back-compat).
- `mingla-business/src/utils/liveEventAdapter.ts` — `liveEventToEditableDraft` populates the 7 RSVP fields (the Step-3 DraftEvent widen had broken this literal — tsc-invisible, ts-jest-visible).
- `mingla-business/app/rsvp/[id]/guests.tsx` — `liveEvent.title`→`.name` (Step-8 tsc error).
- `mingla-business/src/services/rsvpEvents.ts` — `submitPublicRsvp` (edge-fn caller); fixed the committed-RED test (two comments contained the banned `business_publish_event_draft` substring).
- `mingla-business/src/services/rsvpErrorCodes.ts` (NEW, pure) + `__tests__/rsvpErrorCodes.orch1150.test.ts` (NEW).
- `mingla-business/src/services/publicEventsService.ts` — view row type +RSVP cols + `rsvp_going_count`; `getPublicEventBySlug`/`ById` admit `'rsvp'`; `publicEventViewRowToEvent` maps event_type + RSVP fields + going count.
- `mingla-business/src/components/event/RsvpPublicBody.tsx` (NEW) — the Going/Not-going page body (reuses ORCH-1138 ParallaxCoverShell).
- `mingla-business/src/components/event/PublicEventPage.tsx` — `event_type==='rsvp'` early-return branch (ticketed path untouched).
- `supabase/migrations/20261004000000_orch_1150_rsvp_events.sql` — appended a `business_public_events_view` recreate exposing the 6 RSVP columns + a `rsvp_going_count` subselect.

**Step 10** (`711fcb776`)
- `supabase/functions/discover-merged-events/_types.ts` + `_business-query.ts` — `eventType` on `BusinessEventCard` (maps `e.event_type`).
- `app-mobile/src/types/mergedDiscover.ts` — mirror `eventType`.
- `app-mobile/src/services/rsvpDeckService.ts` (NEW) + `__tests__/rsvpDeckService.orch1150.test.ts` (NEW, Deno source-contract).
- `app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx` — RSVP Going/Not-going dock + `handleRsvp`; ticketed cart path untouched (TicketCartSheet stays mounted).

**Step 11** (`d8f6ad649`)
- `mingla-business/src/components/event/EventListCard.tsx` — RSVP renders (was bailed with trips); "N going" / "N / cap going"; right-rail + a11y RSVP-aware.
- `mingla-business/src/services/businessEvents.ts` — event_type probe pulls RSVP cols + a `event_rsvps` going-count aggregate; `eventFromRow` gains `rsvpMeta`.
- `mingla-business/src/utils/rsvpHubMetrics.ts` (NEW, pure) + `__tests__/rsvpHubMetrics.orch1150.test.ts` (NEW).

**Step 12** (`f57e1e1b2`)
- `mingla-business/src/components/event/EditPublishedScreen.tsx` — `rsvpMode` filters out Tickets section; `handleConfirmSave` RSVP branch → `biz_update_live_rsvp` then local mutation (no refund machinery); "N going" notice (opaque Android fill) via `rsvpEditNoticeCopy`.
- `mingla-business/src/utils/rsvpHubMetrics.ts` — `rsvpEditNoticeCopy`.

**SQL tests** (`6cad4f8e2`)
- `supabase/migrations/__tests__/orch_1150_rsvp.test.sql` (NEW).

---

## 4. Data-model changes applied (this dispatch)
Only the **view** recreate inside the existing ORCH-1150 migration: `business_public_events_view` now exposes `rsvp_discoverable / rsvp_capacity / rsvp_allow_plus_ones / rsvp_plus_ones_max / rsvp_waitlist_enabled / rsvp_approval_mode` + a `rsvp_going_count` subselect (going+approved, counting `plus_count`; 0 for non-RSVP). No new tables/columns (the events RSVP columns + `event_rsvps` shipped in Step 1).

## 5. Edge functions touched
- `discover-merged-events` — `verify_jwt = false` (unchanged); added `eventType` to the card mapping only. **Deploy from MERGED main.**
- (no change to `public-submit-rsvp` / `rsvp-notify` this dispatch — Step 2.)

## 6. Regression tests added (this dispatch)
| Test | Path | Runner | fails-on-revert |
|------|------|--------|-----------------|
| Step 9 error-code bubbling | `mingla-business/src/services/__tests__/rsvpErrorCodes.orch1150.test.ts` | jest (6) | proven (delete body-code branch → 3 fail) @ `eef6d25ea` |
| Step 11 going metric | `mingla-business/src/utils/__tests__/rsvpHubMetrics.orch1150.test.ts` | jest (8, incl. Step 12 notice) | proven (drop `plus_count` term) @ `d8f6ad649`/`f57e1e1b2` |
| Step 10 deck contract | `app-mobile/src/services/__tests__/rsvpDeckService.orch1150.test.ts` | Deno (3) | proven (revert dock branch → 1 fail) @ `711fcb776` |
| §9 invariants | `supabase/migrations/__tests__/orch_1150_rsvp.test.sql` (T1/T2/T4/T6) | psql probe | structural (await orchestrator DB run) |

## 7. Gates
- **tsc:** mingla-business + app-mobile — ZERO errors in ORCH-1150 files (pre-existing package/marketing baseline errors unrelated).
- **jest:** 4 RSVP suites, 24/24 pass. (Two source-text suites can't import the RN chain in this worktree — `node_modules` symlinks to the anchor; the same env quirk fails a pre-existing non-1150 test `serverDraftEventMapper.test.ts`. All 24 RSVP assertions that DO run pass.)
- **Deno:** rsvp-notify fanout 5/5; rsvpDeckService 3/3; `deno check` clean on public-submit-rsvp, rsvp-notify, discover-merged-events.
- **strict-grep:** ORCH-1138 (deck-off-ebes, no-trip-only-blocks, trip-reserve-straight-to-cart) PASS; tr2-events-type-filter + tr2-route-by-event-type-filter PASS. `i-proposed-tr2-route-by-event-type` FAILS — **pre-existing on origin/main** (6 violations in `trips.tsx`/`accept-scanner-invitation.tsx`/`ScannerHome.tsx`, none ORCH-1150 files; identical failure on the anchor).
- **Android glass:** new rows (RsvpPublicBody cards, deck dock, edit notice) use opaque/solid fills.

## 8. DO-NOT-TOUCH compliance
- Ticketed publish/checkout path byte-identical: `PublicEventPage` RSVP branch is a top-level early-return; the ticketed render below is unchanged. `ConsumerEventDetailScreen` keeps `TicketCartSheet` mounted (deck-off-EBES) and only swaps the dock/float bar for RSVP. `EditPublishedScreen` ticketed save path is unchanged (RSVP branch returns before `validateLiveEventFieldUpdate`).
- Only `validateBasics` export + `lockSingleDate` prop touched on the ticketed validator/When (Steps 4/6, prior).

## 9. Known issues / deferred (Discoveries for Orchestrator)
1. **Unlisted RSVP public page:** `business_public_events_view` filters `visibility='public'`, so an `unlisted` (link-only) RSVP won't resolve on `/e/`. Same pre-existing constraint as unlisted ticketed events. If link-only RSVPs must render their public page, the view (or a separate by-slug path) needs an unlisted carve-out — out of steps 9–12 scope.
2. **`host_set_rsvp_status` / RPC-driven approve in T4:** the SQL test exercises the host-remove via a direct `approved→denied` UPDATE (the mechanism the RPC performs) rather than the RPC itself, because the RPC's `auth.uid()`+brand-rank gate is awkward in a DO block. The drain mechanism (the §9.4 invariant) is fully proven; the RPC's auth gate is covered by T30/T42 (tester's adversarial scope).
3. **Pre-existing `i-proposed-tr2-route-by-event-type` failure on main** — flag for a cleanup ORCH (6 hardcoded `/trip/` `/event/` router.push in scanner/trips routes).
4. **jest RN-import wall in this worktree** — `node_modules` symlinked to anchor; some source-text-import tests can't run here. Confirmed environmental (a non-1150 baseline test fails identically). CI should run them in the real install.

## 10. Operator action required
- No migration `db push` needed from this dispatch (the Step-1 migration `20261004000000` already carries the schema; this dispatch only appended the view recreate to that same file — re-applies cleanly via the existing Step-1 `db push`).
- Edge deploy (from MERGED main): `discover-merged-events`, `public-submit-rsvp` (verify_jwt=false), `rsvp-notify` (verify_jwt=true).
- Run the SQL probe `supabase/migrations/__tests__/orch_1150_rsvp.test.sql` against the linked remote after migration apply.
