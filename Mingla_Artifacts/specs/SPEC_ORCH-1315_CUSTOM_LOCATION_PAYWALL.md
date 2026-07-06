# SPEC — ORCH-1315 [preferences-custom-location-paywall-not-firing]

- **Source investigation:** `Mingla_Artifacts/investigations/INVESTIGATION_ORCH-1315_CUSTOM_LOCATION_PAYWALL.md`
- **Worktree:** `~/Desktop/mingla-orchs/orch-1315-[preferences-custom-location-paywall-not-firing]/` on branch `orch-1315-preferences-custom-location-paywall-not-firing`
- **Confidence carried in:** root cause PROBABLE (F-1). The IMPLEMENT/TEST cycle MUST include a free-tier on-device live-fire to confirm (see §5, §10).

---

## 1. Executive summary

On the consumer preferences sheet, a free user who taps the "Use my current location" GPS switch OFF (to type a custom starting location — a Mingla+ feature) gets NO paywall. The handler chain is correct right up to `setShowPaywall(true)`; the break is at the iOS presentation layer: the preferences sheet renders inside an RN `<Modal>` (`BaseBottomSheet wrapInRNModal`), and `CustomPaywallScreen` is a SECOND RN `<Modal presentationStyle="pageSheet">`. iOS will not reliably present a second RN Modal over an already-presented one, so the paywall never appears (F-1). A secondary UX gap compounds it: the row/label/lock-icon are non-interactive, so the visually-natural tap targets are dead (F-3). This spec makes the paywall reachable and presentable from inside the sheet WITHOUT changing the gate policy (`custom_starting_point` stays Mingla+-only).

## 2. Scope & non-goals

**In scope**
- Make the `custom_starting_point` paywall actually present when a free user taps the gated GPS affordance in `PreferencesSheet`, on iOS and Android consumer.
- Fix the dead-tap affordance (F-3) so the natural target fires the paywall.

**Non-goals / explicitly NOT changed**
- The gate policy. `custom_starting_point` remains Mingla+-only; `useFeatureGate` / `tierLimits` / `get_effective_tier()` untouched.
- ORCH-1314's `curated_cards` toggle work (twin symptom, same sheet). Do NOT edit its scope. NOTE for REVIEW: the same `presentInline` mechanism will very likely also fix 1314 — coordinate, do not merge here.
- The systemic modal-over-modal risk in `BillingSheet` / `ConnectionsPage` / `DiscoverScreen` (Discoveries — separate ORCH).
- `BaseBottomSheet.tsx` internals.

**Assumption:** Seth's reported case is a free-tier account (`isLocked=true`). The tester confirms via live-fire (Q6). If the account was actually Mingla+, there is no toggle bug — but the F-1/F-3 fixes are still correct for real free users.

## 3. Cross-Surface Impact Declaration

| # | Surface | Covered | User-visible behavior demanded | Files touched | Parity |
|---|---------|---------|-------------------------------|---------------|--------|
| 1 | Consumer iOS (`app-mobile`) | YES | Tapping the gated GPS affordance presents the Mingla+ paywall over the open sheet | `CustomPaywallScreen.tsx`, `PreferencesSheet.tsx`, `PreferencesSectionsAdvanced.tsx` | shared JS |
| 2 | Consumer Android (`app-mobile`) | YES | Same; Android Modal-stacking differs, so verify independently | same | shared JS (manual per-surface verify) |
| 3 | Buyer/anon Web | NO | Preferences sheet is a consumer-app surface; not on web | — | n/a |
| 4 | Business iOS | NO | Different app | — | n/a |
| 5 | Business Android | NO | Different app | — | n/a |
| 6 | Admin Web | NO | n/a | — | n/a |
| 7 | Business Web preview | NO | n/a | — | n/a |

## 4. Layered specification

Only the **component** layer is affected (no DB/edge/service/hook/realtime changes).

### Component A — `CustomPaywallScreen.tsx` (add an in-window overlay render mode)

- **Add optional prop** `presentInline?: boolean` (default `false` → unchanged current behavior; every existing call site keeps its RN `<Modal>`).
- When `presentInline` is `true`: render the SAME paywall content NOT wrapped in an RN `<Modal>`, but in a plain full-screen absolutely-positioned `<View>` (StyleSheet `position:'absolute'`, inset 0, opaque `#1C1C1E` background, high `zIndex`/`elevation`), shown only while `isVisible` is true (return `null` when not visible). This keeps the paywall inside the CURRENT RN-Modal window (the sheet's `wrapInRNModal` window) instead of trying to open a second RN Modal — so it z-stacks above the sheet and actually appears.
- Preserve everything else: header, comparison table, packages, purchase/restore, legal links, `InAppBrowserModal` (which is itself an RN Modal — acceptable, it is opened by explicit user action, one-at-a-time), analytics (`paywall_viewed`), and `onClose` (a visible close affordance MUST exist in overlay mode since there is no OS swipe-to-dismiss chrome — reuse the existing `handleBar`/`handle` close and/or add a top-right close control).
- The two render branches SHOULD share one inner content block (extract to a local `renderContent()`), so Modal-mode and inline-mode are byte-identical in content.

> Illustrative only (≤3 lines): `return presentInline ? (isVisible ? <View style={styles.inlineOverlay}>{content}</View> : null) : <Modal visible={isVisible} ...>{content}</Modal>;`

### Component B — `PreferencesSheet.tsx` (opt into inline presentation)

- Pass `presentInline` to the paywall so it renders inside the sheet window. Two acceptable placements (implementor picks the one that renders inside the `wrapInRNModal` window — verify at runtime):
  1. Move `{paywall}` to render INSIDE the `<BaseBottomSheet>` children with `presentInline`, OR
  2. Keep it where it is but ensure the inline overlay mounts within the same RN-Modal window.
- The `onLockedTap` handler (`:1201-1205`) is otherwise unchanged (`setPaywallFeature('custom_starting_point'); setShowPaywall(true)`).

### Component C — `PreferencesSectionsAdvanced.tsx` (fix the dead-tap affordance, F-3)

- When `isLocked`, the natural tap target must fire `onLockedTap`. Make the GPS row (or at minimum the label + lock icon) a pressable that calls `onLockedTap` when `isLocked`. Keep the `Switch`'s existing `onValueChange` locked-branch. Preserve `≥44pt` touch target and an `accessibilityRole="button"` + label ("Upgrade to set a custom starting point").
- Do NOT show the custom text input for locked users (keep `{!useGpsLocation && !isLocked}`), and do NOT alter the force-GPS behavior (guard F-4).

## 5. Success criteria (per-surface where parity is manual)

- **SC-1-iOS:** As a FREE user, open preferences (Home → preferences), tap the GPS switch OFF (or the locked row/label). The `CustomPaywallScreen` (header "…custom starting point…") becomes visible over the sheet within 1 animation frame. (live-fire)
- **SC-1-Android:** Same, verified on an Android emulator/device. (live-fire)
- **SC-2:** Tapping the "Use my current location" LABEL or the lock icon (not just the switch thumb) presents the paywall (F-3 fixed).
- **SC-3:** Dismissing the paywall (close control) returns to the preferences sheet with all prior selections intact (sheet was never unmounted).
- **SC-4:** As a Mingla+ user, tapping the switch OFF reveals the custom-location text input and NO paywall (gate policy unchanged; the input renders because `isLocked=false`).
- **SC-5:** No regression: the other 7 `CustomPaywallScreen` call sites (default `presentInline=false`) still present exactly as before.
- **SC-6:** `paywall_viewed` / `trackPaywallViewed` still fire when the inline paywall opens with `trigger='custom_starting_point'`.

## 6. Invariants

- **Preserve** the gate: free ⇒ `custom_starting_point` locked (`tierLimits.ts`, `useFeatureGate.ts`). Test: SC-4.
- **NEW — `I-PROPOSED-1315-PAYWALL-PRESENTS-FROM-SHEET` (DRAFT):** a paywall/secondary full-screen surface triggered from inside a `wrapInRNModal` sheet MUST be presented as an in-window overlay (or via an explicit present-after-dismiss handoff), never as a bare nested RN `<Modal>` that races the sheet's Modal. Verified by the §9 regression test. (Orchestrator flips DRAFT→ACTIVE on CLOSE.)

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-1 | happy (iOS) | free user taps GPS switch OFF | paywall overlay visible over sheet | live-fire |
| T-2 | happy (Android) | same on Android | paywall overlay visible | live-fire |
| T-3 | affordance | tap label/lock (not thumb) | paywall opens | live-fire |
| T-4 | dismiss | close paywall | sheet intact, selections preserved | live-fire |
| T-5 | pro path | Mingla+ user taps switch OFF | custom input shown, NO paywall | live-fire |
| T-6 | regression | render `<CustomPaywallScreen>` with no `presentInline` | still an RN `<Modal>` (unchanged) | unit/structural |
| T-7 | structural | PreferencesSheet's paywall uses `presentInline` | assert the prop is set | unit/structural (fails-on-revert) |

## 8. Implementation order

1. `CustomPaywallScreen.tsx` — extract `renderContent()`; add `presentInline` prop + inline-overlay branch + visible close control; keep Modal default.
2. `PreferencesSheet.tsx` — render the paywall with `presentInline` inside the sheet window.
3. `PreferencesSectionsAdvanced.tsx` — make the locked GPS affordance pressable → `onLockedTap` (F-3).
4. Add the §9 regression test.
5. Live-fire free-tier repro on iOS + Android (mingla-tester).

## 9. Regression prevention (fails-on-revert)

- **Structural test (T-7):** assert that in `PreferencesSheet.tsx` the `<CustomPaywallScreen ... />` used for the preferences paywall carries `presentInline` (e.g., source/JSX assertion in a `src/components/__tests__/orch-1315-*.test`). It MUST FAIL if `presentInline` is removed (revert) and PASS when present. Add a protective comment referencing F-1 + `I-PROPOSED-1315-PAYWALL-PRESENTS-FROM-SHEET` explaining WHY (RN cannot present a second Modal over the sheet's `wrapInRNModal` Modal).
- Follow the append-only test-gate conventions used by sibling `orch-*` tests in that folder.

## 10. Open questions

1. **Account tier (Q6):** confirm Seth's failing account is FREE. If Mingla+, there is no toggle bug (SC-4 is the expected behavior) and the fix still stands for real free users — but say so explicitly in the test report.
2. **DESIGN decision (flag for Seth/orchestrator):** (a) present-as-in-window-overlay (recommended — sheet stays mounted) vs present-after-dismiss (sheet closes, paywall opens from root); (b) F-3 affordance: make the WHOLE row a paywall trigger vs a dedicated locked pill/button. Recommend (a)+whole-row; do NOT unilaterally finalize product UX. `mingla-designer` may be invoked at REVIEW if the overlay chrome needs pixel spec.
3. Android Modal-stacking may behave differently; if the inline-overlay approach is unnecessary on Android, keep it anyway for parity (harmless) — confirm in T-2.

## 11. Downstream routing

REVIEW (orchestrator) → optional DESIGN (Open Q2) → IMPLEMENT (`mingla-implementor`, this worktree/branch) → TEST (`mingla-tester`, free-tier live-fire iOS+Android, settles Q6) → orchestrator CLOSE (flip `I-PROPOSED-1315-*` ACTIVE, reap worktree). Coordinate with ORCH-1314 at REVIEW (shared root cause).

---

## Scoped allowlist + DO-NOT-TOUCH

**Allowlist (implementor may modify):**
- `app-mobile/src/components/CustomPaywallScreen.tsx`
- `app-mobile/src/components/PreferencesSheet.tsx`
- `app-mobile/src/components/PreferencesSheet/PreferencesSectionsAdvanced.tsx`
- `app-mobile/src/components/__tests__/orch-1315-*.test.*` (new)

**DO-NOT-TOUCH:**
- `app-mobile/src/components/ui/BaseBottomSheet.tsx`
- `app-mobile/src/hooks/useFeatureGate.ts`, `app-mobile/src/constants/tierLimits.ts`, `app-mobile/src/hooks/useSubscription.ts` (gate policy)
- The other 7 `CustomPaywallScreen` call sites (`SwipeableCards`, `DiscoverScreen`, `ConnectionsPage`, `activity/SavedTab`, `activity/CalendarTab`, `profile/BillingSheet`, `app/index.tsx`) — must keep default Modal behavior
- Anything in ORCH-1314's `curated_cards` scope
- App-root keyboard wrappers (`KeyboardRoot.native.tsx`, `KeyboardToolbarRoot.native.tsx`) — the investigation's temporary stubs were reverted; do not reintroduce

The implementor must **stop-and-amend** before touching anything outside the allowlist.
