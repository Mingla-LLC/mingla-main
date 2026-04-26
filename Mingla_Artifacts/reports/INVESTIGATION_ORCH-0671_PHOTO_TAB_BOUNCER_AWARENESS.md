# INVESTIGATION — ORCH-0671: Photo Pool admin surfaces vs. Bouncer signal system

**Investigator:** mingla-forensics
**Mode:** INVESTIGATE-ONLY (no code, no fix proposals beyond §9 change grid)
**Date:** 2026-04-25
**Severity:** S1 → **escalates to S0 candidate** (admin trust + cost-monitor fabrication; no production user impact, but operator-facing data is materially false)
**Confidence:** HIGH across all root-cause findings (every claim backed by file:line + live-DB SQL)

---

## §0 — Founder-Override Premise Check (REQUIRED FIRST)

The founder asserted two things:

| Claim | Verdict | Evidence |
|-------|---------|----------|
| (1) "The Photos tab on the Place Pool page is not aware of the new signal system; downloads photos for non-Bouncer-approved places" | **PARTIALLY TRUE — split verdict.** The **Photos TAB on the Place Pool page** (`<PhotoTab>` inside [PlacePoolManagementPage.jsx](mingla-admin/src/pages/PlacePoolManagementPage.jsx)) is functionally bouncer-aware (calls `backfill-place-photos` edge fn with modes `initial`/`refresh_servable`, both filter `is_servable=true`). BUT the **standalone "Photos" page** ([PhotoPoolManagementPage.jsx](mingla-admin/src/pages/PhotoPoolManagementPage.jsx) — separate route `photos` per [App.jsx:40](mingla-admin/src/App.jsx#L40)) is bouncer-BLIND across all 5 RPCs and the trigger RPC. | See §3 Thread A scorecard. |
| (2) "Still see 'AI Approved' on this tab" | **CONFIRMED TRUE** — literal string `"Not AI Approved"` rendered as a stat card on PhotoTab; `"AI-Approved Places by Category"` rendered as a section title; preview breakdown text says `"X not AI-approved"`. | [PlacePoolManagementPage.jsx:1737](mingla-admin/src/pages/PlacePoolManagementPage.jsx#L1737), [:1394](mingla-admin/src/pages/PlacePoolManagementPage.jsx#L1394), [:1980](mingla-admin/src/pages/PlacePoolManagementPage.jsx#L1980), [:2024](mingla-admin/src/pages/PlacePoolManagementPage.jsx#L2024), [:2069-2070](mingla-admin/src/pages/PlacePoolManagementPage.jsx#L2069-L2070). |

**Reframing the dispatch scope:** the original prompt focused on the standalone Photo Pool Management page. Investigation reveals **TWO separate broken surfaces** with **two different failure modes**. Both must be remediated, but they are different problems requiring different fixes:

- **Surface A — Photos TAB on Place Pool page** (`PlacePoolManagementPage.jsx → <PhotoTab>`): **Behavior correct, labels stale.** Pure label debt.
- **Surface B — Standalone "Photos" page** (`PhotoPoolManagementPage.jsx`, route `/photos`): **Bouncer-blind RPCs + dead-end trigger button + lying cost monitor.** Structural debt.

---

## §1 — Awareness Scorecard

### Surface A — Photos TAB on Place Pool page (`<PhotoTab>`)

| Layer | Bouncer-aware? | Evidence |
|-------|----------------|----------|
| Backfill engine ([backfill-place-photos/index.ts](supabase/functions/backfill-place-photos/index.ts)) | ✅ YES | [:175 `BackfillMode`](supabase/functions/backfill-place-photos/index.ts#L175) limits to `'initial'`/`'refresh_servable'`; [:243-269](supabase/functions/backfill-place-photos/index.ts#L243-L269) gates on `place.is_servable === true` for both modes. |
| Stat card "Downloadable Now" | ✅ YES | Reflects `analysis.eligiblePlaces` from edge-fn preview (post `is_servable` gate). |
| Stat card "Not AI Approved" | ⚠️ FUNCTIONALLY YES, LABEL STALE | [PlacePoolManagementPage.jsx:1737](mingla-admin/src/pages/PlacePoolManagementPage.jsx#L1737) reads `previewSummary.blockedByAiApproval`. Edge fn [:255-256](supabase/functions/backfill-place-photos/index.ts#L255-L256) explicitly comments `analysis.blockedByAiApproval++; // field name kept for backward compat in report` — the value IS the count of `is_servable!==true` blocks, but the field name and UI label call it "AI Approved". |
| Section "AI-Approved Places by Category" | ⚠️ FUNCTIONALLY YES, LABEL STALE | Powered by `admin_place_category_breakdown` RPC ([20260425000014 ch12](supabase/migrations/20260425000014_orch_0640_rewrite_place_admin_rpcs.sql)) → live-fire confirms it filters `mv.is_servable = true` ([live-fire below](#live-fire-evidence)). UI title is wrong; data is right. |
| Buttons "Initial Download" / "Refresh Servable Photos" | ✅ YES | Tooltips explicitly cite `is_servable` ([:1794, :1806](mingla-admin/src/pages/PlacePoolManagementPage.jsx#L1794-L1806)). |

**Verdict:** Surface A is **functionally bouncer-aware end-to-end**. The "AI Approved" string surviving in 5 places is purely cosmetic surface-debt left over from ORCH-0640 / ORCH-0646 cleanup waves that did not include this page.

### Surface B — Standalone "Photos" page (`PhotoPoolManagementPage.jsx`)

The page calls 6 RPCs + 1 trigger. Latest authoritative definitions:

| RPC | Latest migration | Bouncer-aware? | Evidence |
|-----|------------------|----------------|----------|
| `admin_photo_pool_summary` | [20260405000001:22-98](supabase/migrations/20260405000001_split_photo_pool_overview.sql#L22-L98) | ❌ NO | Counts use `WHERE is_active = true` only; never references `is_servable`. |
| `admin_photo_pool_missing_places` | [20260425000014 ch07:321-363](supabase/migrations/20260425000014_orch_0640_rewrite_place_admin_rpcs.sql#L321-L363) | ❌ NO | `WHERE is_active = true AND stored_photo_urls IS NULL AND photos != '[]'` — no `is_servable` filter. |
| `admin_photo_pool_categories` | [20260425000014 ch05:231-268](supabase/migrations/20260425000014_orch_0640_rewrite_place_admin_rpcs.sql#L231-L268) | ❌ NO | `WHERE pp.is_active = true` only. Group key is `pp.ai_categories[1]` (column still exists; legitimate use — AI is the categorizer, just not the gate). |
| `admin_photo_pool_locations` | [20260425000014 ch06:273-316](supabase/migrations/20260425000014_orch_0640_rewrite_place_admin_rpcs.sql#L273-L316) | ❌ NO | `WHERE pp.is_active = true` only. |
| `admin_photo_pool_refresh_health` | [20260425000014 ch08:368-412](supabase/migrations/20260425000014_orch_0640_rewrite_place_admin_rpcs.sql#L368-L412) | ❌ NO | Counts staleness across all `is_active`. |
| `admin_pool_category_detail` | [20260425000014 ch11:473-512](supabase/migrations/20260425000014_orch_0640_rewrite_place_admin_rpcs.sql#L473-L512) | ❌ NO | `WHERE pp.is_active = true AND p_category = ANY(...)` — no `is_servable`. |
| `admin_trigger_backfill` (button) | [20260317100002:300-390](supabase/migrations/20260317100002_admin_photo_pool_management.sql#L300-L390) | ❌ NO + ❌ DEAD CONSUMER | "all_missing" mode resolves via `WHERE is_active = true AND stored_photo_urls IS NULL AND photos != '[]'` — bouncer-blind. AND nothing in `supabase/functions/` consumes `operation_type='photo_backfill'` — only `place_refresh` is consumed by [admin-refresh-places/index.ts:298](supabase/functions/admin-refresh-places/index.ts#L298). |

**Verdict:** Surface B is **bouncer-blind across every layer** AND its primary CTA (the Backfill button) creates log entries that no worker processes (live-fire confirms 17 zombie rows pending since 2026-04-02).

---

## §2 — Correctness Verdict (Thread B)

### What set the standalone page surfaces vs. what it should surface

Live-DB query (this conversation, project `gqnoajqerqhnvulmnyvv`, timestamp 2026-04-25):

```
active_total                  : 65,340
servable_yes                  : 13,362   (Bouncer-approved — the "right" denominator)
servable_no                   : 13,078   (Bouncer-rejected — never serve, never need photos)
servable_unjudged             : 38,900   (60% of pool — Bouncer never ran on these)
missing_current_filter        :  1,325   ← what the standalone page surfaces as "missing photos"
missing_servable_only         :      0   ← what SHOULD show up
missing_but_excluded          :  1,325   ← 100% of "missing" = bouncer-rejected
missing_but_unjudged          :      0
servable_lacking_any_photos   :      0   ← inverse failure — none
```

**The standalone Photos page is currently surfacing 1,325 places as "missing photos to backfill" — and 100% of them are places the Bouncer has explicitly rejected.** If the trigger button worked, every dollar spent would be wasted. It does not work today, so $0 is actually being spent — but the operator sees a number that misrepresents reality.

### What the cost monitor tells the admin vs. the truth

```
estimated_monthly_cost_usd_current     : $695.63   ← what the page shows
estimated_monthly_cost_servable_only   : $0.00     ← what it would cost if filter were correct
```

The Cost Alert banner ([PhotoPoolManagementPage.jsx:560-565](mingla-admin/src/pages/PhotoPoolManagementPage.jsx#L560-L565)) renders when `costMonitor.estimated_monthly_cost_usd > 50`. Today: $695.63 > $50 = **alert banner is firing on a fabricated number**. The admin is being told "Cost Alert: projected $695.63/mo" when the bouncer-aware projection is $0.

### Categories tab — noise inventory

| Category | Total shown (current) | Servable subset (correct) | Noise displayed |
|----------|----------------------:|--------------------------:|----------------:|
| uncategorized | 24,061 | 1,119 | **22,942 (95%)** |
| brunch_lunch_casual | 12,354 | 4,328 | 8,026 (65%) |
| nature | 8,565 | 2,984 | 5,581 (65%) |
| icebreakers | 6,491 | 1,699 | 4,792 (74%) |
| drinks_and_music | 5,257 | 1,219 | 4,038 (77%) |
| creative_arts | 3,509 | 817 | 2,692 (77%) |
| movies_theatre | 2,146 | 342 | 1,804 (84%) |
| groceries | 1,008 | 311 | 697 (69%) |
| upscale_fine_dining | 911 | 286 | 625 (69%) |
| play | 811 | 182 | 629 (78%) |
| flowers | 227 | 75 | 152 (67%) |

**Average noise across non-uncategorized rows: ~73%.** The category coverage chart on this page is largely measuring the bouncer-rejected and bouncer-unjudged populations, not the population that will ever appear in the app.

### Place Refresh tab — noise inventory

```
total_active_places         : 65,340
stale_7d_current            : 52,916   ← page shows
stale_7d_servable_only      :  7,439   ← what matters
stale_7d_excluded           :  6,619   ← bouncer-rejected, refreshing wastes money
stale_7d_unjudged           : 38,858   ← bouncer never ran, refreshing them first is the WRONG order of ops
stale_30d_current           :    257
stale_30d_servable_only     :     10
```

**The "Stale > 7 days" card shows 52,916 — the bouncer-aware truth is 7,439 (86% noise).** The "Refresh All Stale" button at this scale would issue 52,916 Google Place Details API calls for ~$264.58 (52,916 × $0.005), with 86% of that spend going to places that will never serve.

---

## §3 — Cost & Blast-Radius Numbers (Thread C)

### Today (consumer dead — no real money flows)

The `operation_type='photo_backfill'` rows have NO consumer post-March 2026. Live-DB:

```
operation_type=photo_backfill, status=completed : 4 rows, $84 spent (March 18-19, 2026)
operation_type=photo_backfill, status=failed    : 2 rows
operation_type=photo_backfill, status=pending   : 17 rows  ← ZOMBIE since 2026-04-02 (23 days)
```

The 17 pending rows have `places_targeted` = 5,175-5,349 but the `place_ids` arrays no longer resolve to any rows in `place_pool` (live-fire: `targets_servable + targets_excluded + targets_unjudged = 0` for all 17). This means EITHER (a) the deactivated places have been hard-deleted, OR (b) the IDs were never persisted correctly. Either way, the rows are stuck `pending` forever.

**Real $/mo today on the standalone page: $0** (button is decorative).

### If the consumer were re-activated WITHOUT the bouncer fix

- **Backfill All Missing one click:** $46.38 spend (1,325 × 5 photos × $0.007), 100% wasted.
- **Refresh All Stale one click:** $264.58 spend (52,916 × $0.005), ~86% wasted = ~$227 of pure burn per click.
- **At admin's typical re-trigger cadence** (the 17 zombie rows were created 4 minutes apart — implies an admin retried ~once per 4 min seeing nothing happen): one bad afternoon could rack up $1,000s.

### Inverse failure (bouncer-approved with no photos)

`servable_lacking_any_photos = 0`. This is **good news** — the system isn't silently starving the serving set. Surface A's Photos TAB on the Place Pool page is doing its job. Surface B's noise has been masked because Surface A picks up the slack.

---

## §4 — "AI" Surface-Debt Inventory (Thread D)

Every literal "AI" string and every `ai_*` schema reference, classified:

### Surface A — `<PhotoTab>` in PlacePoolManagementPage.jsx

| Loc | String | Classification | Notes |
|-----|--------|---------------|-------|
| [:1394](mingla-admin/src/pages/PlacePoolManagementPage.jsx#L1394) | `"X not AI-approved"` (preview breakdown) | 🟡 Stale label, live data | Underlying value = `is_servable!==true` count. Should read "X not Bouncer-approved". |
| [:1737](mingla-admin/src/pages/PlacePoolManagementPage.jsx#L1737) | StatCard `label="Not AI Approved"` | 🟡 Stale label, live data | Same as above — most visible offender. Founder's likely visual reference. |
| [:1980](mingla-admin/src/pages/PlacePoolManagementPage.jsx#L1980) | Comment `"Load AI-approved category breakdown"` | 🔵 Stale comment | Cosmetic. |
| [:2024](mingla-admin/src/pages/PlacePoolManagementPage.jsx#L2024) | Comment `"AI-approved category breakdown"` | 🔵 Stale comment | Cosmetic. |
| [:2069-2070](mingla-admin/src/pages/PlacePoolManagementPage.jsx#L2069-L2070) | SectionCard `title="AI-Approved Places by Category"` | 🟡 Stale label, live data | Underlying RPC `admin_place_category_breakdown` IS bouncer-filtered (`mv.is_servable = true` — confirmed via live `pg_get_functiondef`). Title is wrong; data is right. |

### Surface B — PhotoPoolManagementPage.jsx
Page contains **zero "AI" strings** (verified via grep). All "AI" the founder might see on this surface comes from RPC return data, specifically `pp.ai_categories[1]` used as group key in `admin_photo_pool_categories` and `admin_photo_pool_locations` — but those values are slugs like `nature`, `brunch_lunch_casual` (not literal "AI"), so the founder is not seeing "AI" here.

### Edge function `backfill-place-photos`

| Loc | Code | Classification | Notes |
|-----|------|---------------|-------|
| [:175 `BackfillMode`](supabase/functions/backfill-place-photos/index.ts#L175) — comment `'initial'` mode docstring | `"first-time city setup; filter ai_approved=true AND no real photos"` | 🟡 Stale comment | Code now uses `is_servable` per [:243](supabase/functions/backfill-place-photos/index.ts#L243). Docstring lies. |
| [:186-187](supabase/functions/backfill-place-photos/index.ts#L186-L187) | duplicated `is_servable?: boolean \| null;` declaration | 🟡 Hidden flaw | Two identical lines in the `CityPlaceRow` interface. Probably leftover from refactor; TS allows but it's noise. |
| [:197 `RunPreviewAnalysis.blockedByAiApproval`](supabase/functions/backfill-place-photos/index.ts#L197) | field name in result interface | 🟠 Contributing factor | Field name is the source of the founder-visible "AI Approved" label leak. Code at [:255-256](supabase/functions/backfill-place-photos/index.ts#L255-L256) explicitly admits `// field name kept for backward compat in report`. The "backward compat" was never reconciled. |
| [:217-220](supabase/functions/backfill-place-photos/index.ts#L217-L220) | comment `"original behavior: ai_approved=true AND lacks real photos"` | 🟡 Stale comment | Same lie as above. |

### Schema (place_pool columns)

| Column | Status | Disposition |
|--------|--------|-------------|
| `ai_approved` | DROPPED ✓ | Confirmed via `information_schema.columns` — gone. |
| `ai_categories` (TEXT[]) | EXISTS | Legitimate — AI categorizer output, not a gate. |
| `ai_confidence` (REAL) | EXISTS | Legitimate. |
| `ai_web_evidence` (TEXT) | EXISTS | Legitimate. |
| `ai_reason` (TEXT) | EXISTS | Legitimate. |
| `ai_primary_identity` (TEXT) | EXISTS | Legitimate. |
| `is_servable` (BOOL NULLABLE) | EXISTS, 3-state | Authoritative serving gate. |
| `bouncer_validated_at` (TIMESTAMPTZ) | EXISTS | Audit timestamp. |
| `bouncer_reason` (TEXT) | EXISTS | Rejection reason. |

**Verdict:** No surviving `ai_approved` schema dependency. All "AI" surface debt is in code/labels/comments, not the database.

---

## §5 — Constitutional & Invariant Violations

| Constitution | Violation | Where |
|--------------|-----------|-------|
| **#2 — One owner per truth** | Two parallel backfill systems exist. System A (`admin_trigger_backfill` RPC + `admin_backfill_log` table, no consumer) and System B (`backfill-place-photos` edge fn + `photo_backfill_runs`/`photo_backfill_batches` tables, fully functional). They write different tables, take different mode names (`'all_missing'`/`'selected'` vs `'initial'`/`'refresh_servable'`), and apply different filters. The standalone Photos page wires to System A; the Photos TAB on Place Pool page wires to System B. | Standalone page → [PhotoPoolManagementPage.jsx:335](mingla-admin/src/pages/PhotoPoolManagementPage.jsx#L335) calls `admin_trigger_backfill` RPC. Place Pool tab → [PlacePoolManagementPage.jsx:1378](mingla-admin/src/pages/PlacePoolManagementPage.jsx#L1378) calls `backfill-place-photos` edge fn. |
| **#3 — No silent failures** | Standalone page's "Backfill All Missing" creates a log row, polls `admin_backfill_status` every 3s for 3 min, then says "Polling stopped — Backfill still pending after 3 minutes. Check the Backfill Log tab for updates." There is no consumer; the row will sit pending forever. The user is told to "check the log" — the log will perpetually show `pending`. | [PhotoPoolManagementPage.jsx:470-478](mingla-admin/src/pages/PhotoPoolManagementPage.jsx#L470-L478). Live-DB: 17 such zombie rows since 2026-04-02. |
| **#3 again** | The "Cost Alert" banner fires on a fabricated denominator. Banner renders if `estimated_monthly_cost_usd > 50`; today: $695.63 > $50 → fires. Bouncer-aware truth: $0. The admin is being warned about money that does not flow. | [PhotoPoolManagementPage.jsx:560-565](mingla-admin/src/pages/PhotoPoolManagementPage.jsx#L560-L565). |
| **#8 — Subtract before adding** | ORCH-0640 ch05 (the rewrite migration) updated 14 RPCs and ORCH-0646 ch1-6 covered 6 more. The 5 photo-pool RPCs were rewritten to drop `card_pool` joins but were not extended to add `is_servable` filters. The cleanup wave subtracted the old (`ai_approved`) without adding the new (`is_servable`) on this surface. | [20260425000014 §5-§8](supabase/migrations/20260425000014_orch_0640_rewrite_place_admin_rpcs.sql#L229-L412). |
| **#9 — No fabricated data** | Everything in §2 above. Coverage %, missing count, cost monitor, category counts, location counts, stale counts — all fabricated against the wrong denominator. | All 5 RPCs in Surface B. |

### Invariant candidates (NEW — orchestrator should formalize)

- **I-PHOTO-FILTER-EXPLICIT (already exists per ORCH-0598.11 [backfill-place-photos:172](supabase/functions/backfill-place-photos/index.ts#L172))** — currently scoped to the edge fn only. Should be extended to "every admin surface that aggregates or actions photo data MUST gate on `is_servable IS TRUE` unless the surface is explicitly labeled as showing the unfiltered pool."
- **I-OWNER-PER-OPERATION-TYPE** — every value in `admin_backfill_log.operation_type` MUST have exactly one consumer in `supabase/functions/`. CI grep gate would catch dead `operation_type` values at PR time.
- **I-LABEL-MATCHES-PREDICATE** — every UI label of the form `"X-approved"` MUST cite the actual approval predicate it counts. (Would have caught "Not AI Approved" labeling an `is_servable!==true` count.)

---

## §6 — Hidden-Flaws Table

| ID | Flaw | Severity | Notes |
|----|------|----------|-------|
| HF-0671-A | Standalone Photos page's "Setup Required" fallback ([:488-523](mingla-admin/src/pages/PhotoPoolManagementPage.jsx#L488-L523)) cites the WRONG migration filename — references `20260317000002_admin_photo_pool_management.sql` but the actual file is `20260317100002_admin_photo_pool_management.sql`. Also references `admin_pool_stats_overview()` which is deprecated per [20260405000001:296-298](supabase/migrations/20260405000001_split_photo_pool_overview.sql#L296-L298). | 🟡 Hidden flaw | Anyone hitting the setup fallback gets misleading instructions. |
| HF-0671-B | `CityPlaceRow` interface declares `is_servable?: boolean \| null;` twice ([:186-187](supabase/functions/backfill-place-photos/index.ts#L186-L187)). | 🟡 Hidden flaw | TS-tolerant but clearly leftover; will confuse the next reader. |
| HF-0671-C | The 17 zombie `admin_backfill_log` rows have `place_ids` that no longer resolve (live `targets_*` all 0). Either places were hard-deleted, or `place_ids` was never persisted. Need to investigate which. | 🟡 Hidden flaw | Suggests either a hard-delete path on `place_pool` exists somewhere (rare and risky), or the RPC has a write path bug that left arrays empty. |
| HF-0671-D | `admin_pool_stats_overview()` (the original monolith RPC) still exists in the database because the deprecation comment at [20260405000001:296-298](supabase/migrations/20260405000001_split_photo_pool_overview.sql#L296-L298) was commented-out. It still references `card_pool` (long archived) and `user_card_impressions` (per ORCH-0640 errata, never existed in prod). Calling it would throw. | 🟡 Hidden flaw | Dead RPC with broken body; should be dropped. |
| HF-0671-E | `admin_photo_pool_summary` was missed by ORCH-0640 ch05 — that migration rewrote 14 RPCs but `admin_photo_pool_summary` is NOT among them (only the 4 from the split migration are). ch05 silently skipped the most-loaded RPC on the page. | 🟠 Contributing factor | Pattern repeat of the ORCH-0646 missed-6 incident. |
| HF-0671-F | The standalone page's `setupNeeded` flag is set on PGRST202 (RPC not found) per [:159](mingla-admin/src/pages/PhotoPoolManagementPage.jsx#L159). After the fix, if any RPC is renamed but not all callers updated, the page silently swallows the error and shows the misleading "Setup Required" pre-2026-03 setup screen. | 🟡 Hidden flaw | Fragile failure mode — masks renamed RPCs as "migration not applied". |
| HF-0671-G | `admin_trigger_backfill` mode `'all_missing'` writes the resolved `place_ids` array via [migration 20260317100002:344-351](supabase/migrations/20260317100002_admin_photo_pool_management.sql#L344-L351) using `array_agg(id)` over `WHERE is_active=true AND stored_photo_urls IS NULL AND photos != '[]'`. If the resolved set is large (e.g. 5,000+ as in the zombie rows), the array column read pattern (`bl.place_ids` later expanded with `= ANY(...)`) can exhaust statement timeout when retried. | 🟡 Hidden flaw | Scale/performance risk for any future consumer. |
| HF-0671-H | The `Refresh Section` tab shows "Recently Served & Stale" using the post-ch05 RPC body that joins `engagement_metrics` ([20260425000014:393-401](supabase/migrations/20260425000014_orch_0640_rewrite_place_admin_rpcs.sql#L393-L401)). This is the ONLY place across all 5 photo-pool RPCs where the `is_active` filter is even partially scoped — and the join silently filters out places never served. **This is the LEAST-broken stat on the page.** | 🔵 Observation | Useful as a pattern reference for the fix. |
| HF-0671-I | Surface A's `formatPreviewBreakdown` ([:1391-1400](mingla-admin/src/pages/PlacePoolManagementPage.jsx#L1391-L1400)) renders BOTH `blockedByAiApproval` AND `blockedByNotServable` as separate lines. They count the same thing differently in different modes ([backfill-place-photos:255-258 vs :266-268](supabase/functions/backfill-place-photos/index.ts#L255-L268)). UI shows two rows that sum the same population. | 🟡 Hidden flaw | Operator could double-count and panic. |

---

## §7 — Five-Truth-Layer Contradiction Map

| Layer | Surface A — Photos TAB on Place Pool page | Surface B — Standalone Photos page |
|-------|-------------------------------------------|-----------------------------------|
| **Docs** | ORCH-0640/0646 retired `ai_approved`; bouncer is sole gate. | Same. |
| **Schema** | `place_pool.ai_approved` dropped; `is_servable` is the authoritative gate. | Same. |
| **Code** | Edge fn correctly gates on `is_servable=true`. UI labels use stale "AI Approved" wording. | RPCs use only `is_active=true`. UI passes through the lie. |
| **Runtime** | Backfill correctly skips non-servable places (proven by `servable_lacking_any_photos = 0`). | Trigger button creates orphan log rows; cost banner fires on $695.63 phantom; "missing photos = 1,325" all bouncer-rejected. |
| **Data** | `photo_backfill_runs` table — 4 completed real runs, fully bouncer-aware. | `admin_backfill_log` — 6 historical rows + 17 zombie pending rows orphaned for 23 days. |

**Contradictions:**
1. **Docs↔Code** on Surface A: docs say "bouncer is sole gate"; code labels say "AI Approved" — 1 contradiction (cosmetic).
2. **Code↔Runtime** on Surface B: code claims to count "missing photos"; runtime shows that the count is dominated by places that will never serve — 1 contradiction (semantic).
3. **Docs↔Runtime** on Surface B: docs say "Backfill All Missing fetches photos for missing places"; runtime says "creates a log row that no consumer processes" — 1 contradiction (functional).
4. **Schema↔Code** consistent across both surfaces — schema is clean, code is the only debt.
5. **Code↔Data** on `admin_backfill_log`: 17 pending rows since 2026-04-02 contradict the page's polling assumption that pending rows resolve within minutes — 1 contradiction (operational).

---

## §8 — Confidence Levels

| Finding | Confidence | Why |
|---------|-----------|-----|
| Founder claim 2 confirmed (AI label visible) | HIGH | Read the exact line, cited file:line. |
| Founder claim 1 partially confirmed | HIGH | Read all 5 RPC bodies (latest authoritative migrations) + edge fn + 2 admin pages; live-fired SQL. |
| Cost monitor fabrication ($695.63 vs $0) | HIGH | Live-DB SQL confirms bouncer-aware count is 0. |
| 17 zombie rows | HIGH | Live-DB SELECT returned them with timestamps. |
| Photo backfill consumer dead | HIGH | grep across all `supabase/functions/` found exactly one match for `operation_type`, scoped to `'place_refresh'` only. |
| Category noise % | HIGH | Live-DB SQL with both denominators. |
| HF-0671-C cause (hard-delete vs persist bug) | LOW | Did not investigate which root cause; flagged for Specer. |
| HF-0671-D `admin_pool_stats_overview` would throw | MEDIUM | Code review of body says yes; not live-fired (RPC isn't called by any UI). |

---

## §9 — What Would Need to Change (Grid Only — No Code)

This grid feeds the next-stage Specer dispatch. **It is not a fix proposal.** Each row identifies a delta the spec must define exactly.

### Surface A — `<PhotoTab>` on Place Pool page (label-only fixes)

| Layer | Current | Target | Change type |
|-------|---------|--------|-------------|
| UI | `label="Not AI Approved"` ([PlacePoolManagementPage.jsx:1737](mingla-admin/src/pages/PlacePoolManagementPage.jsx#L1737)) | `label="Not Bouncer Approved"` (or "Not Servable") | UI relabel |
| UI | `"X not AI-approved"` preview text ([:1394](mingla-admin/src/pages/PlacePoolManagementPage.jsx#L1394)) | `"X not Bouncer-approved"` | UI relabel |
| UI | SectionCard `title="AI-Approved Places by Category"` ([:2069-2070](mingla-admin/src/pages/PlacePoolManagementPage.jsx#L2069-L2070)) | `"Bouncer-Approved Places by Category"` (or "Servable Places by Category") | UI relabel |
| Comments | `// AI-approved category breakdown` ([:1980, :2024](mingla-admin/src/pages/PlacePoolManagementPage.jsx#L1980-L2024)) | bouncer/servable wording | Comment update |
| Edge fn type | `RunPreviewAnalysis.blockedByAiApproval: number` ([backfill-place-photos:197](supabase/functions/backfill-place-photos/index.ts#L197)) | rename to `blockedByNotServable` (consolidate with [:198](supabase/functions/backfill-place-photos/index.ts#L198)) — OR keep both but make UI consume only the consolidated field | Edge-fn rename + UI consumer update |
| Edge fn comments | `'initial' — first-time city setup; filter ai_approved=true` ([:173, :217-220](supabase/functions/backfill-place-photos/index.ts#L173-L220)) | replace `ai_approved` with `is_servable` | Comment update |
| Edge fn type | duplicate `is_servable?: boolean \| null;` lines ([:186-187](supabase/functions/backfill-place-photos/index.ts#L186-L187)) | dedupe to one declaration | Code cleanup |

### Surface B — Standalone Photos page (structural fixes)

**Strategic decision required from founder/orchestrator before spec writes:**

> **Q-671-1:** Does the standalone Photos page need to exist at all? The Photos TAB on the Place Pool page already covers the core operator workflow (preview, initial download, refresh servable, batch progress). The standalone page adds: cost trend chart, weekly cost graph, location heat map, category coverage grid, place-refresh tab. If retained, fix it (option A). If not, retire it (option B). **Orchestrator default: A — retain and fix**, because the analytics views (cost chart, location coverage, category coverage) are operationally useful even if the trigger button is removed.

**Assuming option A (retain and fix):**

| Layer | Current | Target | Change type |
|-------|---------|--------|-------------|
| RPC `admin_photo_pool_summary` ([20260405000001:22-98](supabase/migrations/20260405000001_split_photo_pool_overview.sql#L22-L98)) | `WHERE is_active = true` only | Add `AND is_servable IS TRUE` to all 3 COUNT clauses; clarify in returned JSON shape that figures are servable-scoped (or return BOTH `_total` and `_servable` variants); update the cost projection to be servable-only | DB migration (DROP+CREATE since return shape may change) |
| RPC `admin_photo_pool_missing_places` ([20260425000014:321-363](supabase/migrations/20260425000014_orch_0640_rewrite_place_admin_rpcs.sql#L321-L363)) | filter excludes `is_servable` | Add `AND pp.is_servable IS TRUE` to both COUNT and SELECT clauses | DB migration (CREATE OR REPLACE — return shape unchanged) |
| RPC `admin_photo_pool_categories` ([:231-268](supabase/migrations/20260425000014_orch_0640_rewrite_place_admin_rpcs.sql#L231-L268)) | groups all `is_active=true` | Add `AND pp.is_servable IS TRUE`; consider adding a row that surfaces "unjudged" count separately so admins can prioritize bouncer runs | DB migration |
| RPC `admin_photo_pool_locations` ([:273-316](supabase/migrations/20260425000014_orch_0640_rewrite_place_admin_rpcs.sql#L273-L316)) | groups all `is_active=true` | Add `AND pp.is_servable IS TRUE` | DB migration |
| RPC `admin_photo_pool_refresh_health` ([:368-412](supabase/migrations/20260425000014_orch_0640_rewrite_place_admin_rpcs.sql#L368-L412)) | counts staleness across all `is_active` | Add `AND is_servable IS TRUE` to stale_7d, stale_30d, total_active_places (and consider: a separate "unjudged_active" metric for visibility into the 38,900 unjudged population) | DB migration |
| RPC `admin_pool_category_detail` ([:473-512](supabase/migrations/20260425000014_orch_0640_rewrite_place_admin_rpcs.sql#L473-L512)) | drilldown is unfiltered | Add `AND pp.is_servable IS TRUE` | DB migration |
| RPC `admin_trigger_backfill` ([20260317100002:300-390](supabase/migrations/20260317100002_admin_photo_pool_management.sql#L300-L390)) — mode `'all_missing'` | bouncer-blind resolution + dead consumer | (a) Add `AND is_servable IS TRUE` to the resolution `WHERE` clause; (b) **EITHER** wire a consumer (new edge fn or scheduled cron processing `admin_backfill_log` photo_backfill rows by invoking `backfill-place-photos`) **OR** retire System A entirely and have this page invoke `backfill-place-photos` directly (consolidate to one owner per Constitution #2) | DB migration + edge-fn refactor OR full subtraction |
| `admin_pool_stats_overview` (deprecated monolith) ([20260317100002:78-248](supabase/migrations/20260317100002_admin_photo_pool_management.sql#L78-L248)) | exists, references archived tables, would throw if called | DROP FUNCTION | DB migration (subtraction per Constitution #8) |
| Cost Alert banner ([PhotoPoolManagementPage.jsx:560-565](mingla-admin/src/pages/PhotoPoolManagementPage.jsx#L560-L565)) | fires on phantom cost | (no UI change required if RPCs are fixed — denominator becomes correct upstream) | Indirect — fixed by RPC change |
| Setup fallback ([:488-523](mingla-admin/src/pages/PhotoPoolManagementPage.jsx#L488-L523)) | wrong migration filename + dead RPC name | Update filenames + remove `admin_pool_stats_overview` reference | UI text fix |
| Zombie rows in `admin_backfill_log` | 17 stuck pending since 2026-04-02 | Either mark as `cancelled` with audit reason, or DELETE if Surface B's trigger is being retired | One-time data backfill |
| New invariants (per §5) | absent | Add I-PHOTO-FILTER-EXPLICIT extension, I-OWNER-PER-OPERATION-TYPE, I-LABEL-MATCHES-PREDICATE to `INVARIANT_REGISTRY.md` + corresponding CI grep gates | INVARIANT_REGISTRY update + `scripts/ci-check-invariants.sh` patch |

---

## §10 — Adjacent Debt Observed (NOT in scope for this fix)

Sidebar items the orchestrator may want to register as separate ORCH-IDs:

- **D-1 — System A vs System B duplication.** The two parallel backfill systems (Constitution #2) deserve a separate triage decision. The fix grid above hints at consolidation but does not commit to it. Recommend separate ORCH for that decision.
- **D-2 — 38,900 places never bouncer-judged (60% of pool).** Out of scope for this audit but newly visible. Bouncer coverage is the upstream bottleneck on photo coverage. A "Bouncer Coverage" admin tab might warrant its own ORCH.
- **D-3 — `admin_place_pool_mv` includes `pp.ai_approved`** in its definition ([20260418000001:94](supabase/migrations/20260418000001_orch0481_admin_mv_layer.sql#L94)) but the column was DROPPED by ORCH-0640 ch13. The MV definition is broken — next REFRESH MATERIALIZED VIEW will fail. (Need to verify if a later migration patched this.)
- **D-4 — Setup-fallback pattern is fragile.** Used on multiple admin pages; silently masks renamed-RPC errors as "migration not applied". Pattern audit candidate.
- **D-5 — Pre-bouncer historical `admin_backfill_log` rows** retain useful spend data ($84 across 4 successful runs in March). Should not be deleted; should be queryable as historical baseline.
- **D-6 — `formatPreviewBreakdown` double-counts.** HF-0671-I above. Stale-by-design but visually confusing.
- **D-7 — `admin_trigger_category_fill` RPC + Category Fill modal** ([PhotoPoolManagementPage.jsx:366-396](mingla-admin/src/pages/PhotoPoolManagementPage.jsx#L366-L396)) is a separate feature (Google Nearby Search → seed new places) that lives on this page but isn't covered by this audit's scope. Likely also bouncer-unaware in its post-seed treatment.

---

## §11 — Live-Fire Evidence (Live-Fire Requirement Per `feedback_headless_qa_rpc_gap.md`)

All SQL executed against live database `gqnoajqerqhnvulmnyvv` (Mingla-dev) on 2026-04-25 by this investigator. Raw outputs preserved verbatim above in §2-§3. Five queries, all confirmed semantic results match the static code analysis.

Note: Direct `SELECT public.admin_photo_pool_summary()` invocation throws `Forbidden: admin access required` (RPC's `is_admin_user()` checks `auth.uid()`, which is NULL under MCP service-role context). RPC bodies were therefore replicated as raw SQL with the auth gate stripped. This is the equivalent of running the function as an authenticated admin, and matches what the admin UI would observe.

---

## §12 — Ready for Spec?

**YES — the next stage is a SPEC dispatch.** This investigation provides:
- Every RPC body to be modified, with file:line and the exact `WHERE` clause delta
- Every UI label to be changed, with file:line
- The strategic question that must be answered before the spec writes (Q-671-1: retain or retire Surface B)
- A change grid the Specer can convert directly into an implementation order
- Three new invariants to formalize
- A blast-radius and cost-baseline measurement that doubles as the tester's PASS criteria

Recommend orchestrator answer Q-671-1 with founder, then dispatch SPEC mode.
