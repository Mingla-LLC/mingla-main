# IMPLEMENTATION REVIEW — ORCH-0964 [Public-page theme customization + consumer-app brand screen + deep links] — POST-REWORK FINAL

**Reviewed by:** Claude `mingla-orchestrator` (REVIEW mode, "take over" execution posture)
**Reviewed:** 2026-05-26 (re-REVIEW after Codex rework)
**Implementor:** Codex `implementor-mingla` (parallel session)
**Branch HEAD:** `0e19257c6` (origin/ORCH-0964-public-page-theme-customization)
**Prior REVIEW:** `670678ec3` returned NEEDS WORK (F-01 commit-hash + F-02 fails-on-revert)
**Verdict:** **APPROVED — promote to migration + TEST dispatch.**

## What changed since the prior REVIEW

Codex committed the rework in 6 scoped commits exactly matching the segmentation I recommended in F-01:

| Commit | Subject |
|---|---|
| `70f40bf61` | ORCH-0964: add theme schema and strict grep gates (migration + 6 ORCH-0964 gates + workflow YAML + ORCH-0863 allowlist) |
| `5257758eb` | ORCH-0964: extract shared themed public renderers (packages/brand-rendering/ + packages/theme-animations/ + adapter conversion + packages/event-rendering theme additions) |
| `c3f69da81` | ORCH-0964: wire business theme editing and persistence (BrandEditView + EditPublishedScreen + ThemeEditorSection + write paths + stores) |
| `03ff52435` | ORCH-0964: add consumer brand screen and app theme setup (app-mobile route + hooks + theme + ExpandedBusinessEventSheet brand-tap + font registration + app.json deep-link config) |
| `722abe089` | ORCH-0964: extend business associated domains file (`.well-known/apple-app-site-association` `/b/*` + `/e/*` + consumer iOS app ID) |
| `0e19257c6` | ORCH-0964: document implementation and resolver regression (implementation report + Step 0.5 fails-on-revert proof) |

## Hard guard verification

| Guard | Status | Evidence |
|---|---|---|
| **DEC-179 commit-hash verification** | **PASS** | All 7 key files (migration, shared `PublicBrandPage.tsx`, `themeResolver.ts`, `app-mobile/app/brand/[slug].tsx`, `ThemeEditorSection.tsx`, `.well-known/apple-app-site-association`, implementation report) confirmed in commits. Zero modified-but-uncommitted product files. Only working-tree noise is `?? mingla-admin/node_modules` (pre-existing symlink from spawn.sh — not product code, not ORCH-0964 scope). |
| **Step 0.5 fails-on-revert proof phrase** | **PASS** | Line 95 of implementation report: `Fails-on-revert verified at 9d3ce22e68c0fe977b9b346205fdb473ecbc4c43.` Proof run captured: revert FAILED on `event overrides win partially and inherit unset brand/default fields` assertion (expected `#2563eb` got `#ff6f00`); restored run PASS, 4/4 tests green. Textbook compliance with ORCH-0840 enforcement. |
| **6 ORCH-0964 strict-grep gates** | **ALL PASS** | `orch-0964-brand-rendering-self-contained` PASS, `orch-0964-checkout-no-brand-theme` PASS, `orch-0964-theme-foreground-computed` PASS, `orch-0964-theme-resolver-canonical` PASS, `orch-0964-theme-typed-columns` PASS, `orch-0964-well-known-json-content-type` PASS. All 6 gate scripts present in `.github/scripts/strict-grep/` and registered in `.github/workflows/strict-grep-mingla-business.yml`. |
| **Source-reconciled remote migrations** | **PASS** | `supabase migration list --linked` shows clean alignment through `20260729000001` (META-ORCH-0972 grant rework) with `20260729000002_orch_0964_brand_event_theme_columns.sql` as the single local-only addition. Zero remote-only versions. No `--include-all` flag needed; standard `db push --linked` will apply cleanly. |
| **G1 — no `events.theme` JSONB theme keys** | **PASS** | Re-grepped on committed code: zero `theme.themeColor` / `theme.theme_color` / `events.theme.*theme_*` matches. Typed columns only. |
| **G2 — no business root theme provider** | **PASS** | `mingla-business/app/_layout.tsx` registers fonts only via `useFonts`; zero `ThemeProvider` / `resolveTheme` / `ResolvedTheme` references. |
| **G3 — no `brands.kind` branching** | **PASS** | Zero `isTripBrand` / `brand.kind` / `b.kind` matches in shared `packages/brand-rendering/PublicBrandPage.tsx` or `mingla-business` adapter. |
| **G4 — `packages/brand-rendering/` self-contained** | **PASS** | Zero `mingla-business/src` or `app-mobile/src` imports inside the shared package. Confirmed by strict-grep gate (G4) AND by raw grep. |
| **G5 — no edge-function redeploys** | **PASS** | `supabase/functions/` untouched. META-ORCH-0972 Sub-D version bumps (parse-restaurant-menu v39, parse-play-activities v38, agent-chat v72, agent-confirm-action v67) safe. |
| **G6 — META-ORCH-0972 data-driven tabs preserved** | **PASS** | `packages/brand-rendering/PublicBrandPage.tsx` carries Upcoming / Events / Trips / Experiences / About tab labels. `<ExperienceMiniCard>` included in package per Amendment 3 §2 Action 2. |

## Existing-gate non-regression scan (cross-ORCH check)

Ran 5 non-ORCH-0964 strict-grep gates to confirm Codex's rework didn't regress sibling invariants:

| Gate | Status | Notes |
|---|---|---|
| `orch-0863-marketing-hub-phase-b` | **PASS** | Backend allowlist extension for the new migration is in place. |
| `orch-0963-public-trip-rpc-and-route-segregation` | **PASS** | META-ORCH-0972's renamed gate (kind-branch assertions stripped, route segregation preserved). |
| `meta-orch-0972-no-brand-kind-reads` | **MODULE NOT FOUND (expected)** | Gate file lives on `main` (added by META-ORCH-0972 close `2e018bdea`) but not yet on this branch. Will arrive on rebase. NOT a regression. See "Pre-merge rebase" below. |
| `meta-orch-0972-data-driven-tabs` | **MODULE NOT FOUND (expected)** | Same as above — gate file lives on `main`, not yet on this branch. |
| `orch-0962-brand-field-map-coverage` | **FAIL** | Gate asserts `styles.taglineCentered`, `styles.bioLeadCentered`, `links.facebook` + `icon: "facebook"`, `links.linkedin` + `icon: "linkedin"`, `row.brand_kind`. **Pre-existing failure on `main` (verified by running gate from `/Users/sethogieva/Desktop/mingla-main` directly — fails identically there).** NOT introduced by ORCH-0964. The `row.brand_kind` assertion in particular is stale because META-ORCH-0972 dropped `b.kind AS brand_kind` from `business_public_events_view`. Discovery for orchestrator — see "Discoveries" below. |

## Pre-merge rebase required (NOT a REVIEW blocker)

Branch is **4 commits behind `origin/main`**:
- `2e018bdea` [deploy] Close META-ORCH-0972 (adds the 2 missing meta-orch-0972 gate files + drops `b.kind` from public views)
- `b7ba7df02` ORCH-0978 INTAKE banner
- `3a1b26e77` ORCH-0979 INTAKE banner
- `3bc73c62e` ORCH-0978 INTAKE ack-comms

A rebase onto `main` before the PR opens will:
1. Bring the 2 META-ORCH-0972 gate files into the branch's `.github/scripts/strict-grep/` so CI runs them.
2. Pull in the WORLD_MAP banners for sibling ORCHs.
3. Resolve any conflict locally instead of in PR-review time.

Codex should run before opening the PR:

```bash
cd ~/Desktop/mingla-orchs/ORCH-0964-[public-page-theme-customization]
git fetch origin main && git rebase origin/main
# resolve WORLD_MAP banner stacking by keeping main + re-applying ORCH-0964's commits
```

After rebase, re-run the 6 ORCH-0964 gates + the 2 newly-arrived META-ORCH-0972 gates to confirm green before push + PR open.

## Non-blocking awareness items (TEST-phase concerns, not REVIEW blockers)

| Item | Status | Owner |
|---|---|---|
| **Android `assetlinks.json` SHA-256 fingerprint** | OPEN — Codex flagged at implementation report line 125 | Seth pulls from Google Play Console (Setup → App integrity → App signing key certificate → SHA-256). New memory rule `feedback_android_applinks_sha256_play_console.md` codifies the proactive-staging requirement for future Android-deep-link ORCHs. SC-17 (Android cold-start App Link) will FAIL at TEST without it. Acceptable to ship CLOSE under CONDITIONAL PASS with explicit operator-accepted condition (precedent: ORCH-0954, ORCH-0961). |
| **`usemingla.com` `.well-known/` host placement** | OPEN — Codex flagged at line 126 | Seth decides whether brand URLs ever point at the marketing root domain (`usemingla.com/b/<slug>`) or stay at `business.usemingla.com/b/<slug>`. If marketing-root path is added later, deploy AASA + assetlinks.json to the marketing repo. NOT a blocker for current scope. |
| **EAS build IDs** | DEFERRED — Codex confirmed report line 127 | Native rebuild required for Lottie + 14 fonts + new `/brand/[slug]` route + associated domains. Trigger `eas build --profile production --platform all` for BOTH `app-mobile/` AND `mingla-business/` after CLOSE. Operator-driven Apple/Google submission cycle. |
| **Broader-repo tsc red** | ACCEPTED — non-ORCH-0964-specific | Pre-existing type debt across the workspace + shared-package resolution noise. Same pattern accepted at ORCH-0950 CLOSE. No ORCH-0964-specific errors in business files after the event theme patch. |

## Discoveries for orchestrator

**D-1 (S2-medium) — `orch-0962-brand-field-map-coverage.mjs` strict-grep gate is broken on `main` after META-ORCH-0972.** The gate asserts `row.brand_kind` exists in `viewRowToBrand` mapper, but META-ORCH-0972 Sub-C dropped `b.kind AS brand_kind` from `business_public_events_view` so the mapper no longer reads that field. The gate also asserts `styles.taglineCentered` / `styles.bioLeadCentered` / facebook+linkedin branches in `PublicBrandPage.tsx` — these may still be valid expectations against the shared package's PublicBrandPage but the gate's grep target is stale relative to the new file location after Codex's package extraction. **Recommendation:** register as new ORCH-0980 OR fold into the META-ORCH-0972 Stage 4 follow-up ORCH. Either way, the gate needs reshaping similar to how `orch-0963-public-brand-kind-branched.mjs` got renamed to `orch-0963-public-trip-rpc-and-route-segregation.mjs` during META-ORCH-0972. NOT ORCH-0964's responsibility to fix — flag and move on.

**D-2 (P3-low) — Double-route pattern in `app-mobile/`.** Codex created BOTH `app/brand/[slug].tsx` (canonical per Amendment 2 §1.B) AND `app/b/[slug].tsx` (mirror matching the Universal Link `/b/*` path). Both routes exist in commit `03ff52435`. Verification at TEST time should confirm both mount the same screen via the same hook with no divergent logic. If they diverge, that's a P1 for tester to surface. If they're identical, it's a clean implementation choice for matching the AASA path.

**D-3 (P4 observation) — Apple Team ID resolved autonomously.** Codex extracted `782KVMY869.com.sethogieva.minglabusiness` from existing `app-mobile/app.json` and baked it into the AASA without operator burden. Good initiative — closes one of three operator-input items.

## Decision tree fired

| Outcome | Path |
|---|---|
| **REVIEW APPROVED** (this verdict) | Seth runs migration → orchestrator verifies remote + .well-known Content-Type → Claude `mingla-tester` dispatch with 4-device matrix |
| Migration apply blocks | Source-reconcile any new remote-only versions per migration backstop; rerun |
| Tester returns CONDITIONAL PASS with Android SHA + usemingla.com conditions | CLOSE under operator-accepted conditions (precedent established) |

## Verdict

**APPROVED.** All hard guards PASS. Step 0.5 proof is textbook. Pre-merge rebase is a procedural pre-PR step, not a REVIEW gate. Three discoveries surfaced for orchestrator awareness; none block promotion.

Migration apply command (reproduced verbatim for operator per `feedback_migration_apply_backstop`):

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0964-[public-page-theme-customization]" && /Users/sethogieva/bin/supabase db push --linked
```

After migration applies cleanly, orchestrator runs read-only column-introspection probe + curl `.well-known/apple-app-site-association` Content-Type check, then dispatches Claude `mingla-tester` for 4-device matrix.
