# IMPLEMENTATION — ORCH-1341 [guest-list-sheet-consumer]

**META:** META-ORCH-1337 [social-proof-guest-list] · Leg 4 of 5
**SPEC (binding):** `Mingla_Artifacts/specs/SPEC_ORCH-1341_GUEST_LIST_SHEET.md`
**Design (binding):** `Mingla_Artifacts/specs/DESIGN_META-ORCH-1337_GUEST_SOCIAL_PROOF.md` §2/§4/§5
**Worktree:** `~/Desktop/mingla-orchs/META-ORCH-1337-[social-proof-guest-list]` on `META-ORCH-1337-social-proof-guest-list`
**Base:** `f0bf165ee` · **Code commit:** `f72513ecf` · **Polish commit:** `60231c23d` · **REVIEW-ruling amendment (final):** `b318c6fb9` (pinned header)
**Status:** implemented, partially verified (all structural/type/gate verification done by the implementor; SC-R runtime open/close/z-index proof is the TESTER's hard gate per SPEC §5 — a first-pass sim attempt was made and stopped for an environment reason documented in §9/§12)
**Date:** 2026-07-10

---

## 1. Summary

Tapping the guest cluster / "See who's going ›" link on any consumer detail screen (RSVP event, standard event, trip, experience — 4 entry points) now opens the new **EventGuestListSheet**: a dark app-chrome BaseBottomSheet at a fixed 70% that lists the event's guests — real names/@usernames/photos where privacy allows, "Someone / Keeping it low-key" for private profiles, "Guest" for unlinked seats, "You" first for the viewer — with two inline per-row actions: **Add friend** (open to all named rows, real `useFriends().addFriend` plumbing, "Requested" chip with outgoing cross-ref at first paint) and **Message** (ORCH-0993 friend-gated; locked state teaches the unlock; live path creates/finds the DM atomically, closes the sheet, then lands in Messages via the one `mingla://chat/{id}?type=direct` deep-link rail). All five designed states ship: skeleton (pulse, `isInteraction:false`), gated-mid-view lock state, zero-empty, error+retry, and the capped "and N more" tail. Blocked pairs never reach the client (server-side exclusion only — zero client filtering, guard-tested). Web mounts stay handler-absent (inert affordance — ORCH-1342's leg).

## 2. SPEC success-criteria coverage

| SC | Status | How verified | Commit |
|---|---|---|---|
| SC-1-iOS / SC-1-Android (open at 70%, header, sort bands, variants) | ✓ structural / **runtime = tester** | Component config + row derivation per §4.3 exactly; T-03/T-13 + A-3 assert the config, variants copy, and band logic source; runtime open per platform is SC-R (tester). **Header is PINNED per REVIEW ruling** — `scrollMode="scroll"` + the `header` sibling slot (EventAudienceSheet mechanics); T-03 bans flatlist mode (which folds the header into ListHeaderComponent so the title scrolls away) | `f72513ecf` + `b318c6fb9` |
| SC-2 (4 entry points × both platforms) | ✓ structural / **runtime = tester** | All 4 mounts wired (RSVP config + EventOfferingBody + TripOfferingBody + ExperienceOfferingBody); T-14/T-15/T-16 assert import+mount+handler per screen | `f72513ecf` |
| SC-3 (add-friend: spinner → Requested; cross-ref at reopen; failure hint) | ✓ structural / **live-fire = tester** | Exact `addFriend(profileId, "", username ?? undefined)` call (T-11b); in-flight/requested/pendingOutgoing/failure states implemented per design §2.5; live `friend_requests` row check is tester T-2 | `f72513ecf` |
| SC-4 (message friend: ensure → close → navigate; locked: hint, no conversation) | ✓ structural / **live-fire = tester** | A-1 asserts ensure→close→navigate source order; locked branch returns before `ensureConversation` (gate KEPT — non-friends cannot reach it); live DB zero-effect check is tester T-5 | `f72513ecf` |
| SC-5 (friends: no add button, live message; anon/unlinked/You: NO buttons; rows never tappable) | ✓ | `showActions = isNamed && !isYou` + `isFriendRow` branch (A-3); rows are plain `Animated.View` groups — T-09/T-10 prove no row Pressable | `f72513ecf` |
| SC-6 (gated mid-view → lock state, never error/rows) | ✓ structural / **live flip = tester** | `GuestListGatedError` → `phase="gated"` → lock empty-state (no retry, no rows); T-12 asserts the error mapping, T-13 the state copy | `f72513ecf` |
| SC-7 (blocked pair absent; NO client block code) | ✓ source-half / **live block = tester** | A-2: zero `.filter(` in all new files + no blockService/hasBlockBetween/isBlocked tokens; T-06 bans the imports; live re-open check is tester T-8 | `f72513ecf` |
| SC-8 (cap tail math; honest header) | ✓ | `goingCount − rows.length` footer, rendered only in content phase; header always shows the host's `goingCount`; T-13 asserts both | `f72513ecf` |
| SC-9 (offline/error → Retry → skeleton; zero → "No one yet") | ✓ structural / **runtime = tester** | Error state + `refetch()`; hook's `isLoading` covers the retry-refetch (data-undefined && fetching) so Retry → skeleton per §4.3; zero-empty state built | `f72513ecf` |
| SC-R (runtime sheet proof, recorded, both platforms) | **TESTER-owned (SPEC: "REQUIRED at TEST")** | Implementor first-pass attempted; blocked by worktree environment (§9); protocol unchanged | — |
| SC-10 (existing suites green, zero existing-test edits; gates green) | ✓ (with 2 documented pre-existing main-reds — §12) | 99/99 core deno + 22/22 business jest + 27/27 new; 0991 + 1303 + CI-registered 1043-sibling gates PASS; `git diff` shows zero existing-test edits | `60231c23d` |
| SC-11 (a11y: grouped rows, button labels, locked hint, targets) | ✓ structural / **VoiceOver = tester** | Grouped `accessibilityLabel` per variant, `accessibilityRole="header"`, "Add {name} as a friend" / "Message {name}" / locked hint / Requested announce + disabled state, rows 64pt / buttons 40+4 hitSlop = 48pt / retry 44pt (T-17) | `f72513ecf` |

## 3. Files changed (allowlist-exact, 9 of 9)

| # | File | Δ | What |
|---|---|---|---|
| 1 | `app-mobile/src/components/EventGuestListSheet.tsx` | NEW, ~730 lines | The sheet (§4.3–§4.5) |
| 2 | `app-mobile/src/hooks/useEventGuestList.ts` | NEW, 66 lines | Fresh-fetch-per-open query hook (§4.2) |
| 3 | `app-mobile/src/hooks/queryKeys.ts` | +8 | `guestListKeys` factory append ONLY |
| 4 | `app-mobile/src/services/socialProofService.ts` | +50 | `fetchPeerGuestList` + 2 typed error classes append ONLY |
| 5 | `app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx` | +37 | import, state/handlers, RSVP-config + EventOfferingBody gated handlers, sheet mount |
| 6 | `app-mobile/src/screens/Trip/ConsumerTripDetailScreen.tsx` | +31 | same pattern on TripOfferingBody, `eventId={detail.tripId}` |
| 7 | `app-mobile/src/screens/Experience/ConsumerExperienceDetailScreen.tsx` | +31 | same pattern on ExperienceOfferingBody, `eventId={seed.eventId}` |
| 8 | `app-mobile/src/components/__tests__/orch_1341_guest_list_sheet.test.ts` | NEW, 19 tests | T-9 source-structure suite |
| 9 | `app-mobile/src/components/__tests__/orch_1341_guest_list_sheet_adversarial.test.ts` | NEW, 8 tests | §9 revert families + seals |

Totals: `f72513ecf` = 9 files, +1615/−2; `60231c23d` = 3 files, +14/−2; `b318c6fb9` (REVIEW-ruling amendment) = 2 files, +44/−19. DO-NOT-TOUCH list fully honored (BaseBottomSheet, MessageInterface, useFriends, friendsService/messagingService/blockService/deepLinkService, connectionsService, `packages/offering-rendering/**`, `supabase/**`, `mingla-business/**`, all existing tests, `app/index.tsx`, registries): `git diff origin/main...HEAD --name-only` shows none of them beyond upstream legs' own commits.

## 4. Data-model changes

None (1338 frozen; fetch-on-open read of the LIVE `peer_list_event_guests` RPC).

## 5. Edge functions touched

None. No deploy needed for this leg. (Consumer delivery = per-platform OTA at META CLOSE, orchestrator-owned.)

## 6. Regression tests added

- `app-mobile/src/components/__tests__/orch_1341_guest_list_sheet.test.ts` — 19 tests (T-01..T-17): posture, bans, factory, isInteraction, rows-not-pressable, plumbing signatures, error contract, five states + copy, 3-screen wiring, a11y.
- `app-mobile/src/components/__tests__/orch_1341_guest_list_sheet_adversarial.test.ts` — 8 tests (A-1..A-8): close-before-navigate order, no-client-filter, anonymity seal, no offset-walking, no store writes, unconditional mounts, double gate, fixed detent + fresh fetch.
- Both NEW files (append-only safe — no token needed for them; the branch-wide `[TEST-MOD-APPROVED ORCH-1340]` footer rides every commit per the META dispatch because the PR head must carry ORCH-1340's sanctioned rewrite token).
- Runner note: Deno house-style source-structure suites (the 1340 pattern). Run:
  `deno test --allow-read app-mobile/src/components/__tests__/orch_1341_guest_list_sheet.test.ts app-mobile/src/components/__tests__/orch_1341_guest_list_sheet_adversarial.test.ts`

**fails-on-revert verified at 60231c23d** — all §9 families demonstrated red-then-green on the REAL committed files (mutate → suite red on exactly the targeted test → `git restore` → 27/27 green; clean-tree check = 0 modified files). Verbatim battery:

```
== F1a add <Modal token ==            FAILED | 26 passed | 1 failed   (T-01)
== F1b add gorhom token ==            FAILED | 26 passed | 1 failed   (T-02)
== F1c DELETE wrapInRNModal ==        FAILED | 26 passed | 1 failed   (T-03)  ← true line deletion
== F2 DELETE showActions guard ==     FAILED | 26 passed | 1 failed   (A-3)  ← true line deletion
== F3 DELETE onClose(); ==            FAILED | 26 passed | 1 failed   (A-1)  ← true line deletion
== F4 ADD .filter( in hook ==         FAILED | 26 passed | 1 failed   (A-2)
== F5 SWAP factory for literal ==     FAILED | 26 passed | 1 failed   (T-07)
== F6 ADD enableDynamicSizing ==      FAILED | 26 passed | 1 failed   (T-04)
== F7 ADD sendFirstMessage token ==   FAILED | 26 passed | 1 failed   (T-11)
== F8 DELETE first isInteraction:false == FAILED | 26 passed | 1 failed (T-08) ← true line deletion
== CLEAN ==  0 uncommitted            ok | 27 passed | 0 failed
```

(The same 10-mutation battery was first proven at `f72513ecf` before the polish commit — identical failing-test mapping.)

**Amendment fails-on-revert verified at b318c6fb9** (pinned-header ruling), same mutate → red → `git restore` → green protocol against the COMMITTED state, plus an original-family spot re-check:

```
== R1 flip scrollMode back to flatlist (rejected mechanic) == FAILED | 26 passed | 1 failed  (T-03)
== R2 DELETE the header={header} line (unpin the header)   == FAILED | 26 passed | 1 failed  (T-03) ← true line deletion
== spot F3 DELETE onClose(); (original family)             == FAILED | 26 passed | 1 failed  (A-1) ← true line deletion
== CLEAN == 0 uncommitted                                     ok | 27 passed | 0 failed
```

## 7. Old → New receipts

### EventGuestListSheet.tsx (NEW)
**Before:** did not exist — 1340's "See who's going ›" affordance had no destination; handlers were absent everywhere so the cluster was inert.
**Now:** the full §4.3 sheet. BaseBottomSheet `wrapInRNModal` + `theme="dark"` + `GUEST_LIST_SNAP = ["70%"]` + `scrollMode="scroll"` with the PINNED intrinsic-height `header` sibling slot above the primitive-owned BottomSheetScrollView and mapped keyed rows (REVIEW-ruling amendment `b318c6fb9` — the EventAudienceSheet exemplar's exact mechanics; the title never scrolls away; rows are RPC-capped ≤100 so mapped rows need no virtualization) + `#111418` canvas + `accessibilityLabel="Who's going"` + header content (icon shell 42/r21 primary-500, `people` 18 white, title 20/800, "{n} going" 13/600). Display sort bands You → named-with-photo → named-no-photo → unlinked → anonymous, stable in-band. Row anatomy 64pt/paddingV 8/hairline, 46px avatars (photo w/ border → onError initials disk `#eb7825` → glyph disk for unlinked/anon), text column with `@username` / "On Mingla" / "Keeping it low-key" / "You" line-2. Actions per design §2.5 state machines; transient line-2 hint (fade 120/hold 2500/fade 200, reduced-motion instant). Five states; skeleton pulse 0.5↔1.0 1000ms/leg `isInteraction:false`, reduced-motion static 0.7; 150ms ease-out phase fade. Message: ensure → `onClose()` → one-rail deep link (or the `onOpenConversation` test seam).
**Why:** SPEC §4.3–§4.5; DESIGN §2.
**Lines:** ~730.

### useEventGuestList.ts (NEW)
**Before:** n/a.
**Now:** `useQuery` keyed `guestListKeys.list(eventId ?? "none")`, `enabled: visible && eventId !== null`, `staleTime: 0`, `gcTime: 0`, `retry: 1`; returns the SPEC's `{ page, isLoading, isError, error, refetch }`. `isLoading` is defined as `data === undefined && isFetching` — a semantic thin-passthrough that ALSO covers the Retry-after-error refetch so the bound "Retry → skeleton" state contract (§4.3) holds (plain TanStack `isLoading` would leave the error state frozen during a retry). No filtering, no synthesis, no Zustand.
**Why:** SPEC §4.2 + design §2.6/§2.7.
**Lines:** 66.

### queryKeys.ts
**Before:** no guest-list factory.
**Now:** `guestListKeys { all, list(eventId) }` appended (spec-verbatim shape + a 3-line header comment in the file's idiom). No other line touched.
**Why:** Constitution #4; SPEC allowlist item 3.
**Lines:** +8.

### socialProofService.ts
**Before:** `fetchSocialProof` only.
**Now:** + `fetchPeerGuestList(eventId)` → `supabase.rpc("peer_list_event_guests", { p_event_id, p_limit: 100 })`, payload returned as frozen `PeerGuestListPage` (no mapping); PostgREST error message mapped → `GuestListGatedError` (`guest_list_private`) / `GuestListUnavailableError` (`event_not_available`) / generic rethrow. **Error-form choice documented (SPEC §4.1 gave the implementor the pick):** lightweight `Error` subclasses with a readonly `code` field — `instanceof` drives the sheet's state pick.
**Why:** SPEC §4.1.
**Lines:** +50.

### ConsumerEventDetailScreen.tsx
**Before:** rsvpConfig carried the 1340 seam comment "No onSeeWhosGoing here: ORCH-1341 wires the consumer sheet handler"; standard branch passed no handler; no sheet.
**Now:** `guestSheetVisible` state + `handleSeeWhosGoing`/`handleGuestSheetClose` callbacks (declared with the other state, before all early returns); `rsvpConfig.onSeeWhosGoing` (RSVP branch — reaches the inline `RsvpDecisionBox`; the floating bar has no cluster) and `onSeeWhosGoing` on `EventOfferingBody` (standard branch), BOTH double-gated `privateGuestList !== true && goingCount > 0` per §4.6 (RSVP gate uses `rsvpMomentum.goingCount`, standard uses the socialProof payload count — the spec's table sources); `<EventGuestListSheet …/>` mounted UNCONDITIONALLY as the last fragment sibling, `eventId={isRsvp ? rsvpPublicEvent.id : seed.eventId}`, `goingCount` per the same table. Cold `/e/` seedless route unchanged (early return precedes the mount — F-9b degradation preserved).
**Why:** SPEC §4.6 row 1.
**Lines:** +37.

### ConsumerTripDetailScreen.tsx / ConsumerExperienceDetailScreen.tsx
**Before:** bodies passed no `onSeeWhosGoing`; no sheet.
**Now:** same state/handler/mount pattern; handler double-gated on the socialProof payload; trip `eventId={detail.tripId}` + experience `eventId={seed.eventId}`; `goingCount={socialProofQuery.data?.goingCount ?? 0}`; sheet is the last sibling in each screen's existing root fragment (the proven sub-sheet posture).
**Why:** SPEC §4.6 rows 2–3.
**Lines:** +31 each.

## 8. Cross-surface impact

| # | Surface | Affected? | Detail | Parity |
|---|---|---|---|---|
| 1 | Consumer iOS | YES | 4 entry points open the sheet; all states/actions | Shared component; per-screen wiring manual ×3 (all done) |
| 2 | Consumer Android | YES | Same code; opaque dark canvas to physical bottom is primitive-owned (ORCH-1157 R13/1190) | Automatic (same files); runtime proof per platform = SC-R (tester) |
| 3 | Buyer/anon Web | NO | No handler passed on web mounts ⇒ 1340 inert cluster, no dead tap; ORCH-1342 owns the gate | — |
| 4 | Business iOS | NO | No guest sheet in business; previews pass no handler | — |
| 5 | Business Android | NO | same | — |
| 6 | Admin Web | NO | No mounts (F-2) | — |
| 7 | Business Web preview | NO | Honest zero-state, no affordance (1340 §3) | — |

Delivery: all pure-JS `app-mobile` ⇒ per-platform consumer OTA at META CLOSE (never `--platform all`). No native module added.

## 9. Smoke result (sim first-pass — attempted, environment-blocked, tester owns SC-R)

- Booted iPhone 17 Pro Max sim found with the consumer dev-client (`com.mingla.app.v2`) installed. Metro started from THIS worktree on the dispatch-designated port 8095; dev client launched against it.
- **Blocked:** red-screen `Unable to resolve module ./mingla-main/app-mobile/node_modules/expo-router/entry` — the worktree's `app-mobile/node_modules` is a **symlink to the anchor's** (`ls -la` proof), and Metro cannot serve entry modules across it (the known "OTA/Metro from worktree needs real `npm ci`" class). Per the dispatch ("do not fight the environment"), I stopped after one attempt, killed Metro, terminated the app, and left the sim clean.
- **Tester options for SC-R:** (a) `npm ci` in the worktree's `app-mobile` (replaces the symlink with a real install) then `npx expo start --port 8095` + dev-client; or (b) run the SC-R protocol post-merge from the anchor. The SC-R protocol itself (4 entry points × open/close×3 paths/rapid×5, recorded, both platforms) is unchanged from SPEC §5.

## 10. SHEET-REGRESSION GUARD SECTION — the 11 mapped classes (SPEC §4.7)

| # | Class | Where this implementation satisfies the preventing clause | Proof artifact |
|---|---|---|---|
| 1 | META-0991 raw-Modal/second-gorhom | Sheet imports ONLY `BaseBottomSheet` from `./ui/BaseBottomSheet`; zero `@gorhom/*`, zero RN `<Modal>` in all new files | strict-grep `meta-orch-0991` OK (487 files, sole importer intact) + T-01/T-02 + F1a/F1b red |
| 2 | ORCH-0908/1315/COMMS-0084 modal-over-modal | ONE `wrapInRNModal` sheet; all three hosts' detail sheets are INLINE (ORCH-1194 revert comment verbatim-read; ExpandedCardModal early-returns the event screen outside its own RN-Modal wrap) ⇒ the guest sheet is the only RN-Modal window when open; Message navigates only AFTER `onClose()`; profile-open excluded (rows not pressable); nothing layers above (no `overlay` usage) | T-01 + A-1 + T-04 (`overlay=` ban) + SC-R (tester runtime) |
| 3 | ORCH-1016 nav painted over content | `wrapInRNModal` z-stacks above the nav; `tabBarAware`/`hidesBottomNav` both OMITTED (primitive defaults false) and T-04 bans the tokens from the file | T-04 + SC-R screenshots (tester) |
| 4 | ORCH-1040/1043 header/body double-wrap | `header` = the primitive's PINNED intrinsic-height sibling slot; body is gorhom's OWN `BottomSheetScrollView` via `scrollMode="scroll"` (the primitive's `<>{header}{scroll}</>` direct-child branch, flex:1 body — the exact ORCH-1043 mechanism) — no raw list, no BottomSheetView wrapper anywhere in my file; the primitive untouched | CI-registered `i-bottomsheet-inline-scroll-binding` OK + T-03/T-05; note on the local 1043 script in §12 |
| 5 | ORCH-1064 release-only half-open stall | No `animationConfigs` passed — the primitive's ORCH-1064 deterministic timing drive is untouched | T-04 + F6-family red + SC-R rapid ×5 (tester) |
| 6 | ORCH-1138 dynamic-size mismeasure | Fixed `GUEST_LIST_SNAP = ["70%"]` module const, single detent, `initialIndex` default 0, `enableDynamicSizing` never passed | T-03 + T-04 + A-8 + F1c/F6 red |
| 7 | ORCH-1157 R8/R9 Android bottom gap | Primitive-owned (R13 screen-height host + ORCH-1190 filler live in BaseBottomSheet, untouched); sheet canvas opaque `#111418`; list `paddingBottom 24` + primitive's `withBottomInset` merge | T-03 (#111418) + SC-R Android bottom-edge screenshot (tester) |
| 8 | ORCH-1171 keyboard in RN-Modal | NO text input in v1 — `TextInput`/`BottomSheetTextInput` banned from the file | T-04 |
| 9 | ORCH-1190/1191 bottom fill | Primitive-owned; opaque canvas + opaque rgba-on-#111418 fills only (Android delta honored — no translucency over content) | T-03 + SC-R bottom screenshots (tester) |
| 10 | Dismiss-analytics split | No analytics exist in the sheet yet; the ONLY dismissal seam is the `onClose` prop (pan-down + backdrop + programmatic all route through it via the primitive); protective comment pins the rule for future additions | Code review of the one `onClose` seam + header comment |
| 11 | Ghost touch-blocker after close | No `overlay` used; the RN-Modal window unmounts on close (primitive's ORCH-1064 close-reaches-−1 drive); nothing painted outside the primitive | T-04 (`overlay=` ban) + SC-R step-4 interactivity taps (tester) |

## 11. Invariant preservation (SPEC §6) — all Y

- I-PROPOSED-BASE-BOTTOM-SHEET-SOLE-GORHOM-CONSUMER: Y (gate output pasted above).
- COMMS-0084/ORCH-1315 layering: Y (no second Modal; overlay unused; T-9/A-1).
- ORCH-1043 header-sibling / 1064 stock-motion / 1138 fixed-snap / 1016+Bug-4 nav: Y (§10 rows 3–6).
- ORCH-0993 friend-gate (D4): Y — locked branch returns BEFORE `ensureConversation`; non-friends cannot reach it structurally.
- ORCH-1303 isInteraction: Y — every `Animated.timing` carries `isInteraction: false` (T-08 window-scan + F8 red).
- I-PROPOSED-1340-GUEST-IDENTITY-PRIVACY-GATED: Y — names render only in this authed sheet from the payload; anonymous rows carry no id and no actions; gated state on `guest_list_private`.
- I-PROPOSED-1338-PEER-GUEST-READ-GUARDED: Y — single authed fetch, `p_limit 100`, no offset-walking (A-4).
- Constitution #4: Y (T-07 + F5 red). Constitution #9: Y — every name/avatar from the payload; fixed strings are the design's copy; initials disk is decorative with the name adjacent.
- Zustand-persist: Y — untouched; hook holds server state in React Query only (A-5).
- Proposed NEW drafts implemented as specified: I-PROPOSED-1341-GUEST-SHEET-ACTIONS-ONLY (T-09/T-10/A-3), I-PROPOSED-1341-MESSAGE-CLOSE-BEFORE-NAVIGATE (A-1). Orchestrator flips at CLOSE.

## 12. Verification outputs (verbatim), known issues, deferred

**New suites:** `ok | 27 passed | 0 failed` (19 happy + 8 adversarial).
**TypeScript:** `npx tsc --noEmit` in `app-mobile`: 902 errors baseline (pre-change, saved sorted) → 902 after, `diff` = empty → **zero NEW errors**. (The 902 are pre-existing repo-wide; worktree symlinked node_modules contributes the `packages/phone-input` block.)
**Gates:**
```
I-PROPOSED-BASE-BOTTOM-SHEET-SOLE-GORHOM-CONSUMER OK: scanned 487 file(s) … sole @gorhom/bottom-sheet importer.
ORCH-1303 gate PASS — every RsvpMomentumDecision pulse-loop + meter Animated.timing carries isInteraction:false; …
OK [I-BOTTOMSHEET-INLINE-SCROLL-BINDING / SCROLLABLE-IS-DIRECT-CHILD]: BaseBottomSheet renders every scrollable as a direct child …
```
**Batteries:** core deno (1157 + 1338×3 + 1339×2 + 1340×2): `ok | 99 passed | 0 failed`. 1163 set: 30 passed + 1 pre-existing fail (below). mingla-business jest (1339 trip+experience): `2 suites, 22 passed`. Zero existing-test files edited (append-only clean).

**Known issues / pre-existing reds (NOT caused by this leg — both proven):**
1. **Local `app-mobile/scripts/ci/orch-1043-sheet-scroll-viewport-check.mjs` T-06 is RED on origin/main**: its regex demands `{sheet}` (± `{androidNavFiller}`) immediately before `</GestureHandlerRootView>`, but ORCH-1315's sanctioned `overlay` slot inserted a sibling there. Both the script and BaseBottomSheet are byte-identical to origin/main (`git diff origin/main --` = empty). The script is NOT registered in any workflow; its CI-registered sibling `i-bottomsheet-inline-scroll-binding.mjs` PASSES. The SPEC's §4.7 row-4 proof is satisfied by the CI-registered gate.
2. **`packages/offering-rendering/__tests__/orch_1163_r3_rsvp_floating_active.test.ts` §6b RED**: proven identical with my screen file restored to HEAD (`FAILED | 8 passed | 1 failed` both pre- and post-diff) — already baselined in the ORCH-1340 report §Discoveries ("9 deno failures on main today… docs-only-CLOSE latent-red class").

**Deferred (per SPEC non-goals):** web tap/gate (1342), profile-open from rows (excluded; future = overlay slot only), Accept-chip for incoming requests, search/pull-to-refresh/pagination, `matched_user_id` plus-one identity. No `[TRANSITIONAL]` markers introduced.

## 13. Operator action required

None for this leg (no migration, no edge deploy). Delivery is META-CLOSE-owned: merge the META PR (all CI green) then consumer OTA per platform.

## 14. Discoveries for Orchestrator

1. **Stale local gate (pre-existing main-red):** `orch-1043-sheet-scroll-viewport-check.mjs` T-06 vs the ORCH-1315 overlay slot (§12-1). Not CI-registered so it cannot block the PR, but the SPEC cites it by name and the tester may run it — recommend a small hygiene ORCH to teach T-06's regex the sanctioned `{overlay…}` sibling (a gate-script edit is outside my allowlist).
2. **Pre-existing 1163-§6b deno red** (§12-2) — extends the 1340 report's latent-red list; unowned.
3. **Worktree `app-mobile/node_modules` is a SYMLINK to the anchor's** — Metro cannot serve a dev client from this worktree (entry resolves across the symlink and fails). Affects the tester's SC-R setup: `npm ci` in the worktree app-mobile first, or run SC-R post-merge from the anchor (§9).
4. **Flatlist-header mechanic (deviation-class note, config is spec-verbatim):** SPEC §4.3 describes `header` as the "intrinsic-height sibling slot (ORCH-1043)", which is true for scroll/sectionlist/sticky modes — but in the spec-bound `scrollMode="flatlist"` the primitive forwards `header` as gorhom's `ListHeaderComponent` (BaseBottomSheet.tsx:716), so the header scrolls WITH the list rather than pinning. This is the primitive's standing flatlist behavior (FriendPickerSheet ships it), not something I could change without touching the DO-NOT-TOUCH primitive. Design intent (list scrolls under a header) is served; if a PINNED header is wanted, the amendment is a one-line switch to the exemplar's `scrollMode="scroll"` + mapped rows — flag at review.
5. **SPEC §4.5 sequencing deviation now live in code** (spec-ruled, restated for Seth's review per SPEC §10-1): ensure → close → navigate, not the design's literal close-first — the failure path needs the open sheet as its error surface.

## 15. What remains for the TESTER

- **SC-R (HARD gate, recorded):** iOS sim + Android emulator × 4 entry points — open above inline sheet/floating bar/nav at 70%, dark to the physical bottom; close via pan-down + backdrop + Message-navigation; post-dismiss interactivity taps; rapid open/close ×5; `simctl recordVideo` + `screenrecord` attached. Environment note §9/§14-3.
- **Live-fire (test account pair on prod, self-owned test event only):** T-1 roster bands; T-2 add-friend → `friend_requests` row + reopen chip; T-3 airplane failure hint; T-4 message-friend landing in the DM via the rail; T-5 locked = zero `get_or_create_direct_conversation` effect; T-6 ensure-failure race; T-7 privateGuestList mid-view flip → lock state; T-8 block → absent + source assert; T-12 anonymous rows; T-13 cap tail (>100 or plus-ones); T-15 VoiceOver/TalkBack sweep.
- Physical-device pass per house rules before CLOSE.

## 16. Routing

Back to **mingla-orchestrator** for REVIEW, then **mingla-tester** dispatch (§15 scope). Working tree: `~/Desktop/mingla-orchs/META-ORCH-1337-[social-proof-guest-list]` on branch `META-ORCH-1337-social-proof-guest-list` at `60231c23d` (+ this report commit). No deploy, no merge, no close performed.
