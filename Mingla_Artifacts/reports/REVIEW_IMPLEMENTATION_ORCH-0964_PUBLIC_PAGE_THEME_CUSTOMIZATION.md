# IMPLEMENTATION REVIEW — ORCH-0964 [Public-page theme customization + consumer-app brand screen + deep links] — FINAL APPROVED POST RETEST #3

**Reviewed by:** Claude `mingla-orchestrator` (REVIEW + CLOSE-prep mode)
**Reviewed:** 2026-05-26 (final pass after Codex smoke-test rework + tester retest #3)
**Implementor:** Codex `implementor-mingla` (parallel session)
**Branch HEAD:** `cabff9c02 QA ORCH-0964 public page theme retest`
**Tester verdict:** **PASS** (P0:0 P1:0 P2:0 P3:0 P4:3) per `QA_ORCH-0964_PUBLIC_PAGE_THEME_CUSTOMIZATION_RETEST.md`
**Orchestrator verdict:** **APPROVED — proceed to operator smoke-test, then CLOSE**

## What changed since prior REVIEW (commit `5ed83d99c`)

Codex addressed the 4 operator smoke-test findings (F-A theme-save no-persist, F-B preview no-theme, F-C close-button untappable, F-D up-arrow share-icon) AND significantly expanded scope into a full visual redesign + liquid-glass treatment of the public brand and event pages. 19 commits total — segmentation is clean (one logical change per commit).

Key commits this turn:

| Commit | Subject |
|---|---|
| `a71648342` | ORCH-0964 fix brand theme save patch — F-A root cause + fix |
| `4e57df035` | ORCH-0964 fix public brand preview chrome theme — F-B/F-C/F-D root cause + fix |
| `b4c5c670d` | ORCH-0964 document smoke test rework |
| `2ce790884` | ORCH-0964 make saved theme visible on public page |
| `0ed066b9f` → `cabff9c02` | 14 additional commits: redesign + animation polish + contrast + event-page parity + retest QA |

## Hard guard verification

| Guard | Status | Evidence |
|---|---|---|
| **Migrations untouched** | **PASS** | `git diff 840b980e3..HEAD --stat -- supabase/migrations/` returns empty. The existing `20260729000002_orch_0964_brand_event_theme_columns.sql` is the only ORCH-0964 migration; it remains applied on remote, unchanged. |
| **Edge functions untouched** | **PASS** | `git diff 840b980e3..HEAD --stat -- supabase/functions/` returns empty. META-ORCH-0972 Sub-D edge functions (parse-restaurant-menu v39, parse-play-activities v38, agent-chat v72, agent-confirm-action v67) are not re-deployed. |
| **ORCH-0961 testIDs preserved** | **PASS** | `testID="orch-0961-public-brand-close"` and `testID="orch-0961-public-brand-share"` ARE in the diff — but only as ADDITIONS (re-introduced in the redesigned chrome). Existing testIDs not removed or renamed. Tester automation that depends on these strings remains valid. |
| **Tests append-only** | **PASS** | 5 NEW test files added (444 insertions, 0 deletions). Files: `PublicBrandPage.orch_0964_smoke_rework.test.ts`, `PublicEventPage.orch_0964_design_rework.test.ts`, `themeAnimations.orch_0964_smoke_rework.test.ts`, `useBrands.orch_0964_public_theme_cache.test.ts`, `brandPatch.orch_0964_smoke_rework.test.ts`. No `[TEST-MOD-APPROVED]` tag needed because no existing tests were modified. |
| **DEC-179 commit-hash verification** | **PASS** | All product-code changes committed in 19 scoped commits. Worktree status clean except for `mingla-admin/node_modules` (legit spawn.sh symlink, expected). |
| **Step 0.5 fails-on-revert proof phrase** | **PASS** | `IMPLEMENTATION_ORCH-0964_PUBLIC_PAGE_THEME_CUSTOMIZATION.md:506` records the new assetlinks fails-on-revert; line 564 preserves the prior `Fails-on-revert verified at 9d3ce22e68c0fe977b9b346205fdb473ecbc4c43` from earlier rework. Both phrases present. |

## Strict-grep gates — 10 of 11 PASS

Re-ran ALL strict-grep gates from a clean working tree (after worktree sweep, see below):

| Gate | Status |
|---|---|
| `orch-0964-brand-rendering-self-contained` | PASS |
| `orch-0964-checkout-no-brand-theme` | PASS |
| `orch-0964-theme-foreground-computed` | PASS |
| `orch-0964-theme-resolver-canonical` | PASS |
| `orch-0964-theme-typed-columns` | PASS |
| `orch-0964-well-known-json-content-type` | PASS |
| `meta-orch-0972-data-driven-tabs` | PASS |
| `meta-orch-0972-no-brand-kind-reads` | PASS |
| `orch-0963-public-trip-rpc-and-route-segregation` | PASS |
| `orch-0863-marketing-hub-phase-b` | PASS |
| `orch-0962-brand-field-map-coverage` | **PRE-EXISTING FAIL** (per prior REVIEW D-1 — broken on `main`, not ORCH-0964's regression; ORCH-0980/Stage-4 follow-up scope) |

## Worktree cleanup applied this REVIEW (feedback_orchestrator_cleans_worktree_on_close.md Step 1.6)

The worktree had accumulated 142 Finder-duplicate orphans (` 2.<ext>` and ` 3.<ext>` files) plus 3 duplicate `node_modules` directories from spawn.sh artifacts. 4 of the strict-grep gates were INITIALLY failing because they were scanning these stale duplicate `.mjs` / `.ts` / `.tsx` files. Orchestrator swept all 142 file dupes + 3 `node_modules X` directories. Sole remaining untracked entry is `mingla-admin/node_modules` (legitimate spawn.sh symlink). After sweep, all 10 in-scope gates flipped to PASS. The 1 remaining FAIL is unrelated pre-existing main-side debt.

## Behind-main analysis

Branch is **3 commits behind `origin/main`**, all of which are pure comms-ledger ack commits:
- `be32705fb` COMMS-0964: ack ORCH-0964 retest ledger warnings
- `e85e42c19` Acknowledge ORCH-0964 rework comms
- `3e2de4357` COMMS: acknowledge ORCH-0964 retest warnings

Zero product-code changes on `main` since branch divergence. Pre-merge rebase will be a clean fast-forward — no conflict risk.

## QA retest verdict context

Per `QA_ORCH-0964_PUBLIC_PAGE_THEME_CUSTOMIZATION_RETEST.md` (line 5):
- **Verdict: PASS** (full PASS, NOT conditional this time)
- **Findings:** P0:0 P1:0 P2:0 P3:0 P4:3
- Verified at commit `c8d0cc680573ae903f4ceb2e3019a8b80a00afc8` (subsequent `cabff9c02` is the QA-report commit itself, no product code change after the verified hash).

Coverage cited:
- Theme save path (F-A fix)
- Public brand preview (F-B/F-C/F-D fix)
- Public brand redesign + liquid glass treatment
- Original-color animation preservation
- Social icons + presenter photo + maps affordance
- Event ticket contrast + white event date/time (consumer-facing event UX polish)
- React Query cache coverage (SC-21)

## Constitutional / invariant compliance

- **Rule 9 — No fabricated data:** theme renders Mingla default when columns NULL; no fake colors injected. PASS.
- **Rule 6 — Logout clears everything:** `useBrands.orch_0964_public_theme_cache.test.ts` covers cache cleanup. PASS.
- **`I-PROPOSED-BRAND-FIELD-MAP-COVERAGE`** (ORCH-0962, ACTIVE): theme columns plumbed end-to-end through views + mappers + renderers per migration `20260729000002`. PASS (gate itself broken main-side, see D-1 — not ORCH-0964's regression).
- **`I-PUBLIC-PAGE-DATA-DRIVEN-TABS`** (META-ORCH-0972, ACTIVE): tabs render based on bucket-count truth; no kind branching reintroduced. PASS.
- **`I-PROPOSED-CHECKOUT-NO-BRAND-THEME`** (new this ORCH): `orch-0964-checkout-no-brand-theme` gate PASS.
- **`I-PROPOSED-BRAND-RENDERING-SELF-CONTAINED`** (new this ORCH): `orch-0964-brand-rendering-self-contained` gate PASS.
- **`I-PROPOSED-DEEP-LINK-WELL-KNOWN-JSON-CONTENT-TYPE`** (new this ORCH): `orch-0964-well-known-json-content-type` gate PASS.

## Dependency walk (DEC-179)

Config-layer touches re-verified post-rework (none introduced this turn that weren't already in prior rework):
- `app-mobile/app.json` (associated domains) — unchanged this turn
- `mingla-business/app.config.ts` — unchanged
- `vercel.json` — unchanged
- `package.json` (both apps) — unchanged
- `mingla-business/public/.well-known/apple-app-site-association` — unchanged this turn (already corrected in prior rework)
- `mingla-business/public/.well-known/assetlinks.json` — unchanged (already corrected with both consumer SHA-256 fingerprints in prior rework)
- `.github/workflows/strict-grep-mingla-business.yml` — unchanged
- 6 ORCH-0964 strict-grep scripts — unchanged

No new config-layer surface introduced this turn. The redesign work was contained to `packages/brand-rendering/` + `packages/event-rendering/` + `packages/theme-animations/` + consumer-app theme application.

## Pre-merge actions (CLOSE Step prerequisites)

1. **Rebase onto `origin/main`** — fast-forward only (3 comms-ack commits, no conflicts).
2. **Worktree sweep already done this REVIEW** — 142 orphans removed.
3. **`mingla-admin/node_modules` symlink** — leave; it's expected per spawn.sh.

## Discoveries for orchestrator (carry forward to CLOSE banner)

**D-1 (S2-medium, carried from prior REVIEW):** `orch-0962-brand-field-map-coverage.mjs` gate broken on `main` since META-ORCH-0972 dropped `b.kind AS brand_kind`. Recommend register as ORCH-0980 OR fold into Stage-4 META-ORCH-0972 follow-up. NOT ORCH-0964's responsibility.

**D-2 (P3, RESOLVED post-Codex inspection):** double consumer-route pattern (`app-mobile/app/brand/[slug].tsx` + `app/b/[slug].tsx`) confirmed by tester to mount the same screen via the same hook — clean implementation choice for matching the AASA `/b/*` path. No longer a concern.

**D-3 (P4 — informational, carried):** Apple Team ID + iOS bundle ID resolved autonomously by Codex from existing config. Good initiative.

**D-4 (P4 — new this REVIEW):** Codex's redesign work expanded beyond the 4-finding rework scope (liquid-glass treatment, animation asset replacement, event-page polish, consumer-app event date contrast). All within ORCH-0964's theme-customization scope, no hard-guard violations, but worth noting that some of the visual decisions (e.g., liquid-glass material) are operator-eyeball-pending rather than spec-mandated. CLOSE banner should cite these as polish work shipped under ORCH-0964 umbrella.

## Decision tree

| Outcome | Path |
|---|---|
| **REVIEW APPROVED** (this verdict) | Orchestrator pushes fresh business-app EAS Update to development channel → Seth re-smoke-tests F-A/F-B/F-C/F-D + visual redesign gut-check → if PASS, orchestrator runs CLOSE protocol. |
| Smoke-test PASSES | CLOSE: rebase onto main → commit with `[deploy]` tag → PR open → pre-merge gate → squash-merge → Vercel deploy → EAS production builds → 7-artifact SYNC + invariant flips DRAFT→ACTIVE + worktree reap. |
| Smoke-test FAILS | Route back to Codex with new specific findings. |

## Verdict

**APPROVED.** All hard guards PASS. Tester returned full PASS (P0:0 P1:0 P2:0 P3:0 P4:3) — no conditional this time. 10 of 11 strict-grep gates PASS, the 1 fail is pre-existing main-side debt unrelated to ORCH-0964. Tests append-only. Step 0.5 fails-on-revert proofs documented. Worktree swept clean. Behind-main is 3 ack-only commits, clean fast-forward available.

**Next step:** orchestrator pushes business-app EAS Update so Seth's iPhone receives the latest JS, Seth re-smoke-tests the 4 prior findings + the visual redesign gut-check, then orchestrator runs CLOSE on Seth's thumbs-up.
