# FORENSICS INVESTIGATE — ORCH-1022 [DM-shared card freeze + single-card Policies & Reservations dead taps]

You are Claude `mingla-forensics` in INVESTIGATE mode.

Work in this worktree only:

```bash
cd ~/Desktop/mingla-orchs/ORCH-1022-[dm-shared-card-freeze-policies-reservations]
git status --short --branch
```

## User-reported symptom

Seth reported on 2026-05-30:

> expanding a card you shared in a direct message freezes the app, and the policies and reservations buttons dont work on the single cards anywhere in the app.

Treat this as S1-high because it affects a core consumer loop: receiving a shared card in DM, opening card details, and tapping the practical action users need before going somewhere.

## Affected surfaces

- Consumer iOS: in scope.
- Consumer Android: in scope.
- Buyer/anonymous Web: explicitly NOT in scope.
- Business iOS: explicitly NOT in scope.
- Business Android: explicitly NOT in scope.
- Admin Web: explicitly NOT in scope.
- Business Web preview: explicitly NOT in scope.

## Current intake facts and starting evidence

Do not assume root cause. Prove it.

Historical context to ingest first:

1. `Mingla_Artifacts/COVERAGE_MAP.md` entries for ORCH-0667, ORCH-0685, ORCH-0690, ORCH-0696. These previously promoted DM Saved-Card Sharing and all 8 `ExpandedCardModal` mount surfaces to A, which means this is likely a regression from later bottom-sheet/browser/payload work or an untested data-shape gap.
2. `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0696_REPORT.md` and `Mingla_Artifacts/reports/INVESTIGATION_META-ORCH-0991_CONSUMER_MODALS_TO_SHEETS.md` for bottom-sheet / RN Modal / z-stack history.
3. `app-mobile/src/services/messagingService.ts`:
   - `trimCardPayload` controls what shared card snapshots carry into chat.
   - It preserves top-level `website`, `phone`, `location`, `placeId`.
   - Curated `stops[]` currently preserve many fields but the intake scan did not see `website` preserved per stop; verify whether that matters to this report or is separate.
4. `app-mobile/src/services/cardPayloadAdapter.ts`:
   - Converts `CardPayload` into `ExpandedCardData`.
   - It sets `cardType`, `stops`, `website`, `placeId`, etc. from chat payloads.
5. `app-mobile/src/components/MessageInterface.tsx`:
   - DM shared-card expand path mounts `ExpandedCardModal` around lines ~2160 with `target={{ kind: "nightOut", data: expandedCardFromChat }}`.
   - Verify if this target discriminator is correct for all shared card payload types.
6. `app-mobile/src/components/ExpandedCardModal.tsx`:
   - Regular single-card branch passes `onOpenBrowser` into `ActionButtons`.
   - Curated branch has per-stop Policies & Reservations buttons.
   - In-app browser modals are siblings after the `BaseBottomSheet` under the `META-ORCH-0991 Wave A` comment.
7. `app-mobile/src/components/expandedCard/ActionButtons.tsx`:
   - `handlePoliciesAndReservations` returns early if `!onOpenBrowser`, if `normalizeWebsiteUrl(card.website)` is false, or if the button never renders because `showPoliciesButton = !!card.website`.
   - Comment says "all categories with website or placeId", but current render gate appears website-only. Prove whether placeId-based fallback was intended and lost, or whether the comment is stale.

## Required investigation questions

Answer all with file/line evidence and, where feasible, a minimal repro plan:

1. For DM-shared cards, what exact call chain runs from tapping the chat card bubble to rendering `ExpandedCardModal`?
2. What data shape enters the modal from `CardPayload`, and does it differ from the Discover/Saved/Calendar modal shape in a way that can freeze render, gestures, dynamic sizing, browser modals, or hooks?
3. Does the freeze reproduce only for single cards, curated cards, event/night-out cards, or all shared card payload types?
4. Does any render path violate React hooks rules, BottomSheet dynamic sizing assumptions, RN Modal nesting constraints, or infinite state-update loops when opened from `MessageInterface`?
5. For Policies & Reservations on single cards, is the button missing, visible-but-dead, opening an invisible browser, blocked by invalid URL normalization, or swallowed by bottom-sheet/z-stack/touch layering?
6. Enumerate every single-card mount surface that must be covered: Discover/solo deck, collab deck, Saved, Calendar, friend profile, DM shared-card, session/collab, and any current business-event branch if it uses different components. Mark which share `ActionButtons` and which do not.
7. Identify prior tests/gates that should have caught this and why they did not.
8. Decide whether this needs UI/UX design direction before implementation. If the fix is behavior-only, say so. If button placement, browser presentation, sheet hierarchy, or visible states change, route design to `ui-ux-mingla` before implementation.

## Hard guards

- Investigation only. Do not implement product code.
- Do not edit `.claude/skills/`.
- Do not touch unrelated dirty anchor files.
- Do not run global kills (`pkill`, `killall`, simulator blanket shutdowns).
- If you need runtime proof, use this ORCH worktree and a scoped Metro port. Suggested port from spawn context: `8088`.
- Regression tests are mandatory in the eventual implementation prompt. The investigation must name the test files or new tests that should fail before the fix and pass after.
- If root cause involves external APIs or docs, cite canonical docs. If no external API changes are involved, say `COMMS-0003: N/A no external API contract change`.

## Expected output

Write:

`Mingla_Artifacts/reports/INVESTIGATION_ORCH-1022_DM_SHARED_CARD_FREEZE_POLICIES_RESERVATIONS.md`

The report must include:

- Plain-English user impact.
- Current behavior vs intended behavior.
- Five-layer proof where applicable: source, runtime/repro, data shape, tests/gates, prior artifacts.
- Root cause(s), contributing factors, and ruled-out hypotheses.
- Blast radius by surface.
- Minimal fix direction, but no code.
- Required implementation regression tests and manual runtime smoke gates.
- Clear recommendation: SPEC next, or split into sub-ORCHs if the freeze and dead buttons prove unrelated.

/goal: investigation report written with PROVEN or explicitly bounded PROBABLE findings, enough for orchestrator review and a separate SPEC dispatch.
