# FORENSICS ORCH-1094 - Business Web Core Parity Wave

You are Codex `forensic-mingla` working in:

`/Users/sethogieva/Desktop/mingla-orchs/ORCH-1094-[business-web-core-parity-wave]`

Branch:

`ORCH-1094-business-web-core-parity-wave`

## Goal

Produce the bundled investigation + implementation spec for ORCH-1094 [Business web core parity wave: Create + Hub + Marketing + Account].

This is Seth-approved as one larger restoration pass for items 1-4:

1. Event Creator
2. Hub
3. Marketing
4. Account / payout readiness

Seth explicitly rejected piecemeal tester gates for this stage. The implementation should be built complete across all four route families, then one combined independent tester pass runs after implementation is complete.

## Mandatory entry checks

Read `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md` first. Factor all `ALL`, `ORCH-1094`, and business-web route warnings into the work. Preserve COMMS-0018 deploy discipline: deploy/OTA only from merged main, never from a worktree.

Read the relevant skill instructions:

- `/Users/sethogieva/Desktop/mingla-main/.codex/skills/forensic-mingla/SKILL.md`
- `/Users/sethogieva/Desktop/mingla-main/.codex/skills/orchestrator-mingla/SKILL.md` for lifecycle constraints

## Inputs to ingest

Use these as the evidence spine:

- `Mingla_Artifacts/reports/INVENTORY_ORCH-1085_PHASE_3_BUSINESS_WEB_FULL_WEB_COMPLETION.md`
- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1088_BUSINESS_WEB_EVENT_CREATOR_PARITY.md`
- `Mingla_Artifacts/specs/SPEC_ORCH-1088_BUSINESS_WEB_EVENT_CREATOR_PARITY.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1088_BUSINESS_WEB_EVENT_CREATOR_PARITY.md`
- `Mingla_Artifacts/reports/QA_ORCH-1088_BUSINESS_WEB_EVENT_CREATOR_PARITY.md`
- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1089_BUSINESS_WEB_EVENT_CREATOR_SIGNEDIN_WIZARD.md`
- `Mingla_Artifacts/specs/SPEC_ORCH-1089_BUSINESS_WEB_EVENT_CREATOR_SIGNEDIN_WIZARD.md`
- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1092_BUSINESS_WEB_RESTORATION_WAVE.md`
- `Mingla_Artifacts/specs/SPEC_ORCH-1092_BUSINESS_WEB_RESTORATION_WAVE.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1092_BUSINESS_WEB_RESTORATION_WAVE.md`
- `Mingla_Artifacts/reports/QA_ORCH-1092_BUSINESS_WEB_RESTORATION_WAVE_RETEST2.md`
- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1093_BUSINESS_WEB_SIGNEDIN_ROUTE_OOM.md`
- `Mingla_Artifacts/specs/SPEC_ORCH-1093_BUSINESS_WEB_SIGNEDIN_ROUTE_OOM.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1093_BUSINESS_WEB_SIGNEDIN_ROUTE_OOM.md`
- `Mingla_Artifacts/reports/QA_ORCH-1093_BUSINESS_WEB_SIGNEDIN_ROUTE_OOM_REWORK.md`
- `mingla-business/public/home.html`
- `mingla-business/scripts/inject-mobile-blur-css.mjs`
- `mingla-business/scripts/ci/orch-1093-signedin-route-oom.mjs`
- `mingla-business/scripts/ci/orch-1092-business-web-restoration-wave.mjs`
- `mingla-business/playwright/` and any ORCH-1083/1088/1092/1093 browser harnesses
- `mingla-business/app/event/create.tsx`
- `mingla-business/app/event/[id]/edit.tsx`
- `mingla-business/app/hub/*`
- `mingla-business/app/marketing*` and `mingla-business/src/components/marketing/**`
- `mingla-business/app/account*`, payout, bank, connect, onboarding, and payments views

## Scope locks

In scope:

- Restore core signed-in business web functionality on phone browsers for Create, Hub, Marketing, and Account/payout readiness.
- Keep the product real. Do not replace route families with fake final screens or static-only shells.
- Preserve honest recovery if a user is signed out, has no brand, loses session, or hits a recoverable chunk issue.
- Preserve provider-neutral payout copy from COMMS-0021.
- Preserve ORCH-1091 cache/chunk recovery.
- Preserve ORCH-1093 protected pre-Expo route guard until the spec says exactly how each route graduates out of protection after implementation.

Out of scope:

- Item 5 media-heavy parity pass beyond what is needed for the core pass to avoid crashes.
- Items 6-7 Ari/advanced tools and architecture hardening beyond what is necessary for this pass.
- Item 8 final guard removal cleanup.
- Native app parity changes unless the code path is shared and must be kept safe.
- Admin, buyer/anonymous web, consumer app.
- Supabase/backend changes unless proven absolutely necessary and scoped with provider docs where applicable.

## Required output

Write both files:

- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1094_BUSINESS_WEB_CORE_PARITY_WAVE.md`
- `Mingla_Artifacts/specs/SPEC_ORCH-1094_BUSINESS_WEB_CORE_PARITY_WAVE.md`

The report/spec must include:

- A route inventory for Event Creator, Hub, Marketing, Account/payout readiness.
- The current protected/shelled state of each route and the intended restored state.
- A dependency map of shared native/web hazards, including media pickers, date/time controls, native modules, Reanimated/draggable imports, Stripe/Paystack/Connect/payout surfaces, composer editor, sheets/overlays, and any route-wide imports that can break phone boot.
- The implementation order for the bundled build.
- A single combined post-implementation tester acceptance matrix. Do not split into per-route tester handoffs before implementation completes.
- Regression-test requirements that would fail on the current protected/shelled behavior and pass after full 1-4 restoration.
- Export/build/performance guards with budget checks, cache/chunk recovery checks, and protected-route graduation checks.
- Manual/runtime proof plan for the final tester pass: Android Chrome physical phone and iPhone Safari/Safari-equivalent after the whole 1-4 implementation is complete.
- Deployment discipline: PR title/commit must use `[deploy]`; Vercel deploy from merged main only; no native OTA unless the implementation touches native app surfaces, which is not expected.

## Hard stop

Do not implement product code. Return the report/spec paths and the most important risks. Downstream routing is orchestrator review -> implementor bundled build -> one combined tester pass.
