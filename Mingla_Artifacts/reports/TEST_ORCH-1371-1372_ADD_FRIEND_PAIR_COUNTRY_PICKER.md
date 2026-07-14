# TEST — ORCH-1371 + ORCH-1372 (batched) — consumer country-picker hidden on iOS

- **Mode:** TARGETED + SPEC-COMPLIANCE (production gatekeeper). Batched: **ORCH-1371** [add-friend-country-picker-hidden] + **ORCH-1372** [pair-request-country-picker-hidden].
- **Worktree:** `~/Desktop/mingla-orchs/1371-[friend-country-picker-hidden]/` on branch `1371-friend-country-picker-hidden`.
- **Fix under test:** commit `0241d813e` (impl) atop parent `83997ba44`. Tester commit (adversarial test + CI): on-branch.
- **Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-1371-1372_ADD_FRIEND_PAIR_COUNTRY_PICKER.md`.
- **Comms ledger:** read on entry. No BLOCK rows. Factored OPEN/WARN→ALL: COMMS-0096 (version-parity — verified NO `app.json` touch), COMMS-0095 (doc-drift: phone bypass is POST-OAuth — confirmed at runtime, welcome screen is OAuth-only), COMMS-0084 (modal-over-modal / overlay-slot lesson — same bug class). No new COMMS discovery to file.

---

## 1. VERDICT: CONDITIONAL PASS — P0: 0 · P1: 0 · P2: 0 · P3: 1 · P4: 3

The fix is **PROVEN CORRECT at runtime on iOS** — the platform the bug lived on — across every applicable success criterion (picker appears in BOTH Add-friend and Pair-by-phone; typed phone survives the round-trip; picked country applies; the friends/pair sheet drops while the picker is up and re-presents on close without teardown; genuine reopen resets). Regression gate satisfied both ways (implementor structural gate + tester adversarial behavioral suite, each fails-on-revert). Zero P0, zero P1, zero P2.

**The single open condition (P3, cosmetic, source-safe):** the **Android** no-regression leg (SC-2 / SC-7 + the SPEC-Q1 flicker-on-restore watch) could **not** be runtime-verified — the only available Android consumer dev build (emulator, versionName 1.1.0) and the physical Galaxy A72 (production 1.1.2, non-debuggable) both cannot load the fix's JS bundle: the emulator dev build red-boxes on the pre-existing **ORCH-1317 / COMMS-0084** `react-native-keyboard-controller` native-link gap (`_layout.tsx:39`), unrelated to this fix. Android is otherwise source-safe (shared JS, NO `Platform.OS` fork; mirrors the `AccountSettings` gate that already ships on Android). This needs Seth's acceptance (or a fresh Android consumer dev build / a 30-second device eyeball) to fully seal → per protocol I surface it rather than auto-routing to CLOSE.

---

## 2. Success-criteria matrix (runtime/live-fire evidence per row)

Live-fire device: **iPhone 17 Pro Max, iOS 26.4** (sim `2C3312D9`), consumer dev build loading the **worktree's latest bundle from Metro :8095**. Authenticated flow reached via the operator's own cached Google session (`sethogieva@gmail.com`) — strictly read-only (pickers opened, test phone typed, country picked; **no** friend request / invite ever sent, **zero** data mutated). Screenshots in `Mingla_Artifacts/evidence/ORCH-1371/test_ios_*`.

| SC | Criterion | Verdict | Evidence |
|----|-----------|---------|----------|
| SC-1-iOS (1371) | Add-friend chip tap → picker APPEARS | **PASS (proven)** | `test_ios_20_picker_via_label.png` — "Select Country" full-screen picker up; US +1 checked. (Pre-fix: nothing.) |
| SC-2-Android (1371) | Same tap on Android still works | **BLOCKED (source-safe, probable)** | `test_android_00_boot.png` — emulator dev build red-boxes on the ORCH-1317 keyboard-controller gap; cannot load the fix bundle. Shared JS, no platform fork; iOS-proven-identical code. |
| SC-3 (1371 round-trip) | Typed phone intact + picked country applied on return | **PASS (proven)** | Typed `7700900123` (`test_ios_15`), picked UK+44 → `test_ios_22_roundtrip_result.png`: chip 🇬🇧 +44, field still `7700900123`. E.164 → `+447700900123`. |
| SC-4 (1371 gate) | Picker open → friends sheet dropped (not co-present), re-presents on close, flow not torn down | **PASS (proven)** | Maestro hierarchy dump while picker up: only the picker window present, friends sheet ABSENT (dropped). On close, friends sheet re-presents on the Friends tab, friend list (Seth O / Ari O.) intact — `test_ios_22`. |
| SC-5 (1371 reopen) | Full close + reopen → empty field + default country | **PASS (proven)** | `test_ios_23_reopen_reset.png` — after swipe-close + reopen: empty "Phone number", chip reset to 🇺🇸 +1. |
| SC-6-iOS (1372) | Pair-by-phone chip tap → picker APPEARS | **PASS (proven)** | `test_ios_28_pair_picker_appears.png` — picker up over the Pair modal. (Pre-fix: nothing.) |
| SC-7-Android (1372) | Same on Android | **BLOCKED (source-safe, probable)** | Same ORCH-1317 dev-build gap as SC-2. |
| SC-8 (1372 round-trip) | Phone + search survive; country applied; modal not torn down | **PASS (proven)** | Typed `5551234567` (`test_ios_27`), picked Nigeria+234 → `test_ios_29_pair_roundtrip.png`: chip 🇳🇬 +234, field `5551234567`, "YOUR FRIENDS" list + section intact (not torn down). |
| SC-9 (comment truth) | No "Batch-4 … proven to work" claim; new note refs AccountSettings + iOS one-modal | **PASS (source)** | `AddFriendView.tsx` comment replaced (diff verified); WaveCBatch3 prose amended. |
| SC-10 (guard) | Gate passes on fixed tree, FAILS on revert; `--self-test` passes | **PASS (proven)** | `--self-test` 8/8; independent fails-on-revert re-run (§4). |
| SC-11 (parity untouched) | No `app.json` change; parity gates green | **PASS (proven)** | `git diff origin/main...HEAD --name-only` shows NO `app.json`. |

Adversarial (SPEC §7): no double-picker on rapid double-tap → `test_ios_30_double_tap.png` (single clean picker). Picker X-close restores the Pair modal with state intact → `test_ios_31_pair_xclose_restore.png`. No cross-user `addFriendPhone` leak → source-verified transient `useState`, never persisted (no AsyncStorage/Zustand/queryKey). Background/foreground preservation → source-reasoned (component-state survives backgrounding; app not killed) — not device-cycled.

---

## 3. Findings (P-numbered)

### P3-1 — Android no-regression runtime BLOCKED by the ORCH-1317 dev-build gap (cosmetic, source-safe)
- **Evidence:** `test_android_00_boot.png` — Pixel_8_Pro emulator consumer dev build (versionName 1.1.0) red-boxes: *"The package 'react-native-keyboard-controller' doesn't seem to be linked"* at `KeyboardRoot.native.tsx:6` → `_layout.tsx:39` when loading the worktree bundle from Metro :8095. Physical A72 = production 1.1.2 (`flags=0x0`, non-debuggable) → cannot attach a dev bundle. No newer Android consumer dev build available in the worktree or on disk.
- **Impact:** SC-2 / SC-7 (picker still appears on Android) and the SPEC-Q1 flicker-on-restore watch are not runtime-confirmed. Risk is bounded to a **cosmetic flicker** on sheet-restore — functionality is source-safe: the fix is shared JS with **no `Platform.OS` branch**, iOS-proven on the identical code path, and mirrors the `AccountSettings` gate already shipping on Android.
- **Required fix:** none in code. Operator-unblock: a fresh **Android consumer dev build** (EAS cloud) installed on an emulator/device to re-run SC-2/SC-7 + the flicker watch, OR a Seth device eyeball on Android. If a flicker IS observed on restore, the SPEC-Q1 evidence-gated fallback is a `Platform.OS === 'ios'` guard on the gate disjunct — report, do not pre-apply.
- **Retest:** run the branch on an Android build that links `react-native-keyboard-controller`; repeat TC-1..TC-3 (Add friend) + TC-6/TC-7 (Pair) and watch the sheet-restore transition.

### P4-1 — Praise: clean, disciplined mirror of the proven AccountSettings pattern
The hoist-to-owner + gated-sibling + swallow-for-child-close is a faithful, minimal reproduction of the runtime-proven `AccountSettings.tsx:638-683` pattern. State ownership sits in the component that does not unmount during the sheet drop; the reset effect is correctly keyed on `showFriendsModal` (not the child-open gate). Zero scope creep — every changed line maps to a SC.

### P4-2 — Praise: honest runtime-cap in the implementation report
The implementor explicitly capped the iOS picker-appears claim at "source + gate" and did not fake a runtime pass when the OAuth wall blocked them (§9). Correct discipline; this test closed that gap.

### P4-3 — Note: WaveCBatch3 AF-2 amendment is legitimate (append-only bless required at CLOSE)
The implementor flipped AF-2 from asserting the picker STAYS in `AddFriendView` to asserting it must NOT — carrying `[TEST-MOD-APPROVED ORCH-1371]`. My iOS runtime proof independently confirms the old assertion pinned a **provably-false** structure (a co-present picker never appears on iOS). The amendment is correct; orchestrator should bless it at CLOSE per SPEC Q2.

---

## 4. Step 0.5 — independent re-run of the implementor's fails-on-revert proof

I checked out the **pre-fix** (parent `83997ba44`) versions of the three component files and ran the implementor's structural gate, then restored `HEAD`:

- **Pre-fix tree** → `node .github/scripts/strict-grep/orch-1371-1372-picker-not-copresent-with-sheet-modal.mjs` → **exit 1**, failing **INV-1** (AddFriendView renders `<CountryPickerModal>` + owns `showCountryPicker`/`setShowCountryPicker`), **INV-2** (ConnectionsPage lacks the sibling picker + `addFriendPickerOpen` disjunct), **INV-3** (PairRequestModal sheet is bare `visible={visible}`).
- **Restored fixed tree** → **exit 0** (PASS).
- **`--self-test`** → **8/8 PASS** (good structure + comment-only mention + each revert variant).
- Git status clean after restore.

`fails-on-revert verified` at fix `0241d813e` vs parent `83997ba44` — independently reproduced (not trusting the implementor's claim).

---

## 5. Adversarial test added (tester-owned, different angle, on-branch, in-diff)

- **Path:** `app-mobile/src/components/__tests__/orch_1371_1372_picker_behavior.adversarial.test.ts` (NEW, append-only).
- **CI:** `.github/workflows/orch-1371-1372-tester-adversarial.yml` (NEW, PR-blocking, pinned Deno, path-triggered on the 3 components + the test).
- **Different angle vs the implementor's structural gate:** the gate only checks picker HOIST/RENDER/GATE presence/absence. This suite locks the **behavior** the gate is blind to:
  - **Part A (executable state-machine model):** picker-open drops the sheet + preserves the typed phone; close restores + applies the country + keeps the phone; a genuine reopen clears — **plus a counter-model proving that keying the reset on `anyFriendsChildOpen` WOULD wipe the phone** (the SC-3 regression the structural gate passes clean).
  - **Part B (source weld, fails-on-revert):** reset effect keyed on `[showFriendsModal]` and NOT `[anyFriendsChildOpen]`; hoisted controlled props wired; AddFriendView phone fully prop-controlled with no orphan `setPhoneNumber`; **PairRequestModal SWALLOWS the suppress-for-child close** (`onClose={handleSheetClose}` with a `showCountryPicker` early-return, NOT the bare `handleClose` teardown path).
- **fails-on-revert verified at `0241d813e`:** on the fixed tree **8/8 PASS**; on the pre-fix tree (`83997ba44` checkout of the 3 components) the four Part-B source-weld tests (**ADV-B1/B2/B3/B4**) FAIL while the four Part-A model tests pass; restored → 8/8.
- **Closing-diff check:** `git diff origin/main...HEAD --name-only` shows BOTH the implementor gate (`orch-1371-1372-picker-not-copresent-with-sheet-modal.mjs`) AND the tester adversarial suite — regression gate satisfied.

---

## 6. Constitution 14-rule matrix

| # | Rule | Verdict | Evidence |
|---|------|---------|----------|
| 1 | No dead taps | **PASS** | Chip tap fires the picker at runtime (iOS proven, both flows). |
| 2 | One owner per truth | **PASS** | Add-friend transient phone/country/flag now owned solely by ConnectionsPage; AddFriendView reads props. Pair state owned by PairRequestModal. No competing writers. |
| 3 | No silent failures | **PASS** | No swallowed errors introduced; picker present/absent is deterministic on the gate. |
| 4 | One query key per entity | **N/A** | No query keys touched. |
| 5 | Server state stays server-side | **PASS** | Hoisted state is ephemeral UI input (`useState`), never server data. |
| 6 | Logout clears everything | **PASS** | `addFriendPhone` is transient `useState` (not persisted); reset fires on Friends-modal reopen; no cross-user leak (source-verified). |
| 7 | Label temporary `[TRANSITIONAL]` | **N/A** | No transitional code introduced. |
| 8 | Subtract before adding | **PASS** | Fix DROPS the sheet's modal window before presenting the picker (subtract-before-adding); false comment removed. |
| 9 | No fabricated data | **N/A** | No data rendered/fabricated. |
| 10 | Currency-aware | **N/A** | No currency. |
| 11 | One auth instance | **N/A** | No auth touched. |
| 12 | Validate at the right time | **N/A** | No datetime logic. |
| 13 | Exclusion consistency | **N/A** | — |
| 14 | Persisted-state startup (`_hasHydrated`) | **PASS** | No new persisted state; hoisted state is in-memory only. |

No violations.

---

## 7. Device / parity matrix

| Surface | Result | Detail |
|---------|--------|--------|
| **Consumer iOS** | **PASS (proven)** | iPhone 17 Pro Max iOS 26.4, worktree bundle via Metro :8095, authenticated. All applicable SCs live-fired (§2). |
| **Consumer Android** | **BLOCKED (source-safe / probable)** | Emulator dev build + physical A72 both cannot load the fix bundle (ORCH-1317 native-link gap / non-debuggable prod). Shared JS, no platform fork; iOS-proven-identical code. Operator-unblock ask in P3-1. |
| Buyer/anon Web (mingla-business) | **N/A** | No consumer friends/pair flow. |
| Business iOS | **N/A** | Separate app. |
| Business Android | **N/A** | Separate app. |
| Admin Web | **N/A** | No friends/pair UI. |
| Business Web preview | **N/A** | No consumer friends flow. |
| Physical iPhone (HITL) | **Not required** | iOS fully live-fired on sim; no physical-iPhone-only behavior in scope. |
| Edge-fn live deploy | **N/A** | No DB/edge/migration change. |

Also green: sole-gorhom invariant gate (`meta-orch-0991-base-bottom-sheet-sole-consumer.mjs` — BaseBottomSheet remains the sole gorhom importer); amended `WaveCBatch3.test.mjs` suite PASS.

**Environment blocker RESOLVED (not deferred):** the iOS sim initially red-boxed on the same ORCH-1317 keyboard-controller gap (stale Jul-5 build); I resolved it by installing the newer Jul-10 consumer binary onto the test sim (`simctl install`), which cleared the red-box and let the fix bundle boot cleanly — then reached the authenticated flow via the operator's cached Google session. iOS OAuth was NOT a blocker in the end.

---

## 8. Discoveries for Orchestrator

1. **ORCH-1317 Android dev-build gap is now the limiting factor for Android live-fire** (COMMS-0084 lineage). No consumer Android dev build that links `react-native-keyboard-controller` is available locally; the emulator's 1.1.0 build and the A72 prod build both cannot exercise fixes on Metro. A fresh EAS **cloud** Android consumer dev build would unblock all future Android QA — worth cutting one and keeping it installed.
2. **iOS sim binaries drift stale** — the Jul-5 build red-boxed; the Jul-10 build works. Keep the test sims on a current dev binary or the first bundle load always red-boxes on the keyboard-controller gap.
3. **Consumer welcome screen is OAuth-only** (no phone-bypass affordance) — confirmed at runtime, matching COMMS-0095. The store-review phone bypass (+12015550199 / 123456) is a POST-OAuth onboarding step; a demo login needs OAuth first. Worth documenting the cached-session path for future consumer QA.

---

## 9. Accepted conditions (CONDITIONAL PASS)

One condition, **NOT yet accepted by Seth** (surfaced, not auto-CLOSED):
- **Android runtime no-regression (SC-2 / SC-7 + SPEC-Q1 flicker-on-restore)** — source-safe (shared JS, no `Platform.OS` fork, iOS-proven-identical code, AccountSettings ships the pattern on Android), risk bounded to a cosmetic flicker. Blocked by the ORCH-1317 Android dev-build gap. Seal via a fresh Android consumer dev build / device eyeball, OR accept the deferral given the source-safety + cosmetic-only risk.

---

## 10. Routing

- **iOS fix:** PASS — proven at runtime across all SCs.
- **Overall:** **CONDITIONAL PASS** — surfaces to Seth for the Android-runtime condition. On Seth's acceptance (or a fresh Android dev build / device eyeball), routes to **CLOSE**: flip `I-PROPOSED-1371-PICKER-NOT-COPRESENT-WITH-SHEET-MODAL` DRAFT→ACTIVE, bless the WaveCBatch3 AF-2 append-only amendment, per-platform consumer OTA (never `--platform all`), COMMS entry, registry/World-Map sync, reap worktree.
