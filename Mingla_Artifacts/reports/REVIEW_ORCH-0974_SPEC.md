# REVIEW — ORCH-0974 [Home (mingla-business mobile) section lock + spacing] — INVESTIGATION + SPEC

**Reviewer:** Claude `mingla-orchestrator`
**Reviewed:** 2026-05-25
**Worktree:** `~/Desktop/mingla-orchs/ORCH-0974-[home-mobile-section-lock-and-spacing]/` on branch `ORCH-0974-home-mobile-section-lock-and-spacing`
**Reviewed artifacts:**
- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0974_HOME_MOBILE_SECTION_LOCK_AND_SPACING.md`
- `Mingla_Artifacts/specs/SPEC_ORCH-0974_HOME_MOBILE_SECTION_LOCK_AND_SPACING.md`

## Verdict

**APPROVED.** Ready for implementor dispatch.

## Review checklist

| Item | Verdict | Notes |
|------|---------|-------|
| Root cause proven? | ✅ PASS | F-1 (outer ScrollView wraps both zones) + F-2 (zero section-header→card gap on mobile) carry six-field evidence; confidence PROVEN via source + iOS sim runtime + operator screenshot triangulation. |
| Scope appropriate (could be narrower)? | ✅ PASS | One file edit (`home.tsx` mobile populated branch) + one new component (`UpcomingListItem.tsx`) + one CI gate + one test pair. Non-goals explicit (desktop branch untouched, top bar untouched per ORCH-0973 lane, empty-state preserved verbatim). Could not be meaningfully narrower without dropping required surfaces. |
| Hidden fallback paths? | ✅ PASS | N/A — SPEC, no code. F-5 surfaces the RefreshControl-migration hidden flaw correctly; SPEC §5.A T-01 + adversarial A-01 guard it explicitly. |
| Stale cache paths? | ✅ PASS | N/A — pure UI layout. Cache invariants preserved via unchanged `handleRefresh` body. |
| Response shape truthful in ALL states? | ✅ PASS | SPEC §6 state matrix covers empty/cold-cache, populated-no-live, populated-with-live, populated+ladder-rung. Each names locked-zone vs scrolling-zone composition explicitly. |
| Real fix or symptom mask? | ✅ PASS | Real architectural fix — separates the two scrollable zones via flex shell mirroring the existing `desktopUpcomingPane` pattern. Not a margin/padding patch on the broken architecture. |
| Solo/collab parity? | ✅ N/A | mingla-business has no solo/collab concept. |
| Constitutional compliance? | ✅ PASS | No fab data, no silent failures, RefreshControl preserved (#3), no auth changes (#11), no inline color rule violations (cited in §12), `feedback_toast_needs_absolute_wrap.md` preserved (Toast untouched). |
| Evidence chain complete? | ✅ PASS | Two captured screenshots (`ios-sim-current-state.png` + `ios-sim-after-swipe-up.png`) at `Mingla_Artifacts/reports/screenshots/orch-0974/`. Token values cited from `designSystem.ts:29-37`. |
| Documents updated? | ✅ PASS at SPEC stage | Registry row added at spawn commit `8d9f5e651`. WORLD_MAP entry deferred to CLOSE commit per recent SYNC-deferred precedent (avoids merge churn with parallel ORCH-0973). |
| **Commit-hash verification** | ✅ PASS (SPEC scope) | No product-code files are claimed-changed by SPEC. The artifacts (INVESTIGATION + SPEC + screenshots) exist on the per-ORCH branch as expected. Worktree `git status` confirms artifacts are tracked-but-uncommitted; orchestrator will commit them alongside the implementor's first work commit to keep one PR clean. No "I'll commit later" violation — implementor's commit captures both the artifacts and the code in the same atomic CLOSE PR. Codified per DEC-179. |
| **Dependency walk for config-layer changes** | ✅ PASS with one note | SPEC §4 row 5 modifies `.github/workflows/strict-grep-mingla-business.yml` (additive: one new job for `ORCH-0974: Home mobile lock pane`). **Dependency-walk findings:** (a) GitHub Actions runner — adds one job to PR matrix, no impact on existing jobs; (b) branch protection / required-checks list — operator decides if the new check should be required (recommended: NOT required initially; let it stabilise across a few PRs before adding to required-checks); (c) other consumers (status-check webhooks, CI dashboard) — automatic enumeration. **Per `feedback_strict_grep_registry_pattern.md`:** this is the canonical pattern (one script + one job; never parallel workflow files) — SPEC §10 follows the rule verbatim. No `app.config.ts`/`vercel.json`/`package.json`/`tsconfig.json`/`metro.config.*`/`babel.config.*`/`next.config.*` changes. The `mingla-business/package.json` is READ in §1.3 to verify RN version supports `gap` on `contentContainerStyle`, NOT modified. |

## Notes for implementor (advisory, not blockers)

1. **Tracked-uncommitted artifacts.** INVESTIGATION + SPEC + REVIEW + screenshots exist on the per-ORCH branch but are not yet committed. Implementor should `git add Mingla_Artifacts/reports/INVESTIGATION_*.md Mingla_Artifacts/specs/SPEC_*.md Mingla_Artifacts/reports/REVIEW_ORCH-0974_SPEC.md Mingla_Artifacts/reports/screenshots/orch-0974/` along with the code commit (or in a separate "ORCH-0974 forensics artifacts" commit before the code commit). Either is acceptable; one PR carries everything.

2. **New strict-grep CI job NOT to be added to required-checks list automatically.** Per dependency-walk note above. Add to the workflow file as a passing job; let operator decide whether to flip it to required after a few PRs prove it stable.

3. **`mingla-business/package.json` RN version check.** SPEC §1.3 asks the implementor to verify before assuming `gap` on `contentContainerStyle` works. If RN is < 0.71 (extremely unlikely given Expo SDK 54), fall back to `ItemSeparatorComponent` (already prescribed in SPEC §3.2 as the chosen pattern — so this is robust either way).

4. **A-03 small-phone carve-out is testable.** Implementor's T-05 + T-06 already cover the iPhone-SE viewport case via `useWindowDimensions` mock; tester's adversarial A-04 exhaustively asserts the rendering matrix. Good coverage.

5. **No COMMS impact.** Reviewed COMMS-0001 through COMMS-0005 — none apply to ORCH-0974 (no Stripe, no external API, no backend allowlist, no PublicBrandPage). No new COMMS entry needed.

## Pipeline routing post-APPROVED

→ Dispatch to Claude `mingla-implementor` (Claude side preferred — `/ui-ux-pro-max` pre-flight per `feedback_implementor_uses_ui_ux_pro_max.md` is a Claude-native skill).
→ Implementor produces code + tests + IMPLEMENTATION report.
→ Orchestrator REVIEWS implementation (commit-hash verification + dependency walk both expected to apply at that stage).
→ Claude `mingla-tester` runs TEST on iPhone 17 Pro Max + Pixel emu + iPhone SE 3rd gen + business-web narrow viewport eyeball.
→ If PASS / CONDITIONAL PASS → orchestrator CLOSE with Vercel `[deploy]` tag + EAS OTA `--platform ios,android` + flip `I-PROPOSED-HOME-MOBILE-LOCK-PANE` DRAFT → ACTIVE.
