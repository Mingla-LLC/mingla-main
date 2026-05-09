# REVIEW - ORCH-0763F Share Preview Long Text Overflow Amendment

Date: 2026-05-09
Mode: Orchestrator intake/amendment
Verdict: Amend existing ORCH-0763F implementor prompt; do not create a new ORCH ID

## Plain-English Finding

Shared event and brand links can look broken when the event name or brand name is long. The supplied screenshot shows the event title overflowing downward into the subtext/brand line on the generated share preview card.

This is a public-trust issue: the link destination may work, but the preview can make Mingla look unpolished or unreliable before the recipient taps.

## Evidence

- Operator screenshot: `/Users/sethogieva/Downloads/IMG_0226.jpg`
- Visible failing title: `Runtime Share Test FreeTA throwaway free-ticket QA`
- Visible symptom: title text overlaps the lower copy/brand area instead of shrinking, clamping, wrapping safely, or truncating within its allotted area.
- Current implementation surface:
  - `mingla-business/server/socialPreview.js:621-646` renders title/subtitle with fixed large font sizes and max widths.
  - `mingla-business/server/socialPreview.js:632` truncates title by character count, but does not prove line count, pixel fit, or vertical collision safety.
  - `mingla-business/server/socialPreview.js:600,617` truncates chip text by character count, but does not prove chip width/row height safety.

## Lifecycle Decision

ORCH-0763F already owns post-deploy share preview polish and is implementor-ready. This report amends that existing implementation handoff instead of opening ORCH-0771.

Updated prompt:

`Mingla_Artifacts/prompts/IMPLEMENTOR_ORCH-0763F_SHARE_PREVIEW_POLISH_AND_DUPLICATE_IMESSAGE.md`

## Required Amendment

The ORCH-0763F implementation must add a typography/layout safety contract:

- Long event titles must not overlap date, location, subtitle, brand name, logo tile, or domain/footer text.
- Long brand names must not overlap event count, handle, next-event cue, logo tile, or domain/footer text.
- Long venues/locations and long next-event labels must clamp or truncate within chips without expanding into title/body zones.
- The renderer must use one or more proven fit strategies: line clamp, max-height, dynamic font-size buckets, stricter max characters by line budget, explicit min/max text box dimensions, or separate compact layouts for long text.
- Automated or scriptable tests must include at least one long event-title fixture and one long brand-name fixture, and must assert the renderer receives safe typography parameters or produces non-empty PNG output for those fixtures.
- Tester runtime gate must include fresh/cache-busted iMessage and WhatsApp preview checks for long event and long brand names.

## Priority

Severity: S2 high / Fix Next.

Score: 66 / Fix Next.

Rationale: not a broken destination link, but it affects public share trust, launch polish, and both event and brand public-link surfaces. It should ship inside ORCH-0763F before ORCH-0763E/0763F close.
