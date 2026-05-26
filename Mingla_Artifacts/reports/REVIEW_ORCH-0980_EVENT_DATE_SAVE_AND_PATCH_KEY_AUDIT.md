# IMPLEMENTATION REVIEW — ORCH-0980 [Silent-save-failure bug class — event-date no-persist + patch-key audit]

**Reviewed by:** Claude `mingla-orchestrator` (REVIEW mode)
**Reviewed:** 2026-05-26
**Implementor:** Codex `implementor-mingla` (parallel session)
**Branch HEAD:** `05d3aecc1`
**Commits under review:** `0bca51f33` (fix), `f0961b3e8` (regression test), `05d3aecc1` (report)
**Verdict:** **APPROVED — publish business-app EAS Update so operator iPhone receives the fix, then operator retests, then ORCH-0964 smoke-test unblocks, then both ORCHs close in sequence.**

---

## Verdict at a glance

| Gate | Status |
|---|---|
| Hard guard G1 — no migrations | **PASS** (`supabase/migrations/` diff empty) |
| Hard guard G2 — no ORCH-0964 guarded files | **PASS** (`packages/brand-rendering`, `packages/event-rendering`, `packages/theme-animations`, `mingla-business/src/components/theme`, `mingla-business/src/components/brand/PublicBrandPage.tsx` all untouched) |
| Hard guard G3 — no META-ORCH-0972 Sub-D edge functions | **PASS** (`supabase/functions/` diff empty) |
| Hard guard G4 — no widened audit fixes | **PASS** (audit reporting-only in §"Patch-Key Audit Findings"; no fixes shipped this PR) |
| Hard guard G5 — no testID changes | **PASS** (`testID` references in diff are only documentation/rule-citations, not code changes) |
| DEC-179 commit-hash verification | **PASS** (3 commits scoped + pushed; clean working tree) |
| Step 0.5 fails-on-revert proof phrase | **PASS** (impl-report line 75: `Fails-on-revert verified at f0961b3e8 by reverting fix commit 0bca51f33`) |
| Hypothesis disambiguation | **PASS** (H1 disproved via live-fire on sim + source trace; H2 disproved via RPC source — body raises on sold-event date change; H3 confirmed via source + cache-flow analysis) |

## Root cause as confirmed

**H3 — Cache + local-state refresh stale after `business_patch_event_when` returns success.**

The save flow at `EditPublishedScreen.tsx:803-820` awaited the RPC, then only called `invalidateServerEventCaches()` before continuing into the local success flow. The screen's local edit state is seeded ONCE from `initialEditState`; on immediate return/reopen, React Query could repopulate from stale detail/list caches that hadn't yet been replaced with the canonical post-write event. Result: success toast fires, DB is correctly updated, but the UI shows the old date because the cache wasn't replaced + the local draft wasn't reseeded.

H1 and H2 are both genuinely disproved with concrete evidence:
- H1 disproved via live-fire on iOS sim `F7ECAC25-...` — date picker DID fire `updateDraft({ date })`, `editableDraftToPatch` DID emit `patch.date`, screenshot at `/tmp/orch0980-date-changed.png`.
- H2 disproved via source — RPC body at `supabase/migrations/20260615000000_orch_0877_patch_event_when_rpc.sql:178/194/214/259/274` deletes+reinserts `event_dates` rows and explicitly RAISES on single-mode sold-event date change rather than silently accepting.

## Diff per file

| File | Lines | Purpose |
|---|---|---|
| `mingla-business/src/components/event/EditPublishedScreen.tsx` | +8 | Imports `refreshPublishedEventWhenAfterSave`. After `await patchPublishedEventWhen(...)`, awaits canonical detail refresh + reseeds local edit state from refreshed event. |
| `mingla-business/src/utils/publishedEventWhenRefresh.ts` | +48 (NEW) | Helper `refreshPublishedEventWhenAfterSave`. Fetches canonical detail via `fetchBusinessEventById`. Throws `patch_event_when_refresh_failed` if re-read fails (NO silent failure). Writes canonical event into `businessEventKeys.detail(eventId)` and replaces/prepends in `businessEventKeys.list(brandId)`. |
| `mingla-business/src/components/event/__tests__/EditPublishedScreen_event_date_round_trip.test.ts` | +154 (NEW) | Step 0.5 regression. Asserts RPC success → canonical refresh → local success flow ordering. Asserts canonical server data replaces stale date in BOTH detail and list caches. |
| `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0980_EVENT_DATE_SAVE_AND_PATCH_KEY_AUDIT.md` | +115 (NEW) | Implementation report. |
| `Mingla_Artifacts/WORKTREE_REGISTRY.md` | +1 | Worktree spawn row (orchestrator-added at INTAKE). |
| `COMMS_LEDGER.md` | +6/-3 | Ack lines for the comms entries touching ORCH-0980. |

Net: 6 product/artifact files, 444 insertions, 3 deletions. Tight scope, no scope creep.

## Audit findings (reporting-only per dispatch §3 — surfaced for downstream triage)

| # | Surface | Severity | Finding (summary) | Recommended ORCH-track |
|---|---|---|---|---|
| A-01 | Published event edit patch keys | **P1** | `EditableLiveEventFields` has fields rendered as editable sections that are not all server-writable for server-loaded published events (basics, Where, cover hue, tickets, settings). Current code blocks local save when server-loaded, avoiding false success — but the contract is spread across UI diffing + server-key sets + local-store fallback. | Follow-up SPEC: classify every key as server-writable / local-only / frozen / blocked-with-copy. Ship CI gate enforcing classification. |
| A-02 | Brand profile patch keys (`brandPatch.ts`) | **P2** | `computeDirtyFieldsPatch` allow-lists profile fields and skips some intentionally (immutable/server-derived). `defaultCurrency` is a notable Brand field NOT in the patch list — likely intentional ("currency change requires new brand") but undocumented in skip-stanza. Venue claim/place fields also outside helper. | Add explicit non-editable / owned-elsewhere skip stanza for `defaultCurrency`, claim fields, place fields. Gate the helper against `Brand` type drift with allowed-omits list. |
| A-03 | Trip patch keys (`tripsService.ts`) | **P2** | Trip updates route through `updateLiveTripFields` + `biz_update_live_trip`; basics/pricing services have defensive routing guards. Multiple explicit patch shapes (`TripBasicsPatch`, `TripPricingPatch`, `LiveTripPatch`) are manually maintained, not mechanically compared to UI edit inputs. | Patch-shape coverage tests for trip edit screens — every emitted UI diff key maps to exactly one service/RPC path or explicit blocker. |
| A-04 | Marketing campaigns/templates | **P3** | Tight allow-lists, throw on no-row updates, `template_id`/`scheduled_for`/status separated into create/schedule/cancel/send paths. No immediate silent-save drift found. | Low-priority CI source check: update-input keys, selected columns, update-payload keys stay in sync. |

**Structural prevention options (Codex surfaced 3 per dispatch §3.5):**
1. AST coverage gate for explicit patch builders — fail CI when editable-type key is neither in a patch builder nor declared in an intentional-omit registry.
2. Round-trip mutation tests per save surface — old value → edit state → patch payload → mocked canonical read/cache update.
3. Source-order save-flow gate — server-RPC success must be followed by canonical read + cache write before success toast/navigation for published server-owned entities.

**Orchestrator recommendation for option-3:** this is exactly the pattern ORCH-0980's fix introduces (RPC → canonical refresh → success). Generalizing it into a project-wide invariant via CI gate would prevent future H3-class regressions. Worth registering as ORCH-0981 (or folding into the A-01 follow-up SPEC) once ORCH-0964 + ORCH-0980 close.

## Residual risk acknowledged

**R-01 — Live-fire simulator save end-to-end not completed.** Codex's iOS sim attempt was blocked on the first test event by an unrelated venue-address validation ("Pick the venue address from the suggestions"), so the When RPC was never reached on that record. Codex is honest about this in §"Live-Fire Notes" + §"Residual Risk". Mitigations in place:
- Source-level proof that the fix wires correctly (canonical read + cache write + draft reseed).
- Step 0.5 regression test passes with fails-on-revert proof.
- The new behavior (canonical-read-then-cache-write) is the standard React Query pattern for server-mutated state — well-understood.

Acceptable risk grade: **PASS with mandatory operator post-publish retest.** Operator will validate end-to-end on their installed iPhone build (commit `cabff9c02` ORCH-0964) after I publish the business-app EAS Update with this fix folded in.

## Dependency walk (DEC-179)

Config-layer files touched: **NONE**. No `app.json`, `app.config.ts`, `vercel.json`, `package.json`, `tsconfig*.json`, `metro.config.*`, `babel.config.*`, `.github/workflows/**`, `.github/scripts/**` modifications. Pure source-code + test + report.

## Behind-main analysis

Branch is **1 commit behind `origin/main`** — a comms-ledger ack landed on main since branch spawn. Not a product-code change. Clean fast-forward available at PR time.

## Decision tree fired

| Outcome | Path |
|---|---|
| **REVIEW APPROVED** (this verdict) | Orchestrator publishes business-app EAS Update to development channel → operator force-quits + reopens business app + retests event-date save round-trip → operator confirms PASS → operator returns to ORCH-0964 smoke-test (now unblocked) → after ORCH-0964 thumbs-up, orchestrator runs CLOSE on ORCH-0964 first (it's the older ORCH and was parked at APPROVED earlier) → then CLOSE on ORCH-0980. |
| Operator retest still fails | Re-dispatch to Codex with specific failure mode + sim repro from Codex's now-known-working environment. |

## Verdict

**APPROVED.** All hard guards PASS. Fix is mechanistically sound (canonical post-write read + cache replace + local-state reseed). Step 0.5 regression with fails-on-revert proof at exact commit hashes. Audit findings recorded reporting-only as instructed — no scope widening. Residual risk on live-fire end-to-end is acknowledged and mitigated by source-level proof + standard React Query pattern + Step 0.5 gate. Ready for business-app EAS Update publish + operator retest.

## Next-Handoff target

Orchestrator next move: publish business-app EAS Update to `development` channel via `eas update --branch development --platform ios` from the ORCH-0980 worktree, then notify operator to force-quit + reopen the business app on their iPhone and retest event-date save → reopen the event → confirm date persists.
