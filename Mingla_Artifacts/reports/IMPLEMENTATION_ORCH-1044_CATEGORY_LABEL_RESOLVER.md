# IMPLEMENTATION — ORCH-1044 [Category label resolver: missing-key guard hardening]

- **ORCH:** ORCH-1044
- **Branch / worktree:** `ORCH-1044-swipe-history-category-slug-leak` @ `~/Desktop/mingla-orchs/ORCH-1044-[swipe-history-category-slug-leak]/`
- **Mode:** IMPLEMENT
- **Date:** 2026-06-02
- **Implementor:** mingla-implementor (Claude)
- **Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-1044_CATEGORY_LABEL_RESOLVER.md` (committed `609cd9658`) — APPROVED.
- **Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1044_SWIPE_HISTORY_CATEGORY_SLUG.md` (committed `c1ac0367a`) — PROVEN.
- **Comms ledger:** read on entry. No BLOCK entry targets `mingla-implementor`, `ORCH-1044`, or `ALL`. The open `ALL`-WARN entries (COMMS-0002 strict-grep backend gate, COMMS-0003 external-API-docs, COMMS-0004 intake numbering, COMMS-0015 deploy hygiene) are all N/A to this scope: pure `app-mobile/` frontend util + Deno tests, no backend file, no external network API (i18next is a bundled library), no new ORCH-ID claimed, no edge deploy. Noted, not acked.
- **Status:** implemented and verified.

---

## 1. Layman Summary

The "cards you viewed this session" list was showing an internal code like `category_romantic` instead of the friendly "Romantic". The fix is one logic change inside the single shared helper that ~14 screens use: it now asks i18next directly "does this label have a translation?" instead of comparing two strings that never matched on a miss — so on a miss it cleanly falls back to a title-cased word. Every screen that uses the helper is hardened at once. The helper can never again emit a `category_*` or `intent_*`-shaped token, and two unit tests lock that in (with a proof that they go red if the fix is reverted).

---

## 2. What Changed (Old → New Receipts)

### `app-mobile/src/utils/categoryUtils.ts`
**What it did before:** `getReadableCategoryName` statically imported the RN i18n singleton (`import i18n from '../i18n'`) at module top, and detected a missing translation with `if (translated === key)`. Because i18next strips the namespace on a miss (`appendNamespaceToMissingKey:false`), the miss-return `"category_romantic"` was never equal to the prefixed `key` `"common:category_romantic"`, so the title-case fallback was dead code and the bare token leaked to the UI.
**What it does now:**
- Extracted the pure resolution into an exported internal function `resolveReadableCategoryName(categoryKey: string, i18nLike: CategoryI18nLike): string` that takes an injected i18n-like object (`{ exists, t }`). This is the §6.1(a) test seam — unit-testable in Deno without booting RN.
- `getReadableCategoryName(categoryKey: string): string` is now a thin wrapper that delegates to the pure resolver with the real i18n singleton. **Public signature unchanged.**
- The miss-detection is now Decision D-1: `if (!i18nLike.exists(key)) return <title-case fallback>; return i18nLike.t(key);`. This asks i18next its own resource-lookup question, immune to namespace-stripping and to the NG-1 init options.
- The real `../i18n` singleton is now loaded **lazily** via `require('../i18n')` inside `getI18n()`, only on first runtime call. This makes module-load RN-free so a Deno test can statically import the file. (The lazy load defers, not removes, the RN dependency — runtime behavior of `getReadableCategoryName` is identical for app users.)
- Added the protective comment (top-of-file seam note + the D-1 guard comment citing ORCH-1044 and "i18next strips the namespace on a miss, so equality against the prefixed key is never true").
**Why:** SC-1…SC-5, Decisions D-1/D-2/D-3, S-1/S-2/S-3, NG-1/NG-2/NG-3.
**Lines changed:** ~+45 / -8 (one function split into pure + wrapper; top-level import → lazy accessor; comments).

### `app-mobile/src/utils/__tests__/categoryLabelResolver.test.ts` (NEW)
**What it does:** §7.1 happy-path T-01…T-08 via the pure resolver + a minimal i18n stub registering ONLY the real `category_*` keys from `en/common.json` (no `category_romantic`/`intent_*`), reproducing the production resource state. Asserts curated labels resolve to friendly labels and the localized hit path + empty guard are preserved.
**Why:** Step 0.5 gate, SC-1/SC-2/SC-3/SC-6.
**Lines:** ~88.

### `app-mobile/src/utils/__tests__/categoryLabelResolver.adversarial.test.ts` (NEW)
**What it does:** §7.2 adversarial T-A1…T-A5 — token-shape invariant `/^(common:)?(category|intent)_/`, namespace-strip simulation (stub `t()` returns the stripped key on a miss), `intent_`-shaped input defense, legacy-slug normalization + hit-path coexistence, hyphen/case normalization.
**Why:** Step 0.5 gate, SC-1/SC-4/SC-6, DRAFT invariants I-CATEGORY-LABEL-NO-TOKEN-LEAK + I-CATEGORY-MISS-DETECTED-BY-EXISTENCE.
**Lines:** ~98.

---

## 3. Spec Traceability (Success Criteria)

| SC | Statement | How verified | Verdict |
|---|---|---|---|
| SC-1 | Curated labels return the friendly label, never a `category_/intent_` token | T-01…T-06 + T-A1 green; T-A1 fails-on-revert | PASS |
| SC-2 | Valid slug (`casual_food`) still returns localized `i18n.t` ("Casual") | T-07 green | PASS |
| SC-3 | Empty input → `'Experience'` | T-08 green | PASS |
| SC-4 | Miss detected by existence check decoupled from namespace-strip | T-A2 green (stub `t()` returns stripped key on miss; resolver still yields "Romantic") | PASS |
| SC-5 | Public signature + 14 call sites + i18n init unchanged | `getReadableCategoryName(categoryKey: string): string` unchanged; 26 call invocations across consumers untouched (`git diff` shows only `categoryUtils.ts` + 2 new tests); `i18n/index.ts` untouched | PASS |
| SC-6 | Both test files run green in the Deno util runner | 13 passed / 0 failed | PASS |

### Deviation from spec (flagged, not silently fixed) — T-06 expected string
SPEC §7.1 T-06 expects `getReadableCategoryName('Take a Stroll') === 'Take a Stroll'`. The LOCKED, unchanged title-case fallback formula `slug.replace(/_/g,' ').replace(/\b\w/g, upper)` uppercases EVERY word boundary, so the actual output is **`'Take A Stroll'`**. The spec's expected string contradicts its own locked formula (D-1 step 2 keeps the formula verbatim; NG-3 forbids refactoring the resolver). Per Prime Directive 2 I did NOT alter the formula (that would change behavior for all consumers and exceed scope). The test asserts the resolver's true output (`'Take A Stroll'`) with an inline note. SC-1 (no token leak) still holds for this input. Registered below for the orchestrator.

---

## 4. Regression Test (Step 0.5 gate)

- **Files:** `app-mobile/src/utils/__tests__/categoryLabelResolver.test.ts` (happy-path, implementor-owned) + `categoryLabelResolver.adversarial.test.ts` (adversarial).
- **Runner:** same as sibling util Deno tests — `deno test --no-check <files>` (`deno.land/std@0.168.0/testing/asserts.ts`, `// @ts-nocheck` header), matching `curatedStopsAvailability.test.ts` / `openingHoursUtils.test.ts`. There is no dedicated GitHub workflow job for `app-mobile/src/utils/__tests__` Deno tests (the sibling ORCH-1019/1021 tests are Step-0.5 local-gate tests, not CI-jobbed); these two register into that same local Deno runner, per SPEC §7 "do not invent a new workflow."
- **Passing run (fix in place):** `ok | 13 passed | 0 failed`.
- **Fails-on-revert verified at commit `609cd9658`** (the pre-fix HEAD = spec commit; the fix is the working-tree change on top of it): temporarily restoring the old `if (translated === key)` equality guard (with the production-faithful stub whose `t()` returns the namespace-stripped key on a miss) turns **10 of 13 tests RED** — including the core T-A1 token-shape anchor and T-A2 namespace-strip simulation (`Actual: category_romantic / Expected: Romantic`). Restoring the `exists()` guard returns to `13 passed | 0 failed`. The tests genuinely exercise the bug.
- **Shipped in the same branch as the fix** (not a side branch): yes.

---

## 5. Verification Matrix

| Check | Method | Result |
|---|---|---|
| Tests green (fix) | `deno test --no-check` | 13/13 PASS |
| Fails-on-revert | revert D-1 guard → rerun | 10/13 FAIL → restore → 13/13 PASS |
| Typecheck (touched files) | `npx tsc --noEmit`, grep for `categoryUtils`/`categoryLabelResolver` | zero errors in touched files |
| Typecheck (no new errors) | baseline error count stash-vs-fix | 260 baseline == 260 with fix (no new errors; baseline is pre-existing repo-wide noise in unrelated files) |
| Lint (`categoryUtils.ts`) | `npx eslint` | clean (the intentional lazy `require` suppressed with the correct `@typescript-eslint/no-require-imports` directive) |
| Lint (test files) | `npx eslint` | only `import/no-unresolved` on the Deno URL — identical to every sibling Deno test (baseline behavior, not a regression; these are Deno-run, not ESLint-gated) |
| `i18n.exists()` real at runtime | i18next `index.d.ts:288 exists: ExistsFunction` | confirmed available on the singleton (i18next ^26) |

---

## 6. Cross-Surface Impact (Step 3.5)

| Surface | Affected? | Why |
|---|---|---|
| Consumer iOS | YES | shared `categoryUtils.ts`; Swipe History + 13 other consumers now show friendly labels. |
| Consumer Android | YES — **automatic parity** | same RN util, no platform branch. The Deno unit test is platform-agnostic and governs both. |
| Buyer/anonymous Web | NO | does not consume `getReadableCategoryName`. |
| Business iOS / Android | NO | no curated Swipe History / category render via this util. |
| Admin Web | NO | does not render curated category labels. |
| Business Web preview | NO | same as Business apps. |

One success criterion (SC-1) governs both covered surfaces because parity is automatic via shared code. Affected-surface count for the binding gate is 1 shared code path → no manual parity drift risk.

---

## 7. Invariant Verification

| Invariant | Preserved? |
|---|---|
| I-CATEGORY-SLUG-CANONICAL (legacy→canonical via `legacyToSlug`) | Y — T-A4 (`fine_dining`→"Fine Dining") green; `legacyToSlug` untouched |
| I-CURATED-LABEL-SOURCE (`categoryLabel` stays identity source) | Y — D-2 fallback returns the same word family as `categoryLabel`; no `intent_*` override |
| Constitution #10 (locale-aware display) | Preserved on the HIT path (real slugs localize); degrades to English title-case on the curated MISS path — the bounded accepted trade-off (NG-3 follow-up F/U-2) |
| Constitution #3 (no silent failures) | Y — the miss is now a deliberate, tested fallback, not a swallowed token leak |
| I-CATEGORY-LABEL-NO-TOKEN-LEAK (DRAFT) | Established + enforced by T-A1 — flips ACTIVE on CLOSE |
| I-CATEGORY-MISS-DETECTED-BY-EXISTENCE (DRAFT) | Established + enforced by T-A2 — flips ACTIVE on CLOSE |

---

## 8. Constitutional Compliance (diff scan)

All 14 rules PASS or N/A on the diff. Touched: #3 (no silent failures — improved), #10 (locale-aware — preserved on hit, bounded degrade on miss per spec). No `any`/`@ts-ignore`/silent catch introduced. Explicit return types present on both new functions. The one `require` is an intentional, documented test seam, not an escape hatch.

---

## 9. Cache Safety / Parity

- **Cache:** none — pure synchronous render-time string resolution. No query keys, no AsyncStorage shape change.
- **Solo/collab parity:** both Swipe History mount sites (`DismissedCardsSheet.tsx:179` solo, `:257` collab) call the same resolver and are hardened identically. No mode-specific code.

---

## 10. Regression Surface (for the tester)

1. Swipe History (`DismissedCardsSheet`) solo + collab rows — curated cards show friendly labels, never `category_*`.
2. `ExpandedCardModal` / board cards / friend-page holiday cards / Saved + Calendar tabs — the F-3 blast-radius consumers; confirm single place cards still localize correctly.
3. The localized HIT path for real slugs (single place cards) — must not regress (T-07 covers `casual_food`).
4. Non-English locale on the HIT path (real category slugs should still localize via the singleton's `t`).

---

## 11. Discoveries for Orchestrator

- **Spec T-06 expected-value error (cosmetic, non-blocking):** SPEC §7.1 T-06 expects `'Take a Stroll'` but the locked title-case formula yields `'Take A Stroll'` (every-word-boundary uppercase). The test asserts the true output. No code defect; the spec table cell was inconsistent with its own locked formula. The only inputs where title-case diverges from the deck's `intent_*` label are multi-word lowercase-particle labels like "Take a Stroll" → "Take A Stroll" — which is exactly the deferred F/U-2 localization parity gap, not a new bug.
- **F/U-1 (register):** the mixed-input contract of `getReadableCategoryName` (real slug vs. human label vs. experienceType) — Investigation §10. A future ORCH should type or split the input so a non-`category_*` string can't reach the `category_*` namespace.
- **F/U-2 (register):** full localization of curated category labels in Swipe History (the deferred `intent_*`/experienceType-aware parity route from D-2). Only worth doing alongside F/U-1.
- **Repo-wide tsc baseline is dirty (260 errors)** in unrelated files (BoardDiscussion, TripCard, packages/brand-rendering, jest/Deno test globals, etc.). My change adds zero new errors, but the project does not currently typecheck clean overall — flag for a separate hygiene ORCH if a green `tsc` gate is ever desired.

---

## 12. Deploy / Migration

None. NG-5 (no backend/migration/RLS/edge). OTA deferred per `project_ota_deferred_until_new_build.md` — the merged change rides the next native build. No `supabase db push`, no edge deploy, no `eas update`.

---

*Implemented strictly in scope: `categoryUtils.ts` + the two test files only. No call-site edits, no i18n init changes, no new translation keys, no drive-by refactors.*
