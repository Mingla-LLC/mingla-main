# SPEC — ORCH-1044 [Category label resolver: missing-key guard hardening]

- **ORCH:** ORCH-1044
- **Branch / worktree:** `ORCH-1044-swipe-history-category-slug-leak` @ `~/Desktop/mingla-orchs/ORCH-1044-[swipe-history-category-slug-leak]/`
- **Mode:** SPEC (fix design only — NO implementation code in this file)
- **Date:** 2026-06-02
- **Author:** mingla-forensics (Claude)
- **Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1044_SWIPE_HISTORY_CATEGORY_SLUG.md` (committed `c1ac0367a`) — **PROVEN**, APPROVED.
- **Comms ledger:** read on entry. No BLOCK/WARN entry targets `mingla-forensics`, `ORCH-1044`, or `ALL` that requires action this turn. COMMS-0003 (external-API-docs-at-SPEC) is N/A: i18next is a bundled library, not a network API; no provider enum/payload/endpoint is introduced. Noted, not acked (FYI-grade for this scope).

---

## 1. Layman Summary

In the "cards you viewed this session" list, curated experience cards were showing an internal code like `category_romantic` instead of a friendly label like "Romantic". The investigation proved this is a one-line logic bug in a single shared helper (`getReadableCategoryName`) that ~14 screens use: its "did the translation exist?" check is written wrong, so whenever a label has no translation entry it leaks the raw code instead of falling back to a clean title-cased word. This spec fixes the helper at its core so every screen is hardened at once, and locks it with a unit test that asserts the helper can never again emit a `category_*` or `intent_*`-shaped token. No data is bad — the bad string is built fresh at render time — so there is nothing to clean up; the fix is purely the resolver.

---

## 2. Scope, Non-Goals, Assumptions

### 2.1 Scope (LOCKED)
- **S-1** Fix the missing-key detection inside `getReadableCategoryName` (`app-mobile/src/utils/categoryUtils.ts:110-116`) so that an i18next miss is detected correctly **regardless of namespace stripping**, and the human-readable title-case fallback fires. The resolver must NEVER return a string of shape `category_*`, `intent_*`, or `common:category_*` / `common:intent_*`.
- **S-2** The fix lives at the **resolver level** (the single shared function), so all ~14 consumers (F-3 blast radius) are hardened in one change — not patched per-call-site.
- **S-3** Make the resolver **unit-testable in isolation** of the React-Native i18n module (see §6 — `categoryUtils.ts` imports `../i18n`, which pulls AsyncStorage + RN; a Deno/node unit test cannot load that). The fix must allow the i18next lookup to be exercised/stubbed without booting the full RN i18n stack. This is a structural requirement of the test contract, not a gold-plate.
- **S-4** Ship the regression unit test specified in §7 (happy-path + adversarial), runnable in the existing `app-mobile/src/utils/__tests__` Deno harness.

### 2.2 Non-Goals (LOCKED)
- **NG-1** Do NOT change i18next global init options (`appendNamespaceToMissingKey`, `nsSeparator`, `returnNull`, `parseMissingKeyHandler`) in `app-mobile/src/i18n/index.ts`. Those are app-wide and altering them risks the 23-namespace / 29-language config and the ORCH-0675 lazy-load contract. The fix is local to the resolver. (Rationale: a global `appendNamespaceToMissingKey:true` would "fix" the equality guard but silently change miss-return shape for every other `t()` call in the app — out of scope and risky.)
- **NG-2** Do NOT add new i18n keys, rename `intent_*`/`category_*` keys, or touch `common.json`. The fix is detection logic, not new translations.
- **NG-3** Do NOT refactor the mixed-input contract of `getReadableCategoryName` (slug vs. label vs. experienceType — Investigation §10 naming smell). Register it as a follow-up; this ORCH only stops the token leak.
- **NG-4** Do NOT modify the live-deck path (`CuratedExperienceSwipeCard.tsx`) — it already resolves correctly via `intent_*` and is unaffected.
- **NG-5** No backend / migration / RLS / edge-function changes. The slug is synthesized client-side at render; no DB data is wrong.

### 2.3 Assumptions
- **A-1** i18next runtime config is unchanged from investigation time: default `nsSeparator: ':'`, `appendNamespaceToMissingKey: false`, `defaultNS: 'common'`, `fallbackLng: 'en'`. Verified in `app-mobile/src/i18n/index.ts:805-829` (no override of those three). i18next `^26.0.4`.
- **A-2** On a miss, `i18n.t('common:category_romantic')` returns the **namespace-stripped** key `'category_romantic'` (PROVEN in investigation §3 F-1 via Node repro + docs https://www.i18next.com/overview/configuration-options).
- **A-3** `i18n.exists(key, options?)` is available in i18next ^26 and returns `boolean` for whether a key resolves (docs: https://www.i18next.com/overview/api#exists). This is the robust primitive the recommended fix uses.

---

## 3. Root-Cause Recap (from PROVEN investigation)

`categoryUtils.ts:110-116`:
```ts
const key = `common:category_${normalizedSlug}`;   // built WITH the common: prefix
const translated = i18n.t(key);                     // on a MISS, returns "category_romantic" (prefix STRIPPED)
if (translated === key) {                           // "category_romantic" === "common:category_romantic" → FALSE on every miss
  return slug.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()); // DEAD on namespaced keys
}
return translated;                                  // leaks "category_romantic" to the UI
```
The equality guard compares the stripped miss-return against the prefixed key, so it is never true on a miss → the title-case fallback is dead code → the bare key leaks. (Investigation F-1, PROVEN.)

---

## 4. Decisions (made + justified)

### Decision D-1 — The robust guard: use `i18n.exists()`, not string-equality. **(RECOMMENDED + LOCKED)**

**Options considered:**

| Option | Mechanism | Verdict |
|---|---|---|
| **(a) `i18n.exists(key)` gate** | Call `i18n.exists('common:category_${normalizedSlug}')`; if false → title-case fallback; if true → return `i18n.t(key)`. | **RECOMMENDED.** Detects the miss at the source of truth (i18next's own resource lookup), immune to namespace-stripping, immune to `appendNamespaceToMissingKey`, immune to `nsSeparator` config. No string-shape heuristics. Documented stable API. |
| (b) Compare against BOTH forms | `translated === key \|\| translated === 'category_${normalizedSlug}'` (prefixed AND stripped). | Works today, but couples the guard to the current `appendNamespaceToMissingKey:false` behavior — flips silently if that option ever changes. Fragile. Rejected as primary. |
| (c) `t(key, { defaultValue })` sentinel | Pass a unique sentinel `defaultValue`; if returned value === sentinel → miss. | Robust, but requires inventing/maintaining a sentinel and reads less clearly than `exists()`. Acceptable fallback if `exists()` is somehow unavailable, but `exists()` is available in ^26 (A-3). |

**Chosen: (a) `i18n.exists()`.** Justification: it asks i18next the exact question we mean ("is there a translation for this key?") instead of inferring it from the shape of a returned string. It cannot be defeated by namespace stripping (the precise mechanism that caused this bug), and it is decoupled from the three init options in NG-1 — so a future i18n config change cannot silently reintroduce the leak. As defense-in-depth, the implementor SHOULD also keep an output guard (Decision D-3) so that even an unexpected `exists()`/`t()` interaction can never emit a token-shaped string.

**Contract the implementor must satisfy (LOCKED, behavior — not code):**
1. Build the lookup key exactly as today: `common:category_${normalizedSlug}`.
2. If the key does NOT exist (`i18n.exists(...) === false`): return the title-cased fallback of `slug` — `slug.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())`. This already produces "Romantic", "Group Fun", etc.
3. If the key exists: return `i18n.t(key)` (the localized label).
4. The empty-input guard (`if (!categoryKey) return 'Experience'`) and the legacy-slug normalization (`legacyToSlug`, `stripped`, `normalizedSlug`) are unchanged.

### Decision D-2 — Parity question: title-case fallback, NOT `intent_*` routing. **(RECOMMENDED + LOCKED)**

**Question (from dispatch):** should Swipe History additionally route curated cards through the `intent_*` label for EXACT parity with the live deck (`CuratedExperienceSwipeCard.tsx:73-74`), or is the title-case friendly fallback sufficient?

**Recommendation: title-case fallback is sufficient. Do NOT route Swipe History through `intent_*`.**

**Justification (evidence-backed):**
1. **The resolver doesn't receive the experienceType.** The deck derives its label from `card.experienceType` (the slug `'romantic'`) → `t('common:intent_romantic')`. Swipe History calls `getReadableCategoryName(card.category)`, and `card.category` is the **human label** `'Romantic'` (set at `cardConverters.ts:71` from `categoryLabel`), not the experienceType. Routing through `intent_*` from inside the resolver would require the resolver to reverse-map a display label back to an experience-type slug — a new, fragile, lossy mapping. Lowest-risk path is to fix the existing fallback the resolver already owns.
2. **`intent_*` and title-case actually DIVERGE for two labels — and title-case is the correct, consistent product copy here.** Verified in `en/common.json`:
   - `intent_first_date` → "First Dates" (plural) vs. source label "First Date" (singular, per `CuratedExperienceSwipeCard.CURATED_ICON_MAP`).
   - `intent_take_a_stroll` → "Take a Stroll" (matches title-case of `'Take a Stroll'`).
   - `intent_romantic`/`_adventurous`/`_group_fun`/`_picnic_dates` → "Romantic"/"Adventurous"/"Group Fun"/"Picnic Dates" (all identical to title-case of the source label).
   Forcing `intent_*` would make Swipe History say "First Dates" while the card's own `categoryLabel` says "First Date" — a NEW inconsistency. The title-case fallback returns the same word family the curated record actually carries (`categoryLabel`), so the Swipe History row matches the card's own identity field. This is the cleaner, more consistent label per the dispatch's "least risk, clean, consistent" lean.
3. **The friendly fallback is locale-degraded only on the miss path, which is exactly the curated case.** For real category slugs (single place cards), the `category_*` key exists and `i18n.t()` returns the localized string — locale-aware as before. For curated labels there is no localized key in EITHER namespace that `getReadableCategoryName` can reach with the input it has, so English title-case is the honest best the resolver can do without the larger refactor in NG-3. Brushing Constitution #10 here is accepted as the bounded trade-off (Investigation §6); full localization of curated labels in Swipe History is registered as the NG-3 follow-up.

**Net:** Decision D-1 alone fully removes the reported token leak AND yields a label consistent with the curated card's own `categoryLabel`. The `intent_*` parity route is explicitly **deferred** (see §10 Follow-ups), not adopted.

### Decision D-3 — Output safety net (defense-in-depth). **(LOCKED)**
The resolver's returned value must NEVER match `/^(common:)?(category|intent)_/`. The implementor must guarantee this by construction (D-1 ensures the only two return paths are a localized human string or a title-cased fallback). No separate runtime regex strip is required in product code IF D-1 is implemented as specified; the **test** in §7 enforces this invariant. (Do not add a regex scrubber that masks a future logic regression — fix detection at the source per D-1.)

---

## 5. Cross-Surface Impact (Phase 2.5 — MANDATORY)

The fix is a single shared pure-ish util in `app-mobile/`. Parity is **automatic** across iOS/Android because there is no platform branch.

| # | Surface | Covered? | User-visible behavior demanded | Files | Parity |
|---|---|---|---|---|---|
| 1 | **Consumer iOS** (`app-mobile/` iOS) | YES | Swipe History (and all 14 resolver consumers) show "Romantic"/"Group Fun"/… never `category_romantic`. | `app-mobile/src/utils/categoryUtils.ts` | shared |
| 2 | **Consumer Android** (`app-mobile/` Android) | YES | Identical to iOS. | same | **automatic** (shared RN util, no platform branch) — SC covers both via one criterion (SC-1). |
| 3 | **Buyer/anonymous Web** (`mingla-business/` buyer routes) | NO | Buyer-anon routes do not render curated category labels via this resolver. | — | n/a — surface does not consume `getReadableCategoryName`. |
| 4 | **Business iOS** (`mingla-business/`) | NO | No curated category render via this util. | — | n/a — business app has no curated Swipe History. |
| 5 | **Business Android** (`mingla-business/`) | NO | Same as #4. | — | n/a. |
| 6 | **Admin Web** (`mingla-admin/`) — adjacent | NO | Admin does not render curated category labels. | — | n/a (Investigation §6 "NOT affected"). |
| 7 | **Business Web preview** — adjacent | NO | Same as #4/#5. | — | n/a. |

Because parity across the only two covered surfaces (consumer iOS + Android) is automatic via shared code, **one success criterion (SC-1) governs both**; no separate SC-1-iOS / SC-1-Android split is required (the unit test is platform-agnostic and is the binding gate).

---

## 6. Layer Specification

Only the **utility layer** is touched. No DB / edge / service / hook / realtime / new-component layers.

### 6.1 Utility layer — `app-mobile/src/utils/categoryUtils.ts`
- **Function:** `getReadableCategoryName(categoryKey: string): string` — signature UNCHANGED (LOCKED). No new params, no async, no behavioral change for valid `category_*` slugs.
- **Change:** replace the broken `if (translated === key)` miss-detection (lines 111-116) with the Decision D-1 contract (`i18n.exists()` gate → fallback-or-localized). The comment at line 112 stays accurate ("If i18n returns no translation, fall back to formatting") — update it to describe the `exists()` mechanism so the next reader doesn't reintroduce the equality guard.
- **Testability requirement (S-3, LOCKED):** the resolver currently hard-imports `import i18n from '../i18n'` (module-load pulls AsyncStorage + RN, which a Deno/node unit test cannot evaluate). The implementor MUST make the i18next dependency exercisable in a unit test without booting the RN i18n module. Acceptable approaches (implementor's choice — 🎨 OPEN within this band):
  - (a) Extract the pure resolution into an internal function that takes an injected `{ exists, t }` i18n-like object, with the exported `getReadableCategoryName` delegating to it using the real `i18n` singleton; the test calls the internal function with a stub. **(Preferred — keeps the public API identical and adds zero call-site churn.)**
  - (b) Provide a documented test seam (e.g., a module-level setter / dependency-injection hook) the test uses to substitute a minimal i18n stub.
  - The chosen seam MUST NOT change `getReadableCategoryName`'s public signature or any of the 14 call sites.
- **Static-analysis floor (LOCKED):** explicit return type present (it is); no `any`; no `@ts-ignore`; no silent catch. The function stays synchronous.

### 6.2 Consumers — NO edits (LOCKED)
All 14 call sites (`DismissedCardsSheet.tsx:179,:257`; `SwipeableBoardCards.tsx`; `ExpandedCardModal.tsx:2058,:2178,:2192`; `expandedCard/CardInfoSection.tsx`; `PersonGridCard.tsx`; `PersonHolidayView.tsx`; `activity/SavedTab.tsx`; `activity/CalendarTab.tsx`; `SwipeableCards.tsx`; `board/SwipeableSessionCards.tsx`) keep calling `getReadableCategoryName(card.category)` unchanged. The resolver fix hardens them all (S-2). Editing call sites is OUT of scope (NG).

---

## 7. Test Contract (REQUIRED)

**Harness:** Deno test under `app-mobile/src/utils/__tests__/` matching the sibling pattern (`openingHoursUtils.test.ts`, `curatedStopsAvailability.test.ts`: `Deno.test(...)` + `assertEquals`/`assertMatch`/`assert` from `deno.land/std@0.168.0/testing/asserts.ts`, `// @ts-nocheck` header). Two files mirroring the established naming:
- `categoryLabelResolver.test.ts` — happy-path regression.
- `categoryLabelResolver.adversarial.test.ts` — adversarial.

The resolver is exercised through the §6.1 test seam with a **minimal i18n stub** that registers ONLY the real-category keys present in `common.json` (e.g. `category_nature`, `category_casual_food`) and NO `category_romantic`/`intent_*` keys — reproducing the exact production resource state that triggered the bug.

### 7.1 Happy-path test (`categoryLabelResolver.test.ts`)

| Test | Input (`categoryKey`) | i18n stub state | Expected return | Asserts |
|---|---|---|---|---|
| T-01 | `'Romantic'` | no `category_romantic` key | `'Romantic'` | exact equality |
| T-02 | `'Adventurous'` | no key | `'Adventurous'` | exact equality |
| T-03 | `'First Date'` | no key | `'First Date'` | exact equality (singular, matches `categoryLabel` source — confirms D-2: NOT "First Dates") |
| T-04 | `'Group Fun'` | no key | `'Group Fun'` | exact equality |
| T-05 | `'Picnic Dates'` | no key | `'Picnic Dates'` | exact equality |
| T-06 | `'Take a Stroll'` | no key | `'Take a Stroll'` | exact equality |
| T-07 | `'casual_food'` (real slug) | `category_casual_food` → "Casual" present | `'Casual'` | exact equality — proves the localized HIT path still works (no regression for single place cards) |
| T-08 | `''` (empty) | — | `'Experience'` | exact equality — empty guard intact |

### 7.2 Adversarial test (`categoryLabelResolver.adversarial.test.ts`)

| Test | Scenario | Input | Expected | Asserts |
|---|---|---|---|---|
| T-A1 | **Token-shape invariant (the core regression anchor)** | each of `'Romantic'`, `'Adventurous'`, `'First Date'`, `'Group Fun'`, `'Picnic Dates'`, `'Take a Stroll'` | return value does NOT match `/^(common:)?(category\|intent)_/` AND does NOT contain a `:` namespace separator | `assert(!/^(common:)?(category\|intent)_/.test(out))` for every curated label — fails on revert of D-1 |
| T-A2 | **Namespace-strip simulation** | stub `t()` to return the namespace-stripped key on a miss (i.e. `'category_romantic'` for input `'Romantic'`), exactly as production i18next does | resolver still returns `'Romantic'`, NOT `'category_romantic'` | proves the fix relies on `exists()` (or equivalent), not on string equality that the strip defeats |
| T-A3 | **`intent_`-shaped input never leaks** | `'intent_romantic'` (defensive: a caller mistakenly passes an intent key) | does NOT return `'intent_romantic'` or `'common:intent_romantic'`; returns a title-cased string | guards the F-3 blast-radius class |
| T-A4 | **Legacy slug still normalizes** | `'fine_dining'` with `category_upscale_fine_dining` → "Fine Dining" present | `'Fine Dining'` | proves legacy `legacyToSlug` path + HIT path coexist with the new guard |
| T-A5 | **Hyphen + case normalization** | `'first-date'` (hyphen, lower) | a clean human label, not a token; not `category_first_date` | confirms `normalizedSlug` + guard interplay on a miss |

**iOS/Android parity:** the unit is a shared RN util with no platform branch; the Deno unit test is platform-agnostic and is the binding gate for BOTH consumer iOS and Android (per §5). No separate per-platform test required; the tester's runtime parity check (if dispatched) confirms the rendered Swipe History row on each platform shows the friendly label.

**CI wiring:** register the two test files so they run in the same Deno job that already runs the sibling `app-mobile/src/utils/__tests__` files (the implementor adds them to the existing util-test invocation; do not invent a new workflow). If they must be added to `package.json` scripts following the `test:orch-XXXX` convention, name them `test:orch-1044` / `test:orch-1044-adv`.

---

## 8. Success Criteria (observable, testable, unambiguous)

- **SC-1 (LOCKED)** For every curated label — `'Romantic'`, `'Adventurous'`, `'First Date'`, `'Group Fun'`, `'Picnic Dates'`, `'Take a Stroll'` — `getReadableCategoryName` returns the exact friendly label in §7.1 (T-01…T-06) and NEVER a string matching `/^(common:)?(category|intent)_/`. (Covers consumer iOS + Android via shared code.)
- **SC-2 (LOCKED)** For a valid category slug whose `category_*` key exists (e.g. `'casual_food'`), the resolver still returns the localized label `i18n.t('common:category_casual_food')` ("Casual") — no regression to single place cards (T-07).
- **SC-3 (LOCKED)** Empty / falsy input returns `'Experience'` (T-08) — empty guard preserved.
- **SC-4 (LOCKED)** The miss is detected by an existence check decoupled from namespace-stripping; simulating the production strip (T-A2) still yields the friendly label.
- **SC-5 (LOCKED)** `getReadableCategoryName`'s public signature, the 14 call sites, and i18n global init options are unchanged (NG-1, NG-3, §6.2).
- **SC-6 (LOCKED)** Both test files run green in the existing Deno util-test job.

---

## 9. Invariants

### Preserve (existing)
- **I-CATEGORY-SLUG-CANONICAL** — legacy→canonical slug normalization (`legacyToSlug`) unchanged; verified by T-A4.
- **I-CURATED-LABEL-SOURCE** — curated `categoryLabel` remains the identity source; D-2 keeps Swipe History consistent with it (does not override with a diverging `intent_*` string).
- **Constitution #10 (locale-aware display)** — preserved on the HIT path (real slugs localize); on the curated MISS path it degrades to English title-case as the bounded, accepted trade-off (NG-3 registers full localization as follow-up).
- **Constitution #3 (no silent failures)** — the miss is now a deliberate, tested fallback, not a swallowed error leaking a token.

### Establish (new) — propose to orchestrator for INVARIANT_REGISTRY
- **I-CATEGORY-LABEL-NO-TOKEN-LEAK (DRAFT)** — `getReadableCategoryName` MUST NEVER return a value matching `/^(common:)?(category|intent)_/`. Enforced by §7 T-A1. Flips ACTIVE on ORCH-1044 CLOSE.
- **I-CATEGORY-MISS-DETECTED-BY-EXISTENCE (DRAFT)** — missing-key detection MUST use i18next existence semantics (`exists()` / sentinel `defaultValue`), NOT equality against the prefixed key string. Enforced by T-A2. Flips ACTIVE on CLOSE.

---

## 10. Regression Prevention & Follow-ups

- **Structural safeguard:** T-A1 (token-shape invariant) + T-A2 (namespace-strip simulation) are fails-on-revert anchors — reintroducing the `translated === key` equality guard, or removing the existence check, turns both red.
- **Protective comment:** the resolver MUST carry a one-line comment explaining WHY the guard uses existence-not-equality (cite ORCH-1044 + "i18next strips the namespace on a miss, so equality against the prefixed key is never true"). This is the institutional memory that stops the next editor from "simplifying" it back.
- **Follow-up F/U-1 (register, do NOT do here):** the mixed-input contract of `getReadableCategoryName` (slug vs. label vs. experienceType — Investigation §10). A future ORCH should split label-resolution from slug-resolution or type the input so a non-`category_*` string can't reach the `category_*` namespace.
- **Follow-up F/U-2 (register):** full localization of curated category labels in Swipe History (the deferred `intent_*` / experienceType-aware parity route from D-2) — only worth doing alongside F/U-1, and only if non-English curated labels become a product priority.

---

## 11. Implementation Order

1. `app-mobile/src/utils/categoryUtils.ts` — apply Decision D-1 guard fix + the §6.1 test seam + protective comment (single file, one function).
2. `app-mobile/src/utils/__tests__/categoryLabelResolver.test.ts` — §7.1 happy-path.
3. `app-mobile/src/utils/__tests__/categoryLabelResolver.adversarial.test.ts` — §7.2 adversarial.
4. CI: ensure both files are picked up by the existing Deno util-test invocation (and `package.json` `test:orch-1044*` scripts if the convention requires).
5. Run the two Deno tests locally → green (SC-6). No deploy / migration / OTA step (NG-5; OTA deferred per memory `project_ota_deferred_until_new_build.md`).

---

## 12. LOCKED vs OPEN summary

- **🔒 LOCKED:** root-cause fix at the resolver (D-1 `exists()` guard); title-case parity decision (D-2, no `intent_*` routing); unchanged public signature + 14 call sites + i18n init (NG-1/NG-3); the §7 test tables (T-01…T-08, T-A1…T-A5) and their exact expected strings; SC-1…SC-6; the two DRAFT invariants; the no-token-leak regex `/^(common:)?(category|intent)_/`.
- **🎨 OPEN (implementor's craft):** the exact test-seam mechanism (injected i18n-like object vs. documented setter — §6.1 a/b); internal naming of the extracted helper; whether to also keep option-(b)/(c) belt-and-suspenders inside the guard as defense-in-depth so long as the public behavior matches the locked test tables; wording of the protective comment.

---

*No implementation code is included per the dispatch. This SPEC defines the contract; the implementor executes.*
