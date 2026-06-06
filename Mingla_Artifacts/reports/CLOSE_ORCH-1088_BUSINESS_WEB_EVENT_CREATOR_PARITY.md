# CLOSE - ORCH-1088 Business Web Event Creator Phone-Browser Parity

Date: 2026-06-06
Status: CLOSED-PASS-GradeA for scoped safety slice
Branch: `ORCH-1088-business-web-event-creator-parity`
Verified head before close sync: `0bec851d7`

## Plain-English Outcome

ORCH-1088 removes the next crash/stall class from Business web after sign-in. Phone browsers that hit `/event/create` without a usable session now see a clear sign-in recovery screen instead of a white screen, `Something went wrong`, or an endless `Finishing sign-in...` state.

This is not the full Create workflow reopening. Static Home's Create action remains shelled until a later signed-in Android Chrome and Safari Step 1-7 wizard pass proves the complete flow.

## What Changed

- `/event/create` has bounded terminal states for signed-out, auth timeout/error, brand error/no-brand, and draft-hydration timeout.
- `/event/{draftId}/edit` has bounded missing-draft recovery and web-safe exits back to `/home#hub-events`.
- The web Reanimated shim now exports `Easing.bezier` and `runOnUI`, covering Ari and draggable-list route-wide imports that previously crashed before recovery UI could render.
- Phone-web device cover image/video upload is honestly disabled with desktop/app copy; GIF, stock, and color cover paths remain.
- Paid publish copy remains provider-neutral: `Connect a bank`.
- Static Home Create remains on `#create-event`; unsafe static Home route links remain blocked.

## Evidence

- Investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1088_BUSINESS_WEB_EVENT_CREATOR_PARITY.md`
- Spec: `Mingla_Artifacts/specs/SPEC_ORCH-1088_BUSINESS_WEB_EVENT_CREATOR_PARITY.md`
- Implementation: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1088_BUSINESS_WEB_EVENT_CREATOR_PARITY.md`
- QA: `Mingla_Artifacts/reports/QA_ORCH-1088_BUSINESS_WEB_EVENT_CREATOR_PARITY.md`

QA verdict: PASS for the scoped safety slice.

Verified gates:

```bash
cd mingla-business && npm run test:orch-1088
cd mingla-business && npx expo export -p web && node scripts/inject-mobile-blur-css.mjs && npm run test:orch-1088
```

Runtime proof:

- Physical Android Chrome proof during orchestrator rework: `/event/create?orch1088nosession=3` rendered `Sign in to create an event.` with no `Finishing sign-in...`, `Something went wrong`, `Easing.bezier`, or `runOnUI` failures.
- Tester fallback mobile-browser proof against exported build reached the same terminal recovery state and confirmed no page errors.

## Residual Work

Full signed-in Event Creator web parity is still open:

- Home Create must not link to `/event/create` yet.
- The next slice must prove signed-in Step 1-7 on Android Chrome and Safari.
- Required proof includes draft creation/re-entry, Basics, When, Where, Cover, Tickets, Settings, Preview, publish gating, close/discard, refresh behavior, and fatal/browser-console checks.

## Deploy Notes

This branch changes the Business web runtime and should ship through a GitHub PR with `[deploy]` in the title so Vercel deploys it.

Deploy rule: merge first, then deploy from merged `main` only. Do not deploy or OTA from the worktree. No native OTA is required for ORCH-1088 because this slice is Business web only and the native app paths are not changed by the web-only shim alias.

## Artifact Sync

Updated:

- `Mingla_Artifacts/WORLD_MAP.md`
- `Mingla_Artifacts/MASTER_BUG_LIST.md`
- `Mingla_Artifacts/COVERAGE_MAP.md`
- `Mingla_Artifacts/PRODUCT_SNAPSHOT.md`
- `Mingla_Artifacts/PRIORITY_BOARD.md`
- `Mingla_Artifacts/AGENT_HANDOFFS.md`
- `Mingla_Artifacts/OPEN_INVESTIGATIONS.md`

DIAG-marker reap: zero `[ORCH-1088-DIAG]` matches.
