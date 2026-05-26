# IMPLEMENTATION REPORT — META-ORCH-0972 Sub-D

## 1. Verdict

**IMPLEMENTED AND VERIFIED LOCALLY — ready for orchestrator REVIEW and orchestrator-owned edge deploy.**

Sub-D now locks the post-brand-kind-decommission guardrails: CI rejects active `brand.kind` reads, public/business tab visibility is enforced as data-driven, the ORCH-0963 public-page gate no longer requires kind branching, and Q15 `temporaryCategory` now reaches the Gemini prompt layer as well as pending action args. No Supabase functions were deployed by implementor.

## 2. COMMS Acks

| Entry | Severity | Action |
|---|---:|---|
| COMMS-0002 | WARN | Acknowledged on anchor `main` in `c29aaf51e`; Sub-D backend file touches were added to `ORCH_0972_BACKEND_ALLOWLIST` in the same commit scope. |
| COMMS-0003 | WARN | Acknowledged on anchor `main`; Q15 prompt-only external API touch did not change Gemini endpoint, enum, or payload schema. |
| COMMS-0004 | WARN | Acknowledged on anchor `main`; no INTAKE or ORCH-ID allocation work in this turn. |

## 3. Inputs Read

| Input | Use |
|---|---|
| `COMMS_LEDGER.md` | Mandatory entry scan and WARN acknowledgements. |
| `.codex/skills/implementor-mingla/SKILL.md` | Implementor workflow, worktree discipline, Deno gate rules, report contract. |
| `Mingla_Artifacts/specs/SPEC_META-ORCH-0972_BRAND_KIND_DECOMMISSION.md` §Sub-spec D | Binding Sub-D scope, success criteria SC-D-1 through SC-D-9, hard guards. |
| `supabase/config.toml` | Verified deploy-target functions have no explicit override and therefore use `verify_jwt: true`. |
| Existing strict-grep scripts/workflow | Matched local strict-grep style and CI registration pattern. |
| Parser and shared Gemini files | Confirmed `temporaryCategory` existed in pending action args but not prompt context before this change. |

## 4. Scope Tie-Back

Sub-D is the CI/deploy-handoff phase after Sub-A source edits and Sub-C remote migration readiness. The root contract is to prevent brand persona/kind reads from returning to active product code, preserve trip RPC/route segregation checks, and prepare orchestrator to deploy exactly the edge functions that need source updates.

Out of scope and preserved: Sub-A/B/C sealed UI/runtime surfaces, Stage 4 `brands.kind` removal, new migrations, PR creation, package/lockfile changes, and `supabase functions deploy`.

## 5. Files Changed

| Area | Files |
|---|---|
| Strict-grep gates | `.github/scripts/strict-grep/meta-orch-0972-no-brand-kind-reads.mjs`; `.github/scripts/strict-grep/meta-orch-0972-data-driven-tabs.mjs`; `.github/scripts/strict-grep/orch-0963-public-trip-rpc-and-route-segregation.mjs`; deleted old `.github/scripts/strict-grep/orch-0963-public-brand-kind-branched.mjs`; `.github/workflows/strict-grep-mingla-business.yml` |
| Legacy gate cleanup | `mingla-business/scripts/ci/orch-0855-adversarial-check.mjs` |
| Parser Q15 passthrough | `supabase/functions/parse-restaurant-menu/index.ts`; `supabase/functions/parse-play-activities/index.ts`; `supabase/functions/_shared/geminiMenuParser.ts`; `supabase/functions/_shared/geminiActivitiesParser.ts` |
| Backend allowlist | `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` |
| Regression test/report | `mingla-business/__tests__/strictGrep/noBrandKindReads.test.ts`; `Mingla_Artifacts/reports/IMPLEMENTATION_META-ORCH-0972_SUB_D.md` |

## 6. Old To New Receipts

| File | Before | After |
|---|---|---|
| `orch-0963-public-brand-kind-branched.mjs` | Required public brand kind branching plus trip RPC/route checks. | Renamed to `orch-0963-public-trip-rpc-and-route-segregation.mjs`; C1/C3 kind-branch assertions removed, C2/C4 preserved. |
| `strict-grep-mingla-business.yml` | Ran the old ORCH-0963 kind-branched job only. | Runs renamed ORCH-0963 gate plus new META-ORCH-0972 data-driven-tabs and no-brand-kind-reads jobs. |
| `orch-0855-adversarial-check.mjs` | Still enforced A-07 persona ID lock and A-13 trip-planner kind immutability. | A-07 and A-13 blocks removed per spec. Remaining old assertions are untouched and the script is not workflow-wired. |
| Parser call sites/shared Gemini parsers | `temporaryCategory` was stored in pending action args only. | Parser call sites pass `temporaryCategory`; Gemini system instruction now includes restaurant/play context. |
| `orch-0863-marketing-hub-phase-b.mjs` | ORCH-0972 allowlist covered Sub-A/Sub-C known files. | Added Stage 4 drop migration placeholder plus shared Gemini parser files touched by Sub-D. |
| `noBrandKindReads.test.ts` | No Sub-D strict-grep regression existed. | Jest fixture asserts the new gate exits non-zero for `brand.kind` under `mingla-business/src/`; fails-on-revert verified at `a1c1d7f70`. |

## 7. Regression Coverage

| Test / Check | Result | Notes |
|---|---:|---|
| `node .github/scripts/strict-grep/meta-orch-0972-data-driven-tabs.mjs` | PASS | D1-D4 all passed. |
| `node .github/scripts/strict-grep/meta-orch-0972-no-brand-kind-reads.mjs` | PASS | N1-N4 all passed. |
| `node .github/scripts/strict-grep/orch-0963-public-trip-rpc-and-route-segregation.mjs` | PASS | C2/C4 preserved. |
| `node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` | PASS | C7 allowlist gate passed. |
| `node --check` for new/renamed strict-grep scripts | PASS | Syntax check passed. |
| `npx jest __tests__/strictGrep/noBrandKindReads.test.ts --runInBand` | PASS | 1 suite / 1 test. |
| Fails-on-revert probe | PASS | Temporarily removed the new no-brand-kind gate script; Jest failed as expected, then script was restored and Jest passed. |
| Scoped `git diff --check` | PASS | No whitespace/errors in Sub-D scoped files. |
| `node mingla-business/scripts/ci/orch-0855-adversarial-check.mjs` | EXPECTED FAIL | A-07/A-13 are gone; remaining stale ORCH-0855 assertions still fail because they encode pre-decommission trip-planner contracts and are not in workflow CI. |

## 8. Edge Function Deploy Matrix

Orchestrator owns the deploy invocation after review. Run from the META-ORCH-0972 worktree; do not add `--no-verify-jwt` unless reachability verification returns 404 and orchestrator deliberately chooses that remediation.

| Deploy function | Why deploy | Source files included | Current `verify_jwt` setting |
|---|---|---|---|
| `parse-restaurant-menu` | Sub-A kind-gate removal plus Sub-D Q15 prompt context. | `supabase/functions/parse-restaurant-menu/index.ts`; `supabase/functions/_shared/geminiMenuParser.ts` | `true` (implicit default; no `[functions.parse-restaurant-menu]` override in `supabase/config.toml`) |
| `parse-play-activities` | Sub-A kind-gate removal plus Sub-D Q15 prompt context. | `supabase/functions/parse-play-activities/index.ts`; `supabase/functions/_shared/geminiActivitiesParser.ts` | `true` (implicit default; no `[functions.parse-play-activities]` override) |
| `agent-chat` | Imports `_shared/agentTools.ts`, which Sub-A touched. | `supabase/functions/agent-chat/index.ts`; `supabase/functions/_shared/agentTools.ts` | `true` (implicit default; no `[functions.agent-chat]` override) |
| `agent-confirm-action` | Imports `_shared/agentTools.ts`, which Sub-A touched; grep found it in addition to `agent-chat`. | `supabase/functions/agent-confirm-action/index.ts`; `supabase/functions/_shared/agentTools.ts` | `true` (implicit default; no `[functions.agent-confirm-action]` override) |

Exact orchestrator commands:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/meta-orch-0972-[brand-kind-decommission-universal-features]" && /Users/sethogieva/bin/supabase functions deploy parse-restaurant-menu --project-ref gqnoajqerqhnvulmnyvv
cd "/Users/sethogieva/Desktop/mingla-orchs/meta-orch-0972-[brand-kind-decommission-universal-features]" && /Users/sethogieva/bin/supabase functions deploy parse-play-activities --project-ref gqnoajqerqhnvulmnyvv
cd "/Users/sethogieva/Desktop/mingla-orchs/meta-orch-0972-[brand-kind-decommission-universal-features]" && /Users/sethogieva/bin/supabase functions deploy agent-chat --project-ref gqnoajqerqhnvulmnyvv
cd "/Users/sethogieva/Desktop/mingla-orchs/meta-orch-0972-[brand-kind-decommission-universal-features]" && /Users/sethogieva/bin/supabase functions deploy agent-confirm-action --project-ref gqnoajqerqhnvulmnyvv
```

Post-deploy orchestrator verification: use `mcp__supabase__list_edge_functions` to confirm version bumps for all four function names, then issue one authenticated curl per deployed function and confirm 200/400/401/403 validation behavior rather than `404 NOT_FOUND`.

## 9. Verification Gates + SC-D Criteria

| Criterion / Gate | Status |
|---|---|
| Branch | PASS: `meta-orch-0972-brand-kind-decommission-universal-features`. |
| Baseline | PASS: started from `a1c1d7f70254bd75bbcb22eced821cd2a5728617`. |
| SC-D-1 | HANDOFF: deploy/version-bump/live curl is orchestrator-owned after this commit. |
| SC-D-2 | PASS: A-07/A-13 removed; no workflow job references ORCH-0855. |
| SC-D-3 | PASS: ORCH-0963 gate renamed; C1/C3 removed; C2/C4 preserved; workflow updated. |
| SC-D-4 | PASS: `meta-orch-0972-data-driven-tabs.mjs` exists, is workflow-wired, and passes locally. |
| SC-D-5 | PASS: `meta-orch-0972-no-brand-kind-reads.mjs` exists, is workflow-wired, and passes locally. |
| SC-D-6 | PASS: ORCH-0972 backend allowlist includes spec-required files plus Sub-D shared parser touches. |
| SC-D-7 | PASS: both parsers pass `temporaryCategory` to the prompt layer; no `UPDATE brands SET venue_category` statement found. |
| SC-D-8 | PASS: `mingla-business/__tests__/strictGrep/noBrandKindReads.test.ts` added and fails-on-revert verified at `a1c1d7f70`. |
| SC-D-9 | HANDOFF: live edge smoke requires orchestrator deploy first. |
| Deno check | PASS: `deno check` passed for `parse-restaurant-menu`, `parse-play-activities`, `agent-chat`, and `agent-confirm-action`. |
| Deno test | N/A: `deno test` attempted for the same four function dirs; all returned `No test modules found`. |

## 10. Constraints-Held Checklist

| Constraint | Held |
|---|---:|
| Did not run `supabase functions deploy` | YES |
| Did not run `supabase db push` | YES |
| Did not add a migration | YES |
| Did not remove `brands.kind` | YES |
| Did not touch BrandCreationFlow / OfferingChooser / hub tab implementation / native Stripe boundary / Android Sub-B Jest files / PublicBrandPage rebuild / publicEventsService rewrite | YES |
| Did not touch package or lockfiles | YES |
| Did not open a PR | YES |
| Did not include a deploy marker in commit messaging | YES |
| Preserved `411925909`, `fee178634`, and `a1c1d7f70` ancestry | YES |
| Left pre-existing unrelated report/evidence artifacts uncommitted | YES |

## 11. Downstream Routing

Control returns to Claude `mingla-orchestrator` for REVIEW, then orchestrator deploys the four functions listed in Section 8 and verifies version bumps via `mcp__supabase__list_edge_functions`. After deploy verification, route to Claude `mingla-tester` for Sub-D PASS with the required adversarial regression angle. Stage 4 `brands.kind` removal remains a separate release-cycle decision and must not be folded into this Sub-D commit.
