# QA — ORCH-1068 [business-authored venues render on the consumer deck]

**Skill:** mingla-tester (TEST mode) · **Date:** 2026-06-03
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1068-[business-venues-render-on-deck]/` on branch `ORCH-1068-business-venues-render-on-deck`
**SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-1068_BUSINESS_VENUES_RENDER_ON_DECK.md`
**Impl report:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1068_BUSINESS_VENUES_RENDER_ON_DECK.md`
**Scope of this pass:** code-level + regression + live read-only DB probe. SC-ACCEPT (iOS/Android sim acceptance + deploy) is OWNED BY THE ORCHESTRATOR per dispatch — explicitly out of scope here.

## Verdict: CONDITIONAL PASS

- P0: 0 | P1: 0 | P2: 0 | P3: 0 | P4: 2
- Sim evidence: **EXEMPT for this pass** — backend/SQL-only change (edge functions + migration); the SPEC routes the live-fire SC-ACCEPT sim leg to the orchestrator's CLOSE (db push + edge deploy + iPhone 17 Pro / Android emu). This QA verified every code-level + regression + live-data clause it owns. The CONDITIONAL qualifier is SOLELY the deferred SC-ACCEPT sim leg, which the dispatch assigned to the orchestrator — not a fixable blocker this skill is dodging.
- Regression tests: implementor=`supabase/functions/_shared/__tests__/businessHoursToGoogle.test.ts` (13 tests, green, fails-on-revert verified by implementor @ `9e3aebcce` on top of `e415a087b`; re-verified by me below) | tester=`supabase/functions/_shared/__tests__/businessHoursToGoogle.adversarial.test.ts` (4 tests, green, fails-on-revert verified) | both in `git diff origin/main...HEAD --name-only`.

### Why CONDITIONAL not PASS
The only unmet `/goal` clause is the UI/runtime sim leg (SC-ACCEPT), which the dispatch hard-assigned to the orchestrator ("the orchestrator owns the live sim acceptance + deploy"). Every code-level, regression, type-check, strict-grep, and live read-only DB clause this pass owns is GREEN with captured output. Zero open P0/P1. The orchestrator must complete SC-ACCEPT (Lantern & Vine renders on the Raleigh Drinks deck with its real photo hero, on both sims) before final CLOSE.

---

## 1. Comms ledger
Read on entry. No `BLOCK`/`OPEN` row addressed to `mingla-tester`, `ORCH-1068`, or `ALL` requiring action. COMMS-0002/0003/0018 (WARN) already acked by SPEC + implementation and respected by this change (allowlist in same commit; docs cited; built additively on reconciled pipeline). No new cross-ORCH discovery → no new COMMS entry.

---

## 2. Contract table (file:line → verified)

| Contract | File:line | Verified |
|---|---|---|
| Weekday map `day=(weekday+1)%7` (0=Mon→1, 6=Sun→0) | `_shared/businessHoursToGoogle.ts:59-61` (`((trunc(w)%7)+8)%7` ≡ `((w%7)+1)%7`) | T-02 + live probe (all 3 venues) + AX-2 (negative/huge clamp) |
| `parseHm` "HH:MM[:SS]"→{hour,minute}, rejects junk/out-of-range | `:64-75` | parseHm test + AX-2 |
| `isClosed` row → no period | `:125-128` | T-04 |
| Unparseable time row → skipped (no period) | `:130-138` | AX-2 |
| Overnight (`close<=open`) → `close.day=(googleDay+1)%7` | `:144-152` | T-03 + AX-1 (end-to-end across midnight) |
| `openNow` always `null` (Constitution #12) | `:164` | T-01, AX present |
| `isBusinessHoursArray` guard (array→true, Google obj→false) | `:81-90` | T-05, AX-3 |
| `normalizeBusinessHoursForPool` idempotent pass-through on Google obj | `:175-188` | AX-3 (referential no-op) |
| discover-cards `isOpenAtHour` array branch BEFORE `.periods` | `discover-cards/index.ts:282-284` | T-06/07, AX-1 |
| discover-cards `hasOpeningData` array branch | `:314-316` | T-09 |
| discover-cards `isOpenAnyTimeOnDay` array branch | `:353-357` | (logic verified) |
| Hero picker: first non-video url; `images` keeps full list | `:506-509, 535-536` | T-11 |
| curated `isStopOpenAtHour` array branch after honest-unknown, before `.periods` | `_shared/curatedStopHours.ts:187-189` | T-10/T-13 (fails-on-revert), AX-4 |
| Pipeline normalize at BOTH place_pool write sites | `run-business-place-authoring-pipeline/index.ts:539, 599` (import `:14`) | grep-confirmed; `:362` is a Google-place read-pass, not a business write (correctly untouched) |
| Backfill scoped `business_author_brand_id IS NOT NULL AND jsonb_typeof='array'`, idempotent | `migrations/20260905000000_*.sql:138-149` | live probe (0 remaining, 0 Google touched) |
| C7 allowlist (migration + converter + both tests + 3 edge fns) same commit | `strict-grep/orch-0863-marketing-hub-phase-b.mjs:1584-1591` | gate run exit 0, C7 OK |

---

## 3. Captured runs

**Implementor happy-path suite (13 tests):**
```
deno test --allow-read functions/_shared/__tests__/businessHoursToGoogle.test.ts
ok | 13 passed | 0 failed (80ms)
```

**Tester adversarial suite (4 tests):**
```
deno test --allow-read functions/_shared/__tests__/businessHoursToGoogle.adversarial.test.ts
AX-1 overnight ... ok
AX-2 malformed ... ok
AX-3 idempotency ... ok
AX-4 curated honest-unknown ... ok
ok | 4 passed | 0 failed (10ms)
```

**Both ORCH-1068 test files together:** `ok | 17 passed | 0 failed`.

**Deno typecheck (touched production files):**
```
deno check businessHoursToGoogle.ts curatedStopHours.ts discover-cards/index.ts run-business-place-authoring-pipeline/index.ts
→ all Check OK (clean)
```

**Strict-grep ORCH-0863 gate (incl C7 + ORCH_1068_BACKEND_ALLOWLIST):**
```
node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs
OK [C7: no-new-backend-files] ... # All checks PASS
```

---

## 4. Fails-on-revert proofs

**Implementor branch (curated array branch is load-bearing):** removed the `isBusinessHoursArray` branch from `curatedStopHours.ts:187-189` → `11 passed | 2 failed` (T-10, T-13 fail — closed-Sunday business venue falls through to honest-unknown→OPEN). Restored → `13 passed | 0 failed`. Confirms the production branch is load-bearing (re-verified independently this pass).

**Tester adversarial (weekday off-by-one is load-bearing):** reverted `businessWeekdayToGoogleDay` from `(w+1)%7` to identity `(w)%7` → adversarial suite `1 passed | 3 failed` (AX-1 overnight day attribution, AX-2 clamped-weekday mapping, AX-4 closed-Sunday lands on wrong day all fail). Restored → `4 passed | 0 failed`. **Confirms the `(weekday+1)%7` translation is the load-bearing correctness invariant — and my adversarial test attacks a DIFFERENT angle (overnight midnight-crossing end-to-end deck eval + malformed-input degradation + idempotency) than the implementor's happy-path shape assertions.**

---

## 5. Live DB probe (read-only) — Sunday-closed correctness (the off-by-one)

Migration `20260905000000` is already applied live. Probe of all 3 business-authored `place_pool` rows:

| Venue | servable | oh_type | total periods | Sunday (day=0) periods | Correct? |
|---|---|---|---|---|---|
| Lantern & Vine (`8b720912…`) | true | object | 7 | 1 | ✓ open 7 days incl. Sunday → has day=0 |
| Lumen Wine Bar (`3b10d972…`) | true | object | 6 | **0** | ✓ closed Sunday → NO day=0 period |
| The Tuscanny Place (`f0c3f4c4…`) | false | object | 6 | **0** | ✓ closed Sunday → NO day=0 period |

Days present for Lumen/Tuscanny = `{1,2,3,4,5,6}` (Mon–Sat in Google) with NO `day=0` — exactly the `(weekday+1)%7` translation, no shift. **A naive identity mapping would have produced a `day=6` gap or shifted the closure; instead every venue's days match the spec.** Sunday-closed venues stay closed Sunday. NO off-by-one.

Scope/idempotency probe:
```
business_array_remaining = 0   (all 3 converted to object)
business_total           = 3
google_array_rows        = 0   (no Google row was ever array → none touched)
google_object_rows       = 75690 (intact)
```
SC-5 confirmed live: zero array-shaped business rows remain; re-run matches 0 rows (idempotent); zero Google rows touched.

---

## 6. Image-hero (F-5) verification
`discover-cards/index.ts:506-509` — `VIDEO_EXT=/\.(mp4|mov|webm|m4v)(\?|$)/i`; `isVideoUrl` also matches `/video/upload/`; `heroImage` = first url that is a string AND not a video; `image: heroImage`, `images: storedPhotos` (full list). T-11: a `[.../video/upload/...mp4, .../gallery/y.jpg]` input → hero = the `.jpg`, full list preserved; all-video → `null` (honest stock fallback). **Hero skips video; real photo wins.** ✓

---

## 7. Constitution (14 rules)
- #9 no fabrication — PASS (real photo shown, never stock when a photo exists; `:500-509`).
- #12 validate at right time — PASS (`openNow:null`, computed downstream; `:164`).
- #13 exclusion consistency — PASS (discover-cards + curatedStopHours share the ONE converter; identical array branch).
- #3 no silent failures — PASS (converter degrades malformed input to "excluded", no swallowed errors; pipeline `normalizeBusinessHoursForPool` returns null defensively).
- Others N/A (no auth/state/currency/nav surface touched).

---

## 8. Severity-ranked defects

**P0 / P1 / P2 / P3: none.**

**P4-1 (NOTE, pre-existing, NOT this ORCH):** `functions/_shared/__tests__/scorer.test.ts` and `bouncer.test.ts` fail `deno check` (TS2322/TS18047/TS2353) when the whole `__tests__` dir is type-checked. These files are NOT in the ORCH-1068 diff (`git diff origin/main...HEAD` excludes them) — pre-existing on base, out of scope. Flagged for the orchestrator's general-hygiene backlog; does not gate this ORCH. The ORCH-1068 test files type-check and pass cleanly in isolation and together (17/17).

**P4-2 (NOTE, praise):** Clean single-conversion-authority design — one converter (`businessHoursToGoogle.ts`) powers normalize-at-write, the SQL backfill (byte-equivalent re-impl), and both defensive readers, so the three can never drift. The `((w%7)+8)%7` form is tolerant of negative/out-of-range weekday ints (proven by AX-2). The defensive reader branch means even an un-normalized stray array still serves correctly — true belt-and-suspenders.

---

## 9. Discoveries for orchestrator
- SC-ACCEPT sim leg (iPhone 17 Pro + Android emu, Raleigh Drinks chip, Lantern open hours, real-photo hero) is the remaining CLOSE gate — dispatch-assigned to the orchestrator. All server-side preconditions are green: migration applied (verified), edge code correct (verified), 3 venues converted with correct hours (verified live). After the orchestrator deploys `discover-cards` + `run-business-place-authoring-pipeline` + `generate-curated-experiences` from main + runs db push (already applied), the sim leg should pass on first try.
- Pre-existing scorer/bouncer test type-check debt (P4-1) — general hygiene, not ORCH-1068.
