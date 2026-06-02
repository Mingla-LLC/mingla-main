# QA — ORCH-1044 [Swipe-History category slug leak: category-label resolver hardening]

- **ORCH:** ORCH-1044
- **Mode:** TARGETED (offline unit + invariant; live render deferred to batched signed-in session per dispatch)
- **Date:** 2026-06-02
- **Tester:** mingla-tester (Claude)
- **Branch / worktree:** `ORCH-1044-swipe-history-category-slug-leak` @ `~/Desktop/mingla-orchs/ORCH-1044-[swipe-history-category-slug-leak]/`
- **Code under test:** commit `2ff371116` — `app-mobile/src/utils/categoryUtils.ts` + 2 implementor Deno tests.
- **Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-1044_CATEGORY_LABEL_RESOLVER.md` (APPROVED, `609cd9658`).
- **Implementation report:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1044_CATEGORY_LABEL_RESOLVER.md`.
- **Comms ledger:** read on entry. No `BLOCK`+`OPEN` row targets `mingla-tester`, `ORCH-1044`, or `ALL`. The open `ALL`-WARN rows are all N/A to this scope: COMMS-0002 (strict-grep `no-new-backend-files`) — no `supabase/functions/` file touched; COMMS-0003 (external-API docs at SPEC) — i18next is a bundled library, no network API/enum/payload introduced; COMMS-0004 (ORCH-ID intake collision) — no new ID claimed; COMMS-0012/0015 (deploy/migration hygiene) — no deploy, no migration, no edge fn. Noted, not acked (FYI-grade for this scope).

---

## VERDICT: PASS

- **P0:** 0 | **P1:** 0 | **P2:** 0 | **P3:** 0 | **P4:** 2
- **Report:** `Mingla_Artifacts/reports/QA_ORCH-1044.md`
- **Unit evidence:** `/Users/sethogieva/.deno/bin/deno test --no-check --allow-read` over all 3 suites → **21 passed | 0 failed**.
- **Regression tests:** implementor = `categoryLabelResolver.test.ts` (8, happy-path) + `categoryLabelResolver.adversarial.test.ts` (5, adversarial) — ✅ independently re-confirmed fails-on-revert (10/13 RED when the old equality guard is restored). tester = `categoryLabelResolver.fullcorpus.test.ts` (8, distinct full-corpus + inverse-config angle) — ✅ green, ✅ fails-on-revert (T-T2 + T-T6 RED under old guard).
- **Sim evidence:** DEFERRED corroboration, not a blocker. This is a deterministic, pure synchronous string-resolution fix in a shared RN util with no platform branch; the binding gate is the platform-agnostic Deno unit suite (per SPEC §5/§7). Live Swipe-History on-screen render (`DismissedCardsSheet` solo `:179` + collab `:257`) is explicitly deferred to the batched orchestrator-run signed-in session per dispatch. Confidence ladder: `proven` at the unit + invariant layer; live render = corroboration item carried to the batch.

### Verdict-gate justification (the offline-PASS carve-out)
The standing tester gate normally requires `proven`-level live-fire sim repro for any UI/runtime finding. The dispatch explicitly authorizes an offline PASS here on the basis that the fix is (a) a pure deterministic resolver, (b) unit-proven across 21 assertions, (c) fails-on-revert at the exact pre-fix guard, and (d) governed by a token-shape invariant that is machine-checkable without a device. The render is corroboration, not the gate. This is consistent with the source-only exemption band for "pure logic, no platform branch" — the unit suite IS the parity gate because parity is automatic via shared code (one resolver, no `Platform.select`). The live render is queued, not skipped.

---

## 1. Layman Summary

The "cards you viewed this session" list was showing an internal code (`category_romantic`) instead of a friendly label ("Romantic"). The fix swaps a broken string-equality check for i18next's own `exists()` lookup inside the single shared helper that ~14 screens use, so the friendly title-case fallback now fires on a missing translation. I re-ran the implementor's 13 tests (all green), independently confirmed they go red if the fix is reverted, wrote a distinct 8-test adversarial suite (full real-locale-corpus sweep + the inverse i18next miss-config the existing tests never touch), confirmed it also goes red on revert, and statically verified the public signature, all 14 call sites, the i18n init, and `common.json` are untouched. The cosmetic "Take A Stroll" vs "Take a Stroll" spec deviation is adjudicated non-blocking. Verdict: PASS on unit + invariant evidence; the on-screen Swipe-History render is carried to the batched signed-in session as corroboration.

---

## 2. Independent Test Execution (captured)

### 2.1 Both existing suites — 13/13 (Do-now step 1)
`cd app-mobile/src/utils/__tests__ && deno test --no-check categoryLabelResolver.test.ts categoryLabelResolver.adversarial.test.ts`
```
running 8 tests from ./categoryLabelResolver.test.ts   → T-01…T-08 ok
running 5 tests from ./categoryLabelResolver.adversarial.test.ts → T-A1…T-A5 ok
ok | 13 passed | 0 failed (32ms)
```
Existing tests were NOT modified (append-only honored — the diff adds only the new file).

### 2.2 Tester adversarial suite — 8/8 (Do-now step 2)
New file: `app-mobile/src/utils/__tests__/categoryLabelResolver.fullcorpus.test.ts` (T-T0…T-T7).
`deno test --no-check --allow-read categoryLabelResolver.fullcorpus.test.ts` → `ok | 8 passed | 0 failed`.

**Distinct angle vs. the two existing suites (not a renamed copy):**
| Surface | Existing suites | This suite |
|---|---|---|
| Stub seed | 3–11 hand-picked keys | **FULL real en/common.json corpus** (23 `category_*` keys) read **live** from the locale file at test time — tracks the real resource state, catches a future label edit that introduces a token-shaped value |
| Miss config | strip only (`appendNamespaceToMissingKey:false`) | **BOTH** strip AND the **inverse prefixed-key config** (`:true`) — proves the fix is immune to the config flip NG-1 forbids, a surface the old equality guard happened to survive under one config but not the other |
| Curated coverage | 6 hand-listed labels | **every real `intent_*` deck label** (the 6 from corpus) swept as human-label input |
| HIT path | `casual_food` only | `casual_food` + `upscale_fine_dining` + `nature` under both configs + legacy-alias `fine_dining`→`Fine Dining` |
| Empty guard | one config | both configs |

T-T2 confirms the localized HIT path still works for real slugs and every curated label resolves token-free; T-T4/T-T5 assert real slugs return their real labels ("Casual", "Fine Dining", "Nature & Views") — Do-now step 2's "localized HIT path still works" requirement is satisfied at full corpus fidelity.

**Real finding surfaced by my own test (resolved correctly, not a defect):** my first T-T1 draft asserted every `category_*` key's slug returns its own verbatim label. It failed on `brunch_lunch_casual` — because `legacyToSlug` intentionally canonicalizes `brunch_lunch_casual` → `brunch` (ORCH-0597), so the resolver returns "Brunch", not the corpus's own `category_brunch_lunch_casual` value. This is the documented canonicalization contract (I-CATEGORY-SLUG-CANONICAL), not a bug. I corrected the test to assert the **binding no-token-leak invariant for ALL real slugs** and exact-label identity only for non-legacy-remapped slugs. This is a P4 note that the resolver's legacy-remap and the locale corpus both legitimately carry overlapping keys.

### 2.3 All three suites together, fix in place
`deno test --no-check --allow-read categoryLabelResolver.test.ts categoryLabelResolver.adversarial.test.ts categoryLabelResolver.fullcorpus.test.ts` → **`ok | 21 passed | 0 failed (61ms)`**.

`deno check` (type) on all three test files → clean (`Check ...` ×3; `// @ts-nocheck` headers match the sibling Deno-util convention).

---

## 3. Fails-on-Revert — Independently Re-verified (Do-now step 3)

I did NOT trust the implementor's claim. Method: backed up the working `categoryUtils.ts`, restored the OLD guard verbatim inside the pure resolver — `const translated = i18nLike.t(key); if (translated === key) { …title-case… } return translated;` — re-ran, then restored the fix.

| Suite | Fix in place | Old equality guard restored |
|---|---|---|
| `categoryLabelResolver.test.ts` (8) | 8 ok | **6 FAIL** (T-01…T-06 leak `category_romantic` / `category_take a stroll`); T-07/T-08 still pass (hit + empty don't depend on miss-detection) |
| `categoryLabelResolver.adversarial.test.ts` (5) | 5 ok | **4 FAIL** (T-A1/T-A2/T-A3/T-A5); T-A4 passes (hit path) |
| **`categoryLabelResolver.fullcorpus.test.ts` (8, tester)** | 8 ok | **2 FAIL** (T-T2 curated labels leak tokens; T-T6 raw input echoes `category_category_romantic`) |

Combined: restoring the broken guard turns **12 of 21** tests RED across the three suites; restoring the `exists()` guard returns all to green. The tests genuinely exercise the reported leak — confirmed independently, not by reading the implementor's claim.

**Sharp observation (strengthens, not weakens, the verdict):** my T-T3 (inverse prefixed-key config) does NOT fail on revert — and that is correct and meaningful. Under `appendNamespaceToMissingKey:true`, `t()` returns the prefixed `common:category_romantic`, which the old `translated === key` guard WOULD have caught (equality holds), so the fallback would fire under that config. The bug only manifests under the prod-default strip config. T-T3 documents that the `exists()` fix is robust to BOTH configs whereas the old guard was accidentally correct under one — exactly the fragility Decision D-1 was chosen to eliminate (decoupled from the NG-1 init options). The adversarial value of T-T3 is forward-regression protection against an NG-1 config flip, not the original repro.

---

## 4. Spec Compliance Matrix (Do-now step 4)

| SC | Statement | Verification (captured) | Verdict |
|---|---|---|---|
| SC-1 | Curated labels return friendly label, never `/^(common:)?(category\|intent)_/` | T-01…T-06 + T-A1 + T-T2 green; all fail-on-revert | PASS |
| SC-2 | Valid slug (`casual_food`) still returns localized `i18n.t` ("Casual") | T-07 + T-T4 green | PASS |
| SC-3 | Empty input → `'Experience'` | T-08 + T-T7 green (both configs) | PASS |
| SC-4 | Miss detected by existence check decoupled from namespace-strip | T-A2 (strip) + T-T3 (prefixed/inverse config) green — fix survives BOTH miss shapes | PASS — **strengthened** beyond spec (spec only required strip-immunity; tester proved config-flip immunity too) |
| SC-5 | Public signature + 14 call sites + i18n init unchanged | `getReadableCategoryName(categoryKey: string): string` unchanged (line 162); `git diff origin/main...HEAD --name-only` shows **0** files under `src/components`, `src/services`, `src/i18n`, `src/i18n/locales` — only `categoryUtils.ts` + 2 tests + 3 docs. 26 call invocations across 11 consumer files untouched. | PASS |
| SC-6 | Both test files run green in the Deno util runner | 13/13 (existing) + 8/8 (tester) = 21/21 | PASS |

NG verification: NG-1 (i18n init untouched — 0 diff in `src/i18n`), NG-2 (no new/renamed keys — 0 diff in `src/i18n/locales`), NG-3 (mixed-input contract not refactored — title-case formula verbatim), NG-4 (`CuratedExperienceSwipeCard.tsx` untouched — not in diff), NG-5 (no backend/migration/RLS/edge — 0 `supabase/` diff). All HELD.

---

## 5. T-06 "Take A Stroll" vs "Take a Stroll" Adjudication (Do-now step 5)

**Finding (P4 — cosmetic, NON-BLOCKING).** SPEC §7.1 T-06 expects `getReadableCategoryName('Take a Stroll') === 'Take a Stroll'`, but the LOCKED, unchanged title-case fallback formula `slug.replace(/_/g,' ').replace(/\b\w/g, c => c.toUpperCase())` uppercases every word boundary → actual output `'Take A Stroll'`. The implementor correctly asserted the resolver's true output and flagged the spec-table inconsistency rather than silently altering the formula (which would change behavior for all consumers and violate NG-3).

**Adjudication: does NOT block.**
1. The spec's own LOCKED formula (D-1 step 2) produces `'Take A Stroll'`; the §7.1 expected-string cell contradicts the formula it locks. The implementor obeyed the formula (Prime Directive: code is right, don't weaken the contract to match a typo in the expected column).
2. SC-1 — the binding success criterion — holds: `'Take A Stroll'` does NOT match `/^(common:)?(category|intent)_/`. The token leak (the actual bug) is gone. T-A1 + T-T2 prove it.
3. The only inputs where title-case diverges from the deck's `intent_*` label are multi-word lowercase-particle labels ("Take a Stroll" → "Take A Stroll"). The deck's localized `intent_take_a_stroll` = "Take a Stroll" is the correct product copy, reachable only via the deferred F/U-2 localization route (D-2). Swipe History intentionally falls back to title-case of the card's own `categoryLabel` — internally consistent with the card's identity field, just with naive particle-casing.
4. User impact: a curated Swipe-History row may read "Take A Stroll" instead of "Take a Stroll". Cosmetic title-casing of one particle; not a token, not a wrong word, not misleading. Maps cleanly to the already-registered F/U-2 (full curated-label localization). 

**Routing:** record T-06 as resolved-by-adjudication; it is the deferred-localization follow-up (F/U-2), not a new defect or a rework trigger.

---

## 6. Constitution (diff scan)

| # | Rule | Verdict |
|---|---|---|
| 3 | No silent failures | PASS — the miss is now a deliberate, tested fallback; the swallowed token leak is gone |
| 10 | Currency/locale-aware | PASS on HIT path (real slugs localize); bounded English title-case degrade on the curated MISS path per spec-accepted trade-off (F/U-2 registered) |
| 1,2,4,5,6,7,8,9,11,12,13,14 | — | N/A — pure synchronous string util; no state ownership, no async, no auth, no cache, no datetime, no persisted-state, no currency |

No `any`, no `@ts-ignore`, no silent catch introduced. The one `require('../i18n')` is the documented lazy test-seam (S-3), suppressed with the correct ESLint directive — an intentional, commented seam, not an escape hatch (P4 praise: clean, well-justified, with a protective anti-regression comment block).

---

## 7. Cross-Domain / Parity

- **Solo + collab parity:** both Swipe-History mount sites call the same resolver — `DismissedCardsSheet.tsx:179` (solo, `card.category`) + `:257` (collab, `cd.category ?? ''`). Hardened identically; no mode-specific branch. Verified by grep.
- **iOS + Android parity:** shared RN util, no `Platform.select`. The Deno unit suite is the platform-agnostic binding gate for both (SPEC §5). No per-platform divergence possible.
- **Other surfaces:** Business apps / Admin / buyer-anon web do NOT consume `getReadableCategoryName` — not affected (SPEC §5 #3–#7).
- **Blast radius (11 consumer files / 26 invocations):** all inherit the fix without edits; the resolver is the single owner of the label string. No competing owner.

---

## 8. Deferred Corroboration (for the batched signed-in session)

Carry to the orchestrator-run signed-in batch (NOT a blocker for this PASS):
1. **Swipe History `DismissedCardsSheet` — solo (`:179`):** open a solo deck, left-swipe a curated experience card, open Swipe History → the row reads the friendly label (e.g. "Romantic"), never `category_romantic`.
2. **Swipe History `DismissedCardsSheet` — collab (`:257`):** in a group/collab deck, confirm dismissed curated cards in the shared sheet also show friendly labels.
3. **Single place card (HIT path regression):** confirm a real category slug card still shows its localized label (e.g. "Casual") — T-07/T-T4 cover this offline; eyeball confirms no single-card regression.
4. **Non-English locale on HIT path:** real `category_*` slugs still localize via the singleton's `t` (the fallback only triggers on a miss).

---

## 9. Discoveries for Orchestrator

- **P4 — Spec T-06 expected-value typo (cosmetic):** §7.1 expects "Take a Stroll" but the locked formula yields "Take A Stroll". Resolved by adjudication (§5); maps to existing F/U-2. No code change.
- **P4 — Locale corpus + legacy-remap overlap (note, not a defect):** `en/common.json` carries `category_*` keys for legacy slugs (`brunch_lunch_casual`, `fine_dining`, `casual_eats`, `watch`, `live_performance`, …) that `legacyToSlug` canonicalizes to a DIFFERENT slug, so resolving the legacy slug returns the canonical label, not the legacy key's own value. Surfaced by my T-T1 first draft; corrected by asserting the no-token-leak invariant for all + exact identity only for non-remapped slugs. Consistent with I-CATEGORY-SLUG-CANONICAL. Worth a future hygiene pass to prune dead legacy `category_*` keys from `common.json` alongside F/U-1, but harmless today.
- **DRAFT invariants ready to flip ACTIVE on CLOSE:** I-CATEGORY-LABEL-NO-TOKEN-LEAK (enforced by T-A1 + T-T1/T-T2/T-T6) and I-CATEGORY-MISS-DETECTED-BY-EXISTENCE (enforced by T-A2 + T-T3). The tester suite adds independent enforcement of both.
- **F/U-1 / F/U-2** remain registered (mixed-input typing; full curated-label localization). Not in scope.
- **No CI workflow job** runs `app-mobile/src/utils/__tests__` Deno tests today (these are Step-0.5 local-gate tests, matching the ORCH-1019/1021 sibling pattern). The three files register into that same local Deno runner; no new workflow invented (per SPEC §7). Flag for the orchestrator if a CI-jobbed gate for these is ever desired.

---

## 10. Completion Condition Audit (/goal)

| Clause | Status |
|---|---|
| Both existing Deno tests re-run 13/13 | ✅ captured §2.1 |
| Committed passing SECOND adversarial test, distinct angle | ✅ `categoryLabelResolver.fullcorpus.test.ts`, 8/8, full-corpus + inverse-config angle (§2.2) — committed this turn |
| Fails-on-revert re-confirmed (independent) | ✅ 12/21 RED under restored old guard; restored fix → 21/21 (§3) |
| SC-1…SC-6 + no-token invariant verified | ✅ §4 matrix, all PASS; SC-4 strengthened |
| T-06 adjudicated | ✅ §5 — cosmetic, non-blocking, maps to F/U-2 |
| Verdict report routed to orchestrator | ✅ this file + Section B handoff |
| Live-fire sim | DEFERRED per dispatch — corroboration, not gate (offline-PASS carve-out justified §VERDICT) |
| Zero open P0/P1 | ✅ 0 P0, 0 P1 |

PASS holds on every required clause; the only deferral is the dispatch-authorized live render.
