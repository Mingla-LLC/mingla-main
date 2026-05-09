# RUNTIME ORCH-0758A Event Cover Media Native QA

Date: 2026-05-08  
Tester verdict: BLOCKED/UNVERIFIED

## 1. Verdict

BLOCKED/UNVERIFIED.

The ORCH-0758A DB migration gate is cleared and the focused code/static regression gates still pass, but the required runtime media QA could not be completed because the available simulator app is at the unauthenticated Mingla Business sign-in screen and no safe authenticated business account/brand/event fixture was available to tester.

This is not a code FAIL. It is an evidence/access blocker: I cannot honestly verify upload, storage write/RLS behavior, publish preservation, public/ticket rendering, published-edit atomicity at runtime, or reduced-motion video behavior without an authenticated disposable business fixture and media assets.

## 2. Preconditions / Environment

| Precondition | Result | Evidence |
|---|---:|---|
| Linked DB migration status checked read-only | PASS | `/Users/sethogieva/bin/supabase migration list --linked` shows `20260515000002` and `20260515000003` on both Local and Remote. |
| ORCH-0758A storage migration remote-applied | PASS | `20260515000002 | 20260515000002`; migration creates public `event_covers` bucket and storage policies (`supabase/migrations/20260515000002_orch_0758a_event_cover_storage.sql:4-97`). |
| ORCH-0759 later migration state noted separately | PASS | `20260515000003 | 20260515000003`; applied too, but not treated as ORCH-0758A runtime proof. |
| Native simulator available | PARTIAL | `xcrun simctl list devices booted` shows booted iOS 26.4 simulators; process list shows `minglabusiness.app/minglabusiness` running. |
| Installed app identity | PASS | `xcrun simctl listapps ...` shows bundle `com.sethogieva.minglabusiness`; `Info.plist` shows `CFBundleDisplayName = mingla-business`. |
| Native/dev-client with `expo-video` | PARTIAL | `mingla-business/package.json` has `expo-video ~3.0.16`; `app.config.ts` includes `expo-video`; installed app data contains `expo-dev-launcher-installation-id.txt`. I could not reach a video surface to prove runtime playback. |
| Authenticated business fixture | BLOCKED | Screenshot `/tmp/mingla-business-runtime.png` shows app at sign-in screen with Apple/Google/Email options; no safe credentials or prepared fixture were available in this tester pass. |

## 3. Runtime Test Matrix Results

| Runtime check | Result | Evidence / blocker |
|---|---:|---|
| Upload supported JPEG/PNG/WebP cover | UNVERIFIED | Blocked at unauthenticated sign-in screen. |
| Upload supported GIF cover | UNVERIFIED | Blocked at unauthenticated sign-in screen. |
| Upload supported MP4 video <= 15s | UNVERIFIED | Blocked at unauthenticated sign-in screen. |
| Upload supported WebM video <= 15s | UNVERIFIED | Blocked at unauthenticated sign-in screen and no WebM fixture confirmed. |
| Remove uploaded cover and verify hue fallback | UNVERIFIED | Blocked at unauthenticated sign-in screen. |
| Unsupported file rejection | UNVERIFIED | Blocked at unauthenticated sign-in screen. Static retest previously verified validation path. |
| Oversize file rejection | UNVERIFIED | No safe fixture/runtime access. Static rule remains `EVENT_COVER_MAX_BYTES = 30 * 1024 * 1024`. |
| Over-duration video rejection | UNVERIFIED runtime | Static test still passes via `eventCoverMediaService.test`; runtime picker path not reached. |
| Missing-duration video rejection | UNVERIFIED runtime | Static test still passes via `eventCoverMediaService.test`; runtime fixture not available. |
| Creator preview before publish | UNVERIFIED | Blocked at unauthenticated sign-in screen. |
| Published event preserves `coverMediaUrl/type` into local `LiveEvent` | UNVERIFIED runtime | Static mapper/lifecycle guards pass; runtime publish not exercised. |
| Server event row has canonical `events.cover_media_url/type` | UNVERIFIED runtime | DB migration is applied; no disposable event was created/updated in this pass. |
| Valid media-only published edit writes server/local media | UNVERIFIED | Blocked at unauthenticated sign-in screen. |
| Rejected combined media + sold-ticket unsafe edit writes no server/local media | UNVERIFIED runtime | Static validator/lifecycle tests pass; runtime sold-ticket fixture unavailable. |
| Event/public/checkout/order/home/list/preview/brand event card rendering | UNVERIFIED runtime | Blocked at unauthenticated sign-in screen. |

## 4. Reduced-Motion Video Results

UNVERIFIED runtime.

Static evidence remains the same as the retest:

- `EventCoverMedia` routes `presentation === "video" || presentation === "video_still"` through `EventCoverVideo`, not React Native `Image` (`mingla-business/src/components/ui/EventCoverMedia.tsx:136-143`).
- Image rendering is only used for image/GIF presentations (`mingla-business/src/components/ui/EventCoverMedia.tsx:144-150`).
- `video_still` passes `autoplay=false` and `loop=false` (`mingla-business/src/components/ui/EventCoverMedia.tsx:136-142`).

Runtime proof is still missing because no authenticated video-cover surface was reachable. The prior caution remains relevant: `reduceMotion` initializes as `false` and updates asynchronously (`mingla-business/src/components/ui/EventCoverMedia.tsx:83-98`), while `EventCoverVideo` only calls `play()` during `useVideoPlayer` setup and does not explicitly pause on later `autoplay=false` prop changes (`mingla-business/src/components/ui/EventCoverMedia.tsx:33-65`). This must be verified on device/simulator with a mounted video cover.

## 5. Command Evidence

Commands run from `mingla-business/` unless noted:

```bash
npm run test:orch-0758a
```

Result: PASS. 6 suites passed, 29 tests passed. Watchman emitted a recrawl warning, but Jest exited 0.

```bash
npm run test:orch-0756b
```

Result: PASS. 2 suites passed, 18 tests passed. Watchman emitted the same recrawl warning, but Jest exited 0.

```bash
npx tsc --noEmit
```

Result: PASS. Exit 0.

```bash
npx eslint src/store/liveEventStore.ts src/utils/publishedEventEditGuards.ts src/utils/draftEventPristine.ts src/utils/__tests__/publishedEventEditGuards.test.ts src/utils/__tests__/draftEventPristine.test.ts src/utils/eventCoverMediaRules.ts src/services/__tests__/eventCoverMediaService.test.ts src/components/ui/EventCoverMedia.tsx src/components/event/EditPublishedScreen.tsx src/components/event/EventCreatorWizard.tsx src/utils/__tests__/serverDraftLifecycleGuards.test.ts
```

Result: PASS. Exit 0.

```bash
/Users/sethogieva/bin/supabase migration list --linked
```

Result: PASS as read-only evidence. `20260515000002` and `20260515000003` are present on both Local and Remote.

```bash
xcrun simctl list devices booted
```

Result: PASS. Booted iOS 26.4 simulators include `iPhone 17 Pro` and `iPhone 17`.

```bash
xcrun simctl io F7ECAC25-2A98-4002-AD17-85AED17AB752 screenshot /tmp/mingla-business-runtime.png
```

Result: PASS. Screenshot showed Mingla Business sign-in screen; runtime QA blocked before authenticated event/media flows.

## 6. Migration / Native Build Evidence

DB state:

```text
20260515000001 | 20260515000001
20260515000002 | 20260515000002
20260515000003 | 20260515000003
```

Migration `20260515000002_orch_0758a_event_cover_storage.sql` creates:

- `event_covers` public storage bucket with 30 MB limit and allowed MIME types for JPEG/PNG/WebP/GIF/MP4/WebM (`supabase/migrations/20260515000002_orch_0758a_event_cover_storage.sql:4-23`).
- Public read policy for the bucket (`supabase/migrations/20260515000002_orch_0758a_event_cover_storage.sql:30-33`).
- Event-manager insert/update/delete policies scoped by `brandId/eventId` path and effective brand rank (`supabase/migrations/20260515000002_orch_0758a_event_cover_storage.sql:35-97`).

Native state:

- The business app is installed as `com.sethogieva.minglabusiness`.
- A simulator app process is running.
- App data contains `expo-dev-launcher-installation-id.txt`, consistent with a dev-client style runtime.
- The current app screen is unauthenticated sign-in, so no media runtime path was reached.

## 7. Findings

### BLOCKER: No authenticated disposable business fixture was available for runtime media QA

Severity: Evidence blocker, not product-code failure.

The runtime prompt requires upload, publish, edit, public/ticket rendering, and reduced-motion tests on real app surfaces. The app is available in simulator but is at the unauthenticated sign-in screen. Tester did not have a safe account, brand, disposable event, or media fixture set to use.

Required to unblock:

- Provide or prepare a safe business test account/brand fixture.
- Ensure the simulator/dev client is logged in to that fixture.
- Provide safe media fixtures: image, GIF, <=15s MP4, over-15s video, unsupported file, and optionally missing-duration video/WebM.
- Re-dispatch this same runtime tester prompt.

## 8. Recommendation to Orchestrator

Do not close ORCH-0758A.

Mark the DB push gate as cleared and keep ORCH-0758A in `BLOCKED/UNVERIFIED` runtime status until an authenticated native fixture is available. No implementor rework is indicated by this pass; the remaining blocker is runtime access/evidence.
