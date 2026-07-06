# IMPLEMENTATION — ORCH-1315 + ORCH-1314 (joint) — paywall presents from the preferences sheet

- **ORCH-IDs:** ORCH-1315 [preferences-custom-location-paywall-not-firing] (primary) + ORCH-1314 [preferences-sheet-curated-paywall-dead-gate] (folded in)
- **Worktree / branch:** `~/Desktop/mingla-orchs/orch-1315-[preferences-custom-location-paywall-not-firing]/` on `orch-1315-preferences-custom-location-paywall-not-firing`
- **Commit:** `ea01e9ffa`
- **Specs:** `SPEC_ORCH-1315_CUSTOM_LOCATION_PAYWALL.md`, `SPEC_ORCH-1314_PREFERENCES_CURATED_PAYWALL.md`
- **Status:** implemented, partially verified — typecheck + both regression tests green + fails-on-revert proven for both fixes. **Runtime presentation of the overlay is TEST-gated** (on-device blocked by ORCH-1317 tooling gaps — New-Arch keyboard-controller link failure + bracketed-worktree watchman). No on-device confirmation claimed.

---

## 1. Summary (plain English)

A free user tapping the GPS "Use my current location" switch OFF, or interacting with the "See curated experiences?" section, got **no Mingla+ paywall** — the upsell silently never appeared. Both symptoms share ONE root cause: the paywall was a second RN `<Modal>` that iOS refuses to present over the preferences sheet's own `<Modal>` window (F-1). The fix gives `CustomPaywallScreen` an in-window overlay mode (`presentInline`) and mounts the single shared preferences paywall inside the sheet window, so it now slides over the open sheet. On top of that: the curated section's gate was wired to a dead `false` (so its banner never showed and nothing was gated) — now wired to the real `!canAccess('curated_cards')` signal, and the banner + Switch + experience pills all present the paywall for locked free users. And the locked GPS row is now fully tappable (was dead except the switch thumb). No pricing/gate policy changed — curated and custom-starting-point remain Mingla+-only.

---

## 2. SPEC success-criteria coverage

### ORCH-1315
| SC | Criterion | Status | How satisfied (commit `ea01e9ffa`) |
|----|-----------|--------|------------------------------------|
| SC-1-iOS | Free user taps gated GPS affordance → paywall visible over sheet | implemented, runtime TEST-gated | `presentInline` overlay mounted INSIDE the BaseBottomSheet `wrapInRNModal` window (PreferencesSheet + CustomPaywallScreen) |
| SC-1-Android | Same on Android | implemented, runtime TEST-gated | Shared JS; Android Modal-stacking verified independently at TEST |
| SC-2 | Tapping LABEL/lock/row (not just thumb) presents paywall (F-3) | implemented, runtime TEST-gated | Whole locked GPS row is a `TouchableOpacity onPress={onLockedTap}` (PreferencesSectionsAdvanced) |
| SC-3 | Dismiss returns to sheet, selections intact | implemented, runtime TEST-gated | Overlay returns `null` on close; sheet is never unmounted (paywall is a child, `showPaywall` state only) |
| SC-4 | Mingla+ taps switch OFF → custom input, NO paywall | preserved | Gate policy untouched; `isLocked=false` → input renders; force-GPS effect unchanged |
| SC-5 | No regression on the other 7 paywall call sites | implemented (structural pin) | `presentInline` defaults `false` → those sites keep RN `<Modal presentationStyle="pageSheet">` byte-for-byte |
| SC-6 | `paywall_viewed`/`trackPaywallViewed` still fire | preserved | Analytics `useEffect(isVisible)` untouched; fires in both render modes |

### ORCH-1314
| SC | Criterion | Status | How satisfied |
|----|-----------|--------|---------------|
| SC-1 | Free user sees curated lock banner | implemented | Change 1: `isCuratedLocked={!canAccess('curated_cards')}` |
| SC-2 | Banner tap → curated paywall | implemented | Reachable after Change 1 (existing `onLockedTap`) |
| SC-3 | Switch tap → paywall, no `intentToggle` mutate | implemented | Change 2: `handleIntentToggleChange` short-circuits before mutation |
| SC-4 | Pill tap → paywall, no intent select (OQ-1=b) | implemented | Change 3: `handleIntentToggle` short-circuits before `setSelectedIntents` |
| SC-5 | Mingla+ → no banner, normal behavior | preserved | `isCuratedLocked=false` for Mingla+; handlers fall through |
| SC-6 | Read-only participant view → no paywall | preserved | `if (!isEditable) return` guard kept ahead of the gate in both handlers |
| SC-7 | GPS/`custom_starting_point` gate byte-unchanged | preserved | Its `onLockedTap` block untouched; only the row affordance is additive |

---

## 3. Files changed

| File | Δ (approx) | Kind |
|------|-----------|------|
| `app-mobile/src/components/CustomPaywallScreen.tsx` | +75 / −20 | product |
| `app-mobile/src/components/PreferencesSheet.tsx` | +45 / −8 | product |
| `app-mobile/src/components/PreferencesSheet/PreferencesSectionsAdvanced.tsx` | +38 / −16 | product |
| `app-mobile/src/components/__tests__/orch-1315-preferences-custom-location-paywall.test.tsx` | +150 (new) | test |
| `app-mobile/src/components/__tests__/orch-1314-preferences-curated-paywall-gate.test.tsx` | +155 (new) | test |

`PreferencesSheet/PreferencesSections.tsx` was **NOT** touched (curated pill gating done parent-side in `handleIntentToggle`, per spec preference — child stays presentational).

---

## 4. Data-model / edge / migration changes

None. Component layer only. No DB, RLS, edge function, service, hook, or migration changes. No operator `db push` or edge deploy required.

---

## 5. Regression tests added + fails-on-revert proof

Both new tests follow the sibling conventions (`orch-0943-…` source-structure `readSource`+`assert.match`; `PairingPaywall.orch1239` behavioral decision-model), each with a protective ORCH-tagged header comment and a `require.main === module` self-test. They run standalone via `npx tsx` (the runner that executes the existing `.tsx` self-tests in that folder; app-mobile has no jest).

- `orch-1315-preferences-custom-location-paywall.test.tsx` — pins: preferences paywall element carries `presentInline` + is mounted inside `<BaseBottomSheet>`; CustomPaywallScreen has the `presentInline` prop, `false` default, and the absolute opaque `inlineOverlay` branch; the locked GPS row is a `TouchableOpacity onPress={onLockedTap}` with button role + "Upgrade to set a custom starting point" label; behavioral GPS-locked-tap routing.
- `orch-1314-preferences-curated-paywall-gate.test.tsx` — Part A source pins (`isCuratedLocked={!canAccess('curated_cards')}` present, `isCuratedLocked={false}` absent, both handlers short-circuit to the paywall BEFORE mutation); Part B behavioral decision-model (T-2 free→paywall/not-mutated, T-3 read-only→no-paywall, T-4 Mingla+→mutated/no-paywall, T-5 pill parity).

**fails-on-revert — verified at commit `ea01e9ffa` (true line deletion, not comment-out):**
- ORCH-1315: delete the `presentInline` prop line from the preferences paywall → `orch-1315-*` exits **1**; restore → exits **0**.
- ORCH-1314 (line 1279): `isCuratedLocked={!canAccess('curated_cards')}` → `isCuratedLocked={false}` → `orch-1314-*` exits **1**; restore → exits **0**.
- ORCH-1314 (handler gate): remove the `!canAccess('curated_cards')` short-circuit from `handleIntentToggleChange` → `orch-1314-*` exits **1**; restore → exits **0**.

Both new test files are visible in `git diff origin/main...HEAD --name-only` on this branch. Append-only (no existing test modified/deleted).

---

## 6. Old → New receipts

### CustomPaywallScreen.tsx
- **Before:** always rendered a single RN `<Modal presentationStyle="pageSheet">`. Inside the preferences sheet's own RN Modal window, iOS silently dropped this nested modal — the paywall never appeared.
- **Now:** new optional `presentInline?: boolean` (default `false`). The paywall body is extracted into one shared `content` block. When `presentInline` is `false` → identical RN `<Modal>` (7 other call sites unchanged). When `true` → returns `null` while hidden, and while visible renders `content` in an opaque, absolutely-positioned `inlineOverlay` (`position:absolute; inset 0; #1C1C1E; zIndex/elevation 1000`) capped to one screen height at the top (`useWindowDimensions` + safe-area top), with a visible top-right close `X` (overlay mode has no OS swipe chrome). Analytics, purchase/restore, comparison table, packages, legal links, and `InAppBrowserModal` all preserved.
- **Why:** F-1 (iOS modal-over-modal). `I-PROPOSED-1315-PAYWALL-PRESENTS-FROM-SHEET`.

### PreferencesSheet.tsx
- **Before:** the shared `{paywall}` rendered OUTSIDE `<BaseBottomSheet>` as a nested RN Modal (never presented). `isCuratedLocked={false}` (dead) hid the curated banner; `handleIntentToggleChange`/`handleIntentToggle` had no gate — a free user could flip the Switch / select pills silently.
- **Now:** the single shared paywall element gets `presentInline` and is moved to the LAST child INSIDE `<BaseBottomSheet>` (mounts in the `wrapInRNModal` window). ORCH-1314 Change 1 wires `isCuratedLocked={!canAccess('curated_cards')}`; Changes 2 & 3 add a `!canAccess('curated_cards')` short-circuit (→ `setPaywallFeature('curated_cards'); setShowPaywall(true); return;`) to `handleIntentToggleChange` and `handleIntentToggle`, each after the preserved `if (!isEditable) return`, with `canAccess` added to deps.
- **Why:** F-1 presentation fix (both toggles) + ORCH-1314 F-1/F-2 reachability. GPS `onLockedTap` block and force-GPS effect untouched (SC-7).

### PreferencesSheet/PreferencesSectionsAdvanced.tsx
- **Before:** only the `Switch` `onValueChange` fired `onLockedTap`; the row/label/lock icon were dead taps (F-3).
- **Now:** row inner extracted to `gpsRowInner`; when `isLocked` the whole row is a `TouchableOpacity onPress={onLockedTap}` (`accessibilityRole="button"`, label "Upgrade to set a custom starting point", `minHeight:44`). Switch keeps its locked branch. Custom text input still hidden for locked users (`!useGpsLocation && !isLocked` unchanged).
- **Why:** F-3 dead-tap.

---

## 7. Cross-surface impact

| Surface | Affected | What changes | Parity |
|---------|----------|--------------|--------|
| Consumer iOS | YES | Paywall slides over the open preferences sheet; curated banner/switch/pills + whole locked GPS row now present it | shared JS |
| Consumer Android | YES | Same; Modal-stacking differs → verify independently at TEST | shared JS (manual per-surface verify) |
| Buyer/anon Web | NO | Consumer-only surface | n/a |
| Business iOS / Android | NO | Different app | n/a |
| Admin Web | NO | n/a | n/a |
| Business Web preview | NO | n/a | n/a |

The 7 other `CustomPaywallScreen` call sites (SwipeableCards, DiscoverScreen, ConnectionsPage, activity/SavedTab, activity/CalendarTab, profile/BillingSheet, app/index.tsx) are untouched and keep default `presentInline=false` RN Modal behavior.

---

## 8. Gate results

- **Typecheck:** `npx tsc --noEmit -p tsconfig.json` — **0 errors in the 3 touched product files** (876 pre-existing baseline errors elsewhere in the repo, none referencing these files; the added prop is optional so the 7 call sites cannot break).
- **Regression tests:** both new tests PASS via `npx tsx`; fails-on-revert proven (§5).
- **strict-grep `meta-orch-0991-base-bottom-sheet-sole-consumer.mjs`:** OK (no new `@gorhom/bottom-sheet` import added).
- **`orch_1244_paywall_subscription_title.test.mjs`:** PASS (subscription title preserved).
- **DIAG markers:** none.

---

## 9. Known issues / deferred / notes for TEST

1. **Runtime presentation is TEST-gated (not device-confirmed).** On-device verification is blocked by ORCH-1317 tooling gaps. The tester must free-tier live-fire on an iOS sim/device AND an Android emulator/device: confirm the overlay presents over the sheet for BOTH the GPS switch and the curated section (banner + Switch + pills), SC-1..SC-6 (GPS) + SC-1..SC-7 (curated), dismiss-returns-intact, and NO regression on the other 7 paywall sites.
2. **Overlay geometry choice (flag for the tester):** the inline overlay is a scroll-child inside gorhom's `BottomSheetScrollView`, so it is positioned relative to the scroll CONTENT. It uses opaque `inset:0` (covers the viewport at any scroll position) with the content itself capped to one window-height at the content top — chosen because the GPS + curated sections sit at the TOP of the sheet (the realistic trigger position). If the tester finds the paywall content off-screen when the sheet is scrolled far down before triggering, the fallback is to pass the paywall via BaseBottomSheet's `header` slot (viewport-relative, still in-window) — flagged, not applied, to keep the sheet's proven scroll layout branch unchanged.
3. **Legacy full-screen path (`visible===undefined`, app/index.tsx mount):** the same shared paywall now renders as an inline overlay there too (inside its own full-screen container — not a competing Modal window), which is correct and functional; worth a glance at TEST if that path is exercised.

---

## 10. Operator action required

None for the implementor phase. No migration, no edge deploy. Route back to orchestrator REVIEW → mingla-tester (free-tier live-fire iOS + Android) → CLOSE (flip `I-PROPOSED-1315-PAYWALL-PRESENTS-FROM-SHEET` + `I-PROPOSED-1314-PREFERENCES-PAYWALL-GATE-REACHABLE` DRAFT→ACTIVE, reap worktree).

---

## 11. Discoveries for orchestrator

- **Systemic modal-over-modal risk (already flagged in SPEC_ORCH-1315 §2 non-goals):** `BillingSheet` / `ConnectionsPage` / `DiscoverScreen` present `CustomPaywallScreen` while themselves potentially inside a sheet/modal context. They were left on default Modal behavior per allowlist. If any of them are ever hosted inside a `wrapInRNModal` sheet, they will hit the same F-1 silent-drop and should adopt `presentInline`. Separate ORCH.
- No unrelated bugs introduced or found in-scope.
