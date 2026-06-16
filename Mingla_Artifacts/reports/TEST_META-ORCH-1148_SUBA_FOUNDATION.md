# TEST — META-ORCH-1148 sub-ORCH 2.0 — Venue Suite FOUNDATION

- **Tester:** mingla-tester (brutal production gatekeeper). Assumed broken until proven.
- **Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1148-[venue-suite-foundation]/` · branch `ORCH-1148-venue-suite-foundation` · impl commit **`2f194a71f`**.
- **SPEC:** `specs/SPEC_META-ORCH-1148_SUBA_FOUNDATION.md` (binding contract).
- **COMMS ledger:** read on entry (anchor `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md`). No OPEN/BLOCK row addressed to ALL or ORCH-1148 touching venue/1148 files. Nothing to ack.
- **Method:** independent code-trace of every shipped file (did NOT trust the report) + ran every gate myself + wrote my OWN adversarial suite on a different angle + proved fails-on-revert at `2f194a71f`.

## VERDICT: **CONDITIONAL PASS**

The ship is correct, honest (no dead taps), brand-scoped, additive-only, and money-free, exactly per SPEC + the 5 Conductor resolutions. Every testable invariant is proven by code-trace + green gates + an independent adversarial suite with fails-on-revert. **One P3 latent defect** in the DB invariant-probe (non-deterministic CHECK-constraint selection) and **two P4 packaging notes**. None blocks merge; the P3 should be tightened before the probe is relied on as a CLOSE invariant anchor. The on-device visual leg (sim/device render of OFF→ON, pill-replacement, two-column reflow, Android opaque glass) is **DEFERRED** to a post-merge/dev-OTA check (accepted pattern — no RTL/jsdom + no device this run); all logic/wiring/RLS proven by trace + jest.

---

## Per-criterion results (TEST checklist)

| # | Criterion | Result | Evidence |
|---|-----------|--------|----------|
| 1 | Toggle gates the suite (OFF → Overview+Settings+invitation; ON → booking modules) | **PASS** | `deriveVenueModules` pure OFF→`['overview','settings']`, ON→`['overview',...booking,'settings']` (`venueModules.ts:81`). jest venueModules 7/7 + my adversarial 10/10. Shell OFF-state renders `VenueListingContent` + invitation card (`VenueSuiteShell.tsx:109-140`). |
| 2 | No dead taps (booking → honest ComingSoon, never blank/stub/fake CRUD; pills drive state not router) | **PASS** | Shell dispatch: booking → `<VenueModuleComingSoon>` (`VenueSuiteShell.tsx:146`). `grep router.(push\|replace\|navigate)` in PillRow/ComingSoon/Shell = ZERO (state-only). ComingSoon CTA = `setActiveModule("settings")`, a real 2.0 surface. |
| 3 | Replace-Hub-pills; nav-lock + HUB_TAB_ROUTES untouched (T-12/T-13 green unmodified) | **PASS (logic) / DEFER (render)** | `_layout.tsx:285` conditional render swap `VenueModulePillRow` ⟷ `HubSubNav`, gated on `showVenueModulePills = active && !isWideDesktop && selectModule!==null` (`:113`). Nav-lock redirect effect (`:171-205`) + `/hub/` guard (`:183`) + `HUB_TAB_ROUTES` UNTOUCHED — confirmed `git show --stat` did NOT touch nav-lock/useHubTabs/HubSubNav files. `hub-layout-nav-lock` + `useHubTabs.venueGate` 13/13 GREEN unmodified. RTL render-proof deferred (node-env jest; my adversarial suite covers the predicate + the EXIT-restore the implementor left open). |
| 4 | Settings: no buyer-tax/billing form; paid-fee gated on charges-enabled; team display-only; toggle-ON→Settings | **PASS** | `grep billing/tax-form` in `VenueSettingsModule.tsx` = ZERO code (only docstring). strict-grep gate self-test + real PASS. `handleToggleFee` blocks paid fee when `!payoutReady` → shows `paidPublishGuardCopy` + onboarding route (`:121-136`). Team = static `ROLE_LEGEND` + route to existing `/brand/[id]/team` (no mutation). Toggle-ON → `setActiveModule("settings")` (`VenueSuiteShell.tsx:99`). |
| 5 | Migrations: schema=SPEC, RLS brand-scoped, 8-state CHECK, additive, monotonic, waitlist_entries untouched | **PASS (trace) / DEFER (live RLS)** | 7 tables RLS ENABLED (7/7), member-read + manager-plus-write policy on each (2/2), ZERO `TO anon`, consumer-write = service_role only. `reservations.status` 8-state CHECK correct. `venue_reservation_settings` brand_id PK + default false. Helpers `biz_is_brand_member_for_read_for_caller`/`biz_brand_effective_rank_for_caller` defined in baseline (`:3023/:3170`); RLS mirrors events-table pattern verbatim. Additive (`IF NOT EXISTS`/`DROP POLICY IF EXISTS`). Versions `20261003000000-07` > origin/main max `20261002000000`. `venue_waitlist` is a NEW table; `waitlist_entries` untouched (T-MIG-7). deno 9/9. Live RLS deny/allow probe deferred (tables not yet in any DB; MCP read-only on prod). |
| 6 | No money in 2.0 (checkout/all-in engine untouched, no charge path) | **PASS** | `git show --name-only` touched ZERO ticket-checkout/allInPricing/stripe-edge/paystack-edge files. Fee gate is UI-level only; fee preview is display-only (`formatCurrency`, no charge). Documented seam comments in migrations. |
| 7 | My OWN adversarial test (different angle) + fails-on-revert | **PASS** | See below. |
| 8 | jest + tsc + eslint run independently; pre-existing baseline confirmed (stash-and-rerun) | **PASS** | See "Gates I ran" + "Baseline attribution". |

---

## Gates I ran myself (not trusting the report)

| Gate | My result |
|------|-----------|
| jest `src/components/venue/__tests__` | **19/19 PASS** (incl. new venueModules + venueFeeGate + pre-existing venue suites) |
| jest `hub-layout-nav-lock` + `useHubTabs` (T-12/T-13, unmodified) | **13/13 PASS** |
| strict-grep `orch-1148-no-buyer-tax-form` `--self-test` + real | **PASS / exit 0** (both) |
| deno migration regression (run from worktree ROOT — the cwd matters) | **9/9 PASS** |
| `tsc --noEmit` — venue/hub-1148 files | **0 errors** |
| `tsc --noEmit` — total | **325** (pre-existing) |
| eslint — all 11 changed venue/hub files | **0 errors / exit 0** |
| My adversarial suite `venueSuiteLeakAndExit.tester.adversarial` | **10/10 PASS** |

> NOTE: a first `deno test` run from inside `supabase/migrations/` FAILED with a `readTextFileSync` path error — that was MY cwd mistake (the test uses `DIR="supabase/migrations"` relative path). Re-run from the worktree root = clean 9/9. NOT a defect.

## Baseline attribution (independently confirmed)
- **325 tsc errors**: I diffed the 43 error-bearing files against the 14 commit-touched files — **EMPTY intersection**. Every tsc error lives in `packages/*` (brand-rendering, event-rendering, phone-input, etc.) and other untouched source. This ship adds **zero** type errors. Confirmed pre-existing & independent.
- **~86 stale jest suites**: those failing suites are source-pin tests in unrelated files (e.g. `PublicBrandPage`); none touch venue/hub-1148 files. Not introduced by this ship (the venue + nav-lock + useHubTabs suites I ran are all green).

---

## My adversarial test (DIFFERENT angle than the implementor)

**Path:** `mingla-business/src/components/venue/__tests__/venueSuiteLeakAndExit.tester.adversarial.test.ts` (10 tests, append-only).

The implementor tested `deriveVenueModules` purity (T-1/T-2) and the fee gate (T-7). My suite attacks three angles they did NOT cover, exercising the **REAL exported `useVenueSuiteStore` + the real derivation/guard helpers in combination**:

- **Angle A — toggle-OFF booking LEAK:** I FORCE-`sync` a booking `activeModule` into the live store while the toggle is OFF (an adversary forcing a leaked state). Proven: the nav renders ONLY `visibleModules` = `deriveVenueModules(false)` = `['overview','settings']`, which NEVER contains a booking module, AND the shell snap-back predicate evicts the leaked module back to `overview`. The booking band cannot leak even under a forced active value.
- **Angle B — Venue EXIT restores Hub pills (not just entry):** Proven `deactivate()` (called on `listing.tsx` unmount) fully resets `active=false` + `selectModule=null` + `visibleModules` to the OFF default, flipping the layout predicate false → Hub offering pills render again. A revert that stranded the handler would leave venue pills over a non-venue tab. Also proves the predicate is conjunctive (defense-in-depth).
- **Angle C — desktop never replaces:** `isWideDesktop` suppresses the swap even with the suite fully active (master rail is the nav).

**Fails-on-revert proven at commit `2f194a71f`** against two independent reverts (working tree restored clean after each):
1. Strip the `deactivate` reset to `set({ active:false })` only → **angle B RED** (1 failed) — confirms the EXIT-restore is load-bearing.
2. Remove the OFF-gate in `deriveVenueModules` (show booking band unconditionally) → **angle A RED + the implementor's venueModules suite RED** (7 failed) — confirms the toggle-gate is load-bearing.

---

## Defects (none merge-blocking)

### P3 — DB invariant-probe: non-deterministic CHECK-constraint selection (probe-quality, latent)
`20261003000007_orch_1148_invariant_probes.sql:82-89` selects the `reservations.status` CHECK via `SELECT pg_get_constraintdef(con.oid) INTO v_status_def ... WHERE pg_get_constraintdef(con.oid) ILIKE '%status%'` — but `reservations` has **TWO** CHECK defs containing the substring "status": the lifecycle `status IN (...)` constraint AND the `payment_status IN ('none','paid','refunded')` constraint. With no `ORDER BY`/`LIMIT 1`, plpgsql `SELECT...INTO` takes an arbitrary first row. If the `payment_status` def is returned, `position('requested' in v_status_def)=0` is TRUE → the probe **RAISEs** and the `…000007` migration aborts, blocking the entire apply, despite a 100%-correct schema. In practice the lifecycle constraint is column-defined first (lower OID) so it likely returns first and passes — but correctness is NOT guaranteed by construction. The deno T-MIG-9 only checks SQL source text, so it can't catch this.
**Fix:** disambiguate — e.g. `AND pg_get_constraintdef(con.oid) ILIKE '%''requested''%'` (or filter `conname`), and add `LIMIT 1` defensively. Tighten BEFORE the probe is flipped to a relied-on CLOSE invariant anchor.

### P4 — `test:orch-1148` script tsc tail inherits the 325-error baseline
`package.json:55` ends `… && npx tsc --noEmit`, which exits non-zero on the pre-existing 325 errors → the script as-written always fails in this worktree. The strict-grep + jest steps inside it pass. Scope the tsc tail to changed files (or drop it — tsc is a separate gate) so the script is a usable signal.

### P4 — RLS live-fire & on-device visual leg DEFERRED (label, not defect)
No branch DB was provisioned and the 7 tables don't exist in prod (MCP read-only). RLS deny/allow is proven by SQL trace + verbatim reuse of the battle-tested events-table policy pattern, but NOT live-fired. The sim/device render of toggle OFF→ON, pill-replacement, two-column reflow, and Android opaque-glass is deferred to post-merge/dev-OTA (no RTL/jsdom + no device this run). Recommend the orchestrator runs the live RLS probe on a branch DB at apply-time and a device smoke before 2.1 builds on top.

---

## Conditions for full PASS
1. Tighten the P3 probe CHECK-selection (disambiguate `status` vs `payment_status`) before relying on the probe as a CLOSE anchor.
2. Apply the 8 migrations to a branch DB at merge and run the live RLS deny/allow probe (T-8) + the §4.10 probe execution (not just source-pin).
3. Device/sim smoke of OFF→ON + pill-replacement + two-column reflow + Android glass (accepted as post-merge/dev-OTA).

---

*Verdict: CONDITIONAL PASS. The foundation is sound, honest, and brand-scoped; fails-on-revert proven at `2f194a71f` via my own adversarial suite. Resolve the P3 probe fragility and run the deferred live-RLS/device legs at CLOSE.*
