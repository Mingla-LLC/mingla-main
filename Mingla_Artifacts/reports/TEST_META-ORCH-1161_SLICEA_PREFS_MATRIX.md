# TEST — META-ORCH-1161 Sub-A slice "a" — Consumer notification-preferences matrix

**ORCH:** META-ORCH-1161 Sub-A slice "a" (consumer prefs-matrix UI)
**Skill:** mingla-tester (Claude)
**Date:** 2026-06-20
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1161-[prefs-matrix]/` on branch `ORCH-1161-prefs-matrix`
**Code under test:** `8dd5c3e5d` (impl) · report `23a4843d1` · tester adversarial commit `b55a18be7`
**Mode:** TARGETED + SECURITY (RLS) + SPEC-COMPLIANCE
**Implementation report:** `Mingla_Artifacts/reports/IMPLEMENT_META-ORCH-1161_SLICEA_PREFS_MATRIX.md`

---

## 1. Verdict

**CONDITIONAL PASS** — P0: 0 · P1: 0 · P2: 1 · P3: 2 · P4: 2.

The decision core, service, hook, RLS, and `can_send` honoring are PROVEN against live Postgres
(project `gqnoajqerqhnvulmnyvv`). Toggle-persistence, SMS-chip gating (full-live-seed sweep),
optimistic rollback, RLS owner-only writes, and can_send-honors-the-toggle are all independently
verified at runtime/DB level. The single conditional reason is that **on-device render
(consumer iOS/Android) was NOT live-fired** — no booted sim/Metro session was available this run and
this is consumer-facing UI; UI-runtime is therefore `probable` (source + logic verified), not
`proven`. Per the dispatch ("if you can't drive a device, verify via component/logic tests + code
trace and mark UI-runtime probable"), this is the expected ceiling. The P2/P3 findings are
non-blocking polish/integration-gap items, none gate the slice.

**CLEAR-TO-CLOSE:** YES, conditioned on Seth eyeballing the matrix once on a device (the
implementor's own report already defers on-device to Seth at QA). No P0/P1; regression gate
satisfied (two on-branch tests, both fails-on-revert proven); security clean.

---

## 2. SC-by-SC matrix

| SC | Criterion | Status | Evidence |
|----|-----------|--------|----------|
| SC-1 | Per-category × per-channel matrix grouped by section, consumer order | PASS (source+logic) | `buildNotificationMatrix` + `CONSUMER_SECTION_ORDER`; AccountSettings.tsx L874-891 renders section headers + rows; impl test 7 (order) |
| SC-2 | Channels = category `default_channels`; SMS only for sms-eligible | **PASS (DB-proven)** | Full-live-seed sweep (§ below): SMS chip present IFF `default_channels.includes('sms')` across all 16 live categories |
| SC-3 | Transactional ON by default; turn off → writes enabled=false | **PASS (DB-proven)** | `defaultChannelEnabled` + `buildChannelPrefUpsert`; live: wrote `buyer_event_reminder/sms enabled=false`, row persisted |
| SC-4 | Marketing OFF by default; toggle on → enabled=true | **PASS (DB-proven)** | live: `marketing/push` no row → off; wrote enabled=true → persisted; mirrors can_send (mkt_norow=false) |
| SC-5 | Locked channels (inapp always; transactional email) locked-on, write NO row | PASS (logic-proven) | `isChannelLocked`; adversarial test 4 sweeps the whole seed → every locked cell yields `buildChannelPrefUpsert == null` |
| SC-6 | Reads live `notification_categories` + user prefs; absent row = default | **PASS (DB-proven)** | `fetchNotificationMatrix` queries `.eq('active',true)` + `.eq('user_id',userId)`; coalesce in core |
| SC-7 | Upsert to `notification_channel_prefs` PK(user,cat,channel) on toggle | **PASS (DB-proven)** | `upsertChannelPref` onConflict `user_id,category_key,channel`; live upsert persisted + idempotent |
| SC-8 | Hook + service; factory query key; optimistic + error toast (no silent fail) | PASS (source+logic) | `useNotificationPrefs` onMutate/onError/onSettled; `notificationPrefsKeys.matrix`; error bar L894-906 |
| SC-9 | States: loading skeleton / empty (never blank) / saving / error (bar+revert) | **PARTIAL (P3-1)** | skeleton + optimistic + save-error bar present; **fetch-error state not consumed** (`isError` exposed but unused → blank matrix region on load failure) |
| SC-10 | Master `push_enabled` global gate above matrix; legacy toggle works | **PASS (logic-proven)** | master Toggle L844-847 kept; `pushDimmed` dims+disables push chips when master off, email/SMS stay live (L219-220) |
| SC-11 | Shared RN → Android parity; no glass introduced | PASS (source) | opaque chip fills only (`prefChipOn/Off/Locked` solid colors); no glass tokens |

Per-surface (parity): Consumer iOS / Consumer Android both ship from the single RN component;
parity is automatic. UI-runtime `probable` on both (no sim driven this run).

---

## 3. Findings

### P2-1 — `payout_paid` (a SELLER/payout notification) renders in the CONSUMER prefs matrix
- **Evidence:** Live `notification_categories` contains `payout_paid` (section `Payouts`,
  `default_channels {inapp,push,sms,email}`, is_transactional=true, active=true). The matrix is fully
  data-driven and reads ALL active categories; `CONSUMER_SECTION_ORDER` does not include `Payouts`, so
  it sorts LAST under a "Payouts" header — but it still RENDERS in the consumer app's notification
  settings. A consumer (explorer) who never receives a payout would see a "Payout paid" preference row
  with a live SMS chip.
- **Impact:** Mild UX incoherence (a seller-only category shown to all consumers) and a stray SMS chip
  on a category irrelevant to most consumers. Not a security/data issue — it's the brand/seller's own
  category surfacing in the wrong audience's settings UI. The dispatch's "EVERY live category" SMS-gate
  check is still correct (payout_paid policy DOES include sms, so the chip is policy-correct); the issue
  is audience scoping, not the gate.
- **Required fix:** Either (a) add an audience/`section IN (consumer set)` filter to
  `fetchNotificationMatrix` / `buildNotificationMatrix` so only consumer-relevant sections render, or
  (b) tag categories with an audience column and filter on it. Cross-slice — likely Sub-B/business
  prefs territory; flag to orchestrator rather than fix here.
- **Retest:** Query the matrix sections for a consumer user → assert `Payouts` section absent.

### P3-1 — Fetch-error state leaves the matrix region blank (SC-9 "never blank" partial)
- **Evidence:** `useNotificationPrefs` returns `isError`, but `AccountSettings.tsx` destructures only
  `sections`, `isLoading`, `isSaving`, `toggleChannel` (L184-187) — `isError` is NOT consumed. On a
  fetch failure `prefMatrixLoading` is false and `prefSections` is `[]`, so the matrix area (L874-891)
  renders nothing. The master push toggle above still shows, so it's not a fully blank screen, but the
  matrix itself is silently empty with no retry affordance.
- **Impact:** A rare load failure shows an empty notifications grid with no explanation. The SAVE-error
  path (the dispatch's silent-failure concern, constitution rule 3) IS handled correctly via the
  rollback + error bar — this gap is the READ path only.
- **Required fix:** consume `isError` → render an inline "Couldn't load preferences — tap to retry"
  row (the `refetch` already exists on the hook).
- **Retest:** force `fetchNotificationMatrix` to throw → assert an error/retry row renders.

### P3-2 — Marketing-default divergence between shipped slice and design (cross-slice integration gap)
- See §7 (marketing-default reconciliation). Flagged, not a slice-A defect — the current behavior is
  internally consistent; the design's default-ON depends on S2/S3 (out of scope).

### P4-1 — Clean dependency-free decision core (praise)
- `notificationPrefsMatrix.ts` has ZERO React/RN/Supabase imports — fully unit-testable under Node's
  strip-types runner, exactly the `useLaunchCityGate.test.ts` precedent. Defence-in-depth: the locked
  guard exists in BOTH the core (`buildChannelPrefUpsert` returns null) AND the hook (`if (!payload)
  return`) AND the component (`disabled`/`interactive`). One-owner, well-factored.

### P4-2 — `can_send` contract exactly matches the UI default rules (praise)
- The live `can_send` SECURITY DEFINER function's transactional branch (`pref=false → false`) and
  marketing branch (`pref IS DISTINCT FROM true → false`) are byte-aligned with the UI's
  `defaultChannelEnabled` + coalesce. One source of truth for "is this on," proven live.

---

## 4. Step 0.5 — Independent re-run of the implementor's fails-on-revert proof

- Checked out branch `ORCH-1161-prefs-matrix` at impl commit `23a4843d1` (HEAD before my test commit).
- **As-is:** `node --experimental-strip-types --test notificationPrefsMatrix.orch1161.test.ts` → **7 pass / 0 fail**.
- **True line-deletion revert** of the SMS gate: replaced `const supported = [...cat.default_channels]`
  with `const supported = [...ALL_CHANNELS]` (the behavioral revert — drops the `default_channels`
  filter) → test 4 **`not ok 4 - SMS chip renders ONLY for sms-eligible categories`**
  (`non-eligible category has NO SMS chip`); result **6 pass / 1 fail**.
- **Restored** → **7 pass / 0 fail**. Product file confirmed back to committed state (`git status` clean).
- Verdict: the implementor's `fails-on-revert verified at 84663fe9` claim is GENUINE (the merged commit
  is `23a4843d1`; same gate, same failing assertion).

---

## 5. Adversarial test added (tester, different angle)

- **Path:** `app-mobile/src/components/profile/__tests__/notificationPrefsMatrix.orch1161.adversarial.test.ts`
- **Commit:** `b55a18be7` (on branch `ORCH-1161-prefs-matrix`).
- **Angle vs implementor:** the implementor tested 3 SYNTHETIC categories. Mine pins the EXACT 16-row
  LIVE seed (tester-verified via Supabase MCP 2026-06-20) and sweeps, for EVERY live category, that the
  SMS chip is present IFF `default_channels.includes('sms')` — including explicit absence on the
  dispatch-named no-text categories (`buyer_reservation_confirmed`, `buyer_purchase_confirmation`, all
  Social). Plus: rendered chip set == supported channels in canonical order (no invented/dropped
  channel); NO locked chip in the whole seed yields an upsert payload; an inactive sms-policy category
  contributes zero rows.
- **As-is:** 5 pass / 0 fail.
- **fails-on-revert verified at `23a4843d1`:** same SMS-gate line-deletion → **3 of 5 fail**
  (the SMS-presence sweep, the no-text-category check, and the exact-chip-set check); restore → 5 pass.
- Both tests appear in `git diff origin/main...HEAD --name-only` (`notificationPrefsMatrix.orch1161.test.ts`
  + `…adversarial.test.ts`). Append-only respected — no existing test modified.

---

## 6. Constitution 14-rule matrix

| # | Rule | Result | Evidence |
|---|------|--------|----------|
| 1 | No dead taps | PASS | every chip onPress → `toggleChannel` → mutation; locked/dimmed chips are `disabled` (intentional non-tap, not dead) |
| 2 | One owner per truth | PASS | `notification_channel_prefs` single writer = `upsertChannelPref`; locked-guard owned by core |
| 3 | No silent failures | PASS (save path) | onError rolls back + `options.onError` → save-error bar. NOTE: READ-error path not surfaced (P3-1) but is not a SILENT success — it's a missing message, master toggle still renders |
| 4 | One query key per entity (factory) | PASS | `notificationPrefsKeys.matrix(userId)`; invalidate via same key |
| 5 | Server state stays server-side | PASS | categories+prefs in React Query; only `push_enabled` legacy local-state master (pre-existing) |
| 6 | Logout clears everything | PASS | query keyed by userId; no new persisted client store added |
| 7 | Label `[TRANSITIONAL]` + exit | N/A | no transitional code introduced |
| 8 | Subtract before adding | PASS | 5 flat legacy sub-toggles REMOVED, replaced by matrix |
| 9 | No fabricated data | PASS | category list/labels are for REAL seeded categories; humanized fallback only on real keys |
| 10 | Currency-aware | N/A | no money in this slice |
| 11 | One auth instance | PASS | uses shared `supabase` client; userId from `useAuth` |
| 12 | Validate at right time | N/A | no datetime logic |
| 13 | Exclusion consistency | PASS | active-only filter applied in BOTH the service query AND the core builder |
| 14 | Persisted-state startup gate | N/A | no Zustand persist added |

No constitutional violation → no automatic P0.

---

## 7. Marketing-default reconciliation (flagged per dispatch item 7)

**Current shipped behavior (slice A) is INTERNALLY CONSISTENT and off-by-default:**
- UI: `defaultChannelEnabled('push'|'sms'|'email', isTransactional=false)` → `false` for marketing
  (non-locked). No pref row ⇒ chip renders OFF.
- DB `can_send`: marketing branch is `IF v_pref_enabled IS DISTINCT FROM true THEN RETURN false`.
  Proven live: `can_send(user,'marketing','push',NULL) = false` with no row; `= true` after writing
  enabled=true. The UI default and the send-gate AGREE — there is no internal contradiction.

**The divergence is design-vs-shipped, NOT a slice-A defect (dispatch said do not treat default-ON as
a defect):**
- DEC-186 (DECISION_LOG entry is the ORCH-1151 reuse of the ID for curated-experiences; the
  notification DEC-186 lives in the SPEC §8 + design, "every signup/checkout auto-enrolls in
  marketing" via the bundled mandatory consent gate, Seth-accepted 2026-06-19 w/ TCPA risk).
  **Heads-up: DEC-186 is double-used** — DECISION_LOG.md DEC-186 = ORCH-1151 curated-experiences; the
  spec/design cite DEC-186 = bundled-consent. The notification decision is in the SPEC, not the
  DECISION_LOG, under that same ID. Flag for orchestrator (possible DEC-ID collision like the
  ORCH-1156 collision in COMMS-0036).
- The design (§S1.3 + states L163/L176) says marketing chips render default-ON "because DEC-186
  auto-enrolls." That default-ON is realized by S2/S3 consent capture writing a `scope='marketing'`
  GRANT — and S2/S3 are EXPLICITLY OUT of this slice.
- **Integration gap (P3-2):** today nothing bridges a marketing `consent_records` grant into either an
  `enabled=true` channel-pref row OR into `can_send` (which reads channel_prefs + channel_suppressions,
  NOT consent_records). So even once S2/S3 ship the GRANT, marketing will STILL be off-by-default in
  both the matrix and `can_send` unless that bridge is built. Whoever owns S2/S3 must decide: (a) the
  consent grant writes enabled=true marketing pref rows, or (b) `can_send` learns to treat a marketing
  consent_record as the grant. **Recommend orchestrator route this as an explicit Sub-B/Sub-C
  requirement.** The "one-line flip in `defaultChannelEnabled`" the implementor mentions would make the
  UI show ON but would NOT make `can_send` send (it returns false on no row) — so that flip alone would
  create a NEW inconsistency and should NOT be done in isolation.

---

## 8. Device / parity matrix

| Surface | Ships here | Result | Note |
|---|---|---|---|
| Consumer iOS | YES | PROBABLE (source+logic) | matrix screen primary target; no sim driven this run |
| Consumer Android | YES | PROBABLE (source+logic) | shared RN → automatic parity; opaque chip fills (no glass delta) |
| Buyer/anon Web | NO | skipped | consumer-app Settings sheet only |
| Business iOS | NO | skipped | business prefs out of scope (Sub-B/C) |
| Business Android | NO | skipped | " |
| Admin Web | NO | skipped | n/a |
| Business Web preview | NO | skipped | n/a |

**DB / backend (DB-PROVEN, project gqnoajqerqhnvulmnyvv, 2026-06-20):**
- RLS: single policy `notification_channel_prefs_owner` FOR ALL, role `authenticated`, USING + WITH
  CHECK both `user_id = auth.uid()`; RLS enabled. Live impersonation: **User A self-write = ALLOWED;
  User A → User B write = BLOCKED** (`positive_self_write=true, negative_cross_write_blocked=true`); no
  residue row left for B. All test rows cleaned up (verified `residue=0`).
- can_send-honors: transactional toggled OFF → `can_send=false`; marketing opted-in → `can_send=true`;
  no-row baselines: transactional `true`, marketing `false`, sms-on-non-sms-channel
  (`buyer_reservation_confirmed/sms`) `false`.

**Physical iPhone HITL:** not requested this run (implementor's report defers on-device eyeball to Seth
at QA; recommend Seth does the 4-step smoke below). Not marked skipped silently — it is the explicit
CONDITIONAL.

**Edge functions:** none touched; no live-deploy verification owed.

---

## 9. Discoveries for Orchestrator

1. **DEC-186 ID collision** — DECISION_LOG.md DEC-186 = ORCH-1151 curated-experiences; the META-ORCH-1161
   spec/design cite DEC-186 = bundled-mandatory consent. Two different decisions under one ID (mirrors
   the COMMS-0036 ORCH-1156 collision). Recommend renumbering one or logging the notification decision
   into DECISION_LOG explicitly.
2. **`payout_paid` audience leak (P2-1)** — a Payouts/seller category renders in the consumer matrix.
   Likely needs an audience filter shared with business prefs (Sub-B/C). Not fixed here.
3. **Marketing consent→send bridge missing (P3-2)** — see §7. S2/S3 grant won't actually enable
   marketing sends without a bridge into channel_prefs or can_send. Make it an explicit Sub-B/C SC.
4. **Comms ledger:** read on entry. No BLOCK/WARN addressed to mingla-tester / ORCH-1161 / ALL that is
   actionable. COMMS-0040 (RSVP public-page standardization, ALL/WARN) and COMMS-0038/0035 do not touch
   AccountSettings or the notification tables — no conflict, no ack required beyond noting.

---

## 10. Accepted conditions (CONDITIONAL PASS)

The single condition: **on-device render of the consumer notification-prefs matrix is `probable`
(source + logic + DB proven), not `proven`** — no sim/Metro was driven this run; this is consumer
UI. The implementation report already defers the on-device eyeball to Seth at QA. To upgrade to full
PASS, Seth (or a follow-up sim run) confirms the matrix renders + a chip tap persists on device.
No P0/P1 outstanding; the P2/P3 items are non-blocking and routed as Discoveries.

---

## RETEST 2026-06-20 — P2 rework verification (audience filter)

**Skill:** mingla-tester (Claude) · **Mode:** RETEST · **Code under test:** rework commit
`4f2bf0783` (fails-on-revert proof commit `be665a90d`) · branch HEAD `4f2bf0783`.

### Verdict (RETEST)

**PASS** (P2-1 CLOSED) — P0: 0 · P1: 0 · P2: 0 (the prior P2-1 audience leak is fixed) · plus ONE
new **P3 hygiene finding** (stale prior adversarial test, on-branch only, see below — non-blocking,
must reconcile before merge). UI-render remains `probable` (no sim driven this run — same documented
condition as the original CONDITIONAL PASS; the rework is a pure decision-core filter so the device
risk is unchanged). **CLEAR-TO-CLOSE: YES**, conditioned on (a) the same on-device eyeball already
owed from the original verdict, and (b) reconciling the stale prior adversarial file P3 below.

### 1. P2-1 CLOSED — data-driven audience filter (PROVEN)

- **Fix shape (verified in source):** `notificationPrefsMatrix.ts` adds `isConsumerCategory(cat)` =
  `CONSUMER_SECTION_ORDER.includes(cat.section)` (allowlist of the 5 consumer sections), and
  `buildNotificationMatrix` now filters `c.active && isConsumerCategory(c)` (L187). It is an
  **allowlist by SECTION, NOT a one-key denylist** — exactly what the dispatch required. A future
  `Sales`/`Payouts` `biz_*` row is excluded with zero further code change.
- **Single chokepoint (verified):** `buildNotificationMatrix` has exactly ONE non-test consumer —
  `useNotificationPrefs.ts:123` — and the component reads `sections` from that hook. The service
  (`notificationPrefsService.ts`) fetches raw active categories (no audience pre-filter) and passes
  them through the core. No render path bypasses the filter.
- **Confirmed against the LIVE category set (Supabase MCP, project `gqnoajqerqhnvulmnyvv`,
  2026-06-20):** 16 active categories; tagging each with the allowlist predicate yields **exactly 1
  excluded — `payout_paid` (section `Payouts`)** — the lone seller category. The other 15
  (Purchases ×4, Reservations ×3, Reminders ×2, Marketing ×2, Social ×4) all pass. So the consumer
  matrix renders 15 rows and `payout_paid` is gone.
- **Tests (gated runner):** `npm run test:orch-1161` → **8/8 PASS** (was 7/7; +1 exclusion test
  "REWORK P2: seller-only payout_paid is EXCLUDED from the consumer matrix").
- **Independent fails-on-revert (re-run by tester):** TRUE line-deletion of the audience filter
  (`c.active && isConsumerCategory(c)` → `c.active`) → exclusion test (test 7) **FAILS** (7 pass / 1
  fail); all others green. Restored → 8/8. Matches the implementor's claim @ `be665a90d`. `tsc
  --noEmit` → zero new errors in the touched core file; `git status` clean after restore.

### 2. No regression (CONFIRMED)

- **SMS-gate:** intact — happy-path test 4 + my new retest test 4 both prove SMS chip present IFF
  `default_channels.includes('sms')` across the surviving 15 consumer rows.
- **Locked-on inapp / transactional-email:** `isChannelLocked` + `defaultChannelEnabled` untouched
  by the rework (diff = only the new predicate + filter wiring).
- **Optimistic toggle + error-revert:** hook (`useNotificationPrefs`) not touched by the rework.
- **RLS owner-only (DB-PROVEN):** `notification_channel_prefs_owner` FOR ALL, `qual` + `with_check`
  both `user_id = auth.uid()` — unchanged.
- **can_send honors toggles (DB-PROVEN):** `can_send(p_user_id,p_category_key,p_channel,p_contact)`
  live and unchanged; it gates by category_key/channel against channel_prefs and is **independent of
  the UI section allowlist** — confirming the audience filter is display-only and does NOT block any
  send. (No category becomes unsendable just because it's hidden from the consumer prefs screen.)

### 3. Tester adversarial RETEST added (different angle)

- **Path:** `app-mobile/src/components/profile/__tests__/notificationPrefsMatrix.orch1161.retest.adversarial.test.ts`
  (NEW; append-only — no existing test modified).
- **Angle:** attacks the AUDIENCE filter on the FULL live seed — only consumer rows survive (15 of
  16, payout_paid dropped BY SECTION); no non-consumer section ever appears; a HYPOTHETICAL future
  `Sales` biz alert is auto-excluded (proves allowlist not denylist); SMS-gate still holds (no
  regression).
- **As-is:** 4/4 PASS. **fails-on-revert verified at `4f2bf0783`** (same line-deletion of the
  filter → 3 of 4 FAIL, the SMS no-regression test correctly stays green; restore → 4/4).

### 4. NEW P3 finding — stale prior adversarial test (on-branch only, reconcile before merge)

- **Evidence:** the PRIOR tester adversarial file `notificationPrefsMatrix.orch1161.adversarial.test.ts`
  (commit `b55a18be7`, **on-branch only — NOT on origin/main**) pinned the full 16-row seed as
  all-present and asserts "every active live category renders one row" (16). Run directly post-rework
  it is **3 pass / 2 fail** (`15 !== 16`; `payout_paid` lookup returns undefined) — i.e. it fails
  PRECISELY because the P2 fix correctly drops the seller row. This is positive evidence the fix
  works, but a red test file should not ship.
- **Why not fixed here:** tester is append-only (cannot modify an existing test file).
- **Impact:** the gated CI runner (`test:orch-1161`) runs ONLY the happy-path file (8/8 green) — the
  stale adversarial file is NOT wired into any workflow today, so CI is green. The risk is hygiene +
  any future broad `node --test src/` sweep.
- **Required fix (orchestrator/implementor, before CLOSE-merge):** update the 2 stale assertions in
  `…orch1161.adversarial.test.ts` to expect `payout_paid` excluded (or drop that file in favor of the
  new `…retest.adversarial.test.ts` which already supersedes its coverage). Since it's branch-only,
  it can be reconciled before merge with no history impact.
- **Retest:** `node --experimental-strip-types --test …orch1161.adversarial.test.ts` → must be green.

### 5. Comms ledger

Read on entry. No BLOCK to mingla-tester / ORCH-1161 / ALL. OPEN WARNs COMMS-0040/0041/0042/0045
(RSVP/experience/trip public-page standardization + ORCH-1165 collision) do not touch
AccountSettings or the notification tables — no conflict, no ack owed beyond noting.

### 6. Routing

PASS (P2 closed) → orchestrator CLOSE. Two carry-forward conditions, both non-blocking: (a) the
on-device eyeball already owed from the original CONDITIONAL PASS; (b) reconcile the stale
branch-only adversarial file (P3 above) before the closing merge.
