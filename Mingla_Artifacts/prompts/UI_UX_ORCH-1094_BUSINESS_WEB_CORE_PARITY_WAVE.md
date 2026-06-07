# UI/UX ORCH-1094 - Business Web Core Parity Wave

You are Codex `ui-ux-mingla` working in:

`/Users/sethogieva/Desktop/mingla-orchs/ORCH-1094-[business-web-core-parity-wave]`

Branch:

`ORCH-1094-business-web-core-parity-wave`

## Goal

Produce product/design direction for the restored mobile business web core pass: Event Creator, Hub, Marketing, and Account/payout readiness. The goal is not a new marketing page or stripped web substitute. The restored browser experience should feel like Mingla Business, optimized for a phone browser and honest about the few workflows that still belong to later passes.

## Mandatory entry checks

Read `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md` first and factor the active `ALL` warnings. Preserve provider-neutral payout copy from COMMS-0021.

Read:

- `/Users/sethogieva/Desktop/mingla-main/.codex/skills/ui-ux-mingla/SKILL.md`
- `/Users/sethogieva/Desktop/mingla-main/.codex/skills/orchestrator-mingla/SKILL.md` for lifecycle constraints

## Inputs

Use:

- `Mingla_Artifacts/reports/INVENTORY_ORCH-1085_PHASE_3_BUSINESS_WEB_FULL_WEB_COMPLETION.md`
- ORCH-1087/1088/1089/1092/1093 reports and specs
- `mingla-business/public/home.html`
- Existing app routes/components for Event Creator, Hub, Marketing, and Account
- Existing Mingla Business design tokens, glass components, tabs, cards, list density, action buttons, sheets, forms, and copy patterns

## Scope

Design direction only. Do not implement product code.

Output should cover:

- Phone-browser navigation from static Home into the real restored route families.
- Loading, signed-out, no-brand, missing-permission, lost-session, chunk-recovery, and protected-route fallback states.
- How restored routes should feel on mobile web: dense, functional, app-like, not a landing page.
- Where web-specific degradation is acceptable and how it should read honestly.
- Event Creator, Hub, Marketing, and Account/payout readiness acceptance criteria from a UI/UX perspective.
- Specific copy guard for provider-neutral payout language.
- Tester visual/interaction checks to run only after the full 1-4 implementation is complete.

## Required output

Write:

`Mingla_Artifacts/reports/DESIGN_ORCH-1094_BUSINESS_WEB_CORE_PARITY_WAVE.md`

Downstream routing is orchestrator review -> implementor bundled build -> one combined tester pass.
