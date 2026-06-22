# TEST — ORCH-1219 (explorer form multi-select + no auto-advance + always-email TestFlight link)

Tester: mingla-tester
Branch: `1219-form-multiselect-no-autoadvance` (rebased clean on `origin/main`)
Worktree: `~/Desktop/mingla-orchs/1219-form-multiselect-no-autoadvance/`
Implementation under test: commit `6d25710d0`
Date: 2026-06-22

---

## 1. VERDICT — **CONDITIONAL PASS**

All four product contracts (multi-select + no auto-advance, organiser single-select + no auto-advance,
3-way platform copy incl. the Seth desktop-never-says-Android bug, always-email Fix D) are proven
**correct at runtime** — real headless Chromium across iOS / Android / Desktop UAs + handler-level Deno
runtime with a stubbed transport + the migration applied against ephemeral Postgres 15.

The PASS is **CONDITIONAL on one P1**: the migration **fails to apply** against the real ORCH-1216
baseline schema (`ERROR: operator does not exist: text[] = text`). Its scalar-interest-CHECK discovery
filter is inverted and never drops the constraint it must drop before the `text → text[]` conversion.
This is a hard deploy blocker for the backend half (Fix A/C array + android), reproduced deterministically.
The frontend (Fix A/B/C modal behavior) and the edge-fn logic (Fix D) are independently shippable and
correct; the migration must be patched before the edge fn is deployed.

Conditions to clear → full PASS:
1. **P1** — fix the migration's interest-CHECK discovery (drop by `<@`/`array_length` absence, not by
   `= any` presence). Re-prove apply against the 1216 baseline.
2. **P2** (recommended, not blocking) — tighten the array CHECK to `cardinality(interest) >= 1` so an
   empty array is actually rejected by the DB (today it slips through; the edge fn is the only effective
   guard). Optional given the edge fn is the sole writer.

---

## 2. FINDINGS

### P1 — Migration fails to apply against the real ORCH-1216 baseline (DEPLOY BLOCKER)

**File:** `supabase/migrations/20261125000000_orch_1219_explorer_interest_multi_platform_android.sql`
lines 50-53.

**Repro (deterministic):** applied the real ORCH-1216 baseline table
(`20261124000000_orch_1216_explorer_app_leads.sql` shape — `interest text NOT NULL CHECK (interest in
(...))`) to ephemeral Postgres 15, then applied the ORCH-1219 migration on top:

```
ERROR:  operator does not exist: text[] = text
CONTEXT: SQL statement "alter table public.explorer_app_leads alter column interest type text[] using …"
```

**Root cause:** the migration intends to drop the scalar interest CHECK *before* the `ALTER COLUMN …
TYPE text[]` (Postgres re-validates surviving CHECKs against the new type). The discovery query filters:

```sql
and pg_get_constraintdef(con.oid) ilike '%interest%'
and pg_get_constraintdef(con.oid) not ilike '%= any%'   -- "scalar form, not array"
```

The comment's premise is wrong. Postgres **normalises the scalar `interest IN (…)` to
`interest = ANY (ARRAY[…])`** in `pg_get_constraintdef` (verified: the live constraint reads
`CHECK ((interest = ANY (ARRAY['places'::text, …])))`). So `not ilike '%= any%'` **excludes the exact
scalar constraint it must drop.** The scalar CHECK survives → the column conversion fails →
`text[] = ANY(text[])` operator error → the whole migration aborts.

**Proven fix direction (validated end-to-end in ephemeral PG):** distinguish the *new array* CHECK from
the *old scalar* CHECK by the array-only tokens, not by `= any`:

```sql
and pg_get_constraintdef(con.oid) ilike '%interest%'
and pg_get_constraintdef(con.oid) not ilike '%<@%'
and pg_get_constraintdef(con.oid) not ilike '%array_length%'
```

With that, the scalar check drops, the conversion + array CHECK + android CHECK + RPC re-create all apply
cleanly, and every CHECK probe behaves (T1–T5 below). (The `array <@ enum` array-CHECK definition has no
`= any`, so the migration also can't accidentally re-drop its own new constraint on a re-run — the
re-runnability the file claims actually requires this fix to hold.)

**Blast radius:** backend half only. The frontend modal behavior + the edge-fn TS logic do not depend on
this migration to *function*, but the edge fn now writes `interest` as a `text[]` and may write
`platform='android'`; deploying the edge fn before a corrected migration lands would 500 every insert
(column-type / CHECK mismatch). Sequence: corrected migration FIRST, then edge fn (the implementor's
report already specifies migration-first; the migration just doesn't currently apply).

### P2 — Empty interest array bypasses the DB array CHECK (defense-in-depth hole)

**File:** same migration, the `explorer_app_leads_interest_arr_chk` CHECK (`array_length(interest, 1) >= 1`).

**Repro:** `insert … interest = ARRAY[]::text[] …` → **INSERT 0 1 (accepted)**, not rejected.
`array_length(ARRAY[]::text[], 1)` returns **NULL** in Postgres (not 0); `NULL >= 1` is NULL; a CHECK only
rejects on an explicit FALSE → the empty array slips through. The migration's stated "≥1 element"
invariant is therefore **not enforced by the DB**.

**Severity P2 (not P1):** the edge fn (service role) is the *only* writer and rejects an empty array
*before* insert (`interest.length < 1` → 400 — proven at runtime, §4 TADV + the implementor's
`validateLead` suite). So no empty array reaches the table through the real path. The DB CHECK is the
second line, and the second line has a hole. **Fix:** `cardinality(interest) >= 1` (returns 0 for empty).

### No P0 found.

The four product contracts are all correct at runtime (§3). No on-screen TestFlight link leaks to
Android/desktop/idle/step/error; desktop never says "Android"; duplicates are not re-emailed; the lead
email always fires on a created submit to `lead.email` and carries the live TestFlight URL.

---

## 3. RUNTIME EVIDENCE — headless Chromium (real modals)

Driver: `/tmp/orch1219-pw/drive.mjs` (Playwright + Chromium, against `next dev` rendering the **real**
`GetTheAppModal` + `BetaAccessModal` via a throwaway, NOT-committed harness route). The edge-fn POST was
**route-stubbed to a fake `created` success** so the success panel renders with **zero live Resend sends**.
**23/23 assertions PASS.** Screenshots in `Mingla_Artifacts/evidence/ORCH-1219/`.

| Screenshot | Proves |
|---|---|
| `c1-explorer-3chips-selected.png` | **Contract 1 multi-select:** 3 interest chips toggled ON simultaneously (`aria-pressed=true` × 3), modal still on **Step 1 of 2** — tapping a chip does NOT auto-advance. |
| `c1-explorer-step2.png` | Pressing **Next** (required; disabled at 0 selected, enabled at ≥1) advances to Step 2. |
| `c2-organiser-single-select.png` | **Contract 2:** organiser brand-type is `role=radiogroup`; a 2nd pick **replaces** the 1st (exactly 1 `aria-checked`); tapping does NOT auto-advance (still **Step 1 of 3**); Next required. |
| `c3-success-ios.png` | **Contract 3 iOS:** "You're in. Grab the app." + on-screen **"Open in TestFlight"** link + "We've also emailed you the link." No "Android". |
| `c3-success-android.png` | **Contract 3 Android:** "You're on the list." + Android-specific copy, **NO on-screen link**. |
| `c3-success-desktop.png` | **Contract 3 + the Seth bug:** desktop UA (Mac, no touch) → "Mingla's in beta on iPhone & iPad…", **NEVER renders the word "Android"**, **NO on-screen link**. |

Assertion-level results (all PASS):
- C1.0–C1.6: group is `role=group` + 5 `aria-pressed` chips; tap → no advance; 3 chips stay selected;
  deselect untoggles only that chip; Next disabled@0 / enabled@≥1; Next advances to Step 2.
- C2.0–C2.4: `role=radiogroup` (7 radios); tap → no advance; 2nd pick replaces 1st (single-select);
  Next required → advances to Step 2.
- C3.ios: link present, no "Android", heading "Grab the app".
- C3.android: **no** link, copy mentions Android, heading "on the list".
- C3.desktop: **no** link, **no "Android"**, heading "on the list". ← the reported bug, fixed.
- A11Y: explorer chip toggles via **Space**, untoggles via **Enter** (keyboard-operable toggle group).

**Contract 4 (hard-gate):** the on-screen `a:has-text("Open in TestFlight")` element renders in the iOS
success branch ONLY (`linkCount=1` iOS, `0` android, `0` desktop). The edge-fn email carries the URL too —
that is expected (Fix D) and lives in a different file the modal gate doesn't scan; modal on-screen
behavior for non-iOS is unchanged.

---

## 4. RUNTIME EVIDENCE — edge fn (stubbed transport, no live mail)

**My adversarial test** (DISTINCT angle from the implementor's `validateLead`/happy-path suites):
`supabase/functions/explorer-app-lead-submit/__tests__/submit_tester_adversarial_orch1219.test.ts`.
It drives the **actual `handler`** with `globalThis.fetch` stubbed to emulate the supabase-js
PostgREST insert/count (created vs 23505-duplicate) AND to **capture Resend POSTs** — no env/network
side effects, zero real sends. 4/4 PASS.

- **TADV-1 (Fix D idempotency, runtime):** a duplicate submit (insert → 23505 → `already_on_list`) sends
  **ZERO** emails — neither the internal notify nor the lead email. (The strict-grep gate only proves the
  call sits textually after the early return; this proves it at runtime by counting sends.)
- **TADV-2 (always-email, runtime):** a NEW **android** (non-iOS) submit sends **exactly one** lead-facing
  email to `to == lead.email` carrying the live TestFlight URL in html+text, the internal seth notify
  fires once (not to the lead), and `interest` persists as a **Postgres array** `["events","trips"]`,
  not a scalar.
- **TADV-3 (interest boundary):** a 6-element interest array with an out-of-set element → handler **400**,
  **0 emails, 0 inserts**; while a 6-raw-element array that de-dupes to the 5-value set is accepted
  (trim+dedupe boundary the other way).
- buildDownloadLinkEmail unit: recipient is always `lead.email`, never the internal inbox.

**Fails-on-revert proof (each invariant independently broken, then restored):**

| Invariant | Revert applied | Revert hash | Result |
|---|---|---|---|
| TADV-2 always-email | wrapped lead-email send in `if (lead.platform === "ios")` (iOS-only) | `675646a4d` | TADV-2 **FAILED** (android no longer emailed) |
| TADV-1 idempotency | re-send both emails inside the `already_on_list` (23505) branch | `a90dac300` | TADV-1 **FAILED** (duplicate re-emailed) |
| Fix A multi-select (form gate) | explorer `useState<string[]>([])` → `useState("")` | n/a | gate **EXIT=1** ("interest is not a useState<string[]>") |

Edge fn restored to the committed hash `7657962c1a4c90b6c43145fb1f8afc34136050a3` after all reverts;
working tree clean (only my new test + evidence added).

**Migration applied against ephemeral Postgres 15** (after pre-dropping the scalar interest CHECK that
the P1 filter fails to drop — i.e. simulating the corrected migration):

- T1 — `interest = ARRAY['events','trips']`, `platform='android'` → **INSERT 0 1 (accepted)** ✓
- T2 — `interest = ARRAY[]::text[]` → **accepted (P2 hole)** ⚠ (should reject)
- T3 — `interest = ARRAY['events','hacker']` → **CHECK violation (rejected)** ✓
- T4 — `platform='windows'` → **CHECK violation (rejected)** ✓
- T5 — `admin_explorer_app_leads_list()` returns `interest` as **`text[]`** ✓

---

## 5. GATES / DENO / TSC — exact counts

- **Strict-grep gates: 7/7 PASS** (each `--self-test` AND live):
  `i-proposed-1216-android-no-testflight-link`, `-explorer-only-cta`, `-no-service-key-client`,
  `-success-mount-gated`, `-testflight-behind-submit` (all 5 still pass with no matcher edits) +
  `i-proposed-1219-always-email-download-link`, `i-proposed-1219-form-no-autoadvance-multiselect`.
  Both 1219 jobs are wired in `.github/workflows/strict-grep-mingla-business.yml`
  (`orch-1219-always-email-download-link`, `orch-1219-form-no-autoadvance-multiselect`, each `--self-test` + live).
- **Deno tests: 35 passed / 0 failed** — 18 happy + 13 adversarial (implementor) + **4 mine** (tester).
- **`deno check` edge fn:** EXIT=0.
- **marketing `tsc --noEmit`:** EXIT=0 (clean).

---

## 6. POST-DEPLOY-ONLY CONDITIONS (cannot be cleared pre-deploy)

1. **Apply the CORRECTED migration to live prod** (after the P1 patch). The table is empty in prod, so the
   `text → text[]` conversion is clean once the scalar CHECK drop works. Verify `\d explorer_app_leads`
   shows `interest text[]` + the array CHECK + the 3-value platform CHECK live.
2. **Deploy the edge fn AFTER the migration** (it now writes `text[]` + may write `platform='android'`).
3. **Real branded-email delivery on a created submit** — confirm an actual iOS AND a non-iOS lead each
   receive the branded TestFlight email (renderShell chrome + working CTA + the live link) at the lead's
   inbox via Resend (`EMAIL_SENDERS.system` / `RESEND_SYSTEM_FROM`), with the internal seth notify also
   landing. Use a sink address you own — the recipient is a real lead.
4. **Real duplicate-no-reemail on prod** — submit the same email twice; confirm the 2nd returns
   `already_on_list` and triggers ZERO sends (matches TADV-1).
5. **Live 3-way platform telemetry** — confirm `explorer_app_leads.platform` records `android` vs `other`
   distinctly so Android demand is measurable (the column comment claims this).

---

## 7. WHAT I VERIFIED vs ASSUMED

- **Verified at runtime:** all 4 contracts in a real browser across 3 UAs (incl. the desktop-never-Android
  bug); the hard-gate link isolation; Fix D always-email + duplicate-no-reemail + recipient + array
  persistence through the real handler with a stubbed transport; the migration's CHECK behavior + RPC type
  against ephemeral Postgres; all 7 gates self-test + live; deno + tsc clean; fails-on-revert for both
  email invariants + the form multi-select gate.
- **Capped at "suspected" → SOURCE-LEVEL only / surfaced as P1:** the migration **as written** does NOT
  apply to the real baseline — I proved the failure AND the fix in ephemeral PG, but the committed file is
  still broken. The live prod apply remains post-deploy.
- **Not exercised:** real Resend delivery (deliberately not fired at real lead inboxes); live prod DB; the
  `anon`/`authenticated` role grants (ephemeral DB lacked them — harmless, prod has them).
