# FORENSIC PROMPT - ORCH-1088 Business Web Event Creator Phone-Browser Parity

Use Codex `$forensics` / `forensic-mingla`.

You are in worktree `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1088-[business-web-event-creator-parity]` on branch `ORCH-1088-business-web-event-creator-parity`.

## Goal

Produce the investigation report and implementation spec needed to restore the real Business Web Event Creator on phone browsers. The user pain is that the current static Home is safe but feels stripped down because "Create event" is shelled. ORCH-1088 must prove the blockers and specify a robust fix so the Home Create action can be reopened only after the browser workflow actually works.

## Inputs To Read

- `/Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md` first.
- `Mingla_Artifacts/reports/INVENTORY_ORCH-1085_PHASE_3_BUSINESS_WEB_FULL_WEB_COMPLETION.md`
- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1087_BUSINESS_WEB_FULL_ROUTE_PHONE_BROWSER_GATE.md`
- `Mingla_Artifacts/specs/SPEC_ORCH-1087_BUSINESS_WEB_FULL_ROUTE_PHONE_BROWSER_GATE.md`
- `Mingla_Artifacts/reports/CLOSE_ORCH-1087_BUSINESS_WEB_STATIC_ROUTE_FIREWALL.md`
- `mingla-business/public/home.html`
- `mingla-business/public/auth/callback.html`
- `mingla-business/app/event/create.tsx`
- `mingla-business/app/event/[id]/edit.tsx`
- `mingla-business/src/components/event/EventCreatorWizard.tsx`
- `mingla-business/src/components/event/CreatorStep*.tsx`
- `mingla-business/src/store/draftEventStore.ts`
- `mingla-business/src/hooks/useServerDraftEvents.ts`
- `mingla-business/src/utils/draftEventValidation.ts`
- `mingla-business/src/utils/serverDraftEventMapper.ts`
- `mingla-business/src/components/ui/CoverPicker*.tsx`
- `mingla-business/src/components/venue/MapboxAddressInput.tsx` and shared Mapbox input package if relevant.
- `mingla-business/vercel.json`
- `mingla-business/scripts/inject-mobile-blur-css.mjs`

## Hard Constraints

- Forensics only: no product-code edits, no deploy, no OTA, no merge, no reap.
- Do not weaken ORCH-1087 static Home safety unless the spec includes runtime proof and regression gates.
- Do not touch Hub, Ari, Marketing Composer, Account/Payouts, buyer checkout, native apps, backend schema/RLS, or provider integrations except as source context.
- Preserve COMMS-0021 provider-neutral seller copy.
- Deploy work, if later implemented, must happen only from merged `main` per COMMS-0015/0018.
- If the spec changes any external API payload or endpoint, cite canonical provider docs inline per COMMS-0003. Prefer no backend/external API change for this slice unless root cause requires it.

## Required Investigation

1. Reproduce current production and/or local behavior for `/event/create` on a phone browser:
   - Does it still stall on `Finishing sign-in...`?
   - Does it reach `/event/{draftId}/edit`?
   - Does it crash, OOM, blank, or show the error boundary?
   - Capture Android Chrome DevTools/logcat evidence where available.
   - Capture iPhone Simulator Safari evidence if feasible.
2. Prove the auth/session/current-brand chain:
   - Static callback localStorage/session handoff.
   - `AuthContext` web readiness.
   - current brand recovery.
   - draft-store persist hydration.
   - `createDraft` and router replace into edit route.
3. Prove wizard boot and step hazards:
   - `EventCreatorWizard` initial render cost and route chunk dependencies.
   - Step navigation and draft persistence.
   - Basics, When, Where, Cover, Tickets, Settings, Preview.
   - Existing web-safe date/time branches versus any still-native picker paths.
   - Mapbox input keyboard/suggestion path.
   - CoverPicker/media upload path and whether this slice should support full media upload or launch with a safe web-compatible degraded path.
   - Sheets/keyboard/viewport behavior on phone browsers.
   - Validation and publish gate behavior, including payout/bank readiness copy.
4. Produce a route contract:
   - What must work in ORCH-1088 to reopen Home's Create action.
   - What can remain safely degraded.
   - What must stay blocked for later ORCHs.
5. Produce a hard validation plan:
   - Repo-running regression tests that fail on current broken behavior or reintroduced hazards.
   - Export/build proof.
   - Physical Android Chrome smoke.
   - iPhone Safari or iPhone Simulator Safari smoke.
   - Production post-merge gate.

## Expected Outputs

Write both files:

- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1088_BUSINESS_WEB_EVENT_CREATOR_PARITY.md`
- `Mingla_Artifacts/specs/SPEC_ORCH-1088_BUSINESS_WEB_EVENT_CREATOR_PARITY.md`

The spec must be implementor-ready and bounded. It must say exactly which files may be changed, which tests must be added, and what evidence is required before the Home Create action can link to the real route again.

## Completion Condition

Commit the two output artifacts on the ORCH-1088 branch and report the commit SHA plus a concise verdict: ready for implementor, blocked, or needs Seth product decision.
