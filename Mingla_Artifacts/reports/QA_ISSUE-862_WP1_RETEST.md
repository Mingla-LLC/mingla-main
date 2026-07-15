# QA RETEST — ISSUE-862 WP1: Full Rooms Ad Engine foundation + Meta channel

**Tester:** mingla-tester+claude · **Date:** 2026-07-15 · **Cycle:** RETEST 1 (after FAIL `f3e1aeae5`)
**Worktree:** `~/Desktop/mingla-orchs/issue-862-meta-ads-api` on branch `issue-862-meta-ads-api`
**Rework under test:** commits `c32eab1b6..56aef068f` (fix map: `WP1-862-REWORK-REPORT.md` §3)
**Environment:** LOCAL Supabase stack (fresh boot, full migration chain) + `supabase functions serve` with real Meta credentials; direct read-only/validate-only Graph v25.0 calls for baselines/residuals; a LOCAL mock Graph recorder (dummy token) for the AC-5 launch wire-shape leg per the ORCHESTRATOR OVERRIDE (no live activation, ever).
**Append-only integrity verified first:** `git diff f3e1aeae5..HEAD -- issue862_wp1_tester_adversarial.test.ts` → **0 lines**; single commit in its history. Untouched, all 20 still green.

---

## 1. Verdict

## **PASS — 0 × P0 · 0 × P1 · 0 × P2 · 2 × P3 (new, minor) · 3 × P4**

Every FAIL finding is fixed and independently re-proven at runtime — most against the REAL Meta account. The engine now does the thing it exists to do: **a real create through `admin-ad-create-campaign` cleared step 2 and persisted one fully-PAUSED campaign→ad-set→creative→ad chain with all four external IDs** (then was deleted the same run; residual-zero verified). The AC-5 launch path was proven at wire-shape level against a local mock (top-down, exact payloads) with **zero live activation** per the override; pause was proven live as a no-op transition. Two new minor P3s (below) are hardening notes, not blockers. → routes to CLOSE (live $5/day launch remains Seth-gated at CLOSE).

---

## 2. Per-leg evidence

### Leg 1 — real create clears step 2, one PAUSED chain, 4 IDs, then residual-zero — **PASS**
- Baseline (real account): campaigns/adsets/ads/adcreatives all `{"data":[]}`.
- `POST admin-ad-create-campaign` (500¢ daily CBO, `LINK_CLICKS`/`IMPRESSIONS`, live event destination, accessible image, `request_id qa-862r-plumbing-1`) → **HTTP 200**: campaign `52584720839827`→ no wait — campaign **`52584723537027`**, ad set **`52584723539627`**, ad **`52584723547027`**, creative **`2063480314543915`** — one `ad_campaigns` + `ad_sets` + `ads` row set persisted, `status='PAUSED'` on all three rows, `delivery_status='PAUSED'` read back, `dest_url` canonical, `dest_smart_link` stored-not-sent.
- Meta-side direct reads: campaign `status=PAUSED, effective_status=PAUSED, bid_strategy=LOWEST_COST_WITHOUT_CAP` (the P1-1 fix visible on the real object); ad set `PAUSED/PAUSED`; ad `status=PAUSED` (`effective_status=IN_PROCESS` = Meta's transient processing state for a new paused ad — advertiser status never ACTIVE); one `create` audit row.
- Idempotency: same `request_id` replay → `idempotent_replay: true`, same row, count still 1.
- Cleanup (explicit platform delete, same run): creative delete → first refused **1487235 "Cannot delete creative with current ads"** (ad still existed — see P3-R2), campaign `DELETE` → `{"success":true}`, **cascade verified** (ad set AND ad read back `DELETED`), creative delete retried after ad deletion → `{"success":true}`. Final lists: **campaigns `[]`, adsets `[]`, ads `[]`, adcreatives `[]`**. Local DB: campaign row removed (cascade), 0/0/0, audit rows retained (append-only by design).

### Leg 2 — step-3 failure + `rollbackCreative` live — **PASS**
- **Real step-3 (creative) failure through the fn** (undownloadable image): **502 `meta_create_failed`, step=creative, rolled_back=true, `creative_rolled_back=null`** (correct — no creative existed at a step-3 failure); partial chain campaign `52584725830027` + adset `52584725834227` rolled back — campaign reads `DELETED` on Meta; audit row `rollback` carries both ids + step.
- **Step-4 (ad) failure through the fn against the MOCK Graph** (mock fails `POST /ads`): **502, step=ad, rolled_back=true, `creative_rolled_back=true`**, and the recorded wire sequence proves the ordering the rework promises: `POST /campaigns → POST /adsets → POST /adcreatives → POST /ads(400) → DELETE /{mock_adcreatives_3} → DELETE /{mock_campaigns_1}` — **the AdCreative is deleted BEFORE the campaign**; audit row `rollback` carries the creative id + step=ad; DB untouched.
- **Live wire proof of the delete verb:** a real UNREFERENCED creative (`1513691737200559`, created directly then deleted same minute) → `DELETE` → `{"success":true}`; adcreatives list back to `[]`. Plus the referenced-creative case (1487235) — see P3-R2.

### Leg 3 — AC-5 launch (ORCHESTRATOR OVERRIDE: no live activation) — **PASS within the override**
- **Nothing was ever set ACTIVE on Meta.** The launch leg ran against a LOCAL mock Graph (`META_GRAPH_BASE=http://host.docker.internal:8629`) with a **dummy token** (the real credential never even traveled to the mock).
- Wire-shape proof (recorded verbatim): `POST /v25.0/52584723537027 {"status":"ACTIVE"}` → `POST /v25.0/52584723539627 {"status":"ACTIVE"}` → `POST /v25.0/52584723547027 {"status":"ACTIVE"}` → `GET /v25.0/52584723537027?fields=id,status,effective_status,issues_info` — **top-down campaign→ad-set→ad, exact §4.0 order and payloads**. Local DB rows updated to ACTIVE + `launch` audit row (`PAUSED→ACTIVE`).
- Real Meta campaign checked immediately after: **`status=PAUSED, effective_status=PAUSED`** — never activated.
- **PAUSE proven live** (permitted: no-op transition on an already-PAUSED object): real `POST /{campaign} {status:PAUSED}` via the fn → 200, DB `ACTIVE→PAUSED` + `pause` audit row, delivery read back `PAUSED`.
- **Sync proven live:** `admin-ad-campaign-sync` → `synced:1, errors:[], truncated:false`; ad-set `external_status=PAUSED`; ad `review_status=PAUSED`, `review_detail` null (no fabricated `{}`); P3-10 bound (`LIMIT 50` + `truncated`) in code and response shape.

### Leg 4 — business-lane fail-close + invalid upsert (P2-3 + P2-4) — **PASS**
- With ONLY consumer secrets set: `POST admin-ad-connect {platform:meta, lane:business}` → **424 `meta_not_connected`** (the consumer credential was NOT silently verified) **AND** an invalid row upserted: `meta|business|invalid|connected=f|token_env_var=META_MINGLABIZ_SYSTEM_USER_TOKEN|external_account_id='unconfigured'` (documented sentinel). R-3 unit test re-run green; lane-correct env resolution verified in the diff (`laneEnvName`, `resolveMetaClient(conn, lane)` threading).

### Leg 5 — validate-only layers (P2-2) — **PASS, both cases**
- **First-ever run (no reference campaign):** 200 `{validated:true, validated_layers:["campaign","creative"], skipped_layers:[{layer:"ad_set", reason:"no_reference_campaign — …"}]}` — the skip is named, never silent.
- **With a reference campaign** (after the Leg-1 create): 200 `{validated:true, validated_layers:["campaign","ad_set","creative"], skipped_layers:[]}` — the ad-set layer (where P1-1 hid) is now genuinely validated against Meta; zero objects, zero rows both times.
- **Admin-UI honesty:** the toast surfaces the same contract — observed live: *"Validated — Validated layers: campaign, creative (skipped: ad_set) — nothing was created."*

### Leg 6 — admin `#/ad-engine` UI smoke — **PASS (live-fire, real 2FA)**
- Drove the REAL full login: password step → email OTP captured from local Mailpit → `Verify & Sign In` → dashboard (headless Chrome via CDP; no session injection shortcuts, no osascript).
- `#/ad-engine` renders: **SC-4** connected card ("Meta · Consumer (Use Mingla) — account 2393570861066813 · USD · ACTIVE — floors: imp $1.00 · video $1.00 · clicks $5.00 · conv $40.00 /day" — live floors surfaced); **SC-5** full create form (objective/goal/budget-with-floor-copy/countries/age/destination/creative/CTA/AI-toggle/validate-toggle); **SC-6** campaign list with dual-badge caption, "Sync status" control, honest empty state; preflight panel.
- Controls FIRE (no dead taps): **Run preflight** → live rows rendered: meta **amber**, P1 token ✓, P2 billing ✓, P3 Page+ADVERTISE ✓, B6 app Live ✓, P4 pixel WARN (never fired, 422-gated goals named), P5 tier ✓, P6 market ✓; four stub channels honestly `not_connected`. **Validate shapes** (the submit relabels itself when validate-only is ON) → the layers toast above. **Sync status** fired.
- Runtime-console/UX note: the submit button relabeling ("Create (Paused)" ↔ "Validate shapes") is good SC-3-style affordance. SC-1/SC-2 render states not UI-driven this round (they require unset/invalid consumer secrets; the API-level equivalents were proven in the first QA + Leg 4) — noted, not blocking.
- Nothing was created by the UI drive (DB count 0, Meta lists `[]` re-verified after).

### Leg 7 — full suite + gates + checks on the final commit — **PASS**
- Scoped suite: **75/75** (41 implementor + 20 tester adversarial untouched + 12 rework + **2 new retest adversarial**). `deno check` on all 7 ad-engine TS files clean. Both strict-grep gates + self-tests pass. CI `DENO_TEST_FILES` now lists all five files (`--allow-read` present).
- **Step 0.5 re-run of the rework's fails-on-revert:** true line-deletion of `bid_strategy: input.bidStrategy ?? META_DEFAULT_BID_STRATEGY,` → **R-1 ×2 + R-2 + my RT-A FAILED** (exact assertions at `issue862_wp1_rework.test.ts:53/:67/:79`, `issue862_wp1_retest_adversarial.test.ts:35`); restore → 75/75. Implementor's claim at `0b7fb2d75` confirmed independently.
- Note: a `__tests__/*.test.ts` GLOB run trips ~pre-existing failures in unrelated legacy suites (bouncer photo, imageCollage, notify triggers — environment-dependent, untouched by this branch); the CI job correctly uses the explicit file list. Not a WP1 regression (verified none of the failing files are in this branch's diff).

### New tester tests this round (append-only, on-branch, in-diff)
`supabase/functions/_shared/__tests__/issue862_wp1_retest_adversarial.test.ts` — **RT-A** (bid_strategy presence under a hostile input grid incl. injected keys — guards the P1-1 regression class via a different construction-path angle than R-1) and **RT-B** (DOUBLE rollback failure: creative AND campaign deletes both failing → both reported `false`, all three partial ids carried, creative attempted FIRST — a path R-4 doesn't cover). `fails-on-revert verified` (bid_strategy line deletion fails RT-A; restore passes). Wired into the CI job.

---

## 3. Findings (new this round)

- **P3-R1 — validate-only ad-set layer regresses to "skipped" whenever zero campaigns exist for the connection** (also immediately after a full cleanup, as observed live in the UI leg). Honest and named, but the first-create-after-cleanup always flies without ad-set prevalidation. Fix idea for #864: keep the most recent `external_campaign_id` (even of a deleted campaign — Meta validates against deleted parents? unverified) or validate ad-set fields client-side against the stored floors/matrix more aggressively. Informational.
- **P3-R2 — persist-failure path deletes the creative while the ad still references it** → Meta refuses (**1487235, proven live**), `creativeRollbackOk=false`, residue id audited; the campaign delete that follows cascades the ad, after which the creative WOULD be deletable (proven live: same creative deleted successfully post-cascade). Swapping the order (campaign first, then creative) in the **DB-persist-failure branch only** (`admin-ad-create-campaign/index.ts:567-580`) makes that rare path residue-free. The AtomicCreateError branch's creative-first order is CORRECT (ad never existed) — do not change it.
- **P4-a:** the mock-Graph leg validated the entire launch/rollback machinery with zero platform risk — the `META_GRAPH_BASE` env seam is a quality piece of design worth keeping documented for future WP testers.
- **P4-b:** the relabeling submit button ("Validate shapes" when validate-only is on) + the layers toast is exactly the SC-7 honesty the spec asked for.
- **P4-c:** preflight panel matches PROOF_LOG ground truth row-for-row (amber on P4 pixel only), including honest fail-close rows for the four unbuilt channels.

## 4. Constitution spot-re-check (rework surface only)

Rules 2/3/9/12 re-verified on the diff + runtime (single conversion point intact with the new bound; no silent failures — every degraded path names itself: `skipped_layers`, `creative_residue_id`, `truncated`; no fabricated data — `'unconfigured'` sentinel documented, `review_detail` null-not-`{}`; all gates still precede platform writes, auth now precedes validation everywhere). No violations. Full 14-rule matrix unchanged from the FAIL report otherwise.

## 5. Residual-zero statement

**Meta account `act_2393570861066813` final state: campaigns `[]` · adsets `[]` · ads `[]` · adcreatives `[]`** (all API-verified at session end). Soft-DELETED terminal objects from this retest (non-listable, non-spending): campaigns `52584723537027`, `52584725830027` (+ cascaded adset/ad `52584723539627`/`52584723547027`, adset `52584725834227`); creatives `2063480314543915`, `1513691737200559` both hard-confirmed deleted (`success:true`). **Nothing was ever ACTIVE on any platform object at any point.** Local stack torn down (`supabase stop --no-backup`); credentials env files shredded; migration renames restored byte-identical (335 files, original 6 duplicate pairs intact); `mingla-admin/.env` removed.

## 6. Accepted conditions

None required — PASS is unconditional. P3-R1/P3-R2 are follow-up hardening notes for the orchestrator to register (suggested: fold into #864 / the WP2 dispatch), not conditions on this verdict.

## 7. Discoveries for Orchestrator

- D-R1: P3-R1 + P3-R2 above (register as follow-ups; neither blocks WP1 CLOSE).
- D-R2: the `__tests__` glob-run failures are pre-existing, environment-dependent, and unrelated to this branch (bouncer photo / imageCollage / notify-trigger suites) — worth a hygiene ticket so local glob runs are meaningful again.
- D-R3 (carried): duplicate migration versions still break `supabase start` on main (P3-11, orchestrator lane per the rework dispatch).
- D-R4: Admin-UI login enforces a 12+-char password client-side — fine, but the local-dev seed docs should say so (cost me one failed login cycle).

---

**Routing:** PASS → CLOSE (orchestrator). The live $5/day `LINK_CLICKS` plumbing launch stays reserved for Seth's explicit go at CLOSE, exactly per the override.
**Working tree:** `~/Desktop/mingla-orchs/issue-862-meta-ads-api` on branch `issue-862-meta-ads-api`.
