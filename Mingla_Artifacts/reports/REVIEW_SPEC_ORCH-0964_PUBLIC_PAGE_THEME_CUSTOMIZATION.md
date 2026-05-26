# SPEC REVIEW — ORCH-0964 [Public-page theme customization + consumer-app brand screen + deep links]

**Reviewed by:** Claude `mingla-orchestrator` (REVIEW mode)
**Reviewed:** 2026-05-25
**Verdict:** **APPROVED — proceed to IMPLEMENT**

## Documents under review

1. `Mingla_Artifacts/specs/SPEC_ORCH-0964_PUBLIC_PAGE_THEME_CUSTOMIZATION.md` (463 lines, commit `744057a83`)
2. `Mingla_Artifacts/specs/SPEC_ORCH-0964_AMENDMENT_POST_0961_0962_0963.md` (188 lines, commit `9c43d157b`)
3. `Mingla_Artifacts/specs/SPEC_ORCH-0964_AMENDMENT_2_CONSUMER_BRAND_SCREEN_AND_DEEP_LINKS.md` (307 lines, commit `777ec9828`)
4. Underlying investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0964_PUBLIC_PAGE_THEME_CUSTOMIZATION.md` (175 lines, commit `bc9f8d4ed`)

## Commit-hash verification (DEC-179)

| File | Commit on per-ORCH branch | Verified |
|---|---|---|
| SPEC | `744057a83` | ✅ |
| Amendment 1 | `9c43d157b` | ✅ |
| Amendment 2 | `777ec9828` | ✅ |
| Investigation | `bc9f8d4ed` | ✅ |

All 4 documents present at branch head. Zero modified-but-uncommitted files in the worktree's `Mingla_Artifacts/` directory.

## Dependency walk (DEC-179 — config-layer awareness)

The SPEC + amendments propose touching these config-layer files during implementation:

| File | Consumers / compatibility | Addressed in SPEC? |
|---|---|---|
| `app-mobile/app.json` or `app.config.ts` | Adds 14 font packages + Lottie + universal links + new `/brand/[slug]` route registration | ✅ Amendment 2 §1.D names every required field |
| `mingla-business/app.config.ts` | Adds 14 font packages + Lottie for buyer-web RN-Web build | ✅ Original SPEC §4.4 + Amendment 2 §1.D |
| `vercel.json` (mingla-marketing OR mingla-business) | New `.well-known/*.json` Content-Type rule | ✅ Amendment 2 §1.D + new invariant `I-PROPOSED-DEEP-LINK-WELL-KNOWN-JSON-CONTENT-TYPE` |
| `package.json` (both apps + new package) | New workspace package `@mingla/brand-rendering` + new workspace package `@mingla/theme-animations` + 14 font deps × 2 apps | ✅ Amendment 2 §1.A + original SPEC §4.3 + §4.4 |
| `tsconfig*.json` (workspace + new packages) | New `paths` entries for `@mingla/brand-rendering` + `@mingla/theme-animations` | ⚠️ Implied by workspace pattern; implementor should add explicitly to new package tsconfigs (flagged in dispatch) |
| `.github/workflows/strict-grep-mingla-business.yml` | 6 new gate jobs (4 original SPEC + 2 from Amendment 2) | ✅ Original SPEC §10 (`feedback_strict_grep_registry_pattern.md`) |
| `.github/scripts/strict-grep/orch-0962-brand-field-map-coverage.mjs` | Extension to register theme columns in expected-field list | ✅ Amendment 1 §7 |
| `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` | Backend allowlist if migration files added (per `feedback_close_commit_precommit_checks.md`) | ✅ Original SPEC §10 hard guards |

Dependency walk obligation is met at the SPEC level. Per-consumer walk for the actual edits is implementor's REVIEW gate, not SPEC's.

## Review checklist

- [x] Root cause / requirement proven via investigation evidence
- [x] Scope appropriate — operator confirmed 5 lock-in decisions + 3 expansion decisions
- [x] Hidden fallback paths addressed — `MINGLA_DEFAULT_THEME` resolver chain proven
- [x] Stale cache paths addressed — React Query keys `['brandTheme', ...]` + `['consumerBrand', ...]` + logout invalidation contract
- [x] Response shape truthful in ALL states — resolver returns same shape for null/partial/full theme
- [x] Real fix or symptom mask — net-new feature, no mask risk
- [x] Solo/collab parity — N/A (no collab surface)
- [x] Constitutional compliance — Rules 2/3/6/9/11/14 explicitly cited in invariants section
- [x] Evidence chain complete — INVESTIGATION → SPEC → 2 amendments, all committed
- [x] Documents updated — WORLD_MAP + WORKTREE_REGISTRY updated at INTAKE; will update again at CLOSE
- [x] Commit-hash verification — all 4 commits confirmed
- [x] Dependency walk for config-layer changes — addressed in SPEC, deferred to implementor REVIEW for actual edits

## Hard guards verified

Original SPEC §10 hard guards + Amendment 1 §9 additions + Amendment 2 §7 additions = 14 total DO NOTs. All concrete, all enforceable, all paired with strict-grep gate or test case.

## Surface coverage

7 surfaces total per Cross-Surface Impact:
- 5 IN scope (buyer-web, consumer iOS, consumer Android, business iOS edit UI, business Android edit UI)
- 2 NOT in scope (admin web, business-web preview live theme preview)
- Plus the new consumer-app `/brand/[slug]` screen and deep-link surfaces

Each in-scope surface has its own success criterion (SC-2-buyer-web, SC-2-consumer-iOS, etc.) so manual parity gates are explicit at TEST time.

## Risks called out for downstream awareness

1. **Real-device deep-link verification (SC-23/SC-24)** — iOS Universal Links don't fully reproduce in simulator; TEST phase needs a real iPhone. Operator's physical iPhone in the live-fire matrix per `feedback_tester_3sims_plus_operator_physical.md` covers this.
2. **34-commit rebase needed at Step 0** — branch is stale. Rebase first, conflicts likely in WORLD_MAP/WORKTREE_REGISTRY only (all SPEC work is in new files).
3. **`.well-known/` repo location** — operator input needed at implementation to know which Vercel project hosts which domain.
4. **Native rebuild required** — Lottie + fonts + universal links + new route = NOT OTA. Operator should plan for `eas build` on both apps as part of the close-cycle.
5. **13–14 day implementation budget** — large by Mingla standards. Implementor may suborganize into ~3 internal commits but ONE PR per `feedback_close_commit_precommit_checks.md`.

## Verdict

**APPROVED.** Dispatch to implementor.
