# IMPLEMENTATION — ORCH-1371 + ORCH-1372 (batched) — consumer country-picker hidden on iOS

- **Mode:** IMPLEMENT (single pass; no deploy/merge/close).
- **Worktree:** `~/Desktop/mingla-orchs/1371-[friend-country-picker-hidden]/` on branch `1371-friend-country-picker-hidden` (rebased on `origin/main` `83997ba44` — already up to date).
- **Spec (binding):** `Mingla_Artifacts/specs/SPEC_ORCH-1371-1372_ADD_FRIEND_PAIR_COUNTRY_PICKER.md`.
- **Comms:** No BLOCK entries. COMMS-0096 (WARN/ALL — `I-RELEASE-VERSION-PARITY`) factored: this ORCH touches NO `app.json` (either app), so the parity gate stays green. All other OPEN rows are WARN/FYI addressed to ALL and unrelated to this component fix.
- **Label:** implemented and verified at source + gate + typecheck + structural-test level; **iOS runtime picker-appears claim capped** (authenticated flow unreachable this session — see §9). Android no-regression: source-safe (unconditional gate mirrors the Android-proven AccountSettings pattern); physical-device verification is the tester's.

---

## 1. Summary (plain English)

On the consumer app (iOS), tapping the flag/dial-code chip in **Add friend** (Friends page → Friends modal) and in **Pair with someone → Pair by phone** did nothing — the "Select Country" picker never appeared, because iOS shows only one modal window at a time and the picker was being opened *on top of* the sheet's own modal window (which iOS refuses). The fix drops the sheet's window for the moment the picker is up, then brings it back — exactly the pattern already shipping and working in Account Settings. The typed phone number and the picked country now survive that swap. No database, server, or app-version change; pure client-side React Native JS, consumer OTA-eligible per platform once merged.

---

## 2. SPEC success-criteria coverage

All code satisfied at commit `0241d813e` (single fix commit — hash filled in §11 after commit).

| SC | Criterion | Status | How verified |
|----|-----------|--------|--------------|
| SC-1-iOS (1371 picker appears) | Add-friend chip tap → picker appears | ✓ source + gate; ⚠ runtime capped | Picker hoisted to a SIBLING of the friends sheet + sheet gated closed via `anyFriendsChildOpen` (frees iOS's single modal slot). Mirrors the runtime-proven AccountSettings gate. Authenticated live-fire unreachable this session (§9). |
| SC-2-Android (1371 no regress) | Same tap on Android still works | ✓ source-safe | Same code both platforms; unconditional gate == AccountSettings, which ships this on Android. Physical Galaxy verification = tester. |
| SC-3 (1371 round-trip) | Typed phone intact + picked country applied after return | ✓ source | `addFriendPhone` + `addFriendCountry` live on `ConnectionsPage` (never unmounts during the sheet drop); reset effect keyed on `showFriendsModal` only, so it does NOT fire mid-round-trip. |
| SC-4 (1371 gate integrity) | Picker open → friends sheet dropped, not torn down; re-presents on close | ✓ source | `addFriendPickerOpen` added to `anyFriendsChildOpen`; `handleFriendsModalClose` still swallows the suppress-for-child close. |
| SC-5 (1371 reopen semantics) | Full close + reopen → empty field + default country | ✓ source | B-5 `useEffect([showFriendsModal])` resets phone + country + picker flag on the false→true edge only. |
| SC-6-iOS (1372 picker appears) | Pair-by-phone chip tap → picker appears | ✓ source + gate; ⚠ runtime capped | `PairRequestModal` sheet self-gated `visible={visible && !showCountryPicker}`. |
| SC-7-Android (1372 no regress) | Same on Android | ✓ source-safe | Same unconditional gate. |
| SC-8 (1372 round-trip) | Phone + search-query survive; country applied; modal not torn down | ✓ source | Component stays mounted (`showPairRequestModal` stays true); swallow-for-child `handleSheetClose` prevents `handleClose` from clearing state / calling parent `onClose`. |
| SC-9 (comment truth) | No "Batch-4 … proven to work" claim; new note refs AccountSettings + iOS one-modal | ✓ | AddFriendView `:15-20` replaced (A-1); WaveCBatch3 prose + AF section header amended. |
| SC-10 (guard) | Gate passes on fixed tree, FAILS on revert; `--self-test` passes | ✓ verified | `--self-test` 8/8 PASS; pre-fix tree FAIL (INV-1/INV-2/INV-3), fixed tree PASS. See §6. |
| SC-11 (parity untouched) | No `app.json` change; parity gates green | ✓ verified | `git diff` touches no `app.json`. `orch-1367-release-version-parity --self-test` and `orch-1369-release-submit-config --self-test` unaffected (files untouched). |

---

## 3. Files changed (7 modified + 1 new; +139 / −60 on tracked files, new gate 350 lines)

| File | Δ | Layer |
|------|---|-------|
| `app-mobile/src/components/connections/AddFriendView.tsx` | ~+30 / −44 | Component (ORCH-1371) |
| `app-mobile/src/components/ConnectionsPage.tsx` | +64 | Component (ORCH-1371 owner) |
| `app-mobile/src/components/PairRequestModal.tsx` | +14 / −3 | Component (ORCH-1372) |
| `.github/scripts/strict-grep/orch-1371-1372-picker-not-copresent-with-sheet-modal.mjs` | +350 (NEW) | CI gate |
| `.github/workflows/strict-grep-mingla-business.yml` | +13 | CI job |
| `.github/scripts/strict-grep/README.md` | +1 | Registry doc |
| `app-mobile/src/components/ui/__tests__/WaveCBatch3.test.mjs` | +14 / −10 | Structural test (AF-2 + prose) |
| `Mingla_Artifacts/INVARIANT_REGISTRY.md` | +6 | DRAFT invariant |

All within the SPEC §11 scoped allowlist. Nothing outside touched. No shared-package / onboarding / AccountSettings / BaseBottomSheet / app.json edit.

---

## 4. Data-model changes applied

None. No migration, RLS, edge function, service, hook, or realtime change. Component-layer + CI-tooling only.

---

## 5. Edge functions touched

None.

---

## 6. Regression tests — the fails-on-revert contract

**Primary CI-blocking guard (NEW):** `.github/scripts/strict-grep/orch-1371-1372-picker-not-copresent-with-sheet-modal.mjs`, wired PR-blocking as job `orch-1371-1372-picker-not-copresent` in `strict-grep-mingla-business.yml` (triggers on `app-mobile/**`), registered in the strict-grep README.

Assertions (comment-stripped reads): **INV-1** AddFriendView renders no `<CountryPickerModal>` and owns no `showCountryPicker`/`setShowCountryPicker`; **INV-2** ConnectionsPage renders `<CountryPickerModal>`, includes `addFriendPickerOpen` in `anyFriendsChildOpen`, keeps `visible={showFriendsModal && !anyFriendsChildOpen}` (no bare `visible={showFriendsModal}`); **INV-3** PairRequestModal gates `visible={visible && !showCountryPicker}` (no bare `visible={visible}`).

**`--self-test`:** PASS 8/8 (GOOD fixed structure + comment-only mention + reverted-picker-render + reverted-picker-flag + missing-sibling-picker + gate-missing-disjunct + ungated-friends-sheet + bare-PairRequest-visible).

**Fails-on-revert proof (captured BEFORE writing the fix — authentic pre-fix line-state, not a comment-out):**

```
$ node .github/scripts/strict-grep/orch-1371-1372-picker-not-copresent-with-sheet-modal.mjs   # PRE-FIX (buggy) tree
ORCH-1371-1372 I-PROPOSED-1371-PICKER-NOT-COPRESENT-WITH-SHEET-MODAL FAIL:
  INV-1: … AddFriendView.tsx MUST NOT render <CountryPickerModal> …
  INV-1: AddFriendView.tsx MUST NOT own showCountryPicker/setShowCountryPicker …
  INV-2: … ConnectionsPage.tsx MUST render <CountryPickerModal> …
  INV-2: the `anyFriendsChildOpen` expression MUST include `addFriendPickerOpen` …
  INV-3: … PairRequestModal.tsx MUST gate … visible={visible && !showCountryPicker} …
  INV-3 (adversarial): the PairRequestModal sheet MUST NOT use the pre-fix bare visible={visible} …
exit=1

$ node .github/scripts/strict-grep/orch-1371-1372-picker-not-copresent-with-sheet-modal.mjs   # AFTER the fix
ORCH-1371-1372 … PASS — AddFriendView hoists the picker, ConnectionsPage renders it as a gated sibling, and PairRequestModal self-gates its own sheet.
exit=0
```

`fails-on-revert verified` — pre-fix tree fails INV-1/INV-2/INV-3; the fix flips all to PASS. Reverting §4A re-fails INV-1, §4B re-fails INV-2, §4C re-fails INV-3.

**Structural suite amended (append-only bless required):** `app-mobile/src/components/ui/__tests__/WaveCBatch3.test.mjs` AF-2 changed from asserting the (provably-false) "picker stays in AddFriendView (Batch-4 precedent)" to asserting the picker is NOT in AddFriendView; prose comment + AF section header updated. This modifies an existing assertion → the fix commit body carries **`[TEST-MOD-APPROVED ORCH-1371]`** for `tests-append-only.yml`. Amended suite re-run: **PASS** (`CD, FH, MI, CP, AF — 4 modals + 1 sub-component`). Sole-gorhom gate re-run: **PASS** (BaseBottomSheet still the sole `@gorhom/bottom-sheet` importer; the picker is an RN `<Modal>`, not gorhom). Flag the AF-2 amendment for Seth at CLOSE (SPEC Q2).

---

## 7. Old → New receipts

### AddFriendView.tsx (ORCH-1371)
- **Before:** Owned `phoneNumber`, `selectedCountry`, `showCountryPicker` local state; rendered `<CountryPickerModal>` as a sibling *inside its own return* (co-present with the friends sheet's RN `<Modal>` on iOS → never appeared); carried a false comment claiming the "Batch-4 sub-picker stacks above the sheet" pattern.
- **Now:** Receives `selectedCountry` / `phoneNumber` / `onPhoneNumberChange` / `onOpenCountryPicker` as props; renders NO picker; the chip calls `onOpenCountryPicker`; the two clear-on-success calls + the field `onChangeText` call `onPhoneNumberChange`; `handleCountrySelect` removed (moved up); imports pruned (`CountryPickerModal`, `getDefaultCountryCode`, `getCountryByCode` gone; `CountryData` kept); false comment replaced with a 6-line accurate note referencing `AccountSettings.tsx:638-683` + the iOS one-modal constraint.
- **Why:** SC-1/3/4/9. A RN `<Modal visible={false}>` unmounts its children, so the transient state cannot live in a child that unmounts during the sheet drop.
- **Lines:** ~+30 / −44.

### ConnectionsPage.tsx (ORCH-1371 owner)
- **Before:** Rendered `<AddFriendView>` with 6 props; `anyFriendsChildOpen` did not include the add-friend picker; no country-picker imports/state.
- **Now:** Imports `CountryPickerModal` + `CountryData` + `getDefaultCountryCode`/`getCountryByCode`; owns `addFriendCountry` / `addFriendPhone` / `addFriendPickerOpen`; `anyFriendsChildOpen` includes `addFriendPickerOpen`; adds `handleAddFriendCountrySelect` + a `useEffect([showFriendsModal])` reset; passes the 4 new props; renders `<CountryPickerModal>` as a SIBLING immediately after the friends `</BaseBottomSheet>`.
- **Why:** SC-1/3/4/5. Owner does not unmount during the sheet drop → state survives; sibling picker presents into the freed iOS slot.
- **Lines:** +64.

### PairRequestModal.tsx (ORCH-1372)
- **Before:** `<BaseBottomSheet visible={visible} onClose={handleClose}>` — its picker co-present with its own sheet's RN `<Modal>` → never appeared on iOS; `handleClose` (which clears phone + calls parent `onClose`) was the sheet's `onClose`, so a suppress-for-child drop would tear down the whole flow.
- **Now:** `visible={visible && !showCountryPicker}`; new `handleSheetClose` swallows the close while the picker is open and is used ONLY on the sheet `onClose`; the header X keeps `handleClose` (genuine dismiss); the picker sibling + `handleClose`'s `setShowCountryPicker(false)` unchanged.
- **Why:** SC-6/8. Mirror of `AccountSettings.tsx:683` + `handleRootClose`.
- **Lines:** +14 / −3.

---

## 8. Cross-surface impact

| Surface | Affected | Parity |
|---------|----------|--------|
| Consumer iOS | YES — fix target | shared code |
| Consumer Android | YES — must not regress | shared code (no `Platform.OS` branch; mirrors Android-proven AccountSettings) |
| Buyer/anon Web (mingla-business) | NO — no consumer friends flow | n/a |
| Business iOS | NO | n/a |
| Business Android | NO | n/a |
| Admin Web | NO | n/a |
| Business Web preview | NO | n/a |

Parity is automatic (single shared RN codebase; no per-platform path).

---

## 9. Smoke / runtime result

**Environment:** two iOS sims booted (iPhone 17 Pro `17091E60…`, iPhone 17 Pro Max); consumer dev build `com.mingla.app.v2` installed. Metro started on this ORCH's dedicated port **8095** from the worktree (real `node_modules`, not a symlink) — an unrelated session on 8090 was left untouched. Metro stopped cleanly at the end (only the 8095 listener killed; 8090 confirmed still alive).

**What was proven at runtime (my `impl_*` screenshots):**
- The app **BUILDS and BOOTS cleanly** with all three modified files bundled — no redbox, no crash. (The one `StripeNativeProvider` symbolicated frame in the Metro log is a benign Stripe-handshake-skipped warning — `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY unset` — not a bundle failure; the app proceeded to render.)
- The app reached `WelcomeScreen (not authenticated)`; the Connections persisted-state keys my change interacts with (`connectionsFriendsModalTab`, `connectionsActivePanel`) hydrated without error (`[STORE] set(...)` in the Metro log). No JS-load regression from the fix.
- Evidence: `Mingla_Artifacts/evidence/ORCH-1371/impl_00_launch_state.png`, `impl_01_welcome.png`, `impl_02_welcome_dialog_dismissed.png`.

**Runtime claim capped (honest):** the picker-appears / round-trip flow (SC-1/3/4/6/8 at runtime) is in the **authenticated** app (Friends → Add friend / Pair). This session landed on the login screen, which offers only Apple / Google OAuth (needing credentials I do not have and will not enter) with **no phone-bypass affordance on the welcome screen**. So I could NOT drive the authenticated flow. I do **not** claim runtime proof that the picker appears — that is capped at "source + gate + typecheck + structural-test proven." The design is a byte-for-byte mirror of the AccountSettings gate that is already runtime-proven on this exact iOS surface (per the investigation).

**Not my evidence:** the evidence folder also contains `01_*`…`14_*.png` timestamped 17:40–17:53 (before the fix was written, ~18:00+). These are **forensics-era** artifacts I did not create and am **not** relying on as fix verification; provenance/what-they-show is the investigation's, not mine.

**Handed to the tester (device matrix):** SC-1/SC-6 iOS picker-appears live-fire via the demo account (phone bypass +12015550199 / code 123456, or Google `rambleawaypod@gmail.com`); SC-3/SC-8 round-trip; SC-4 gate integrity; SC-2/SC-5/SC-7 Android no-regression on the physical Galaxy A72; plus the SPEC §7 adversarial angles (sheet actually drops vs z-behind; no cross-user `addFriendPhone` leak; no double-picker on rapid double-tap; background/foreground preserves the applied country).

---

## 10. Known issues / deferred

- **No `[TRANSITIONAL]` code introduced.**
- **B-5 reset scope (SPEC Q3):** default preserves pre-1371 semantics (empty field + default country on Friends-modal reopen). If Seth prefers "retain last typed across reopen", drop the effect. No blocker.
- **Android unconditional gate (SPEC Q1):** per SPEC the gate is unconditional (no `Platform.OS`), mirroring AccountSettings. If the tester finds an Android flicker on restore, the evidence-gated fallback is to guard the disjunct to `Platform.OS === "ios"` — do NOT pre-empt without evidence.
- **iOS runtime not live-fired here** (auth-gated; see §9) — the tester owns the device matrix.

---

## 11. Operator action required

- **No migration; no edge deploy; no `db push`.** Pure client-side RN JS.
- **Next → orchestrator REVIEW**, then `mingla-tester`.
- **At CLOSE:** flip `I-PROPOSED-1371-PICKER-NOT-COPRESENT-WITH-SHEET-MODAL` DRAFT→ACTIVE; **bless the WaveCBatch3 AF-2 append-only amendment** (`[TEST-MOD-APPROVED ORCH-1371]` in the fix commit); per-platform consumer OTA (never `--platform all`); COMMS entry; registry/World-Map sync; reap worktree.
- **Fix commit hash:** `0241d813e` (this branch — filled below after commit).

---

## 12. Discoveries for orchestrator

- **Pre-existing project tsc baseline:** a full `tsc --noEmit` reports ~905 errors across the app-mobile codebase (large RN project). The ONLY error touching my files is a **pre-existing** `Map<…, GroupEventMeta>` type mismatch in `ConnectionsPage.tsx` (line 195 pre-fix → line 201 after my +5-line import insert; byte-identical message; confirmed via stash). My three files introduce **zero** new type errors. Not this ORCH's scope, but flagged.
- **Two-picker-implementation drift (from the investigation §7):** `packages/phone-input` still ships both `CountryPickerModal` (RN `<Modal>`) and `CountryPickerOverlay`; converging them is a separate deferred ORCH (explicitly OUT of this scope).
- **Consumer welcome screen has no phone-bypass affordance:** the store-review phone bypass (+12015550199) referenced in memory is not reachable from the current dev-build welcome screen (only Apple/Google OAuth shown). Worth confirming the demo-login path the tester will use.
