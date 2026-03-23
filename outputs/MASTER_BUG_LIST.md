# Master Bug List — Complete Inventory

> **Last updated:** 2026-03-22
> Every known bug, tracked and organized into implementation passes.
> Nothing missing. Nothing duplicated.

---

## COMPLETED (Blocks 1-8 + Push Fix)

All graded A. See LAUNCH_READINESS_TRACKER.md for evidence.

| ID | Bug | Block | Status |
|----|-----|-------|--------|
| B1-01 | Category slug mismatch (zero cards) | Block 1 | DONE |
| B1-02 | Hidden categories wrong format | Block 1 | DONE |
| B1-03 | Curated card labels missing | Block 1 | DONE |
| B2-01 | Per-category exclusion not enforced | Block 2 | DONE |
| B2-02 | Exclusion cross-contamination regression | Block 2 | DONE |
| B2-03 | Missing place_pool_id index | Block 2 | DONE |
| B3-01 | Pair request accepted — no notification | Block 3 | DONE |
| B3-02 | Pair activity bypasses preferences | Block 3 | DONE |
| B3-03 | 6 dead notification types | Block 3 | DONE |
| B3-04 | Session member left — no notification | Block 3 | DONE |
| B3-05 | iOS badge not wired | Block 3 | DONE |
| B3-06 | Holiday reminders missing | Block 3 | DONE |
| B4-01 | City TEXT never set on insert (5 paths) | Block 4 | DONE |
| B4-02 | No city/country propagation trigger | Block 4 | DONE |
| B5-01 | Admin Card Pool page 100% UUID-based | Block 5 | DONE |
| B5-02 | Card generation broken (request body) | Block 5 | DONE |
| B5-03 | 844 curated cards missing hero image | Block 5b | DONE |
| B5-04 | 6 single card orphans unlinked | Block 5b | DONE |
| B5-05 | 29 true orphan cards | Block 5b | DONE |
| B5-06 | Card Health metric mislabeled | Block 5b | DONE |
| B5-07 | 14 dirty city values | Block 5b | DONE |
| B6-01 | isOpenNow stale filter (15s timeout) | Block 6 | DONE |
| B6-02 | 16s batch transition hang | Block 6 | DONE |
| B6-03 | Prefetch key missing exactTime | Block 6 | DONE |
| B6-04 | Curated cards bypass exclusion (serve-time) | Block 6 | DONE |
| B6-05 | Curated cards bypass exclusion (generation) | Block 6 | DONE |
| B6-06 | Category balancing (global top-N) | Block 6 | DONE |
| B6-07 | Nature slug regression | Block 6 | DONE |
| B6-08 | Photo regression (stored_photo_urls dropped) | Block 6 | DONE |
| B7-01 | Children's venue keyword filter | Block 7 | DONE |
| B7-02 | ActionButtons analytics (9 buttons) | Block 7 | DONE |
| B7-03 | Body icon missing | Block 7 | DONE |
| B7-04 | Expanded card travel mode icon | Block 7 | DONE |
| B8-01 | Curated stop chaining (tiered → nearest) | Block 8 | DONE |
| B8-02 | Curated travel time (generation → serve-time) | Block 8 | DONE |
| B8-03 | Unified estimateTravelMin | Block 8 | DONE |
| PUSH-01 | sendPush returns true on failure | Push Fix | DONE |
| PUSH-02 | android_channel_id breaks all push | Push Fix | DONE |
| PUSH-03 | Legacy API key | Push Fix | DONE |
| PUSH-04 | DM collapse (only 1 notification) | Push Fix | DONE |
| PUSH-05 | DM thread grouping | Push Fix | DONE |
| PUSH-06 | Android large icon invisible | Push Fix | DONE |
| ICON-01 | 11 missing ICON_MAP entries | Icon Fix | DONE |
| ICON-02 | paper-plane-outline missing | Icon Fix | DONE |

---

## PASS 1a — Null Safety + Crash Prevention (4 fixes)

| ID | Bug | Source | File | Effort |
|----|-----|--------|------|--------|
| P1-01 | Null crash: displayName.split() in PairedPeopleRow | Forensic G1 | PairedPeopleRow.tsx:88 | LOW |
| P1-02 | images array contains [undefined] | Forensic A3 | SwipeableCards.tsx:1117 | LOW |
| P1-03 | Title/category no fallback (blank/crash) | Forensic A4 | SwipeableCards.tsx:1848, 1885 | LOW |
| P1-04 | ImageWithFallback discards alt prop (accessibility) | Forensic H1 | ImageWithFallback.tsx:38 | LOW |

---

## PASS 1b — Silent Failures + Preferences (4 fixes)

| ID | Bug | Source | File | Effort |
|----|-----|--------|------|--------|
| P1-05 | PreferencesService returns true on save failure | Forensic F1 | preferencesService.ts:86-96 | LOW |
| P1-06 | Custom location lost on GPS toggle | Forensic F2 | PreferencesSheet.tsx:615, 789-793 | LOW |
| P1-07 | Coordinates replacing display text | Deck #10 | PreferencesSheet.tsx | LOW |
| P1-08 | Null geocoding coords silently accepted | Forensic F3 | PreferencesSheet.tsx:572 | LOW |

---

## PASS 1c — Curated Card State (3 fixes)

| ID | Bug | Source | File | Effort |
|----|-----|--------|------|--------|
| P1-09 | Dismissed curated stops reappear in expanded | Forensic C1 | CuratedExperienceSwipeCard.tsx | MED |
| P1-10 | Curated cards missing Schedule button | Deck #8 | ExpandedCardModal.tsx | LOW |
| P1-11 | Shopping list hidden inside Stop 1 | Forensic C2 | ExpandedCardModal.tsx:656-658 | LOW |

---

## PASS 2a — Currency + Pricing (3 fixes)

| ID | Bug | Source | File | Effort |
|----|-----|--------|------|--------|
| P2-01 | Currency changes with GPS location | Deck #3/#4 | locale detection code | MED |
| P2-02 | priceRange = priceLevel (Google enum on cards) | Deck (new) | PersonHolidayView.tsx:383 | LOW |
| P2-03 | Slug on saved page (fine_dining not Fine Dining) | Deck #11 | SavedTab.tsx | LOW |

---

## PASS 2b — Paired View + Dedup (3 fixes)

| ID | Bug | Source | File | Effort |
|----|-----|--------|------|--------|
| P2-04 | Repeated experiences in paired view (no dedup) | Deck #5 | CardRow sections | MED |
| P2-05 | No error state in paired view (shows empty) | Forensic G2 | PairedProfileSection.tsx:127-141 | LOW |
| P2-06 | Birthday validation missing (NaN) | Forensic G3 | PairedPeopleRow.tsx:31-54 | LOW |

---

## PASS 2c — Opening Hours + Timezone (3 fixes)

| ID | Bug | Source | File | Effort |
|----|-----|--------|------|--------|
| P2-07 | Opening hours no timezone handling | Forensic B1 | openingHoursUtils.ts:40-101 | MED |
| P2-08 | Opening hours dual-path divergence | Forensic B3 | ActionButtons.tsx:102-139 | MED |
| P2-09 | Lat/Lng 0 treated as falsy | Forensic B4 | Timeline section:137-161 | LOW |

---

## PASS 3a — Error States + Truthfulness (4 fixes)

| ID | Bug | Source | File | Effort |
|----|-----|--------|------|--------|
| P3-01 | API failure shows "That's a Wrap" not error | Forensic A1 | deckService.ts:294-332 | MED |
| P3-02 | Optimistic close with no rollback on save fail | Forensic F4 | PreferencesSheet.tsx:833-887 | MED |
| P3-03 | Wrong empty state (filters vs truly empty) | Forensic D2 | SavedTab.tsx:2031-2059 | LOW |
| P3-04 | Failed category deselect no feedback | Forensic F5 | PreferencesSheet.tsx:416 | LOW |

---

## PASS 3b — Browser + Links + URLs (3 fixes)

| ID | Bug | Source | File | Effort |
|----|-----|--------|------|--------|
| P3-05 | Policies/reservation open phone browser | Deck #7 | Link handling code | MED |
| P3-06 | Address not sanitized for Maps URL | Forensic B2 | PracticalDetailsSection.tsx:36-43 | LOW |
| P3-07 | Avatar load failure no handler | Forensic G4 | PairedPeopleRow.tsx:104-111 | LOW |

---

## PASS 3c — Card Quality + Rendering (4 fixes)

| ID | Bug | Source | File | Effort |
|----|-----|--------|------|--------|
| P3-08 | Card transition flicker/blank frame | Forensic A2 | SwipeableCards.tsx:1036-1055 | MED |
| P3-09 | Curated/category round-robin broken | Deck #12 | Round-robin interleaver | MED |
| P3-10 | Skeleton card never rendered | Forensic A7 | SkeletonCard.tsx unused | LOW |
| P3-11 | Rating 0 treated as falsy | Forensic B5 | Companion stops:115-127 | LOW |

---

## PASS 4a — Scheduling Fixes (4 fixes)

| ID | Bug | Source | File | Effort |
|----|-----|--------|------|--------|
| P4-01 | Schedule picker opens behind modal | Deck #8 | SavedTab scheduling | MED |
| P4-02 | No schedule confirmation (abrupt) | Deck #9 | ActionButtons scheduling | LOW |
| P4-03 | Can't use current date to schedule | Deck #10 | DateTimePicker onChange | MED |
| P4-04 | Schedule handler race condition | Forensic E1 | ActionButtons.tsx:401-413 | LOW |

---

## PASS 4b — Data Quality: Exclusions + Categories (3 fixes)

| ID | Bug | Source | File | Effort |
|----|-----|--------|------|--------|
| P4-05 | Schools in cards (type + keyword exclusion) | User report | Migration + code | MED |
| P4-06 | Flowers category too broad | User report | seedingCategories.ts | LOW |
| P4-07 | Missing icons: play, alert-triangle | Log bugs | Icon.tsx | LOW |

---

## PASS 4c — Curated Content Quality (3 fixes)

| ID | Bug | Source | File | Effort |
|----|-----|--------|------|--------|
| P4-08 | Curated AI stop descriptions missing | User report | generate-curated-experiences | MED |
| P4-09 | Picnic dates returns zero cards | User report | Pool / generation gap | MED |
| P4-10 | Description no length truncation | Forensic B6 | DescriptionSection.tsx | LOW |

---

## PASS 5a — Saved Page + Calendar (4 fixes)

| ID | Bug | Source | File | Effort |
|----|-----|--------|------|--------|
| P5-01 | Deactivated cards still interactive on saved | Forensic D1 | SavedTab.tsx:1864-1999 | MED |
| P5-02 | Calendar permission failure silent | Forensic D3 | SavedTab.tsx:1428-1447 | LOW |
| P5-03 | Silent failure on saved card removal | Forensic D5 | SavedTab.tsx:1346 | LOW |
| P5-04 | No server-side duplicate schedule guard | Forensic D4 | calendarService.ts:86-89 | LOW |

---

## PASS 5b — Swipe + Animation Edge Cases (4 fixes)

| ID | Bug | Source | File | Effort |
|----|-----|--------|------|--------|
| P5-05 | Swipe limit bypass via rapid swiping | Forensic A5 | SwipeableCards.tsx:1009-1016 | LOW |
| P5-06 | currentCardIndex race during batch | Forensic A6 | SwipeableCards.tsx:936-955 | MED |
| P5-07 | Total time missing null guards | Forensic C3 | ExpandedCardModal.tsx:421-431 | LOW |
| P5-08 | Weather only for first stop | Forensic B7 | ExpandedCardModal.tsx:783-820 | MED |

---

## PASS 6 — Polish + Optimization (13 fixes)

| ID | Bug | Source | File | Effort |
|----|-----|--------|------|--------|
| P6-01 | Silent image fallback no logging | Forensic A8 | SwipeableCards.tsx:86-100 | LOW |
| P6-02 | PanResponder threshold too low (5px) | Forensic A9 | SwipeableCards.tsx:966-967 | LOW |
| P6-03 | Fetch without abort signal | Forensic A10 | deckService.ts:262-291 | LOW |
| P6-04 | SeatMap URL no error handler | Forensic B8 | ExpandedCardModal.tsx:1208-1218 | LOW |
| P6-05 | Photo counter desync on fast scroll | Forensic B9 | StopImageGallery.tsx:129-132 | LOW |
| P6-06 | Single image missing resizeMode | Forensic C4 | StopImageGallery.tsx:74 | LOW |
| P6-07 | No past date validation | Forensic E2 | ProposeDateTimeModal.tsx | LOW |
| P6-08 | No coordinate bounds validation | Forensic F6 | PreferencesSheet.tsx:371-375 | LOW |
| P6-09 | No past date in preferences picker | Forensic F7 | PreferencesSheet.tsx:685-719 | LOW |
| P6-10 | No "Pair Now" CTA in empty state | Forensic G5 | PairedProfileSection.tsx:137-138 | LOW |
| P6-11 | Missing icons: play, alert-triangle (if not in 4b) | Log bugs | Icon.tsx | LOW |
| P6-12 | Single image missing resizeMode | Forensic C4 | StopImageGallery.tsx:74 | LOW |
| P6-13 | No past date in preferences picker | Forensic F7 | PreferencesSheet.tsx:685-719 | LOW |
| P6-14 | Unsafe images pattern in 4 remaining files | Test finding | CalendarTab, BoardSessionCard, BoardViewScreen, SessionViewModal | LOW |
| P6-15 | Async suggestion select race (rapid double-select) | Test finding | PreferencesSheet.tsx handleSuggestionSelect | LOW |
| P6-18 | 27 avatar render sites with no onError handler | Investigation finding | Systemic — needs reusable AvatarImage component | MED |
| P6-16 | SavedTab category filter broken (slugs vs display names) | Spec finding | SavedTab.tsx filter logic | LOW |
| P6-17 | Account settings: country/currency/measurement manual change | User request | New feature — settings UI | MED |

---

## PASS 7 — Realtime + Freshness (Full App Audit)

> This pass requires a deep investigation before bugs can be itemized.
> Every data flow in the app must be audited for staleness, missing realtime,
> and missing foreground refresh. The bugs below are known — the investigation
> will find more.

| ID | Bug | Source | Scope | Effort |
|----|-----|--------|-------|--------|
| P7-01 | App goes stale after idle — no foreground refresh | User report | App-wide | TBD |
| P7-02 | Pair request sender not updated when accepted | User report | Pairings | TBD |
| P7-03 | No realtime subscriptions on key data changes | User report | App-wide | TBD |
| P7-04 | Must shake/reload to see changes | User report | App-wide | TBD |

**Scope of investigation (every data flow):**
- Notifications (new notification arrives — does badge/list update?)
- Friend requests (sent, accepted, declined — does other user see immediately?)
- Pair requests (sent, accepted, declined — does other user see immediately?)
- Collaboration sessions (invite, join, leave, vote — realtime for all members?)
- Chat/DMs (new message — already has realtime? verify)
- Saved cards (save/unsave from another device — syncs?)
- Calendar entries (schedule/remove — syncs?)
- Profile changes (name, avatar — reflected in friend lists, paired view?)
- Card pool changes (admin generates new cards — do users get them on next fetch?)
- Preference changes (change preferences — deck refreshes immediately?)
- Subscription tier changes (upgrade/downgrade — features gate immediately?)
- Foreground resume (app backgrounded 30s, 5min, 1hr — what refreshes?)
- React Query staleTime audit (which queries have staleTime too long?)
- Supabase Realtime subscription audit (which tables have listeners, which don't?)
- Cache invalidation audit (after every mutation, are the right queries invalidated?)

---

## DEFERRED (Not planned for current hardening)

| ID | Bug | Source | Reason |
|----|-----|--------|--------|
| DEF-01 | Dark mode unsupported | Forensic H2 | Architectural — 232 StyleSheet declarations |
| DEF-02 | Android back button gaps | Forensic (cross-cutting) | Needs per-screen audit |
| DEF-03 | Voting completed notification | Block 3 | No voting workflow exists |
| DEF-04 | Custom notification sounds | Block 3 | OS defaults acceptable |
| DEF-05 | Android notification channels | Push fix | Need OneSignal dashboard config |
| DEF-06 | Recurring holidays (year NOT NULL) | Block 3 | Schema change needed |

---

## Summary

| Pass | Count | Focus | Status |
|------|-------|-------|--------|
| Completed | 44 | Blocks 1-8 + push + icons | DONE |
| Pass 1 | 8 | Crashes + data loss | PENDING |
| Pass 2 | 5 | Data integrity + contracts | PENDING |
| Pass 3 | 12 | UX breaks + misleading states | PENDING |
| Pass 4 | 7 | Scheduling + data quality | PENDING |
| Pass 5 | 14 | Consistency + edge cases | PENDING |
| Pass 6 | 13 | Polish + optimization | PENDING |
| Deferred | 6 | Architectural / not planned | DEFERRED |
| Pass 7 | 4 | Realtime + freshness | PENDING |
| **Total** | **113** | | |
