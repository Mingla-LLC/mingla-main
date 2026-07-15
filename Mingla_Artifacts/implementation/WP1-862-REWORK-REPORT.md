# REWORK — ISSUE-862 WP1: fixes for QA verdict FAIL (1×P1, 4×P2, 6×P3)

**Rework of:** `Mingla_Artifacts/reports/QA_ISSUE-862_WP1.md` (tester commit `f3e1aeae5`)
**Base implementation:** `WP1-862-IMPLEMENTATION-REPORT.md` (commits `b7be4718e..069422d8d`)
**Worktree:** `~/Desktop/mingla-orchs/issue-862-meta-ads-api` on branch `issue-862-meta-ads-api`
**Scope discipline:** ONLY the QA FAIL findings were touched — no scope expansion; the
tester's adversarial suite (`issue862_wp1_tester_adversarial.test.ts`) was NOT modified
(append-only honored; all 20 of its tests still green).

---

## 1. Summary

The P1 (campaign builder omitted `bid_strategy`, killing every real create at the ad-set
step with subcode 1815857) is fixed at the exact point the tester named: the campaign body
now carries `bid_strategy: "LOWEST_COST_WITHOUT_CAP"` explicitly on BOTH the CBO and
non-CBO branches, with an input override slot and a fails-on-revert-proven regression test.
All four P2s and five of six P3s are fixed; one P3 (the duplicate migration versions) is
explicitly out of my lane per the dispatch. Full suite: **73/73 green**
(41 implementor + 20 tester + 12 rework).

## 2. Rework commits

| Commit | Content |
|---|---|
| `c32eab1b6` | P1-1 bid_strategy (both branches) · P2-3 lane-correct env resolution · P2-4 invalid-row upsert on first-connect failure · P2-5 `rollbackCreative` hook + residue audit |
| `3df2db96f` | P2-2 validate-only ad-set layer + named layers · P3-6 live-only destinations · P3-7 auth-before-validation ×2 · P3-8 EAA scrub · P3-9 budget bounds · P3-10 bounded sync sweep · admin toast shows validated layers |
| `0b7fb2d75` | 12 rework regression tests (R-1…R-6) + CI DENO_TEST_FILES wiring |

## 3. Per-finding fix status

| Finding | Status | Fix + evidence |
|---|---|---|
| **P1-1** campaign builder omits `bid_strategy` → every real create dies at ad-set (1815857) | **FIXED** `c32eab1b6` | `buildMetaCampaignBody` (meta.ts) sends `bid_strategy: input.bidStrategy ?? META_DEFAULT_BID_STRATEGY` ("LOWEST_COST_WITHOUT_CAP") on BOTH branches; `admin-ad-create-campaign` reads `body.bid_strategy`, allowlists ONLY `LOWEST_COST_WITHOUT_CAP` in WP1 (`422 bid_strategy_unsupported_wp1` otherwise — cap strategies need `bid_amount`, #864), and threads it through. Regression tests R-1 (CBO + non-CBO) + R-2 (override). **fails-on-revert verified at `0b7fb2d75`:** true line deletion of the `bid_strategy:` line → R-1 both tests + R-2 FAILED; line restored → 73/73 pass. |
| **P2-2** validate-only skips the ad-set shape (where P1-1 hid) | **FIXED** `3df2db96f` | Validate-only now validates campaign → **ad set** → creative and the response NAMES the layers: `{validated, validated_layers[], skipped_layers[]}`. Meta ad-set validation needs a `campaign_id`, so the ad set validates against the connection's most recent persisted campaign; with none, the layer is reported `skipped` with the explicit reason (never silent). Admin toast surfaces the layer list. |
| **P2-3** business-lane first connect verifies the CONSUMER credential then persists `connected` | **FIXED** `c32eab1b6` | `resolveMetaToken(conn, lane)` / `resolveMetaEnvConfig(lane)` / `resolveMetaClient(conn, lane)` are lane-correct: with no persisted row the defaults are the LANE's env names (business → `META_MINGLABIZ_SYSTEM_USER_TOKEN` + `META_MINGLABIZ_{AD_ACCOUNT_ID,PAGE_ID,BUSINESS_ID,DATASET_ID}`), so a business connect with only consumer secrets **fail-closes 424, no connected row** (test R-3). connect + preflight pass the lane explicitly. |
| **P2-4** first-connect failure persists nothing (AC-1 wants an `invalid` upsert) | **FIXED** `c32eab1b6` | `markInvalid()` is now an UPSERT on `(platform,lane)` — a failing FIRST connect persists `status='invalid', connected=false` with the lane's default env-var NAME, so SC-2 renders before any success. `external_account_id` uses the lane's env ID when resolvable, else the explicit sentinel `'unconfigured'` (documented — not fabricated data). |
| **P2-5** rollback leaves an account-level AdCreative orphan (campaign delete does NOT cascade creatives) | **FIXED** `c32eab1b6` | New optional `ChannelAdapter.rollbackCreative` hook; `metaAdapter.rollbackCreative = DELETE /{creative_id}`. `createFullCampaignAtomic` cleans the creative FIRST (while provably unreferenced — the ad never existed), then the campaign, and reports `creativeRollbackSucceeded: true/false/null`. Where deletion is impossible/failing, the residue id is written into the audit row (`provider_response.creative_residue_id`) and the action degrades to `create_failed`. Same treatment on the DB-persist-failure path. Tests R-4 ×3 (delete-before-campaign ordering, missing-hook residue honesty, pre-creative null). Tester T-8 pins (rollbackCampaign exactly once; their mock without the new hook) remain green. |
| **P3-6** ended/cancelled events accepted as destinations | **FIXED** `3df2db96f` | Destination resolve adds `.in("status", ["scheduled","live"])` — AC-4 "public + LIVE" now literal. |
| **P3-7** input validation before the admin gate (connect + action) | **FIXED** `3df2db96f` | Both fns hoist the 401/403 gate directly after JSON parse, matching preflight/create/sync — no pre-auth validation oracle. |
| **P3-8** provider messages unscrubbed | **FIXED** `3df2db96f` | `scrubMetaTokens()` (`EAA[A-Za-z0-9]{16,}` → `[redacted]`) applied inside `normalizeMetaError` (test R-5). |
| **P3-9** no budget upper bound / micro precision loss | **FIXED** `3df2db96f` | Two layers: edge-level `422 budget_above_maximum` above 100,000,000¢ ($1M/day), and `MAX_BUDGET_CENTS = floor(MAX_SAFE_INTEGER/10,000)` guard inside `centsToPlatformBudget` (uniform across platforms). The tester's T-1 exactness boundary sits exactly AT the bound and still passes (test R-6). |
| **P3-10** unbounded sync sweep | **FIXED** `3df2db96f` | All-campaign sweep is bounded: oldest-`status_synced_at` first (nulls first), LIMIT 50, response carries `truncated` so a caller knows to sweep again. |
| **P3-11** 6 duplicate migration-version pairs break `supabase start` | **DEFERRED — out of my lane per dispatch** | Pre-existing on main; the orchestrator is handling it at the orchestrator level (dispatch instruction: do not attempt). Noted only. |

## 4. Self-verify (real output, this session)

- **Full suite:** `deno test --allow-env --allow-read` over all four files →
  **`ok | 73 passed | 0 failed`** (41 implementor + 20 tester untouched + 12 rework).
- **fails-on-revert (new bid_strategy test):** deleted the
  `bid_strategy: input.bidStrategy ?? META_DEFAULT_BID_STRATEGY,` line →
  `R-1: CBO … FAILED`, `R-1: non-CBO … FAILED`, `R-2 … FAILED`; restored → 73/73.
  **fails-on-revert verified at `0b7fb2d75`.**
- **deno check:** all 7 touched TS files — clean.
- **Strict-grep gates:** `issue-862-ad-token-env-server-only` self-test + live PASS
  (the new `META_MINGLABIZ_*` ID names are non-secret IDs; the token names were already
  in the gate's list); `issue-862-reddit-configured-status` armed-pass.
- **YAML lint:** `supabase-migrations-and-stripe-deno.yml` valid after the DENO_TEST_FILES
  addition.
- **vite build:** mingla-admin green (toast change only).
- **Append-only:** tester suite untouched; all rework tests live in the NEW
  `issue862_wp1_rework.test.ts`.
- **Hard guards:** no live platform call, no deploy, no migration apply, no push, nothing
  ever ACTIVE, no master-keys read.

## 5. Old → New receipts (rework surface)

### supabase/functions/_shared/meta.ts
**Before:** campaign body had no bid strategy (P1-1); env resolution was consumer-only;
provider messages unscrubbed; no creative rollback.
**Now:** explicit `bid_strategy` both branches; lane-parameterized token/ID env resolution
(`META_MINGLABIZ_*` for business); `scrubMetaTokens` inside `normalizeMetaError`;
`rollbackCreative` adapter hook. **Why:** QA P1-1/P2-3/P3-8/P2-5. ~60 lines changed.

### supabase/functions/_shared/adChannel.ts
**Before:** `AtomicCreateFailure` knew nothing of creatives; no budget ceiling; no
`bidStrategy` input slot.
**Now:** `rollbackCreative?` on the interface; creative-first cleanup + `creativeRollbackSucceeded`
in the atomic engine; `MAX_BUDGET_CENTS` precision guard; `CreateCampaignInput.bidStrategy`.
**Why:** QA P2-5/P3-9/P1-1. ~55 lines changed.

### admin-ad-connect / admin-ad-campaign-action
**Before:** input validation ran pre-auth; connect failure persisted nothing on first
connect; first connect resolved consumer env names for any lane.
**Now:** gate-first ordering; invalid-row UPSERT; lane-correct resolution.
**Why:** QA P3-7/P2-4/P2-3. ~70 lines changed.

### admin-ad-create-campaign
**Before:** validate-only covered campaign+creative only; destinations accepted
ended/cancelled; no bid-strategy input; no ceiling; rollback paths ignored the creative.
**Now:** all five fixed as above. **Why:** QA P2-2/P3-6/P1-1/P3-9/P2-5. ~110 lines changed.

### admin-ad-campaign-sync
**Before:** unbounded sweep. **Now:** LIMIT 50 oldest-first + `truncated`. ~12 lines.

### mingla-admin/src/pages/AdEnginePage.jsx
**Before:** validate-only toast said only "shapes are valid".
**Now:** names validated/skipped layers (P2-2's honesty requirement surfaced to the admin).
~10 lines.

## 6. Known issues / notes for RETEST

- The P1-1 fix is unit-proven against the tester's live-derived contract; the tester's
  own RETEST plan applies: live create must persist one PAUSED row set with 4 IDs, then
  the step-3-through-the-edge-fn leg (now also proving `rollbackCreative` live), then
  AC-5 launch/pause, then admin UI smoke.
- `META_MINGLABIZ_{AD_ACCOUNT_ID,PAGE_ID,BUSINESS_ID,DATASET_ID}` extend A2's business
  naming convention to the non-secret IDs — flagged for a one-line spec amendment (A2
  names only the token/CAPI secrets). Until those secrets/IDs exist, business-lane
  connect fail-closes 424 (exactly the tester's required retest behavior).
- Validate-only's ad-set layer requires a reference campaign; the FIRST-ever validate
  reports `skipped_layers: [ad_set]` with the reason. After the first real create, all
  three layers validate. (Alternative sentinel-campaign design rejected as a standing
  cost/risk on the real account — within the tester's offered option (b), but stronger:
  the layer IS validated whenever a reference exists.)
- P3-11 (duplicate migration versions on main) untouched per dispatch — orchestrator lane.

## 7. Discoveries for Orchestrator

- None new beyond the QA report's own D-1…D-4. The rework surfaced no additional defects.
