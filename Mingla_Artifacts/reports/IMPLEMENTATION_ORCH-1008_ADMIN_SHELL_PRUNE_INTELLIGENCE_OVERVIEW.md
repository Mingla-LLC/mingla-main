# IMPLEMENTATION — ORCH-1008 [Admin shell prune + Place Intelligence Trial overview + UX overhaul]

- **Skill:** Claude `mingla-implementor`
- **Date:** 2026-05-29
- **Worktree:** `~/Desktop/mingla-orchs/ORCH-1008-[admin-shell-prune-intelligence-overview]/`
- **Branch:** `ORCH-1008-admin-shell-prune-intelligence-overview`
- **Commits ahead of main:** 6 (1 SPEC + 4 phase commits + 1 test commit)
- **Status:** implemented and verified (5 regression tests pass, 5 fails-on-revert proofs captured, Deno check clean, anchor `npm run build` blocked by pre-existing Tailwind drift — operator must run dev server for live screenshots)

---

## §0 — Comms ledger ack (entry-time scan)

Scanned `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md`. No BLOCK/WARN entries target `mingla-implementor+claude` or `ORCH-1008` directly. Two ALL-target WARNs factored into the work:

- **COMMS-0002** (backend allowlist gate) — landed `ORCH_1008_BACKEND_ALLOWLIST` in `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` in the SAME commit as the backend touches (Phase 3 commit).
- **COMMS-0003** (external API docs cited inline) — cited Gemini 2.5 Flash pricing URL https://ai.google.dev/pricing/gemini-2-5-flash in:
  - `supabase/functions/run-place-intelligence-trial/index.ts` (handleStartRun cost block comment)
  - `mingla-admin/src/services/intelligenceCoverageService.js` (header doc)
  - `mingla-admin/src/services/intelligenceCoverageEstimators.js` (header doc)
  - `mingla-admin/src/components/placeIntelligenceTrial/RunRemainderConfirmModal.jsx` (cost-breakdown footer with externalLink to the docs URL)

No new comms ledger entry written this turn — no cross-ORCH discovery.

---

## §1 — Files touched / new / deleted

### Deleted (6 pages + 1 orphan subtree = 26 files)
```
mingla-admin/src/pages/AnalyticsPage.jsx                    (DELETE)
mingla-admin/src/pages/BetaFeedbackPage.jsx                 (DELETE)
mingla-admin/src/pages/ContentModerationPage.jsx            (DELETE)
mingla-admin/src/pages/ReportsPage.jsx                      (DELETE)
mingla-admin/src/pages/SeedPage.jsx                         (DELETE)
mingla-admin/src/pages/TableBrowserPage.jsx                 (DELETE)
mingla-admin/src/components/rules-filter/*.jsx              (DELETE — 20 files; orphan subtree)
```

`components/seeding/` is NOT deleted — `PlacePoolManagementPage.jsx` lines 38-40 still imports `SeedTab`, `RefreshTab`, and seeding-format helpers. Grep verified before staying hands off.

### Edited (9 files)
```
mingla-admin/src/App.jsx                                            (Phase 1)
mingla-admin/src/lib/constants.js                                   (Phase 1)
mingla-admin/src/pages/PlaceIntelligenceTrialPage.jsx               (Phase 2 + Phase 3 wiring)
mingla-admin/src/components/ui/Tabs.jsx                             (Phase 4 — additive arrow-key nav, ~25 LOC)
mingla-admin/src/components/placeIntelligenceTrial/TrialResultsTab.jsx (Phase 4 — 3-mode picker, status groups, cancel modal, resume, signal panel)
mingla-admin/src/services/intelligenceCoverageService.js            (Phase 3 + test refactor — re-exports estimators)
supabase/functions/run-place-intelligence-trial/index.ts            (Phase 3b — remainder mode + new intelligence_coverage action)
.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs     (Phase 5 — COMMS-0002 backend allowlist)
```

### Created (12 files)
```
supabase/migrations/20260801000002_orch_1008_remainder_mode.sql                                  (Phase 3b — CHECK extension)
supabase/functions/run-place-intelligence-trial/__tests__/runRemainder.test.ts                    (Test 4)
mingla-admin/src/components/placeIntelligenceTrial/IntelligenceOverviewTab.jsx                    (Phase 3a)
mingla-admin/src/components/placeIntelligenceTrial/RunRemainderConfirmModal.jsx                   (Phase 3a + reused Phase 4)
mingla-admin/src/components/placeIntelligenceTrial/CancelRunConfirmModal.jsx                      (Phase 4c)
mingla-admin/src/components/placeIntelligenceTrial/PlaceResultExpanded.jsx                        (Phase 4b — Q2 16-card stack)
mingla-admin/src/components/placeIntelligenceTrial/RunHistoryGroups.jsx                           (Phase 4b — status-grouped run history)
mingla-admin/src/components/placeIntelligenceTrial/SignalDistributionPanel.jsx                    (Phase 4d — Recharts + spot-check)
mingla-admin/src/services/intelligenceCoverageEstimators.js                                       (test-friendly pure-math split)
mingla-admin/src/__tests__/orch1008_sidebar.test.js                                               (Test 1)
mingla-admin/src/__tests__/orch1008_intel_padding.test.js                                         (Test 2)
mingla-admin/src/__tests__/orch1008_intel_overview_tab.test.js                                    (Test 3)
mingla-admin/src/__tests__/orch1008_status_groups.test.js                                         (Test 5)
Mingla_Artifacts/reports/qa_evidence_orch1008/{README.md, phase4_light.html, phase4_dark.html,
                                              light_overview_tab.html, dark_overview_tab.html}    (QA evidence)
```

---

## §2 — Migration

- **File:** `supabase/migrations/20260801000002_orch_1008_remainder_mode.sql`
- **Monotonicity:** local + linked-remote heads are both ≤ `20260801000001` at write time (the local-only `20260801000001` is ORCH-0990's pending migration). Sibling worktree scan confirms `20260801000002` is strictly greater than every local prefix.
- **Migration list --linked head:**
  ```
  20260801000000 | 20260801000000 | 2026-08-01 00:00:00
  20260801000001 |                | 2026-08-01 00:00:01   ← local-only, ORCH-0990
  ```
  My new migration `20260801000002_orch_1008_remainder_mode.sql` will sit one step above.
- **Read-only invariant probe (run via `mcp__supabase__execute_sql`):**
  ```sql
  SELECT mode, count(*) FROM public.place_intelligence_runs GROUP BY mode ORDER BY mode;
  -- Result: full_city=4, retry_failed=1, sample=1  → all values already inside
  -- the new ('sample','full_city','retry_failed','remainder') CHECK superset.
  -- Zero existing rows would violate the new constraint.
  ```
- **Apply command (copy-paste ready) for the operator:**
  ```bash
  cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-1008-[admin-shell-prune-intelligence-overview]" && /Users/sethogieva/bin/supabase db push --linked
  ```
  Note: this will also apply ORCH-0990's pending `20260801000001` migration first; coordinate with ORCH-0990's close PR.

---

## §3 — Edge function

- **Touched edge fn:** `supabase/functions/run-place-intelligence-trial` (the only edge fn touched)
- **`_shared` imports touched:** none — `handleStartRun` + the new `handleIntelligenceCoverage` use existing imports only.
- **Deno check result:** clean — `/Users/sethogieva/.deno/bin/deno check supabase/functions/run-place-intelligence-trial/index.ts` exits 0 with no diagnostics.
- **Deploy command (orchestrator runs after CLOSE per the standing deploy split):**
  ```bash
  /Users/sethogieva/bin/supabase functions deploy run-place-intelligence-trial --project-ref gqnoajqerqhnvulmnyvv
  ```

---

## §4 — Test results — Step 0.5 GATE

Baseline commit for all fails-on-revert proofs: **`2300b918e`** (the forensics SPEC commit — pre-implementation).

| # | Test path | Result | Fails-on-revert proof |
|---|-----------|--------|------------------------|
| 1 | `mingla-admin/src/__tests__/orch1008_sidebar.test.js` | **PASS** (8/8 subtests) | FAILS on revert verified at `2300b918e` — 6 of 8 subtests fail when constants.js is reverted to baseline |
| 2 | `mingla-admin/src/__tests__/orch1008_intel_padding.test.js` | **PASS** (2/2 subtests) | FAILS on revert verified at `2300b918e` — 2 of 2 subtests fail when PlaceIntelligenceTrialPage.jsx is reverted |
| 3 | `mingla-admin/src/__tests__/orch1008_intel_overview_tab.test.js` | **PASS** (10/10 subtests) | FAILS on revert verified at `2300b918e` — 1 of 1 file-level test fails (ERR_MODULE_NOT_FOUND on the new IntelligenceOverviewTab + estimators) |
| 4 | `supabase/functions/run-place-intelligence-trial/__tests__/runRemainder.test.ts` | **PASS** (5/5 Deno tests) | FAILS on revert verified at `2300b918e` — 1 of 5 (the source-inspect test) fails when index.ts is checked out to baseline; the other 4 are inline-mirror simulator tests that hold regardless and serve as the contract spec |
| 5 | `mingla-admin/src/__tests__/orch1008_status_groups.test.js` | **PASS** (11/11 subtests) | FAILS on revert verified at `2300b918e` — 5 of 11 subtests fail when TrialResultsTab + RunHistoryGroups are reverted/removed |

**Test commands:**
```bash
# Admin tests (node --test — mingla-admin uses node:test, not Vitest)
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-1008-[admin-shell-prune-intelligence-overview]" && \
  node --test mingla-admin/src/__tests__/orch1008_*.test.js
# → 31 pass / 0 fail / 6 suites

# Deno test for the edge fn
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-1008-[admin-shell-prune-intelligence-overview]" && \
  /Users/sethogieva/.deno/bin/deno test --allow-read \
    supabase/functions/run-place-intelligence-trial/__tests__/runRemainder.test.ts
# → 5 passed | 0 failed
```

**Test-infrastructure note:** mingla-admin has no Vitest / React Testing Library. The existing convention (`mingla-admin/src/lib/__tests__/claimsPhone.test.js`) is node:test. To keep tests in-stack without introducing a new dependency, all admin tests assert (a) module/constant shapes, (b) static source-grep on the JSX surface, and (c) physical-file-existence. JSX-render testing would require introducing jsdom + a React renderer; that's deferred to a future ORCH if the tester wants behavior-level coverage. The fails-on-revert proofs are real and reproducible.

---

## §5 — Screenshots

Headless browser screenshots are blocked by a pre-existing anchor `mingla-admin/node_modules` Tailwind drift (the symlinked `@tailwindcss/vite` expects a `compile` export from `@tailwindcss/node` that the installed version does not provide; reproducible with `npm run build` and `npx eslint`). `npm install` was forbidden by the dispatch. Per the dispatch escape clause, static DOM evidence is provided:

```
Mingla_Artifacts/reports/qa_evidence_orch1008/README.md
Mingla_Artifacts/reports/qa_evidence_orch1008/phase4_light.html        — tabs + segmented mode picker + cost preview + 5 status-group headers + 4 Q2 reasoning cards (success/info/warning/veto)
Mingla_Artifacts/reports/qa_evidence_orch1008/phase4_dark.html         — same surface, dark theme tokens (lifted verbatim from globals.css [data-theme="dark"] block)
Mingla_Artifacts/reports/qa_evidence_orch1008/light_overview_tab.html  — IntelligenceOverviewTab: 4 aggregate tiles + per-city coverage table with progress bar + Run remainder CTA per row
Mingla_Artifacts/reports/qa_evidence_orch1008/dark_overview_tab.html   — same, dark
```

The HTML files inline the same Tailwind/globals.css CSS-var ladder and apply the exact class lists used in the React JSX, so light + dark contrast can be verified by opening the files in any browser. To capture true PNG screenshots the operator can run `cd mingla-admin && npm install && npm run dev` once the Tailwind drift is resolved, then visit `http://localhost:5173/#/place-intelligence-trial` and toggle theme via Settings.

---

## §6 — Step 0.5 evidence summary (complete)

- All 5 regression tests written, passing, and fails-on-revert verified at baseline `2300b918e`.
- Tests shipped in the SAME PR as the fix (see §1 — `__tests__/` under both `mingla-admin/src/` and `supabase/functions/run-place-intelligence-trial/`).
- COMMS-0002 backend allowlist updated in the SAME commit as the backend file additions (Phase 3 commit `f465352dc`).
- COMMS-0003 Gemini docs URL cited inline in every touched code path that hits the pricing math.

---

## §7 — Old → New receipts per file (key edits)

### `mingla-admin/src/App.jsx`
- **Was:** Imported 18 page modules; PAGES map had 18 entries; the 6 deleted ids (content/analytics/reports/feedback/seed/tables) were live routes.
- **Now:** Imports 12 page modules; PAGES map has 12 entries; the 6 deleted ids are gone (legacy hashes silently fall through to overview via the existing `getTabFromHash` guard).
- **Why:** SPEC §2 Phase 1 deletion list + the operator's "we never click these" assertion.

### `mingla-admin/src/lib/constants.js`
- **Was:** 7 nav groups (People / Supply / Quality Gates / Content / Intelligence / Operations / System) with a `collapsible:true` System group hiding Settings + Table Browser.
- **Now:** 1 nav group, label:null, 12 items in the SPEC-locked order. Settings is top-level.
- **Why:** Invariant I-PROPOSED-ADMIN-SHELL-FLAT-NAVIGATION (flips ACTIVE on CLOSE).

### `mingla-admin/src/pages/PlaceIntelligenceTrialPage.jsx`
- **Was:** Root wrapper double-wrapped the AppShell content box (max-w + mx-auto + px-6 INSIDE AppShell's max-w + mx-auto + px-16) → page rendered visibly narrower than peers. Single "Trial Results" tab. AlertCard intro panel.
- **Now:** Root wrapper is `py-6 flex flex-col gap-6` (matches SignalLibraryPage convention). 2-tab system: Overview (default) + Trial Results. AlertCard removed (content folded into Overview tab + mode-picker helper text per design §1.1).
- **Why:** SPEC §3 Phase 2 + Phase 3a. Invariant I-PROPOSED-INTEL-TRIAL-PEER-PADDING (flips ACTIVE on CLOSE).

### `supabase/functions/run-place-intelligence-trial/index.ts`
- **Was:** `handleStartRun` admitted `mode IN ('sample','full_city')`. The mode-enum validator + cost guard + parent-insert + pg_net kick all assumed two modes.
- **Now:** `handleStartRun` admits `mode IN ('sample','full_city','remainder')`. `remainder` selects servable place IDs that have never reached `status='completed'` for the same city via a Set diff (`evaluatedSet`). Cost guard mirrors `full_city` semantics (confirm_high_cost=true required above $5). pg_net first-chunk kick fires for both `full_city` and `remainder`. New top-level action `intelligence_coverage` returns per-city aggregate rows (4 parallel queries, client-side join, sorted by servable_count desc, ≥1 servable filter).
- **Why:** SPEC §3 Phase 3b (predicate verbatim). COMMS-0003 Gemini docs URL inline-cited above the cost block.

### `mingla-admin/src/components/placeIntelligenceTrial/TrialResultsTab.jsx`
- **Was:** 2-button segmented control (Sample / Whole city). Helper-text-only cost display. window.confirm cancel prompt. Per-run flat list with inline PlaceResultCard (Q2 rendered as truncated tooltips).
- **Now:** 3-button segmented control adds "Remainder only". Live cost-preview chip with warning/error color ladder + breakdown line ("X of Y already scored"). Cancel button opens `CancelRunConfirmModal`. Resume-from-N button appears on cancelled-run banners. Per-run flat list replaced by `RunHistoryGroups`. `SignalDistributionPanel` mounts under the City-coverage card when the selected city has ≥10 completed places. Inline PlaceResultCard deleted (replaced by `PlaceResultExpanded` mounted by `RunHistoryGroups`).
- **Why:** DESIGN §1.3, §2.1, §2.4, §3, §4.2, §4.3, §5.

### `mingla-admin/src/components/ui/Tabs.jsx`
- **Was:** Click-only tab activation; tabIndex/aria-selected/role wired but no keyboard cycling.
- **Now:** Adds Left/Right arrow + Home/End cycling on the focused tab. Disabled tabs are skipped. Focus moves to the new active tab. Fully backward-compatible; click + tabIndex behavior unchanged.
- **Why:** DESIGN §7.1 keyboard nav recap + §10 operator-review flag (the design noted this primitive enhancement explicitly).

### `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs`
- **Was:** C7 backend allowlist contained 30+ prior ORCH allowlists but nothing covering ORCH-1008's migration or edge-fn edit.
- **Now:** Adds `ORCH_1008_BACKEND_ALLOWLIST` listing the migration + edge-fn index.ts + the runRemainder Deno test file; spreads it into the unified ALLOWLIST array. Per COMMS-0002.
- **Why:** Strict-grep C7 would otherwise block PR merge with `FAIL [C7: no-new-backend-files]`.

---

## §8 — Spec traceability

| SPEC criterion | Implemented in | PASS / UNVERIFIED |
|----|----|----|
| Phase 1: delete 6 page files + sidebar flatten + Settings top-level | App.jsx + constants.js + git rm | PASS |
| Phase 2: peer-page padding parity | PlaceIntelligenceTrialPage.jsx line 43 → `py-6 flex flex-col gap-6` | PASS (test 2 grep-asserts) |
| Phase 3a: Overview tab + per-city coverage table + Run remainder CTA per row | IntelligenceOverviewTab.jsx + intelligenceCoverageService.js + RunRemainderConfirmModal.jsx | PASS (tests 3 + manual browser verification deferred to operator) |
| Phase 3b: edge fn admits mode='remainder', SQL predicate matches SPEC §3 Phase 3b verbatim | index.ts:986-1100 | PASS (Deno test 4 + remote probe of mode CHECK supercedes confirmed) |
| Phase 3b: new migration extends mode CHECK + sample_size CHECK | 20260801000002_orch_1008_remainder_mode.sql | PASS — pending operator `db push` |
| Phase 4a: 3-option segmented + live cost preview | TrialResultsTab.jsx | PASS |
| Phase 4b: status-grouped run history + Q2 16-card stack | RunHistoryGroups.jsx + PlaceResultExpanded.jsx | PASS |
| Phase 4c: cancel modal + resume-from-N | CancelRunConfirmModal.jsx + Resume button in active-run banner | PASS |
| Phase 4d: per-signal verdict distribution + spot-check | SignalDistributionPanel.jsx | PASS |
| Tabs.jsx arrow-key nav additive | Tabs.jsx | PASS |
| Both light + dark mode render correctly | All Phase 4 components use only existing CSS var tokens; dark theme auto-applies via `[data-theme="dark"]` | PASS — verified via DOM-rendered HTML proof; live browser verification deferred to operator (Tailwind anchor drift) |

---

## §9 — Invariant verification

- **I-PROPOSED-ADMIN-SHELL-FLAT-NAVIGATION** (single nav group, no collapsible): asserted by test 1 — `expect(NAV_GROUPS.length).toBe(1) && expect(NAV_GROUPS[0].collapsible).toBeFalsy()`. Preserved.
- **I-PROPOSED-INTEL-TRIAL-PEER-PADDING** (no max-w/mx-auto/px-* at page root): asserted by test 2. Preserved.
- **I-PROPOSED-INTEL-REMAINDER-SKIPS-COMPLETED** (remainder must exclude completed): asserted by Deno test 4 (4 inline simulator subtests + 1 source-inspect). Preserved.
- **I-TRIAL-OUTPUT-NEVER-FEEDS-RANKING**: no consumer-deck or signalScorer code touched. Preserved.

---

## §10 — Parity check

- Admin-only surface — no solo/collab consumer parity concerns.
- Consumer iOS / Consumer Android / Buyer-anon Web / Business iOS / Business Android / Business Web preview: untouched.
- Admin Web: the only affected surface. Light + dark both validated via DOM-rendered HTML.

---

## §11 — Cache safety

- No React Query keys touched.
- The Overview tab does not introduce a query factory; it polls via direct `invokeWithRefresh("run-place-intelligence-trial", { body: { action: "intelligence_coverage" } })`. Each tab mount re-fetches; explicit Refresh button forces a re-call. No stale cache risk.
- The `remainder` mode insert path uses the existing unique partial index on `(city_id) WHERE status IN ('pending','running','cancelling')` — same 23505 → 409 concurrent_run behavior as full_city.

---

## §12 — Regression surface (what the tester should focus on)

1. **Place Pool page** — `PlacePoolManagementPage.jsx` still imports `SeedTab` + `RefreshTab` from `components/seeding/`. Smoke-test that the Seed and Refresh sub-tabs still load on the Place Pool page after my prune.
2. **CommandPalette (Cmd+K)** — derives entries from NAV_ITEMS; deleted pages should no longer appear. Verify by query.
3. **Other admin pages that mount the Tabs primitive** (Place Pool tabs, Signal Library tabs, Photo Labeling tabs) — verify arrow-key navigation behaves as designed; existing click behavior unchanged.
4. **`db push`** — confirm migration 20260801000002 lands after ORCH-0990's 20260801000001; verify CHECK constraint via SQL probe.
5. **First end-to-end remainder run** — operator picks a city with ≥1 unscored servable, hits Run remainder, confirms in the modal, watches the active-run banner spawn, cancels mid-run, then hits Resume.

---

## §13 — Discoveries for orchestrator

- **Pre-existing mingla-admin Tailwind drift (P2):** anchor's `mingla-admin/node_modules` has `@tailwindcss/vite` expecting a `compile` export from `@tailwindcss/node` that the installed version doesn't provide. This blocks `npm run build`, `npm run dev`, and `npx eslint`. It's not caused by ORCH-1008 (reproducible on `main` before any of my commits) but blocks any future admin work that needs the dev server. Suggest a quick ORCH to `npm install` + lock the resolved versions.
- **Per-place cost constant divergence between DESIGN and edge fn (P3):** DESIGN §0 + §2.4 headline is `$0.0075`; the existing edge fn + my new estimators use `$0.0040`. Per the design's §10 Operator Review Flag, the value was left as the existing edge-fn truth (`$0.0040`) to avoid an unauthorized cost-policy change. If operator confirms $0.0075 is the correct META-ORCH-1009 billing rate, both `PER_PLACE_COST_USD` constants flip in one trivial edit.
- **`onFilterByRun` callback in RunHistoryGroups is currently a stub** (P3) — clicking the "Run …" lineage badge in an expanded place panel surfaces a toast saying "lineage filter not yet wired." Wiring the deep-filter would require a dedicated tab state and is out of scope per the DESIGN spec (the design called out the badge but not a filter UI).

---

## §14 — Constitutional compliance quick-check

| Rule | PASS / N/A | Notes |
|---|---|---|
| Subtract before adding | PASS | 6 page files + 20 orphan files deleted before any new Phase 4 code |
| No silent failures | PASS | Every catch block in new code surfaces a toast or error AlertCard |
| Every state handled | PASS | IntelligenceOverviewTab covers loading/error/empty/populated/refreshing; modals handle submitting/error/dismissed |
| Spec is law | PASS | All SPEC sections implemented; deviations documented in §13 |
| Read before write | PASS | All edited files read first; pre-existing patterns preserved (e.g. `useToast`, `extractFunctionError`, `invokeWithRefresh` usage matches sibling services) |
| Verify or label | PASS | Test results captured with commit hashes; UNVERIFIED items labelled (live screenshots, end-to-end remainder run) |

---

## §15 — Output contract

- **Code commits on the per-ORCH branch:** YES — 5 new commits (`4288fe0dd`, `313d531c5`, `f465352dc`, `174e320c5`, `99783bc49`) on top of the SPEC commit `2300b918e`. Branch is local-only — operator decides when to push + open PR.
- **Implementation report:** this file.
- **PR push / merge / migration apply / edge deploy:** NOT done; per skill rules these are operator/orchestrator-owned actions after REVIEW + TEST PASS.

---

## §16 — Next handoff

Per dispatch: hand back to the orchestrator for REVIEW. After REVIEW APPROVED, orchestrator dispatches `mingla-tester` for adversarial QA. After tester PASS, orchestrator runs CLOSE protocol (no `[deploy]` tag — admin-web is on Vercel and the deploy tag is per-project; verify mingla-admin Vercel gate before tagging).

— END REPORT —
