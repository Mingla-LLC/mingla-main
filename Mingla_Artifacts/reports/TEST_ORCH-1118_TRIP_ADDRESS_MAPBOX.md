# TEST — ORCH-1118 [trip from/destination fields must be Mapbox-validated addresses]

**Skill:** mingla-tester (business side)
**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1118-[trip-address-mapbox-validation]/`
**Branch:** `ORCH-1118-trip-address-mapbox-validation` (rebased onto origin/main at TEST start — was 1 behind, 3 ahead; rebased clean)
**Date:** 2026-06-12
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-1118_TRIP_ADDRESS_MAPBOX.md` ([DECISION-REVISED 2026-06-12] departure HARD-REQUIRED)
**Implementation commit (post-rebase):** `07185931a` (orig `4134676e2`)
**Tester adversarial test commit:** `54da7708b`
**Comms ledger:** read on entry. No BLOCK rows for mingla-tester / ORCH-1118 / ALL. COMMS-0024 (WARN/ALL, ORCH-1116 three-way ID collision) factored — ORCH-1118 is this session's assigned, non-colliding ID (its own worktree); no renumber. No new cross-ORCH discovery → no new ledger entry written.

---

## 1. VERDICT

**CONDITIONAL PASS** — P0: 0 · P1: 0 · P2: 0 · P3: 0 · P4: 2

The implementation is correct, complete, and matches the binding SPEC including the [DECISION-REVISED 2026-06-12] departure-hard-required override. Source is clean of the dead-tap / conditional-unmount class. Jest is independently green (36/36 across 5 ORCH-1118 suites incl. my adversarial test); the 4 business desktop-web contract gates pass; do-not-touch paths are byte-unchanged; the implementor's fails-on-revert was independently re-proven on two separate gates; my adversarial test (different angle) fails-on-revert and is on-branch + in-diff.

**The single reason this is CONDITIONAL, not full PASS:** the reserved adversarial angle (SC-5/6/7/8 **on-screen** runtime drive of the published-edit screen — dropdown renders, a real pick persists coords through `biz_update_live_trip` to the DB, save gate fires on-screen) is **auth-gated** and could not be completed autonomously — the business dev-client is at the logged-out sign-in screen and reaching either trip authoring screen requires Seth's login credentials (Apple/Google/Email OTP), which is the human-in-the-loop boundary. I proved everything up to the auth wall: the worktree bundle carrying the swap compiles, serves, **loads onto the iPhone 17 Pro sim, and runs** (5204 modules, all ORCH-1118 strings present in the served bundle), and the swapped field has **no conditional-unmount-on-its-own-path** in source (it is the section's own accordion content, expanded by the save-block handler). Runtime confidence on the picker dropdown + DB persist is therefore **`probable`**, not `proven`.

→ **Routes to Seth for the HITL on-screen confirmation in §7**, then CLOSE. This is NOT a code defect; no REWORK is implied.

---

## 2. SC-by-SC matrix

Parity is automatic (shared RN code, no `Platform.OS` branch in the new logic) → iOS/Android/Web share each SC. "Evidence" cites the independent verification I ran, not the implementor's claim.

| SC | Description | Status | Evidence |
|----|-------------|--------|----------|
| SC-1 | Create: type-without-pick clears coords (both fields) | **PASS** | `TripCreatorStep1Basics.tsx:404-413,441-450` both `onChangeText` null placeId/lat/lng; jest T-4 PASS |
| SC-2 | Create: publish blocked on unvalidated destination (jump + inline + toast + disabled) | **PASS** | `TripCreatorWizard.tsx:886-908` belt (`if(!tripLocationValid){setStep(1);showToast(...);return;}`) BEFORE Stripe check + `setPublishConfirmVisible`; disabled suspenders line 1350; jest T-5 PASS; re-proven fails-on-revert (§4) |
| SC-3 | Create: publish blocked on dirty OR EMPTY departure (hard-required) | **PASS** | `tripLocationValid` memo ANDs `departureLocationValidated` (empty→false); predicate `tripLocationValidated.ts:48-53`; jest T-3 + adversarial PASS |
| SC-4 | Create: valid path (both picked) publishes | **PASS** | gate is the AND of both `*Validated`; only the fully-picked shape passes — adversarial test "ONLY fully-picked passes" PASS |
| SC-5 | Edit: fields are MapboxAddressInput (dropdown, not text box) | **PASS (source) / PROBABLE (on-screen)** | `EditPublishedTripScreen.tsx:1143,1186` two `<MapboxAddressInput`; jest T-6 PASS; served sim bundle contains the swap (grep §6). On-screen dropdown render is the HITL step §7 |
| SC-6 | Edit: type-without-pick clears coords | **PASS** | `EditPublishedTripScreen.tsx:1147-1153,1190-1196` null structured fields; jest T-8 PASS |
| SC-7 | Edit: save blocked on unvalidated (dest + empty/dirty departure) | **PASS (source) / PROBABLE (on-screen)** | `handleSavePress` gate `1768-1786` (OR of `!destValidated || !depValidated`) placed AFTER empty-patch+title, BEFORE `setModal`; jest T-7 PASS; on-screen fire = HITL §7 |
| SC-8 | Edit: valid path saves; diff-builder emits structured keys unchanged | **PASS (source) / PROBABLE (DB persist)** | gate passes only on full picks; `buildLiveTripPatch` already emits destination*/departure* (unchanged, SC-11); live DB persist via `biz_update_live_trip` = HITL §7 |
| SC-9 | Refund behavior unchanged | **PASS** | `classifyTripSeverity` byte-unchanged in diff; only input method changed; no refund/notify path touched |
| SC-10 | Backfill safety + idempotency | **PASS** | `orch1118Backfill.dryrun.test.ts` exercises real `evaluate`/`isDirty` against fixtures (incl. the 5 live city strings) — confidence gate rejects ambiguous/low-confidence/non-settlement, accepts unambiguous high-confidence; skip-on-coords idempotency; 9/9 PASS. Live run operator-gated per spec. |
| SC-11 | No shared-field change (git diff empty for do-not-touch) | **PASS** | `git diff origin/main...HEAD` over `packages/location-input/`, `MapboxAddressInput.tsx` wrapper, `experience/*`, `mapbox-geocode/`, `migrations/` → **EMPTY** (verified §below) |

---

## 3. Findings

No P0/P1/P2/P3. Two P4 notes:

- **P4-1 (praise):** the gate is correctly placed in `handleSavePress` AFTER the empty-patch + title checks and BEFORE `setModal` — a switch-only save (empty patch) still short-circuits at the top, so the new gate does not regress the ORCH-1006 switch-only-save path. Clean ordering.
- **P4-2 (praise):** the swapped edit-screen field is the section's own accordion content (`renderSection("basics")`), and the save-block handler calls `setOpenSection("basics")` to expand it when revealing the inline error — so the error is always visible when it fires. No dead-tap / conditionally-unmounted-on-own-path pattern (the exact failure class the SPEC §7 reserved for the tester).

---

## 4. Step 0.5 — independent re-run of the implementor's fails-on-revert proof

I re-ran TWO of the implementor's claimed fails-on-revert proofs myself (true edits, re-run, restore):

1. **Predicate T-3 (empty departure invalid).** Loosened `departureLocationValidated` (`tripLocationValidated.ts`) to `_text empty ? true : tripPlacePicked(...)` (the pre-revision ORCH-1016 "optional departure" shape). Re-ran `tripLocationValidated.test.ts`:
   - **T-3 "departure EMPTY is INVALID" FAILED** — `expect(departureLocationValidated("",null,null,null)).toBe(false)` → `Expected: false / Received: true`. Restored → **9/9 PASS**. Matches the implementor's claim (`fails-on-revert verified at 4134676e2`/post-rebase `07185931a`).

2. **Create-wizard belt T-5.** Replaced `if (!tripLocationValid) {` with `if (false) {` in `TripCreatorWizard.tsx::handlePublishTap`. Re-ran `TripCreatorStep1Basics.mapbox.test.ts`:
   - **T-5 "publish gate references tripLocationValid and blocks before the confirm dialog" FAILED** — `expect(handler).toContain("if (!tripLocationValid)")` substring missing. Restored → **8/8 PASS**.

Both product files confirmed clean (`git status --short` empty) after restore.

---

## 5. Adversarial test added (tester — DIFFERENT ANGLE)

- **Path:** `mingla-business/src/components/trip/__tests__/tripLocationGate.adversarial.test.ts`
- **Commit:** `54da7708b` (on branch, in `git diff origin/main...HEAD --name-only`)
- **Angle (distinct from implementor):** the implementor's tests grep file SOURCE for the gate's text. Mine **imports + CALLS** the real `departureLocationValidated`/`destinationLocationValidated` and **reproduces the exact OR-combined boolean** both gates evaluate (`block ⇔ NOT(destValid AND depValid)`), pinned against the **live production dirty rows** read read-only from `gqnoajqerqhnvulmnyvv` ("The Sone" + "The DC Adventure": dirty `destination_text`, empty departure). It asserts the gate BLOCKS those rows, and pins the critical hard-required case (valid-picked destination + EMPTY departure STILL blocks).
- **Fails-on-revert verified at `54da7708b`:** with departure loosened to "empty=valid", the "FAILS-ON-REVERT pin: valid-picked destination + EMPTY departure STILL blocks" case flipped `true→false` → `Expected: true / Received: false` (1 failed, 4 passed). Restored → 5/5 PASS.
- Both the implementor's happy-path suites AND this adversarial test appear in the closing diff (`__name-only__` lists all 5).

---

## 6. Runtime evidence (the reserved adversarial angle — as far as auth allowed)

**Bundle-load proof (the worktree code, not the anchor):**
- Metro served from the **worktree** (`/Users/.../ORCH-1118-.../mingla-business`) on port 8085 (the pre-existing 8082 Metro is the ANCHOR's main code — would NOT carry the swap; anchor `EditPublishedTripScreen.tsx` has **0** `MapboxAddressInput` refs vs the worktree's **3**).
- iOS bundle built + served: `HTTP 200, 31,067,122 bytes`. Grep of the served bundle:
  - `"Pick the departure city from the suggestions"` → 1 hit
  - `"Pick the destination from the suggestions"` → 1 hit
  - `edit-trip-departure` / `edit-trip-destination` testIDs → 2 hits
  - `"Pick the trip's departure and destination from the suggestions"` (save/publish toast) → 2 hits
  → the runtime bundle the device loads **carries the ORCH-1118 swap + gate**, not the anchor's plain TextInputs.
- Business dev-client (`com.sethogieva.minglabusiness`) launched on iPhone 17 Pro sim (`17091E60-…`) pointed at `exp+mingla-business://expo-development-client/?url=http://localhost:8085`. Metro log: **`iOS Bundled 21243ms index.js (5204 modules)`** — the worktree bundle loaded and the app rendered (Mingla Business sign-in screen, `/tmp/orch1118_sim_03.png`).

**Dead-tap / conditional-unmount source proof (SPEC §7's reserved failure class):** the swapped `MapboxAddressInput` is `renderSection("basics")`'s own content; the block handler `setOpenSection("basics")` expands that very section before revealing the inline error. There is no separate overlay/portal that could be unmounted on its own path. The component is the **identical** already-shipped `SharedMapboxAddressInput` (packages/location-input) used by the create wizard (ORCH-1079) + experience stops (META-ORCH-1059) — it renders the suggestion dropdown and forwards `error` (proven shipped). Swap reuses it verbatim.

**What is NOT yet proven (the auth wall → HITL §7):** the on-screen dropdown rendering, a real pick on the edit screen, the save gate firing on-screen, and coord persistence through `biz_update_live_trip` to the DB — all behind the logged-out sign-in screen. Confidence: **`probable`** (bundle proven loaded + strings present + no dead-tap pattern + identical shipped component), capped below `proven` because I did not observe the dropdown render on the auth-gated screen.

**Live DB read-only confirmation of the target rows (project `gqnoajqerqhnvulmnyvv`):** the editable dirty trips exist as the investigation described — scheduled trips with dirty `destination_text` + null coords + empty departure:
- `743ad25b…` "The Sone" — `destination_text="Tulum, Quintana Roo, Mexico"`, `departure_text=null`, `departure_geo=null`, `theme.business_trip.destinationLat/PlaceId=null`
- `060d0483…` "The DC Adventure" — `destination_text="Washington DC, USA"`, departure null/null
- `9a9c406c…` (Untitled, scheduled) — `destination_text="Tulum, Quintana Roo, Mexico"`, departure null
These are exactly the rows the edit-screen gate will now block from re-save until both fields are picked, and the backfill targets (destination coords). No writes performed (read-only).

---

## 7. HITL — on-screen confirmation for Seth (unblocks full PASS)

The worktree Metro is live on **port 8085** and the business dev-client on the iPhone 17 Pro sim has the ORCH-1118 bundle loaded (sign-in screen). To convert SC-5/6/7/8 from `probable` → `proven`:

1. On the sim's Mingla Business sign-in screen, **log in** (the brand owning "The Sone" / "The DC Adventure" is `becddd00-85b1-4c95-81ba-f888954a4fa7`).
2. Open a **published/scheduled trip** → **Edit** → expand **Basics**. Confirm **Departing from** and **Destination** show the **Mapbox autocomplete dropdown** (type 3+ chars → suggestions appear), NOT a plain text box.
3. With Destination as free text (no pick) and Departure empty, tap **Save changes** → confirm it does **NOT** open the change-summary modal, the basics section stays expanded, the inline "Pick the … from the suggestions." errors show, and the toast fires.
4. **Pick** a real Destination suggestion AND a real Departure suggestion → **Save** → confirm the change-summary modal opens and the save completes.
5. (DB persist) After saving, the row's `theme.business_trip.destinationPlaceId/Lat/Lng` (and departure*) should be non-null — I can re-query read-only to confirm once you've saved.

If steps 2-4 behave as described, this flips to **PASS**.

---

## 8. Constitution 14-rule matrix (independent re-check vs the diff)

| # | Rule | Result | Evidence |
|---|------|--------|----------|
| 1 | No dead taps | **PASS** | swapped field is the section's own content, error-section auto-expands on block; no unmounted target (§6, P4-2) |
| 2 | One owner per truth | **PASS** | single `tripLocationValidated.ts` predicate; both screens import it (no duplicated validation) |
| 3 | No silent failures | **PASS** | block path shows inline error + toast + jump/expand; no swallowed catch added |
| 4 | One query key per entity | **N/A** | no query keys touched |
| 5 | Server state server-side | **N/A** | no Zustand/server-state change |
| 6 | Logout clears everything | **N/A** | no auth/session change |
| 7 | Label `[TRANSITIONAL]` | **N/A** | no transitional code introduced |
| 8 | Subtract before adding | **PASS** | edit screen removed plain TextInputs while adding the picker (net swap, not additive) |
| 9 | No fabricated data | **PASS** | backfill writes ONLY confident geocodes; ambiguous → flagged null, never guessed |
| 10 | Currency-aware | **N/A** | no money/currency surface |
| 11 | One auth instance | **N/A** | no auth code; buyer-web anon-tolerance not touched (business-only screens) |
| 12 | Validate at the right time | **PASS** | gate fires at publish/save (the right moment), errors revealed only after a blocked attempt (`showAddressErrors`/`showEditAddressErrors`), not pre-emptively |
| 13 | Exclusion consistency | **N/A** | no exclusion lists |
| 14 | Persisted-state startup | **N/A** | no hydration gate touched |

No violations → no automatic P0.

---

## 9. Device / parity matrix

| Surface | Result | Note |
|---------|--------|------|
| Consumer iOS | **N/A (skip)** | read-only beneficiary; no trip authoring path |
| Consumer Android | **N/A (skip)** | same |
| Buyer/anon Web | **N/A (skip)** | no trip address authoring |
| Business iOS | **PROBABLE** | worktree bundle loaded + ran on iPhone 17 Pro sim (5204 modules); swap strings present in bundle; on-screen dropdown/pick/save behind auth wall → HITL §7 |
| Business Android | **PARITY (automatic)** | shared RN code, no `Platform.OS` branch in the new logic; physical Samsung `R58R54YV7JT` connected but same auth wall — not separately driven (shared-code parity, gated only by login) |
| Admin Web | **N/A (skip)** | no trip address authoring |
| Business Web preview (adjacent) | **PARITY (automatic)** | same RN components; the validated-pick gate is platform-agnostic |

Physical-iPhone HITL: the runtime on-screen drive is the §7 ask (login required). No fabricated "skipped/TBD" — it is an explicit HITL ask with the unblock steps.

Edge-fn live deploy state: **N/A** — no edge function changed (`mapbox-geocode` consumed unchanged; `verify_jwt` values untouched).

---

## 10. Independent test results (re-run, not trusted)

- **5 ORCH-1118 trip suites together:** `tripLocationValidated` + `TripCreatorStep1Basics.mapbox` + `EditPublishedTripScreen.mapbox` + `orch1118Backfill.dryrun` + `tripLocationGate.adversarial` (mine) → **36 passed, 36 total** (31 implementor + 5 mine).
- **4 business desktop-web contract gates** (`[[feedback_mingla_business_desktop_web_contracts]]`): `useResponsiveLayout` + `BottomNavWebDesktopPolish` + `wizardDesktopLayout` + `homeKpiPresentation` → **17 passed**; strict-grep `orch-0885-a-no-bottomnav-on-wide-desktop.mjs` → "gate passed". No desktop-contract regression.
- **Typecheck:** `tsc --noEmit` → **zero errors in any ORCH-1118 touched file**. Pre-existing unrelated baseline errors persist (D-1) — present on origin/main, not introduced here.
- **Do-not-touch git-diff-empty:** confirmed EMPTY for all 5 do-not-touch path globs (SC-11).

---

## 11. Discoveries for Orchestrator

- **D-A:** Two anchor-side Metro/expo instances were already squatting ports 8082/8083 (`/Users/.../mingla-main/mingla-business`). I served the worktree on a free 8085. Not a defect — flagging that the anchor Metro on 8082 serves MAIN code, so any "load latest bundle" check on the device must point at the worktree Metro (8085), not 8082, to see ORCH-1118 changes. (Worktree `node_modules` symlinks to the anchor's — bundles compile from worktree source correctly.)
- **D-B:** The implementor's D-1 (pre-existing `mingla-business` tsc baseline of unrelated errors — checkout buyer pages, marketing composer, `packages/phone-input`/`brand-rendering` react resolution, event category fixtures) is real and confirmed; the business package does not enforce a clean `tsc --noEmit` gate. Future hygiene pass; does not block ORCH-1118.
- **D-C:** The backfill live run remains operator-gated (no secrets in session); the flagged report is a placeholder the script overwrites on first run. Confidence-gate + idempotency proven via fixtures only — recommend Seth run the dry-run first and eyeball `ORCH-1118_BACKFILL_FLAGGED.md` before `--live`.

---

## 12. Accepted conditions (CONDITIONAL PASS)

The single condition holding this below full PASS is the **auth-gated on-screen runtime drive** of the edit/create screens (SC-5/6/7/8 on-screen firing + DB persist). It is NOT a code defect — it is a HITL login dependency (§7). Two resolutions:
- **(preferred)** Seth runs the §7 steps on the live sim (bundle already loaded) → flips to PASS, route to CLOSE.
- **(or)** Seth explicitly accepts the `probable`-level runtime evidence (bundle proven loaded + swap strings present + no dead-tap pattern + identical shipped component + green jest + fails-on-revert) as sufficient given this is a verbatim reuse of an already-shipped, already-runtime-proven picker — then CLOSE.

No P1/P2 defects to accept. Zero REWORK items.

---

*TEST complete. Verdict CONDITIONAL PASS pending the §7 HITL on-screen confirmation (or explicit acceptance of probable-level runtime evidence). Adversarial test committed `54da7708b`. No product code modified; all revert edits restored; do-not-touch clean.*

---

# RETEST (2026-06-12) — runtime render-proof of the published-edit screen

**Skill:** mingla-tester (business side) · RETEST mode · gap-closer for the prior CONDITIONAL PASS
**Goal given:** convert SC-5/6/7/8 from `probable` → `proven` with a genuine RUNTIME mount of `EditPublishedTripScreen` (kill the dead-tap / conditional-unmount class) instead of source-grep; drive the sim as far as auth legitimately allows. No auth bypass / no key exfiltration.
**Render-proof test:** `mingla-business/src/components/trip/__tests__/EditPublishedTripScreen.render.test.tsx` — committed `b6385ec71`.
**Comms ledger:** re-read on entry. COMMS-0024 (WARN/ALL, ORCH-1116 three-way ID collision) re-factored — ORCH-1118 keeps its number (own worktree, no renumber). No BLOCK rows for tester / ORCH-1118 / ALL. The P1 found below is internal to ORCH-1118 (no cross-ORCH blast) → no new ledger entry.

## R0. REVISED VERDICT

**FAIL** — P0: 0 · **P1: 1** · P2: 0 · P3: 0 · P4: 2 (carried)

The runtime render-proof did what source-grep could not: it MOUNTED the real screen and **found a genuine P1 dead-render defect** the prior (source-only) pass missed. The swap is structurally correct and the save GATE fires, BUT the SPEC-required **inline field errors are a dead path on the edit screen after a blocked save** — `renderSectionBody`'s `useCallback` dependency array omits `showEditAddressErrors`, so the picker's `error` prop is computed from a stale closure and never updates when the gate sets the flag. Toast + gate-block both work; the inline error does not. This violates SC-6/SC-7 ("type-without-pick → inline error fires" / "save blocked … inline error") on the edit screen specifically.

→ **Routes to REWORK (implementor)**, not CLOSE. One-line fix (add `showEditAddressErrors` to the dep array). This supersedes the prior CONDITIONAL PASS.

## R1. What the render-proof PROVED (the dead-tap class is killed)

The test mounts the REAL `EditPublishedTripScreen` via `@testing-library/react-native` (RTL 14) with only the network/native boundary stubbed (supabase invoke, expo-router, safe-area, the non-basics accordion bodies, the react-query mutation hook, native-heavy chrome primitives Button/Toast/Icon/ConfirmDialog/Sheet). **NOT** mocked: the `MapboxAddressInput` chain (business wrapper → shared `@mingla/location-input` package), `tripLocationValidated`, the basics render JSX, `handleSavePress`, and the Save button. `react`/`react-native` are pinned to the business install (single-copy); only the renderer + RTL come from a worktree-local `.orch1118-testdeps` overlay (gitignored; never touches the anchor symlink).

Runtime results (dedicated config `jest.orch1118.render.cjs`):

| Case | Result | What it proves at runtime |
|------|--------|---------------------------|
| (a) MOUNTS both fields as MapboxAddressInput (combobox), not plain TextInput | **PASS** | `getAllByRole("combobox").length === 2`; both labelled "Departing from"/"Destination" with the picker's `accessibilityHint` ("…then pick one."). The swapped pickers MOUNT on the basics path — **the dead-tap / conditionally-unmounted-on-own-path risk is killed** |
| (b1-gate) free-text dest (no pick) + empty departure → Save blocks | **PASS** | tapping the real `edit-trip-save` does NOT open `ChangeSummaryModal`; the block toast fires. Gate FIRES at runtime |
| (b2-gate) validly-picked dest + EMPTY departure → Save still blocks | **PASS** | hard-required departure blocks even with a valid destination; modal stays shut |
| (c) both validly picked → Save proceeds | **PASS** | `ChangeSummaryModal` opens; no blocking errors |
| (b1-inline-error) blocked save reveals INLINE field errors [SPEC SC-6/7] | **FAIL** | the inline "Pick the … from the suggestions." errors do NOT render after a blocked save — **the P1 below** |

The "render-has-not-been-called"/empty-return symptom early on was RTL 14's async API (`render`/`fireEvent` are `async`); resolved by `await`. The screen mounts fully (no heavy-native-dep wall) once the boundary is stubbed.

## R2. P1-EDIT-STALE-ERROR (NEW — runtime-proven)

- **Evidence (runtime):** `EditPublishedTripScreen.render.test.tsx` case (b1-inline-error) FAILS — `Unable to find an element with text: "Pick the destination from the suggestions."` after a blocked Save, even though the gate fired (modal blocked) and the toast rendered. A direct runtime probe confirmed the mechanism: after a blocked press, departure-error count = **0**; after a SUBSEQUENT picker-field `changeText` (which mutates `editState`, a dep that IS in the array → recreates the callback), departure-error count = **1**.
- **Root cause (source, confirmed by the runtime probe):** `EditPublishedTripScreen.tsx:1097` `const renderSectionBody = useCallback(…, [editState, updateBasics, handleDaysChange, handleInclusionsChange, handlePricingChange, handleCoverChange, submitting, totalConfirmedOrders, soldCountByTier, trip, showToast])` — **lines 1441–1453 OMIT `showEditAddressErrors`**. The basics body reads `showEditAddressErrors` to compute each picker's `error` prop (lines 1172, 1215). Because the memoized callback is only recreated when a listed dep changes, after `handleSavePress` calls `setShowEditAddressErrors(true)` the body keeps rendering with the stale captured `false`, so `error` stays `undefined` and the inline error never appears.
- **Why source-grep QA missed it:** the prior pass marked SC-6/SC-7 "PASS (source)" because the `error={…showEditAddressErrors && !validated…}` JSX is literally present and correct in isolation. The defect is a React render-memoization stale-closure — invisible to grep, visible only at runtime mount. This is precisely the "interactive elements must fire — runtime proof, not source wiring" class.
- **Contrast (proves it's edit-screen-specific):** the CREATE wizard renders the same errors via `TripCreatorStep1Basics`, a real component that takes `showAddressErrors` as a **prop** and computes `departureError`/`destinationError` in render scope — so it re-renders correctly (create-side T-4/T-5 + the adversarial test stay green). Only the edit screen's memoized `renderSectionBody` is affected.
- **Impact (user):** on the published-trip Edit → Basics screen, a planner who taps Save with a dirty/empty departure or destination is correctly BLOCKED (modal won't open) and sees the toast, but the **per-field red "Pick the … from the suggestions." hint never appears** — so they're told "something's wrong" without the field-level pointer the SPEC requires. Degraded, not catastrophic (save is still correctly gated; money/data are safe), but it's a stated SC and a dead-render path.
- **Required fix:** add `showEditAddressErrors` to the `renderSectionBody` `useCallback` dep array (`EditPublishedTripScreen.tsx:~1453`). One line. (Optionally also `setOpenSection`/`setShowEditAddressErrors` are stable setters — only the read value `showEditAddressErrors` must be added.)
- **Retest:** re-run `npx jest --config jest.orch1118.render.cjs --runInBand` — case (b1-inline-error) must go green (and the other 4 stay green).

## R3. Fails-on-revert (the gate assertions genuinely exercise runtime)

I reverted the location gate in `handleSavePress` (replaced the `if (!destValid || !depValid)` condition with `if (false)`), re-ran the render-proof, and **(b1-gate) + (b2-gate) FLIPPED to FAIL** (the `ChangeSummaryModal` now opens because nothing blocks) while (a) and (c) stayed green (mount + valid-path are gate-independent). Restored the file → `git diff` empty → the 4 stable cases pass again. **Gate fails-on-revert verified at branch HEAD `73b3c29b4`.** (The b1-inline-error case is the standing P1 marker, red on HEAD by design until the dep is fixed.)

## R4. Sim drive (secondary evidence)

- Foreground-closed + relaunched the business dev-client (`com.sethogieva.minglabusiness`) on the iPhone 17 Pro sim (`17091E60-…`) pointed at the **worktree** Metro on **port 8085** (`exp+mingla-business://expo-development-client/?url=http://localhost:8085`). Screenshot: `Mingla_Artifacts/reports/orch1118_retest/sim_business_bundle.png` — the Mingla Business sign-in screen rendered (worktree bundle live).
- Served-bundle grep (HTTP 200, 31,067,122 bytes) confirms the device runs the ORCH-1118 swap: `"Pick the departure city from the suggestions"` ×1, `"Pick the destination from the suggestions"` ×1, `edit-trip-departure` testID ×1, save-toast ×2.
- On-pixel navigation past sign-in is still gated on Seth's interactive login (Apple/Google/Email OTP) — **not bypassed** (no key exfiltration, no forged session). This is no longer the gating residual: the render-proof exercised the edit-screen runtime behaviour directly (and the on-pixel path could not have revealed the stale-closure inline-error bug at all without a deep manual repro). The dead-tap / mount risk the HITL step was reserved for is now closed by R1.

## R5. Regression suites re-run (all green except the P1 marker)

- **5 existing ORCH-1118 default suites** (`tripLocationValidated` + `TripCreatorStep1Basics.mapbox` + `EditPublishedTripScreen.mapbox` + `orch1118Backfill.dryrun` + `tripLocationGate.adversarial`) → **36 passed / 36** under the default config (now with a `testPathIgnorePatterns` so the new RTL `.render.test.tsx` does NOT run under the node/ts-jest default — it has no RTL there — and runs only under the dedicated config).
- **Render-proof** (dedicated config) → 4 passed / 1 failed (the P1 marker).
- **4 business desktop-web contract gates** (`useResponsiveLayout` + `BottomNavWebDesktopPolish` + `wizardDesktopLayout` + `homeKpiPresentation`) → **17 passed**; strict-grep `orch-0885-a-no-bottomnav-on-wide-desktop.mjs` → "gate passed". No desktop-contract regression.

## R6. Hygiene / what was added (no product code touched)

- **Committed (`b6385ec71`):** the render-proof test + its README, the dedicated `jest.orch1118.render.cjs` + `jest.orch1118.babel.cjs`, a `testPathIgnorePatterns` line in `jest.config.cjs`, and a `.gitignore` entry for the overlay. Append-only-safe (new test file = status A; README under `__tests__` = status A; configs are not test files).
- **NOT committed / gitignored:** `mingla-business/.orch1118-testdeps/` (262-package overlay installed via `npm install --no-save` into a worktree-local dir — the business `node_modules` is a symlink to the anchor, so the overlay deliberately avoids polluting the shared anchor).
- **Product code:** byte-unchanged. The gate-revert was on a working copy and restored (`git diff` empty). Do-not-touch paths (`packages/location-input`, business `MapboxAddressInput` wrapper, `ExperienceStopCard`, ORCH-1016 trigger, `biz_update_live_trip`, migrations, edge fns) untouched.

## R7. Honest limits

- The render-proof mounts the screen with the **network/native boundary stubbed** (supabase invoke, expo-router, safe-area, react-query mutation, and the native-heavy chrome primitives + non-basics accordion bodies). The MapboxAddressInput chain, the gate, and the basics render are REAL. A real Mapbox suggestion network round-trip + a real `biz_update_live_trip` DB persist are NOT exercised by this test (those remain covered by the backfill dryrun fixtures + the create-side flow + the served-bundle proof) — but they were never the dead-tap risk.
- The business package genuinely has **no RTL / react-test-renderer / RN jest preset installed** and its `node_modules` is an anchor symlink. The proof therefore runs under a dedicated config + a gitignored worktree-local overlay rather than the package's default node/ts-jest jest. This is a faithful runtime mount (React 19.1 + RTL 14 `test-renderer`), not a simulated one — but it is NOT wired into the default `npm test` and would need the overlay re-installed to re-run (steps in the README).

## R8. FINAL verdict (supersedes §1)

**FAIL — 1×P1 (P1-EDIT-STALE-ERROR), runtime-proven.** The swap mounts correctly and the save gate fires (the dead-tap/unmount risk is dead), but the SPEC-required inline field errors are a stale-closure dead-render on the published-edit screen. Route to REWORK: add `showEditAddressErrors` to the `renderSectionBody` `useCallback` dep array in `EditPublishedTripScreen.tsx` (~L1453), then re-run the render-proof (b1-inline-error must go green). The on-pixel HITL behind Seth's login is no longer required to reach a verdict — the render-proof exercised and falsified the runtime behaviour directly.

*RETEST complete. Render-proof committed `b6385ec71`; gate fails-on-revert verified at `73b3c29b4`. No product code modified.*
