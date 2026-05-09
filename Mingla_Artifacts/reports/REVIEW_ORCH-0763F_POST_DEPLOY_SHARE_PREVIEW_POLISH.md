# REVIEW - ORCH-0763F Post-Deploy Share Preview Polish

Date: 2026-05-09
Mode: Orchestrator intake/review
Verdict: Register follow-up; dispatch forensics/spec before implementation

## Plain-English Finding

The deployed public share system now works: links open, rich metadata exists, and the social preview machinery is live.

The remaining issues are quality and trust polish:

- iMessage can sometimes receive the share twice.
- The OG/share card background is too black, so the orange Mingla Business logo does not pop.
- Brand public-page sharing should have the same rich branded design quality as event sharing.
- Event share-card design should visibly include the event date.

These are not the original broken-domain failure. They are the next layer: making shared Mingla links feel polished, intentional, and launch-grade.

## Why This Needs Investigation/Spec First

The visual issues are straightforward design polish, but the intermittent iMessage double-share is not safe to guess at. It could come from:

- app-native Share invocation firing twice
- web `navigator.share` behavior
- iOS share sheet retry/preview behavior
- user interaction state allowing double taps
- duplicate event handlers between public route/share modal
- platform-specific behavior when a preview card is generated

We should prove the exact surface before implementation so we do not patch the wrong layer.

## Scope For Next Pass

The next pass should produce a precise implementation spec for:

1. Double-share guard
   - Find whether duplication happens in app native share, Safari/public-page share, iMessage preview handling, or all of the above.
   - Determine whether a one-shot/submitting guard is needed in `ShareModal`, route-level share buttons, or share helper utilities.

2. Event OG card visual polish
   - Keep the Mingla logo visible on a higher-contrast panel.
   - Avoid flat black dominance.
   - Add the event date as a first-class visible element.
   - Preserve event cover as the dominant visual when available.

3. Brand OG card parity
   - Give brand public-page shares a rich branded card, not a weaker fallback.
   - Use the same Mingla Business visual system as event cards.
   - Include brand name, handle/slug, event count or next-event cue when available.

4. Regression gates
   - Automated tests for metadata/card inputs where feasible.
   - Runtime share-smoke checklist for iMessage and WhatsApp.

## Next Action

Dispatch `$forensics` with:

`prompts/FORENSICS_SPEC_ORCH-0763F_SHARE_PREVIEW_POLISH_AND_DUPLICATE_IMESSAGE.md`

Expected outputs:

- `reports/INVESTIGATION_ORCH-0763F_SHARE_PREVIEW_POLISH_AND_DUPLICATE_IMESSAGE.md`
- `specs/SPEC_ORCH-0763F_SHARE_PREVIEW_POLISH_AND_DUPLICATE_IMESSAGE.md`

Do not close ORCH-0763E until ORCH-0763F is either fixed or explicitly accepted as a post-launch polish deferral.
