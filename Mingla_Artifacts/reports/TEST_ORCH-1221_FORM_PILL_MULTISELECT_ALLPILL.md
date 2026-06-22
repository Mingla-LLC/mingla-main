# TEST — ORCH-1221 [Form pill multi-select + "All of it" select-all]

**Tester:** mingla-tester (independent adversarial gatekeeper)
**Branch:** `1220-form-pill-multiselect-allpill` (canonical ORCH-ID **1221**)
**Baseline:** rebased clean on `origin/main` (branch was 3 commits ahead, up to date)
**Date:** 2026-06-22
**Surfaces under test:** marketing-web (explorer `/` + organiser `/organisers`) + backend (edge fn array validator + migration `text→text[]`).

---

## 1. VERDICT — **PASS**

Every contract in the dispatch is proven with runtime evidence:
- **Contract 1 (explorer "All of it" = select-all):** PROVEN in a real headless Chromium against the running dev server — tap selects all 5, tap again clears, 4/4 specifics auto-highlights "All of it" (and ONLY at 4/4), deselecting one un-highlights, and tapping "All of it" from a partial selection SELECTS ALL (not a dumb independent toggle). Still multi-select, Next-gated, no auto-advance.
- **Contract 2 (organiser brand-type multi-select):** PROVEN in browser — multiple business-type chips stay simultaneously selected (NOT single-select-replace), Next disabled at 0 / enabled at ≥1, deselect clears just that chip, no auto-advance.
- **Contract 3 (backend):** edge-fn array validation PROVEN by Deno suite (38/38); migration `text→text[]` PROVEN on a real ephemeral PG15 against the actual ORCH-1045 baseline — the 1 real prod lead preserved as `{restaurant}`, empty/bogus/mixed rejected, multi-value accepted, idempotent on re-apply, admin RPC returns `text[]`.

No P0/P1 found. No blocking conditions. Deploy conditions are the standard "migration + edge fn ship together, in the same release" coupling (already flagged by the implementor).

> **Note on a transient false alarm during testing:** my first browser run showed 3 FAILs (re-tap of "All of it" appearing to no-op). This was a **test-harness artifact** — `evaluateHandle`-based clicks went stale across React re-renders and silently did not land (the deselect path passing while the re-tap "failed" was the tell). Switching to auto-retrying Playwright locators yielded **26/26 PASS**. The product is correct; the first harness was not. Documented here so the false signal is not mistaken for a real regression.

---

## 2. P0 / P1 / P2

- **P0:** none.
- **P1:** none.
- **P2 (non-blocking, pre-existing / out of ORCH-1221 scope):**
  - **P2-a — CI does NOT run the reducer / edge-fn unit tests.** The marketing package has no jest/vitest runner; the edge-fn Deno tests are not in the `DENO_TEST_FILES` allowlist (implementor §7 acknowledges this). CI-enforced protection for ORCH-1221 is the strict-grep gates only (1219 amended + 1221 new), which DO run as blocking jobs. The reducer/edge tests (mine + the implementor's) are runnable locally and prove fails-on-revert, but a future regression that keeps the gate-required structural tokens while breaking the reducer LOGIC would not be caught by CI. The gates lock the *shape* (select-all branch, delegation, `every()` derive); they do not execute the reducer. Acceptable for this fast-follow but worth a follow-on (wire a marketing/edge test runner into a blocking CI job).
    Repro: `node .github/scripts/strict-grep/i-proposed-1221-allpill-selects-all.mjs` passes on shape alone; the reducer's runtime correctness rides on the (CI-unwired) unit tests.

---

## 3. Runtime evidence (browser) — what each screenshot proves

All under `Mingla_Artifacts/evidence/ORCH-1221/`. Driven by Playwright 1.61 headless Chromium against the real Next dev server (`localhost:3717`), reading each chip's live `aria-pressed` for ground truth. **26/26 browser assertions PASS.**

| File | Proves |
|---|---|
| `01-explorer-step1-initial.png` | Explorer modal open, Step 1 of 2, all 5 chips unselected, Next disabled (length-0 gate). |
| `02-explorer-allofit-selects-all.png` | **One tap of "All of it" → ALL 5 chips filled + checked** (Places/Events/Trips/Experiences/All of it), Next enabled. True select-all. |
| `03-explorer-allofit-clears.png` | **Tapping "All of it" again → every chip cleared**, Next disabled again. Set/clear, not self-toggle. |
| `04-explorer-4specifics-allauto.png` | Selecting the 4 specifics one-by-one → "All of it" AUTO-highlights, and only at 4/4 (verified 1/4, 2/4, 3/4 = NOT highlighted). |
| `05-explorer-deselect-one-allunhighlights.png` | Deselecting one specific (Trips) → "All of it" un-highlights, only that chip clears, others stay, `'all'` removed; Next still enabled (≥1). |
| `05b-explorer-allofit-from-partial.png` | From a partial selection, tapping "All of it" SELECTS ALL — the key differentiator from a dumb independent toggle. |
| `06-organiser-step1-initial.png` | Organiser modal open, Step 1 of 3, 7 chips, none selected, Next disabled; copy "Pick all that fit — you can choose more than one." |
| `07-organiser-multiselect-3chips.png` | **Restaurant + Club/Nightlife + Venue/Space all simultaneously selected** (3 distinct chips checked), others unselected. NOT single-select-replace. |
| `08-organiser-cleared.png` | After deselecting all chips, none pressed, Next disabled again (length-0 gate restored). |

Browser-asserted (selected list): no-auto-advance verified on both forms (explorer still "Step 1 of 2" / organiser still "Step 1 of 3" after every chip tap).

---

## 4. Adversarial test (my OWN — different angle) + fails-on-revert proof

**Path:** `mingla-marketing/lib/explorer-interest.tester.test.ts` (NEW, committed on branch).

**Angle (distinct from the implementor's happy-path file):** attacks the **representation seam** between the pure reducer and the modal. The modal derives the "All of it" chip state INDEPENDENTLY via `SPECIFIC_INTERESTS.every((v) => interest.includes(v))` — *independently of whether the stored array literally carries `'all'`*. The modal comment even claims it is "robust to either representation." That is only safe if the reducer canonicalizes correctly under NON-canonical inputs. 7 adversarial cases:

1. `prev` has all specifics but NO `'all'` sentinel → tapping "All of it" CLEARS (idempotent select-all, not a stray-add).
2. STRAY `'all'` present while NOT all specifics selected → next specific toggle DROPS the orphan `'all'`.
3. STRAY `'all'` + partial → tapping "All of it" SELECTS ALL (not a clear).
4. Duplicate specifics in `prev` collapse to a single canonical entry (de-dup).
5. Output is ALWAYS `INTEREST_VALUES` order regardless of toggle order (order-invariance).
6. **The "lying-chip" guard:** reducer-stored `'all'` and modal-derived all-chip NEVER disagree across a full toggle walk (on/off).
7. A non-enum value is contained to the specifics set (no crash, no enum corruption).

**Real path (same tsc→node mechanism as the implementor's file):**
```
npx tsc lib/explorer-interest.ts lib/explorer-interest.tester.test.ts \
  --outDir /tmp/o --module commonjs --target es2020 --esModuleInterop \
&& node /tmp/o/explorer-interest.tester.test.js
→ All 7 ORCH-1221 tester adversarial tests passed
```

**Fails-on-revert PROVEN:** reverted `nextInterest` to a dumb plain independent toggle (`prev.includes(value) ? filter : [...prev, value]`) — the exact regression the contract forbids. **All 7 adversarial cases FAILED** (exit 1), including the lying-chip guard catching `derived(true) !== stored 'all'(false)` at the fully-selected array. Restored from backup → file byte-identical to committed (`git status` clean) → 7/7 green again. (Revert was on the working copy only; never committed.)

---

## 5. Migration proof (real ephemeral PG15, NOT capped at "suspected")

Docker `postgres:15-alpine`. Created Supabase roles (`anon`/`authenticated`/`service_role bypassrls`), applied the **real ORCH-1045 baseline** (`20260817000000_orch_1045_beta_access_leads.sql`), seeded the 1 real scalar prod lead (`brand_type='restaurant'`), applied ORCH-1221, asserted, re-applied for idempotency, tore down.

```
PRE  brand_type ......................... text (scalar)
A1   brand_type after migrate ........... ARRAY / _text  (= text[])        ✓
A2   existing scalar prod row ........... {restaurant}  (len 1)  preserved  ✓
A3   empty array '{}' ................... REJECTED (beta_access_leads_brand_type_arr_chk)  ✓
A4   multi-value {restaurant,club_nightlife} → ACCEPTED, stored exactly     ✓
A5   bogus {hacker} ..................... REJECTED (arr_chk)                 ✓
A6   mixed valid+bogus {venue_space,evil} REJECTED (arr_chk)                ✓
A7   re-apply migration (idempotency) ... CLEAN; type still ARRAY; prod row still {restaurant}  ✓
A8   admin_beta_leads_list() ............ declared brand_type text[]; returns {restaurant} as text[]  ✓
A9   all 7 enum values (1-element arrays) ALL 7 accepted                    ✓
```

The cardinality CHECK (`cardinality(brand_type) >= 1`) is the correct empty-array guard — confirmed `{}` is rejected (the migration's comment about `array_length` returning NULL for `{}` is precisely why `cardinality` is used).

---

## 6. Gate / Deno / tsc / append-only results (exact counts)

| Check | Result |
|---|---|
| Marketing `tsc --noEmit` (full project, incl. my new `.tester.test.ts`) | **0 errors** |
| Edge-fn Deno suite (`beta-access-lead-submit/__tests__/`) | **38 passed, 0 failed** |
| Implementor reducer happy-path (`explorer-interest.test.ts`) | 7/7 (re-verified via tsc→node) |
| My adversarial reducer (`explorer-interest.tester.test.ts`) | **7/7 passed; 7/7 fail-on-revert proven** |
| Strict-grep — 1216/1219/1221 family (8 gates, self-test + live) | **8 PASS / 0 fail** (incl. 1221-new self-test 6/6, 1219-amended self-test 9/9) |
| Strict-grep — 0785 family (5 gates, self-test + live) | **5 PASS / 0 fail** |
| `test-append-only-check.js` (`GITHUB_BASE_REF=main`) | **6 passed, 0 failed** (5 modified edge tests carry `[TEST-MOD-APPROVED ORCH-1221]`; reducer test ADDED) — note: run before my adversarial test was committed; my file is an ADD (always allowed). |

**CI wiring confirmed:** both gate jobs are blocking standalone jobs in `strict-grep-mingla-business.yml` (`orch-1219-form-no-autoadvance-multiselect` @L3025, `orch-1221-allpill-selects-all` @L3051), each running `--self-test` + live, and the workflow triggers on `mingla-marketing/**`, `supabase/migrations/**`, `supabase/functions/**`, and `.github/scripts/strict-grep/**` — all paths ORCH-1221 touches. The gates WILL run on this PR.

---

## 7. Renumber cleanliness — CLEAN

Swept every ORCH-1221-changed file for stray `ORCH-1220` / `I-PROPOSED-1220` / `orch_1220` / `orch-1220`. The ONLY 1220 hits are the **unrelated reviewer-bypass** gate/job in `strict-grep-mingla-business.yml` (`orch-1220-reviewer-bypass-locked` @L3038, the shipped #646) — exactly the one legit 1220 the dispatch carves out. All ORCH-1221 in-code/gate/migration tokens are `1221` / `orch_1221`. No stray 1220 in the reducer, modal, transport, edge fn, migration, tests, or the two ORCH-1221 gates.

---

## 8. Post-deploy-only conditions (not blockers — standard release coupling)

1. **Ship migration + edge fn in the SAME release.** A deployed array-validator inserting into a still-scalar `brand_type` column (or vice-versa) errors. The migration `20261126000000_orch_1221_beta_access_brand_type_multi.sql` + the `beta-access-lead-submit` edge fn must go out together. (Implementor §7 already flags this.)
2. **The 1 real prod lead is preserved** by `using array[brand_type]` — verified on the ephemeral baseline, but re-confirm the prod row count/value before+after the live apply (the migration is idempotent + guard-safe, so a re-run is harmless).
3. **Marketing-web transport** (`brandType: string[]`) is pure-JS → ships via the normal Vercel deploy; no native build, no OTA.
4. **No live emails were fired** during testing (the edge-fn notify/welcome paths were exercised only via the Deno suite's pure builders + a no-env handler that stops at the DB layer). The live Resend send remains a post-deploy smoke item (submit one real organiser lead, confirm the notify email renders "Business type(s)" comma-joined).

---

## Artifacts
- This report: `Mingla_Artifacts/reports/TEST_ORCH-1221_FORM_PILL_MULTISELECT_ALLPILL.md`
- Adversarial test: `mingla-marketing/lib/explorer-interest.tester.test.ts`
- Screenshots: `Mingla_Artifacts/evidence/ORCH-1221/*.png` (9 frames)
- Browser driver (not committed; ephemeral): `/tmp/orch-1221-tester/pw/drive.mjs`
