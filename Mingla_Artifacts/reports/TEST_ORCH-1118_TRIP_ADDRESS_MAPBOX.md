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
