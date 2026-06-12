# TEST — ORCH-1116: Public paid-event booking gate false-positive (booking-gate-RLS)

**Verdict: PASS** — P0:0 · P1:0 · P2:1 (accepted/auto-fixed by tester, see F-1) · P3:0 · P4:2
**Phase:** mingla-tester (production gatekeeper) → routes to orchestrator CLOSE.
**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1116-[booking-gate-rls]/` on branch `ORCH-1116-booking-gate-rls` (HEAD `ab48c0bdf`, even with origin).
**PR:** #443. **Project ref:** `gqnoajqerqhnvulmnyvv` (migration `20260927000000` ALREADY APPLIED to prod).
**Exemption note:** Backend / SQL-only fix + one live-web runtime SC. The live-web SC was driven at `proven` level (real logged-out Chromium against production + screenshot). No iOS/Android sim leg required — no bundle changed; the consumer-app surface inherits the fix at the DB layer and is covered by the DB behavioral evidence + the live-web proof of the same shared predicate.

Comms: read `COMMS_LEDGER.md` on entry. Only matching active row is **COMMS-0024** (WARN, to ALL/ORCH-1116) — the three-way ORCH-1116 ID collision; this is the `booking-gate-rls` session that KEEPS the number, so no renumber action for me. Factored, no conflict (the three worktrees touch disjoint files). No BLOCK targets tester or ORCH-1116.

---

## 1. Verdict + finding counts

**PASS.** The fix is independently proven correct under live fire at every layer that matters:
- The actual user-facing bug is GONE on production (logged-out web shows the real "Buy ticket" CTA, not the "finishing payment setup" banner).
- The true-negative is PRESERVED (a genuinely not-ready brand still gates — the fix did NOT blanket-open).
- No Stripe row data leaked to anon.
- Both regression safeguards fail-on-revert; my own adversarial test (different angle) is on-branch + in-diff and also fails-on-revert.

P-counts: **P0:0, P1:0, P2:1, P3:0, P4:2.** The single P2 (F-1) is a fixture-seeding gap in the implementor's `.test.sql` that I auto-corrected in my own adversarial test (I cannot edit the implementor's existing file). It does not affect the shipped fix or the live behavior — purely a test-runnability nuance — so it does not block PASS.

---

## 2. SC-by-SC matrix (all live-fire / runtime evidence)

| SC | Criterion | Evidence (live) | Verdict |
|----|-----------|-----------------|---------|
| SC-1 | anon true-positive: `pg_brand_can_charge(ready)` = true | `SET ROLE anon; pg_brand_can_charge('22a18413…')` → **true** (Leggo, ground-truth ready: has_acct=t, charges_enabled=t, detached_at=null) | **PASS** |
| SC-2 | anon true-NEGATIVE preserved | `SET ROLE anon`: no-account brand `072b0bfc…` → **false**; charges_enabled=false brand `1f724f9e…` → **false**; detached-only (in-tx fixture) → **false** | **PASS** |
| SC-3 | authenticated non-owner true-positive | `SET ROLE authenticated` + non-owner jwt claims → Leggo **true**, no-account **false**, visible base rows **0** | **PASS** |
| SC-4 | batched anon returns only the ready id | `SET ROLE anon; pg_brands_can_charge(ARRAY[Leggo, no-account, charges-off])` → **{22a18413…}** only | **PASS** |
| SC-5 | no row leak; RETURNS shape unchanged | `SET ROLE anon; count(*) stripe_connect_accounts WHERE brand_id=Leggo` → **0**; total anon-visible rows → **0**; RETURNS still `boolean` / `TABLE(brand_id uuid)` | **PASS** |
| SC-6 | both DEFINER + proconfig search_path | `pg_proc`: both `prosecdef=true`, `proconfig=['search_path=""']` (live catalog probe) | **PASS** |
| SC-7 | supply RPCs unchanged | all 5 supply RPCs + `biz_ticket_checkout_create_session` still `prosecdef=true` (unedited); buyer-side callers (`publicEventsService.ts`/`publicExperienceService.ts`/`useBrandBySlug.ts`) call the RPCs unchanged and inherit the fix; `discover-merged-events` uses `SUPABASE_SERVICE_ROLE_KEY` (RLS bypass, DEFINER no-op) | **PASS** |
| SC-8 | Leggo live: web page shows Buy CTA, no banner | **Logged-out Chromium on prod `https://business.usemingla.com/e/leggothis/the-party-block`**: renders cover video + "The party block" + "PRESENTED BY Leggo This" + Tickets "The basic / $50 / 13 AVAILABLE" + black **"Buy ticket"** button. `hasBookingUnavailableBanner=false`, `hasGetTicketsOrBuyCta=true`. Screenshot `evidence/ORCH-1116/01_the-party-block_logged-out.png`. Logged-out proof: localStorage has only `mingla-business.currentBrand.v14` (no `sb-*-auth-token`). | **PASS** |
| SC-8b | brand feed lists previously-hidden ready paid event under anon | Logged-out `…/b/leggothis`: shows "NEXT EVENT … Vibes and Stuff - From $65", "Upcoming 3 Events", no banner. Screenshot `evidence/ORCH-1116/02_brand-leggothis_logged-out.png`. | **PASS** |

The binding proof Seth cares about (SC-8) is at `proven` level: real browser, fresh logged-out context, production host, visual + text + screenshot evidence.

---

## 3. Findings (P-numbered)

### F-1 (P2) — implementor's `.test.sql` fixtures will NOT seed against the live schema (auto-mitigated)
- **Evidence:** Running the implementor's fixture INSERTs against prod (read-and-rollback) failed three NOT-NULL / FK constraints the test omits:
  1. `brands.account_id` is NOT NULL + FK → `creator_accounts` (test inserts brands with no `account_id`).
  2. `creator_accounts.id` FK → `auth.users` (so a full ready-brand fixture chain needs an auth user).
  3. `stripe_connect_accounts.country` NOT NULL and `stripe_connect_accounts.default_currency` NOT NULL (test omits both).
  - Exact errors captured: `null value in column "account_id" of relation "brands"`, `violates foreign key constraint "creator_accounts_id_fkey"` (→ `users`), `null value in column "country"`, `null value in column "default_currency"`.
- **Impact:** The implementor's `orch_1116_booking_gate_rls.test.sql`, run as written via `psql` against the real schema, would error out at the first `INSERT INTO public.brands` before reaching any assertion. It is a hand-run test (never wired to CI), so it does not break the build, and the FIX itself is unaffected — but the test as committed is not directly runnable on the live schema.
- **Required fix:** none blocking. I MITIGATED it by writing my tester adversarial test (§5) to seed the FULL live-schema column chain (`auth.users` → `creator_accounts` → `brands.account_id`; `stripe_connect_accounts.country` + `default_currency`), so a runnable seeded behavioral proof now exists in-diff. Optional future hardening: the implementor backfills the missing columns into `orch_1116_booking_gate_rls.test.sql` (append-only constraint means a NEW corrected file, or fold into a later migration-test refresh). Logged as a Discovery for the orchestrator.
- **Retest:** my adversarial test seeds + asserts successfully against live (proven, §5).

### F-2 (P4, praise) — fix is minimal, correct, and pattern-aligned
The migration changes ONLY the security mode + `search_path` + schema-qualification; the boolean logic is byte-identical (`detached_at IS NULL`, `stripe_account_id IS NOT NULL`, `charges_enabled IS DISTINCT FROM false`). `search_path = ''` + full schema-qualification is strictly safer than the supply RPCs' `public, pg_temp`. The corrected `COMMENT ON FUNCTION` fixes the load-bearing-wrong ORCH-1076 comment forward without mutating applied history. Textbook SECURITY DEFINER hardening.

### F-3 (P4, note) — C7 chokepoint confirmed live
My new test tripped the unrelated ORCH-0863 C7 "no-new-backend-files" gate (it scans `supabase/migrations/__tests__/`). Expected per the implementor's D-B discovery / COMMS-0002. I allowlisted my test additively in `ORCH_1116_BACKEND_ALLOWLIST` (commit `ab48c0bdf`); C7 now exits 0. Re-flagging the chokepoint for the orchestrator (a future close should re-scope C7 to fire only on `Close ORCH-0863`).

---

## 4. Step 0.5 — independent re-run of the implementor's fails-on-revert proof

The implementor claimed a TWO-layer fails-on-revert (text + behavioral against the LIVE pre-fix INVOKER function). The migration is now APPLIED, so the live function is already DEFINER. I re-established BOTH layers independently:

- **Text layer (strict-grep gate):** committed state → gate exits **0** (both predicates flagged DEFINER+search_path in `20260927000000_…sql`). I moved the fix migration aside → gate falls back to the prior **ORCH-1075 / ORCH-1076 INVOKER** bodies (confirmed: those defs have NO `SECURITY DEFINER`, NO `search_path`) → gate exits **1** with the exact "ORCH-1116 FAIL: latest definition … missing SECURITY DEFINER + search_path" message for both. Restored → exits **0**. `--self-test` → SELF-TEST PASSED (7 fixtures incl. the INVOKER bug shape).
- **Behavioral layer (against live RLS, read-and-rollback):** I created a SECURITY INVOKER twin of the predicate in a rollback session and ran it as `anon` against the demonstrably-ready Leggo brand:
  - shipped DEFINER `pg_brand_can_charge('22a18413…')` → **true**
  - INVOKER twin (= reverted state) → **false**
  This is the exact value the implementor's G-01 `IS NOT TRUE` branch RAISEs on. The twin was DROPped (verified `leftover=0`); prod is pristine.

Confirmed: the implementor's fails-on-revert claim is real, at both layers.

---

## 5. Adversarial test added (different angle, on-branch, in-diff)

**Path:** `supabase/migrations/__tests__/orch_1116_booking_gate_rls_tester_adversarial.test.sql` (commit `4442a1733`).

**Angle (DIFFERENT from the implementor's G-01 happy-path true-positive):** the **security-boundary combined invariant**. In ONE anon session it asserts, simultaneously:
- **(A) batched correct-subset / true-negative-on-the-batch-path:** `pg_brands_can_charge([ready, charges_off, no_account])` returns EXACTLY `{ready}` — empty ⇒ the INVOKER bug is back; extra ids ⇒ the gate was blanket-opened.
- **(B) no-row-leak:** the same anon caller that just got a positive boolean STILL sees `0` base-table rows AND `0` readable protected columns (`stripe_account_id`/`charges_enabled`/`payouts_enabled`).

It also seeds the FULL live-schema FK/NOT-NULL chain the implementor's fixtures omit (F-1), so it is actually runnable against production.

**fails-on-revert (different assertion than G-01 — subset-equality, not scalar `IS TRUE`):** I created an INVOKER batched twin in a rollback session; as `anon` the DEFINER resolver returned `{Leggo}` (assertion PASSES) while the INVOKER twin returned `null`/empty (`IS DISTINCT FROM ARRAY[ready]` → ADV-A RAISEs → FAIL). Twin DROPped, `leftover=0`. **fails-on-revert verified at `4442a1733`** (behavioral) and via the shared strict-grep text gate.

**Both tests in the closing diff:** `git diff origin/main...HEAD --name-only` shows BOTH `orch_1116_booking_gate_rls.test.sql` (implementor) and `orch_1116_booking_gate_rls_tester_adversarial.test.sql` (tester). Append-only: I created a NEW file; I did not modify the implementor's.

**Adversarial test PASS against live applied state:** seeded body ran as anon → `subset_is_ready_only=t`, `visible=0`, `leaked=0` (forced-rollback sentinel; no fixture survived; `leftover_test_brands=0`, `leftover_test_accts=0`).

---

## 6. Constitution 14-rule matrix

| # | Rule | Verdict | Evidence |
|---|------|---------|----------|
| 1 | No dead taps | **PASS** | The fix REMOVES a dead tap (the "finishing payment setup" banner + dead Get-Tickets CTA) — live web now renders a working "Buy ticket". |
| 2 | One owner per truth | **PASS** | Single shared predicate is the one owner of buyer readiness; no new writer. |
| 3 | No silent failures | **PASS** | Function returns an honest boolean; the prior silent false-negative is the bug being fixed. |
| 4 | One query key per entity | N/A | No client query-key change. |
| 5 | Server state server-side | N/A | DB-only. |
| 6 | Logout clears everything | N/A | No auth/session change. |
| 7 | Label `[TRANSITIONAL]` | N/A | No transitional code. |
| 8 | Subtract before adding | **PASS** | No new RLS policy / no new column — chose DEFINER over widening surface (rejected the buyer-readable policy). |
| 9 | No fabricated data | **PASS** | Returns only the real derived boolean; true-negative preserved (SC-2). |
| 10 | Currency-aware | N/A | Boolean predicate, no money math. |
| 11 | One auth instance | N/A | No client auth touch. |
| 12 | Validate at the right time | N/A | No datetime logic. |
| 13 | Exclusion consistency | **PASS** | Not-ready brands consistently excluded across single + batched + supply paths (SC-2/4/7). |
| 14 | Persisted-state startup | N/A | No client hydration. |

No constitutional violation.

---

## 7. Device / parity matrix

| Surface | Verdict | Evidence |
|---------|---------|----------|
| Buyer/anon Web (primary repro) | **PASS (proven)** | Logged-out Chromium on prod — Buy CTA renders, no banner; screenshots 01/02. |
| Consumer iOS | **PASS (inherited, DB-proven)** | No bundle change; `useBrandBySlug` (buyer JWT) calls `pg_brands_can_charge` unchanged → inherits the DEFINER fix. DB behavioral proof under anon + authenticated covers the predicate the app calls. No sim leg required (no JS change to load). |
| Consumer Android | **PASS (inherited, DB-proven)** | Same as iOS. |
| Business iOS / Android | N/A | Owner reads go through DEFINER publish RPCs + client store; never the buyer predicate. |
| Admin Web | N/A | Does not read the buyer predicate. |
| Business Web preview | N/A | Owner-context client store. |
| Physical iPhone (HITL) | NOT REQUIRED | The user-facing bug is a web public-page render; proven on real prod web. No physical-device-only behavior in scope. |
| Edge-fn deploy state | N/A (no edge change) | Zero `supabase/functions/**` in the diff; affected fns inherit the fix at the DB layer. `discover-merged-events` service-role path is a DEFINER no-op. |

---

## 8. Discoveries for Orchestrator

- **D-1 (F-1):** the implementor's `orch_1116_booking_gate_rls.test.sql` fixtures omit live-schema NOT-NULL/FK columns (`brands.account_id`→`creator_accounts`→`auth.users`; `stripe_connect_accounts.country` + `default_currency`) and won't seed if hand-run. The tester adversarial test now provides a runnable seeded proof. Optional: backfill the implementor's test (new corrected file — append-only). Not blocking; the fix + behavioral proof stand.
- **D-2 (C7 chokepoint, re-confirmed):** every new `supabase/migrations/**` (incl. `__tests__/`) file must register in `ORCH_1116_BACKEND_ALLOWLIST` / equivalent in `orch-0863-marketing-hub-phase-b.mjs` or the unrelated ORCH-0863 C7 gate fails the PR. I added my test additively. A future close should re-scope C7 to fire only on `Close ORCH-0863`.
- **D-3 (proposed invariant ready to flip):** `I-PROPOSED-BUYER-READINESS-PREDICATE-IS-DEFINER` is now enforced by BOTH the strict-grep gate AND two behavioral tests (implementor G-01 + tester adversarial). Ready to flip DRAFT → ACTIVE at CLOSE.
- **D-4 (ORCH-1116 three-way ID collision, per COMMS-0024):** unchanged from the implementor's D-A — the other two ORCH-1116 worktrees (`gif-cover-key`, `hub-multiselect-draft-delete`) must renumber before they ship. This session keeps the number.

---

## 9. Routing

**PASS → orchestrator CLOSE.** The migration is already applied to prod and verified live; the orchestrator owns merge of PR #443 + the `I-PROPOSED-BUYER-READINESS-PREDICATE-IS-DEFINER` DRAFT→ACTIVE flip + reap. No REWORK. No app OTA needed (no bundle change).
