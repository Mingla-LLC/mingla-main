# QA Report: ORCH-0763 Free Event Publish + Share Device Sweep

> Date: 2026-05-08
> Mode: TARGETED / RUNTIME / DEVICE-SWEEP
> Device: `iPhone 17 Pro (17091E60-C3B6-4167-980D-60C348E177F6)`
> Verdict: FAIL
> Findings: P0:0 P1:2 P2:3 P3:1 P4:3

## 1. Layman Summary

The original wrong-domain bug is mostly repaired, but the share experience is still not release-safe.

On the correct simulator, I published a free-ticket event under `Test Stripe`. The app created a real public URL on the correct domain:

`https://business.usemingla.com/e/teststripe/friday-free-sunset-mixer-qaga-free-golden-hour-rooftop-style-mixer-for-mingla-qa-with-easygoing-music-mocktails-and-room-to-meet-new-people`

That URL opens in Safari and returns HTTP 200 from Vercel. I did not see `mingla.com/e`, `business.mingla.com`, or a `draft` URL in the tested publish/share path.

The remaining blockers are:

- `Copy link` still copies nothing on iOS.
- The public event page shows `DATE TBD` even though the event has a real date/time in the saved payload.
- The created live QA event could not be cleaned up from the UI because the live-event menu did not expose a reachable `Cancel event` or `Delete` action.

Important correction: an earlier Apple auth/settings failure came from the wrong booted simulator. It is excluded from this report.

## 2. Published QA Event

| Field | Value |
|---|---|
| Brand | `Test Stripe` |
| Brand slug | `teststripe` |
| Event id | `b6122ef8-dc76-47d6-94a3-717450acff4f` |
| Event slug | `friday-free-sunset-mixer-qaga-free-golden-hour-rooftop-style-mixer-for-mingla-qa-with-easygoing-music-mocktails-and-room-to-meet-new-people` |
| Status after publish | `scheduled` in payload, shown as `Live` in app list |
| Visibility | `public` |
| Published at | `2026-05-08T21:45:07.748819+00:00` |
| Ticket | `Free RSVP`, price `0`, unlimited |

Note: the title is messy because test automation accidentally appended part of the description into the event name. That is tester-created test data, not a product bug.

## 3. Verification Performed

| Check | Result | Evidence |
|---|---|---|
| Correct simulator identified | PASS | `xcrun simctl list devices booted` showed `iPhone 17 Pro (17091E60...)`; all follow-up commands used this UDID. |
| Step 7 publish screen | PASS | `/tmp/mingla-qa/udid-17091-step-check.png` showed Step 7 Preview and no wrong `mingla.com/e` or `draft` URL. |
| Free event publish | PASS | `/tmp/mingla-qa/after-confirm-publish-correct.png`; event payload showed public/scheduled/published values. |
| Public page domain in app | PASS | `/tmp/mingla-qa/share-modal-public.png` showed `https://business.usemingla.com/e/teststripe/...`. |
| Public URL network reachability | PASS | `curl -IL --max-time 25 <public-url>` returned `HTTP/2 200` from Vercel. |
| Public URL in iOS browser | PASS | `/tmp/mingla-qa/sim-open-public-url.png`; Safari opened `business.usemingla.com` and rendered the event page. |
| Share modal URL card | PASS | `/tmp/mingla-qa/after-tap-visible-url-card.png`; tapping the visible URL opened Safari on `business.usemingla.com`. |
| Share via native sheet | PASS / PARTIAL | `/tmp/mingla-qa/native-share-sheet-public.png`; native sheet displayed `business.usemingla.com`, not Expo. Actual recipient copy from sheet was inconclusive because simulator pasteboard stayed unchanged after tapping native `Copy`. |
| Public-page `Copy link` | FAIL | Pasteboard sentinel stayed `SENTINEL_EMPTY_ORCH_0763` after tapping `Copy link`. |
| Event-list menu `Copy share link` | FAIL | Tapping `Copy share link` opened the share modal; pasteboard sentinel stayed `SENTINEL_MENU_COPY_ORCH_0763`. |
| Public page date display | FAIL | `/tmp/mingla-qa/current-correct-sim.png` and `/tmp/mingla-qa/sim-open-public-url.png` show `DATE TBD`; payload contains `date: "2026-05-08"`, `doorsOpen: "21:00"`, `endsAt: "03:00"`, timezone `America/New_York`. |
| Cleanup/delete test event | FAIL / BLOCKED | Live event menu only exposed `Edit details`, `View public page`, `Open scanner`, `Orders`, `Copy share link`; no reachable cancel/delete action. Evidence: `/tmp/mingla-qa/event-menu-hierarchy-state.png` plus Maestro hierarchy. |
| Automated regression gates | PASS | `npm run test:orch-0763`, `npm run test:orch-0759`, `npm run test:orch-0756b`, `npx tsc --noEmit`, `git diff --check`, and `supabase migration list --linked` all passed before this runtime continuation. |

## 4. Findings

### P1-001: Native `Copy link` does not copy anything

- **Evidence:** On the correct simulator, I set the pasteboard to `SENTINEL_EMPTY_ORCH_0763`, tapped the public-page share modal `Copy link`, then read the pasteboard back. It was still the sentinel.
- **Source evidence:** `mingla-business/src/components/ui/ShareModal.tsx` native copy path does not write to the clipboard; native dependency `expo-clipboard` is missing from `mingla-business/package.json`.
- **Impact:** Users tap a button that promises to copy the event link, but nothing is copied.
- **Required fix:** Add real native clipboard support and only show success after the clipboard write resolves. Retest with `xcrun simctl pbpaste` and a real paste target.

### P1-002: Public event page shows `DATE TBD` for a dated published event

- **Evidence:** Public page screenshots show `DATE TBD`, while the saved event payload contains `theme.business_event.when.date = "2026-05-08"`, `doorsOpen = "21:00"`, `endsAt = "03:00"`, and timezone `America/New_York`.
- **Impact:** Guests see a published event without a date, even though the organizer entered one. That is a major trust and attendance problem.
- **Required fix:** Trace the public event page date source/normalization path and map the saved business-event `when` payload into the public display model.

### P2-001: Event-list `Copy share link` is mislabeled

- **Evidence:** From the live event menu, tapping `Copy share link` opened the share modal instead of copying. The pasteboard stayed `SENTINEL_MENU_COPY_ORCH_0763`.
- **Impact:** Lower than P1-001 because the modal appears, but the label is misleading and the next `Copy link` button still fails.
- **Required fix:** Either rename this action to `Share` / `Open share options`, or make it copy directly.

### P2-002: Cleanup of live QA event is blocked in the UI

- **Evidence:** The live-event menu hierarchy exposed `Edit details`, `View public page`, `Open scanner`, `Orders`, and `Copy share link`. It did not expose `End ticket sales`, `Cancel event`, or `Delete`.
- **Impact:** The tester-created live event remains under `Test Stripe`; I did not mutate Supabase directly from tester mode.
- **Required fix:** Decide whether the test brand should have lifecycle permission. If yes, restore the cancel action. If no, provide an authorized cleanup path for QA data.

### P2-003: Native share sheet copy result is inconclusive

- **Evidence:** The native share sheet displayed the correct authority, `business.usemingla.com`. After tapping the native sheet's `Copy`, `simctl pbpaste` still showed the sentinel.
- **Impact:** This no longer reproduces the operator's Expo-link claim on this simulator, but it still needs a real recipient-app verification pass after clipboard repair.
- **Required fix:** Retest by sharing to Messages/Notes/Mail or another reliable recipient target and verify the exact text delivered.

### P3-001: Event wizard/test accessibility remains brittle

- **Evidence:** Several controls required coordinate taps during Maestro automation because visible labels were not consistently exposed as tappable controls.
- **Impact:** This slows runtime QA and can hide real issues behind automation friction.
- **Recommended fix:** Add stable accessibility labels/test IDs for event wizard inputs, share controls, and destructive lifecycle actions.

## 5. Confirmed Good Behavior

- The tested canonical event URL uses `business.usemingla.com`.
- The public web URL is reachable and renders in Safari.
- The share modal URL card opens the SEO public webpage.
- The native share sheet displayed `business.usemingla.com`, not an Expo link, on this run.
- The published free-ticket event appeared in the Events list as `Live`.
- The Events list card correctly showed `Fri 8 May · 21:00`.

## 6. Required Rework

1. Fix native clipboard for every iOS/native copy entry point.
2. Fix public-page date rendering from the saved business event date/time payload.
3. Clarify or change the event-list `Copy share link` action.
4. Restore or document live-event cleanup/cancel permissions for the `Test Stripe` QA brand.
5. Retest the full flow on the same simulator: publish a clean free event, copy link, share via native sheet to a recipient target, open public URL in Safari, then cancel/delete the QA event through the UI.

## 7. Verdict

FAIL. The wrong-domain problem is not reproducing on the correct simulator, and the public URL works in the browser. But `Copy link` is still broken, the public event page shows `DATE TBD`, and QA cleanup is blocked by missing live-event lifecycle actions.
