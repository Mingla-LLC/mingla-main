# INVESTIGATION — ORCH-1314 [preferences-sheet-curated-paywall-dead-gate]

- **ORCH-ID:** ORCH-1314
- **Worktree:** `~/Desktop/mingla-orchs/orch-1314-[preferences-curated-paywall-dead-gate]/` on branch `orch-1314-preferences-curated-paywall-dead-gate` (rebased onto `origin/main`)
- **Phase:** INVESTIGATE (paired with SPEC in the same pass — see `Mingla_Artifacts/specs/SPEC_ORCH-1314_PREFERENCES_CURATED_PAYWALL.md`)
- **Author:** mingla-forensics
- **Date:** 2026-07-05
- **Confidence:** ROOT CAUSE **PROVEN by source** (hardcoded literal — tier-independent). Free-tier sim runtime repro **PENDING TEST** (capped honestly; no free-tier login performed this pass).

---

## 1. Symptom summary (expected vs actual)

**Seth (verbatim):** "the paywall on the preferences sheet is gating the toggle. But when a user clicks the toggle, the paywall does not show up."

| | Expected | Actual |
|---|---|---|
| Free-tier user, preferences sheet, "See curated experiences?" section | Interacting with the paywall-gated curated section presents the Mingla+ paywall (`CustomPaywallScreen`, feature `curated_cards`) | The curated paywall is **never presented from the preferences sheet** — the section behaves as fully unlocked. The intent toggle flips freely; the experience-type pills select freely; no lock banner shows. |

---

## 2. Investigation manifest (every file read, in trace order)

| # | File | Layer | Why |
|---|---|---|---|
| 1 | `app-mobile/src/components/PreferencesSheet.tsx` (all 1878 lines) | Code (component) | The sheet — paywall state, both gated toggles, handlers |
| 2 | `app-mobile/src/components/PreferencesSheet/PreferencesSections.tsx` | Code (component) | `ExperienceTypesSection` — the curated lock banner + pill taps |
| 3 | `app-mobile/src/components/PreferencesSheet/PreferencesSectionsAdvanced.tsx` | Code (component) | `LocationInputSection` — the GPS switch (Toggle B) |
| 4 | `app-mobile/src/components/PreferencesSheet/ToggleSection.tsx` | Code (component) | The Switch wrapper for the "See curated experiences?" toggle |
| 5 | `app-mobile/src/hooks/useFeatureGate.ts` | Code (hook) | `canAccess()` — the gate signal |
| 6 | `app-mobile/src/hooks/useSubscription.ts` (`useEffectiveTier`) | Runtime/data | What tier a free user actually resolves to |
| 7 | `app-mobile/src/constants/tierLimits.ts` | Schema (client tier table) | `curatedCardsAccess` / `customStartingPoint` per tier |
| 8 | `app-mobile/src/components/CustomPaywallScreen.tsx` (feature-map region) | Code (component) | Confirms `feature='curated_cards'` renders a real paywall |
| 9 | `app-mobile/src/components/SwipeableCards.tsx` (gate region ~1698-1713) | Code (blast radius) | The established, WORKING `curated_cards` gate pattern |
| 10 | `app-mobile/src/i18n/locales/*/preferences.json`, `*/billing.json` | Docs (copy) | The orphaned `experience_types.curated_locked` string |
| 11 | git blame / `git log -S` on `isCuratedLocked` | Data (history) | When/how the hardcode was introduced |

---

## 3. Q-scorecard

**Q1 — Which toggle(s) fail to present the paywall for a free-tier user, and why?**
Verdict: **Toggle A ("See curated experiences?" / intent toggle) is the sole defect.** Its curated paywall is unreachable because `isCuratedLocked` is hardcoded to the literal `false` (PreferencesSheet.tsx:1279), which is the ONLY condition that renders the lock banner (the only element wired to open the curated paywall). Toggle B (GPS) is correctly wired. `PROVEN by source.`

**Q2 — Is Toggle B (GPS / `custom_starting_point`) also broken?**
Verdict: **No — RULED OUT.** The GPS switch's `onValueChange` fires `onLockedTap()` when `isLocked && !val`, and the parent's `onLockedTap` sets `paywallFeature('custom_starting_point'); setShowPaywall(true)`. For a free user the auto-reset effect forces `useGpsLocation=true`, so a tap sends `val=false`, satisfying `isLocked && !val` → paywall presents. `PROVEN by source.`

**Q3 — What does `canAccess('curated_cards')` return for a free user, and is it the right signal to gate on?**
Verdict: **`false` for free; yes it is the right signal.** `canAccess('curated_cards')` → `limits.curatedCardsAccess` → `getTierLimits(tier).curatedCardsAccess`. For `tier='free'` that is `false` (tierLimits.ts:22). Tier resolves via `useEffectiveTier` (server `get_effective_tier` RPC authoritative; RevenueCat + Supabase-subscription fallback; default `free`). This exact signal already gates `curated_cards` correctly in 5 other surfaces. `PROVEN by source.`

**Q4 — Is this a localized defect or a systemic gate failure?**
Verdict: **Localized.** The `curated_cards` paywall is LIVE and correctly wired everywhere else (SwipeableCards, DiscoverScreen, SavedTab, CalendarTab). PreferencesSheet is the ONLY site where it is hardcoded dead. `PROVEN by source.`

**Q5 — Is the gate itself (curated = Mingla+) correct product intent, i.e. is the fix "make the paywall reachable" not "remove the gate"?**
Verdict: **Gate intent is correct; fix = make it reachable.** `tierLimits.ts` sets `curatedCardsAccess:false` for free; the `experience_types.curated_locked` string ("Curated cards are locked on Free — upgrade to explore them") is fully translated in all 30 locales; 5 sibling call sites enforce it. The gate was clearly intended and left disconnected. **The precise free-user interaction model is a product/UX decision — flagged as OQ-1, not decided here.**

---

## 4. Findings (six-field evidence)

### F-1 — `isCuratedLocked={false}` hardcoded literal kills the curated paywall trigger — CONFIRMED ROOT CAUSE

1. **Symptom:** Free user's curated section shows no lock banner; tapping the toggle/pills never presents the paywall.
2. **Layer:** Code (component).
3. **Probe:**
   `grep -rn "isCuratedLocked" app-mobile/src` and read of `PreferencesSheet.tsx:1274-1285` + `PreferencesSections.tsx:57-68`.
4. **Evidence (verbatim):**
   `PreferencesSheet.tsx:1274-1285`:
   ```
   <ExperienceTypesSection
     experienceTypes={experienceTypes}
     selectedIntents={selectedIntents}
     onIntentToggle={handleIntentToggle}
     minMessage={minSelectionMessage}
     isCuratedLocked={false}                    // ← line 1279, hardcoded literal
     onLockedTap={() => {
       if (!isEditable) return;
       setPaywallFeature('curated_cards');
       setShowPaywall(true);
     }}
   />
   ```
   `PreferencesSections.tsx:57-68` — the banner is the ONLY element wired to `onLockedTap`, and it renders only when `isCuratedLocked` is truthy:
   ```
   {isCuratedLocked && (
     <TouchableOpacity onPress={onLockedTap} ... style={styles.curatedLockedBanner}>
       <Icon name="lock-closed" ... />
       <Text ...>{t('preferences:experience_types.curated_locked')}</Text>
     </TouchableOpacity>
   )}
   ```
   `grep` proof that `canAccess('curated_cards')` is **never called** in PreferencesSheet.tsx (only `custom_starting_point` is): the sole `curated_cards` reference in the file is the dead `setPaywallFeature('curated_cards')` at line 1282.
5. **Mechanism:** `isCuratedLocked` is a compile-time `false`, so the `{isCuratedLocked && (...)}` banner never mounts → its `onPress={onLockedTap}` (the only path to `setShowPaywall(true)` for `curated_cards` in this file) can never fire → the curated paywall is unreachable from the preferences sheet for **every** tier.
6. **Severity:** `CONFIRMED ROOT CAUSE`.

### F-2 — The intent Switch (`handleIntentToggleChange`) has no paywall gate — CONFIRMED ROOT CAUSE (co-defect)

1. **Symptom:** A free user can flip "See curated experiences?" on/off with no paywall.
2. **Layer:** Code (component/handler).
3. **Probe:** Read `PreferencesSheet.tsx:610-617` (handler) + `PreferencesSheet.tsx:1267-1273` (wiring) + `ToggleSection.tsx:37-45` (Switch).
4. **Evidence (verbatim):** `PreferencesSheet.tsx:610-617`:
   ```
   const handleIntentToggleChange = useCallback((newValue: boolean) => {
     if (!isEditable) return;
     if (!newValue && !categoryToggle) {
       toastManager.warning(t('preferences:experience_types.min_message'), 2000);
       return;
     }
     setIntentToggle(newValue);
   }, [categoryToggle, isEditable, t]);
   ```
   `ToggleSection.tsx:37-45` — the Switch only blocks the mutual-exclusion "turn OFF when disabled" case; otherwise calls `onToggle(newValue)`. No `canAccess`/paywall anywhere.
5. **Mechanism:** No gate on the toggle handler means a free user's tap silently flips the section state — matching Seth's "when a user clicks the toggle, the paywall does not show up." NOTE the interaction wrinkle in F-4.
6. **Severity:** `CONFIRMED ROOT CAUSE` (the toggle/pill interactions are ungated; F-1 is the primary structural cause, F-2 is why interaction never routes to the paywall).

### F-3 — Toggle B (GPS `custom_starting_point`) is correctly wired — RULED OUT

1. **Symptom (hypothesis to test):** GPS switch might also fail to present the paywall.
2. **Layer:** Code (component/handler).
3. **Probe:** Read `PreferencesSectionsAdvanced.tsx:177-189` + `PreferencesSheet.tsx:1198-1206` + auto-reset effect `PreferencesSheet.tsx:293-299`.
4. **Evidence (verbatim):** `PreferencesSectionsAdvanced.tsx:177-189`:
   ```
   <Switch
     value={useGpsLocation}
     onValueChange={(val) => {
       if (isLocked && !val) { onLockedTap?.(); return; }   // free user tap-OFF → paywall
       onToggleGps(val);
     }}
   />
   ```
   Parent wiring `PreferencesSheet.tsx:1200-1205`: `isLocked={!canAccess('custom_starting_point')}` + `onLockedTap` sets `paywallFeature('custom_starting_point'); setShowPaywall(true)`.
   Auto-reset `PreferencesSheet.tsx:293-299`: `if (!canAccess('custom_starting_point') && !useGpsLocation) setUseGpsLocation(true)` — forces the switch ON for free users, so a tap always sends `val=false`.
5. **Mechanism:** Free user → switch is ON → tap sends `val=false` → `isLocked && !val` true → `onLockedTap()` → paywall. The lock hint (`PreferencesSectionsAdvanced.tsx:237-246`) also opens the paywall. Both paths work.
6. **Severity:** `RULED OUT` (correctly gated; not the reported defect).

### F-4 — The intent toggle DEFAULTS ON — the correct primitive is the banner/pills, not a "turn-on" gate — SUSPECTED CONTRIBUTOR (design wrinkle, drives OQ-1)

1. **Symptom:** There is no natural "toggle turns ON → paywall" moment for the curated section.
2. **Layer:** Code (state) → UX design.
3. **Probe:** Read `PreferencesSheet.tsx:247` + reset paths (232, 864).
4. **Evidence (verbatim):** `PreferencesSheet.tsx:247`: `const [intentToggle, setIntentToggle] = useState<boolean>(true);` — the "See curated experiences?" section is ON by default and reset-to-ON everywhere.
5. **Mechanism:** Because the section is already ON for a fresh free user, gating "turn ON" would never trigger, and gating "turn OFF" is nonsensical (you do not paywall disabling a feature). This is precisely why the built-but-disconnected design used a persistent lock BANNER (always visible for free users, tappable → paywall) rather than a toggle-transition gate — the banner is the right primitive for a default-on section. The remaining question is whether the experience-type PILLS should also route a free tap to the paywall (recommended) and whether the Switch should be visually locked. See OQ-1.
6. **Severity:** `SUSPECTED CONTRIBUTOR` (not a code bug — a design constraint that shapes the correct fix).

---

## 5. Five-Truth-Layer reconciliation

| Layer | What it says | Truth? |
|---|---|---|
| **Docs (i18n copy)** | `experience_types.curated_locked` = "Curated cards are locked on Free — upgrade to explore them" exists fully translated in **all 30 locales**. Intent: free users see a lock banner on the curated section. | The banner was DESIGNED to render. |
| **Schema (client tier table)** | `tierLimits.ts`: free → `curatedCardsAccess:false`; mingla_plus → `true`. Curated is Mingla+-only. | Gate intent confirmed. |
| **Code** | `PreferencesSheet.tsx:1279` hardcodes `isCuratedLocked={false}`; `handleIntentToggleChange` (610-617) has no gate; `canAccess('curated_cards')` is never called in the file. | **This is the bug.** |
| **Runtime** | `canAccess('curated_cards')` returns `false` for free (via `useEffectiveTier` → server RPC / RC / default-free). The dead literal short-circuits it. | Gate signal is available and correct — just never consulted here. |
| **Data (history)** | `isCuratedLocked={false}` present since Seth's 2026-04-15 commit `374bfd2d2d` ("Smart Preferences" `8a22cde24` introduced the prop; ORCH-0372/3/4 `7cae19570` is the current form). Never once wired to `canAccess`. | Dead from day one — not a regression. |

**Contradiction (the bug):** Docs + Schema + Runtime all agree the curated section must be locked for free users and the machinery exists — but Code hard-codes it unlocked. The Code layer is wrong; the other four hold the truth.

---

## 6. Repro evidence / runtime status

- **Source-level proof (PROVEN):** `isCuratedLocked` is the literal `false`. This is tier-independent: the lock banner never renders and the curated paywall is unreachable from the preferences sheet for **any** user (free or Mingla+). No login is required to establish that the trigger is dead — it is a compile-time constant.
- **Free-tier runtime repro (PENDING TEST):** No free-tier consumer sim login was performed this pass (no free-tier credentials on hand; driving a logged-in sim session was out of proportion for a defect already proven by a hardcoded literal). Per the honesty guard, the "a free user taps and the toggle flips with no paywall" observation is capped at **source-proven / runtime-pending-TEST** — NOT fabricated as an on-device result. The TEST phase (mingla-tester) should confirm the flip-with-no-paywall on a real free-tier account and, post-fix, confirm the paywall presents.

---

## 7. Blast radius / cross-surface map

- **`curated_cards` gate is LIVE and correct** in: `SwipeableCards.tsx:1702` (save/right-swipe gate), `SwipeableCards.tsx:3250-3253`, `DiscoverScreen.tsx:2337-2340`, `SavedTab.tsx:1115-1116` + `2098-2101`, `CalendarTab.tsx:2832` + `2844`. PreferencesSheet is the **sole** dead site.
- **In-scope surfaces:** Consumer iOS + Consumer Android — same `app-mobile/` JS, parity automatic (single shared file, no per-platform branch in the affected code).
- **Out-of-scope surfaces:** Business iOS/Android, Buyer/anon Web, Admin Web, Business Web preview — none render `PreferencesSheet.tsx` or the consumer feature-gate. One-phrase reason: consumer-only component.
- **Collab vs solo:** Same `PreferencesSheet` instance serves both (CollaborationPreferences was deleted, ORCH-0316). The fix lands once for both. The read-only participant-view path (`isEditable=false`) must NOT present the paywall (viewing another person's picks) — the existing `if (!isEditable) return` guard in `onLockedTap` already covers this and must be preserved.

---

## 8. Invariant impact

- **No existing invariant is violated or contradicted.** No current invariant governs preferences-sheet paywall reachability.
- **Proposes a NEW invariant** (DRAFT — orchestrator flips ACTIVE at CLOSE): **`I-PROPOSED-1314-PREFERENCES-PAYWALL-GATE-REACHABLE`** — every paywall-gated toggle/section in `PreferencesSheet.tsx` must route a locked free-user interaction to `setShowPaywall(true)`; no paywall trigger may be wired to a hardcoded `false`/dead condition. Full statement in the SPEC §6.

---

## 9. Discoveries for orchestrator (side issues — NOT folded in)

- **D-1 (copy/i18n hygiene):** `experience_types.curated_locked` was shipped + translated into 30 locales for a banner that never rendered — a translation-budget leak. Not a bug; noting for process. No action required by this ORCH.
- **D-2 (no PreferencesSheet unit-test coverage):** There is no `*preferences*paywall*` or `*preferences*gate*` test today; the closest is `orch-0943-prefs-apply-coord-coherence.test.tsx` (a source-structure harness). This ORCH will add the first paywall-gate regression test for the sheet.
- No adjacent paywall gaps were found (the other 5 `curated_cards` sites are correctly wired). If the orchestrator wants a systemic "every `canAccess` call must reach a paywall" audit, that is a SEPARATE ORCH — flagged, not folded in.

---

## 10. Confidence

- **Root cause: PROVEN (by source).** F-1 + F-2 are compile-time facts; the tier trace (F-3/Q3) and blast radius (Q4) are fully traced across all five layers with verbatim evidence.
- **Free-tier on-device repro: PENDING TEST** (capped honestly — not performed this pass).

## 11. Recommended next phase + scope (direction only — not a fix)

Proceed to the SPEC (this pass) → orchestrator REVIEW → **DESIGN only if OQ-1 (free-user interaction model) needs a visual/UX decision** → IMPLEMENT → TEST (free-tier live-fire) → CLOSE. Scope: wire the curated gate in `PreferencesSheet.tsx` to the real `!canAccess('curated_cards')` signal and route locked free-user interaction to the paywall; do NOT touch the `custom_starting_point` path, the deck-level gates, or the gate policy itself. The precise free-user interaction depth (banner-only vs. banner + pill-gate vs. locked switch) is OQ-1 for Seth/DESIGN.
