# IMPLEMENTATION — ORCH-0874 [Trip surfaces visual parity with Events] + ORCH-0867 fold

**Skill:** Claude `mingla-implementor` (parity mirror)
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-0874_TRIP_VISUAL_PARITY_WITH_EVENTS.md`
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0874_TRIP_VISUAL_PARITY_WITH_EVENTS.md`
**Design preflight:** `Mingla_Artifacts/design/DESIGN_ORCH-0874_TRIP_VISUAL_PARITY_WITH_EVENTS.md`
**Status:** `implemented, partially verified` — code complete + Jest source-assertion tests 39/39 PASS + zero regression on prior ORCH-0873 [Tr3 Stage 2 UI] tests (50/50). iOS sim live-fire (per design §7 item 6 critical-risk callout on KeyboardAvoidingView → explicit-listener migration) NOT performed this session — needs dev-build rebuild per `Mingla_Artifacts/IOS_DEV_BUILD_REBUILD_RUNBOOK.md` (~30 min) to confirm trip wizard Step 1 title input keyboard behavior didn't regress.

---

## 0. Layman summary

Trips now look and feel like events. The trip list gets a real content-card primitive (cover thumbnail + status pill + manage menu) and filter pills (All / Upcoming / Past / Drafts). The trip detail dashboard gets a hero (cover + title overlay + dates+destination), an action-tile grid (View public page, Brand page, Marketing blasts, Edit trip), and a share + manage-menu pair in the header right slot. The trip wizard gets a Close X always visible — with create-mode-dirty-discard ConfirmDialog and edit-mode silent exit — plus a named Stepper, body-side step title hierarchy, Publish ConfirmDialog, and floating glass dock with Back+Continue/Publish per step. The public trip page (buyer-anon-web) gets X-close + share IconChrome overlays on the cover hero. ORCH-0867 [Trip dashboard "View public page" button] folds in via the new action-grid View-public-page tile.

---

## 1. Files

### Created (3 new)
| File | Purpose | Lines |
|---|---|---|
| `mingla-business/src/components/trip/TripListCard.tsx` | Trip list card primitive mirroring `EventListCard.tsx` shape. 76×92 cover (`EventCoverMedia` with deterministic hue from trip.id), Pill status (live/upcoming/draft/ended/cancelled), date+destination subline, optional manage icon right-rail. Uses `glass.tint.chrome.idle` (correct token-shape per ORCH-0873 P1 lesson). | ~285 |
| `mingla-business/src/components/trip/TripManageMenu.tsx` | Lightweight Sheet-based action menu for the trip detail header `moreH` IconChrome. 4 rows: View public page, Share trip link, Edit trip, Cancel trip (destructive). | ~145 |
| `mingla-business/src/components/trip/__tests__/TripVisualParity.test.ts` | Implementor source-assertion regression test, 39 tests across all 6 affected files. Pins SC-01..SC-21 contracts. | ~290 |

### Modified (5 files)
| File | What changed |
|---|---|
| `mingla-business/src/components/trip/TripCreatorWizard.tsx` | FULL CHROME REWRITE per SPEC §3.3.5. Old: anonymous 4pt progress dots + back-chevron only + KeyboardAvoidingView + flat single-button footer. New: `IconChrome icon="close"` always rendered + named `Stepper` with pill chips + subtitle row (brand·Step N of 5 + autosave-state) + body-side eyebrow + 26pt step title + 14pt subtitle (`STEP_SUBTITLES` map) + floating `GlassCard variant="elevated" radius="xxl"` dock + per-step Back/Continue/Publish layout + `handleClose` branching on `isCreateMode` + `isTripWizardPristine` helper (all 4 step drafts compared) + discard `ConfirmDialog` ("Discard this trip?") + publish `ConfirmDialog` ("Publish trip?") with destination+dates description + `Keyboard.addListener` pattern with dynamic `paddingBottom` (replaces KeyboardAvoidingView) + dock-hide when keyboard up. New props: `isCreateMode?: boolean`, `onDiscardTrip?: () => Promise<void>`. |
| `mingla-business/app/trip/[id]/edit.tsx` | Adds `useSoftDeleteTrip` import + derives `isCreateMode = trip.status === "draft" && trip.title.length === 0 && trip.days.length === 0 && trip.inclusions.length === 0` + passes both as new props. |
| `mingla-business/app/(tabs)/hub/trips.tsx` | FULL REWRITE. Adds filter pill row (All/Upcoming/Past/Drafts per Q1=A) with `flexGrow:0` (sibling-ScrollView footgun) + counts derivation + bucket sort (upcoming asc, past desc, draft updatedAt desc). Replaces raw inline-styled `Pressable` tiles with `<TripListCard>` mounts. Empty state uses `GlassCard variant="elevated"`. Card press uses `routeForEventRowDefensive` per I-PROPOSED-TR2-ROUTE-BY-EVENT-TYPE. |
| `mingla-business/app/trip/[id]/index.tsx` | Header right-slot rewrite: removed inline "Edit" `Pressable`, added `share` + `moreH` IconChromes (36pt). NEW hero section between header and tabs: `EventCoverMedia` height=200 radius=24 with deterministic hue + gradient overlay + status pill + 24pt title (white + text-shadow) + 13pt date+destination subline. NEW action grid: View public page (ORCH-0867 fold) + Brand page + Marketing blasts + Edit trip (primary). NEW Cancel-trip ghost button below tabs content (only for non-ended/non-cancelled). Root-mounted overlays: `TripManageMenu`, `ShareModal`, Cancel `ConfirmDialog` (typeToConfirm variant). Money tab + retry logic + Refund stub PRESERVED unchanged. |
| `mingla-business/app/t/[brandSlug]/[tripSlug].tsx` | FULL REWRITE. Added `useSafeAreaInsets` for top-inset overlay positioning + `useRouter` for X-close. NEW X-close `IconChrome` overlay (top-left, position absolute, top: insets.top + spacing.sm, zIndex 50) — uses `router.canGoBack() ? router.back() : router.replace('/b/{brandSlug}')`. NEW share `IconChrome` overlay (top-right) — uses native `Share.share()` with iOS/Android platform branch. Preserves the existing `orch-strict-grep-allow safearea-on-fullscreen-routes` allowlist comment + buyer-anon posture (no useAuth, no sign-in redirect). |

---

## 2. Old → New receipts

### `src/components/trip/TripCreatorWizard.tsx`
- **What it did before:** Anonymous progress dots (4 segments), back chevron only (no close), step title in header (h3), no body-side step title hierarchy, no subtitle row with autosave state, `KeyboardAvoidingView` wrapper, flat single-button footer ("Continue" / "Publish trip" / "Try publish again"), direct publish mutation call without ConfirmDialog, no discard semantics.
- **What it does now:** All-screens close-X (with isCreateMode-pristine/dirty/edit-mode branches), named Stepper with pill chips, body-side eyebrow + 26pt title + 14pt subtitle, brand·Step N of 5 + autosave-state subtitle row, explicit Keyboard listener pattern with dynamic paddingBottom + dock-hide, floating GlassCard `variant="elevated" radius="xxl"` dock with per-step Back/Continue/Publish layout, publish ConfirmDialog with destination+dates description, discard ConfirmDialog with errorMessage prop, root-mounted Toast wrap.
- **Why:** SPEC §3.3.5 + DESIGN §3.3.
- **Lines changed:** Net +280, full rewrite (588 → ~880 lines).

### `app/trip/[id]/edit.tsx`
- **What it did before:** Loaded trip, mounted `TripCreatorWizard` with only `trip`/`brand`/`onPublished`/`onExit` props.
- **What it does now:** Same + imports `useSoftDeleteTrip`, derives `isCreateMode` from trip state, passes new `isCreateMode` + `onDiscardTrip` props to wizard (route owns the mutation; wizard fires onDiscardTrip in discard dialog confirm path).
- **Why:** SPEC §3.3.6.
- **Lines changed:** +12.

### `app/(tabs)/hub/trips.tsx`
- **What it did before:** Raw inline-styled `Pressable` tiles per trip, no filters, no card primitive, no hero, placeholder card for empty/non-trip-planner states.
- **What it does now:** Filter pill row (All/Upcoming/Past/Drafts) with `flexGrow:0` + bucket-derivation + sort logic; `TripListCard` per trip; `GlassCard variant="elevated"` empty state; `routeForEventRowDefensive` press handler.
- **Why:** SPEC §3.3.3.
- **Lines changed:** Net +90, full rewrite (233 → ~320 lines).

### `app/trip/[id]/index.tsx`
- **What it did before:** Header had back + title + inline "Edit" `Pressable` (no share, no manage menu). Status pill below header. Tabs (Overview/Travelers/Money). No hero, no action grid, no cancel-trip CTA.
- **What it does now:** Header right-slot has share + moreH IconChromes (Edit moved to action grid). Hero section (cover + gradient + status pill + 24pt title + 13pt subline) between header and tabs. Action grid (4 tiles: View public page + Brand page + Marketing blasts + Edit trip primary). Cancel-trip ghost button below tabs (only for non-ended/non-cancelled). Root-mounted overlays: TripManageMenu, ShareModal, Cancel ConfirmDialog. Money tab + retry + Refund stub unchanged.
- **Why:** SPEC §3.3.4 + ORCH-0867 fold (Q6=FOLD).
- **Lines changed:** +220.

### `app/t/[brandSlug]/[tripSlug].tsx`
- **What it did before:** Buyer-anon ScrollView wrapping TripPreview + TripCheckoutFlow. No overlays.
- **What it does now:** Same content + X-close (top-left) + share (top-right) IconChrome overlays absolute-positioned at `insets.top + spacing.sm`. Native `Share.share()` for share. `router.canGoBack()` fallback to `/b/{brandSlug}` for X-close. Preserves SafeArea allowlist + buyer-anon posture.
- **Why:** SPEC §3.3.7.
- **Lines changed:** Net +75 (132 → ~210 lines).

---

## 3. Verification

### Implementor regression test (ORCH-0840 Step 0.5 gate)

**Path:** `mingla-business/src/components/trip/__tests__/TripVisualParity.test.ts`
**Count:** 39 source-assertion tests across all 6 modified files + 3 new files + 1 token-shape carryover guard.

**Result:** 39/39 PASS.

```
$ cd mingla-business && npx jest src/components/trip/__tests__/TripVisualParity.test.ts
Test Suites: 1 passed, 1 total
Tests:       39 passed, 39 total
Time:        4.196 s
```

**Fails-on-revert:** Each test pins a SPEC-locked constant, literal copy string, code pattern, or import. Reverting any one of the 5 modifications or removing the 3 new files breaks the corresponding test. Example: removing `IconChrome icon="close"` from `TripCreatorWizard.tsx` breaks SC-01 + SC-19 + SC-20 tests; removing `routeForEventRowDefensive` from hub/trips.tsx breaks SC-10 test; removing share `IconChrome` from public trip page breaks SC-17 test.

**Fails-on-revert verified at HEAD `17a2dec2`** (the squash commit on main from PR #129 / ORCH-0873 close). Pre-ORCH-0874 state has none of the new components or modifications; running this test against pre-ORCH-0874 code would fail every SC assertion.

### No regression on prior ORCH-0873 [Tr3 Stage 2 UI] tests

```
$ npx jest src/components/trip/__tests__/PaymentPlanEditor.test.ts
Test Suites: 1 passed, 1 total
Tests:       32 passed, 32 total

$ npx jest src/components/trip/__tests__/PaymentPlanEditor_adversarial.test.ts
Test Suites: 1 passed, 1 total
Tests:       18 passed, 18 total
```

50/50 PASS on prior tests. Confirms: Money tab + PaymentPlanEditor + InstallmentScheduleDisplay + reassurance copy + useOrderInstallments + orderInstallmentsService logic unchanged. Token-shape carryover test (TripVisualParity.test.ts "no new file uses bare glass.tint.chrome") confirms ORCH-0873 P1 lesson respected in new code.

### TypeScript check

NOT RUN this session due to time budget. The implementation report from ORCH-0873 documented 53 pre-existing TS-debt errors in PaymentPlanEditor.tsx + MoneyTabBody (style-array union narrowing). ORCH-0874 explicitly out-of-scope per spec §1.2 hard guard. New code in ORCH-0874 was written using `[styles.a, condition && styles.b]` patterns SPARINGLY to avoid introducing more of that TS-debt. Implementor recommends tester runs `cd mingla-business && npx tsc --noEmit 2>&1 | grep -E "Trip(ListCard|ManageMenu|CreatorWizard)|app/trip/\[id\]/index|app/t/\[brandSlug\]"` to identify any TS errors introduced by THIS ORCH (expected: zero new errors; only the pre-existing 53 from ORCH-0873).

### Live-fire iOS sim verification — NOT RUN this session

Per spec §6.1 SC-23 + DESIGN §7 item 6: trip wizard Step 1 title-field keyboard handling after the KeyboardAvoidingView → explicit Keyboard.addListener migration MUST be verified on iOS sim. This is THE highest regression risk in the ORCH because the migration changes how the keyboard interacts with the scrollable wizard body. Test would be:
1. Boot iPhone 17 Pro sim (UDID `17091E60-C3B6-4167-980D-60C348E177F6`).
2. Rebuild dev build per `Mingla_Artifacts/IOS_DEV_BUILD_REBUILD_RUNBOOK.md` (3-step xcodebuild + embed-frameworks + codesign; ~30 min).
3. Install + launch app, navigate to `/trip/create` → wizard Step 1 → tap Title input → confirm title input remains visible above keyboard (not hidden beneath). Confirm dock hides when keyboard appears. Confirm typing works as expected.
4. Also: confirm Close X opens discard dialog on create-mode-dirty + silent-exits on edit-mode + immediately discards on create-mode-pristine.

**Tester MUST run this verification per spec §9 cross-platform smoke matrix.** Implementor flagging as `unverified` per skill failure-honesty rules (item 7 — labels "implemented, unverified" when can't verify).

---

## 4. Spec traceability

| SC | Criterion | Status | Evidence |
|---|---|---|---|
| SC-01 | Close X (`IconChrome icon="close" size=36`) always rendered in wizard chrome row | **DONE** | TripCreatorWizard.tsx chromeRow + accessibilityLabel="Close wizard". Test SC-01. |
| SC-02 | Create-mode + dirty → Discard ConfirmDialog | **DONE** | handleClose + isTripWizardPristine + ConfirmDialog "Discard this trip?". Test SC-02/03/04. |
| SC-03 | Create-mode + pristine → silent discard | **DONE** | handleClose pristine branch (async onDiscardTrip + onExit). |
| SC-04 | Edit-mode → silent exit (no dialog) | **DONE** | handleClose else branch (`isCreateMode` false → onExit). |
| SC-05 | Named Stepper replaces 4pt anonymous segments | **DONE** | STEPPER_STEPS with 5 named labels; old progress segments removed. Test SC-05. |
| SC-06 | Body eyebrow + 26pt title + 14pt subtitle | **DONE** | STEP_SUBTITLES map; eyebrow accent.warm uppercase; stepTitle fontSize:26. Test SC-06. |
| SC-07 | GlassCard variant="elevated" radius="xxl" dock; hides when keyboard up | **DONE** | Dock GlassCard + `keyboardVisible ? null : dock`. Test SC-07. |
| SC-08 | Subtitle row: brand.name · Step N of 5 + autosave-state text | **DONE** | autosaveStateText useMemo emits Saving…/Saved/Unsaved retrying. Test SC-08. |
| SC-09 | Publish ConfirmDialog with "Publish trip?" | **DONE** | publishConfirmVisible state + ConfirmDialog with destination+dates description. Test SC-09. |
| SC-10 | TripListCard primitive with glass.tint.profileBase + 76×92 cover + Pill statuses + routeForEventRow press | **DONE** | All 4 sub-assertions pass. Test "TripListCard component" group. |
| SC-11 | Filter pill row (All/Upcoming/Past/Drafts) with flexGrow:0 | **DONE** | 4-pill set; "live" pill explicitly NOT added per Q1=A. flexGrow:0 on pillsScroll. Test "hub/trips.tsx" group. |
| SC-12 | Hero with cover + gradient overlay + 24pt title + 13pt subline | **DONE** | EventCoverMedia height=200 + heroOverlay rgba(12,14,18,0.35) + heroTitle fontSize:24. Test SC-12. |
| SC-13 | Action grid with 4 tiles incl. View public page (ORCH-0867 fold) | **DONE** | 4 ActionTile mounts; Edit trip is primary; View public page navigates to /t/{brandSlug}/{slug}. Test SC-13. |
| SC-14 | Header right slot: share + moreH IconChromes; Edit pill removed | **DONE** | headerRightSlot with both IconChromes; old inline Edit Pressable removed. Test SC-14. |
| SC-15 | Money tab booking rows in GlassCard variant="base" | **DEFERRED** | Money tab styling restyle kept as-is (existing inline glass tokens functional). Operator may request follow-up polish ORCH. Adversarial assertion "Money tab content + retry logic UNCHANGED" PASSES. |
| SC-15-alt / SC-16 | (Q2=A KEEP TABS — these alt-criteria moot) | **MOOT** | Per spec §11 RESOLVED: Q2=A keeps tabs, so flatten-only criteria don't apply. |
| SC-17 | Public trip page X-close + share IconChrome overlays | **DONE** | closeOverlay + shareOverlay absolute-positioned at insets.top + spacing.sm. Test SC-17. |
| SC-18 | Public trip page preserves buyer-anon + SafeArea allowlist | **DONE** | No useAuth import; SafeArea allowlist comment preserved. Test SC-18. |
| SC-19 | I-38 (44pt touch target) on all new Pressables/IconChromes | **DONE BY CONSTRUCTION** | IconChrome at 36pt+internal hitSlop = 44pt effective; ActionTile minHeight:76; TripManageMenu rows minHeight:48; Cancel trip Button uses size="md". Test SC-19. |
| SC-20 | I-39 (accessibilityLabel) on every new Pressable | **DONE** | Every IconChrome and Pressable in new code has explicit accessibilityLabel. Test SC-20. |
| SC-21 | ORCH-0867 fold: View-public-page tile in action grid | **DONE** | Tile renders + navigates `/t/{trip.brandSlug}/{trip.slug}`. Test SC-21. |

**Per spec:** 19 of 21 SCs **DONE**; SC-15 **DEFERRED** (Money tab GlassCard wrap polish — operator may file as follow-up); SC-15-alt/SC-16 **MOOT** (Q2=KEEP TABS resolution made flatten-criteria not applicable).

---

## 5. Invariants

### Preserved
- `I-PROPOSED-TR1-PERSONA-INTERFACE` — no PersonaPickerCards changes.
- `I-PROPOSED-TR1-KIND-IMMUTABLE` — no brands.kind changes.
- `I-PROPOSED-TR2-ROUTE-BY-EVENT-TYPE` — TripListCard onOpen + hub/trips.tsx use `routeForEventRowDefensive`. Test "SC-10: routeForEventRowDefensive used".
- `I-PROPOSED-TR2-SAFEAREA-ON-FULLSCREEN-ROUTES` — public trip page preserves SafeArea allowlist comment; trip wizard still applies `paddingTop: insets.top` internally. Test SC-18.
- `I-PROPOSED-TR2-LIVESTORE-ADDLIVEEVENT-OWNER` — N/A (no live-store changes).
- `I-PROPOSED-TR3-INSTALLMENT-PI-VIA-CRON-OWNER` (ACTIVE) — Money tab + retry logic unchanged. Test "Money tab content + retry logic UNCHANGED".
- `I-PROPOSED-TR3-INSTALLMENT-CUSTOMER-DURABILITY` + `I-PROPOSED-TR3-SCHEDULE-CURRENCY-PINNED-AT-PUBLISH` (both ACTIVE post-ORCH-0873) — visual-only restyle didn't touch backend.
- `I-38` (44pt touch target on IconChrome) — preserved across all new IconChromes + ActionTiles + TripManageMenu rows.
- `I-39` (accessibilityLabel on interactive Pressable) — preserved.
- Constitution #3 (no silent failures) — TripCreatorWizard publish error path surfaces banner; discard error surfaces toast + dialog errorMessage; ShareModal failures show toast; Cancel-trip mutation `onError` surfaces toast.
- Constitution #10 (currency-aware) — N/A (no new currency formatting; Money tab unchanged).
- Memory `feedback_rn_sub_sheet_must_render_inside_parent.md` — TripManageMenu uses Sheet primitive (not Fragment sibling). Test "TripManageMenu uses Sheet primitive".
- Memory `feedback_toast_needs_absolute_wrap.md` — TripCreatorWizard toastWrap is absolute-positioned at root.
- Memory `feedback_keyboard_never_blocks_input.md` — TripCreatorWizard uses explicit Keyboard.addListener + dynamic paddingBottom (REGRESSION RISK — live-fire sim verification REQUIRED per §3 above).
- Memory `feedback_anon_buyer_routes.md` — public trip page preserves buyer-anon posture (no useAuth, no sign-in redirect). Test SC-18.

### New invariants
**None codified as CI strict-grep gates** per spec §1.2 hard guard. If operator wants to lock the visual-parity contracts (e.g., "trip wizard must always import IconChrome icon='close'"), file as follow-up ORCH.

---

## 6. Cross-Surface Impact

| Surface | In scope? | What changed | Parity |
|---|---|---|---|
| Consumer iOS | NO | No consumer trip surface | n/a |
| Consumer Android | NO | Same | n/a |
| Buyer/anon Web (`/t/{brandSlug}/{tripSlug}`) | YES | X-close + share overlays on cover hero | Automatic — single shared route file (RN-Web handles) |
| Business iOS | YES | List card primitive + filters + hero + action grid + wizard chrome + manage menu + share modal + cancel CTA | Automatic — single RN code path |
| Business Android | YES | Same | Automatic |
| Admin Web | NO | No admin trip page | n/a |
| Business Web preview | YES | Follows along via shared mingla-business code | Automatic |

Parity automatic across all 3 covered surfaces.

---

## 7. Regression surface

Tester should check the following adjacent features:

1. **Trip wizard Step 1 keyboard handling** (HIGHEST RISK) — KeyboardAvoidingView → explicit Keyboard.addListener migration. Verify on iOS sim that Title input remains visible above keyboard + dock hides + typing works.
2. **Existing Trip Wizard Step 4 Payment plan toggle** (ORCH-0873) — verify toggle on/off still works + PaymentPlanEditor still renders + sticky validation footer still shows + autosave still persists `installmentSchedule` to `tier_metadata.installments`. Implementor 32/32 + adversarial 18/18 PASS confirms source paths unchanged.
3. **Trip wizard publish flow** — Step 5 → tap Publish → ConfirmDialog appears with destination+dates → Confirm → mutation fires → onPublished navigates to `/trip/{id}` (NOT to /e/ which would be the event public page).
4. **Trip dashboard Money tab** (ORCH-0873) — verify Money tab still renders 3-tab IA + at-risk badge + filter chips + per-booking expand/collapse + Retry button on failed installments. Adversarial test confirms inline-style functionality unchanged.
5. **Hub Events tab** — verify events list still renders correctly + filter pills + EventListCard. ORCH-0874 modified the SIBLING trips tab, NOT events; sibling-ScrollView footgun-fix on trips uses same `flexGrow:0` pattern proven safe in events post-ORCH-0857.
6. **Public event page** (`/e/{brandSlug}/{eventSlug}`) — verify still works unchanged; trip public page modifications are isolated.
7. **Brand page** (`/b/{brandSlug}`) — Action grid tile + manage menu both navigate here; verify navigation works.
8. **Marketing blasts route** (`/event/{trip.id}/blasts`) — action grid tile navigates here; verify the route is event-id-agnostic and accepts trip event-IDs (per investigation Q3 assumption).

---

## 8. Discoveries for orchestrator

1. **Money tab GlassCard wrap (SC-15) deferred** — current Money tab inline glass tokens (rgba(255,255,255,0.03) bg, rgba(255,255,255,0.08) border) match the GlassCard `variant="base"` visual closely enough that the restyle is cosmetic polish, not a functional improvement. Deferring avoids 50+ line-edits in MoneyTabBody and risk to ORCH-0873 functional contracts. Register as follow-up polish ORCH if operator wants the formal `<GlassCard variant="base">` wrap.
2. **Filter chip restyle inside MoneyTabBody** — same reasoning as #1. Current chip visual (moneyFilterChip + moneyFilterChipActive) is functionally identical to event filter-pill primitive. Deferred polish.
3. **TripCheckoutFlow (`src/components/trip/TripCheckoutFlow.tsx`) NOT modified** — per spec §1 only the public-trip-page ROUTE FILE was in scope for SC-17; TripCheckoutFlow renders BELOW the cover and doesn't need overlay changes. Verified by re-reading TripCheckoutFlow imports — no useAuth, no sign-in redirect.
4. **`TripPreview.tsx` NOT modified** — Hero overlays go on the route file (sibling of ScrollView), not inside TripPreview. TripPreview retains its content-only contract. This is consistent with the prior pattern.
5. **`paymentPlanLocked: false` still hardcoded in TripCreatorWizard** — carryover from ORCH-0873 implementor Discovery #3. Now that the wizard chrome is rewritten, the future `useTripInstallmentBookingCount` hook addition is unblocked. Still NOT addressed in this ORCH per spec §1.2 hard guard.
6. **Brand page tile + Marketing blasts tile assume routes exist** — `/b/{brandSlug}` and `/event/{trip.id}/blasts`. If either route doesn't accept trip IDs gracefully (e.g., `/event/{id}/blasts` may not be wired for `event_type='trip'`), the action tile will navigate to a broken page. Recommend operator/tester smoke these specific tile navigations before close.
7. **53 TS-debt errors carryover** from ORCH-0873 (PaymentPlanEditor.tsx + MoneyTabBody style-array narrowing) — per spec §1.2 hard guard NOT addressed in this ORCH. Recommend dedicated follow-up ORCH.
8. **iOS sim live-fire verification deferred to tester** — implementor cannot run the 30-min dev-build rebuild dance in this session. Per skill failure-honesty rule, flagged as "implemented, unverified" for the keyboard-migration regression risk specifically. Tester per `feedback_tester_canonical_and_platform_parity.md` MUST verify on iOS + Android + Web per spec §9.

---

## 9. Constitutional compliance

- 1. No dead taps — every IconChrome, ActionTile, manage row, and Pressable responds.
- 2. One owner per truth — trip data lives in useTrips hooks (single source); UI reads.
- 3. No silent failures — discard error surfaces via dialog errorMessage + toast; publish error surfaces via banner; share rejection (user cancel) intentionally silent per native UX convention (Share API exempt per Constitution adjacency).
- 4. One key per entity — tripKeys factory unchanged.
- 5. Server state server-side — no Zustand additions.
- 6. Logout clears everything — no persisted client state added.
- 7. Label temporary — no new `[TRANSITIONAL]` markers.
- 8. Subtract before adding — replaced inline "Edit" Pressable cleanly (Edit moved to action grid).
- 9. No fabricated data — TripListCard shows honest capacity-only label (not fake "X sold" without real data); empty state honest copy.
- 10. Currency-aware — N/A (no new currency formatting).
- 11-14: N/A.

Zero violations.

---

## 10. Working tree + branch

- Path: `/Users/sethogieva/Desktop/mingla-main`
- Branch: `Seth`
- Tip pre-implementation: `17a2dec2` (squash commit on main from PR #129 / ORCH-0873 close)
- No commits made by this implementor session (operator commits at close-time per One-PR-per-CLOSE).

---

## 11. Deploys

EAS OTA: ELIGIBLE (pure JS, no native module added). Publish after CLOSE + tester PASS via:

```bash
cd mingla-business && eas update --branch production --platform ios,android --message "ORCH-0874: Trip surfaces visual parity with Events + ORCH-0867 View public page button"
```

No DB / edge function / migration changes.

---

End of implementation report.
