# Retest Report: ORCH-0763D iOS Runtime Share Links

> Date: 2026-05-08
> Mode: TESTER / RUNTIME / RIGHT-SIMULATOR
> Device: `iPhone 17 Pro (17091E60-C3B6-4167-980D-60C348E177F6)`
> App: `com.sethogieva.minglabusiness`
> Verdict: FAIL

## Layman Summary

The rebuilt app is now using the right public domain in the main business-app share flow.

The old `expo-clipboard` native-module problem is fixed on this simulator build: `Copy link` inside the business app now writes the correct `business.usemingla.com` event URL to the iOS pasteboard.

Two real runtime problems remain:

- The public webpage share flow opens the iOS share sheet, but the native sheet's `Copy` action copied only the event text, not the URL.
- The draft delete confirmation appears to send a network request that gets `403`, then leaves the user stuck on the confirmation modal with no visible error.

## Current Good Behavior

| Check | Result | Evidence |
|---|---|---|
| Correct simulator used | PASS | All commands targeted `17091E60-C3B6-4167-980D-60C348E177F6`, the signed-in simulator on the right. |
| Native clipboard installed in rebuilt app | PASS | Compiled app binary contains `ExpoClipboard` / `ClipboardModule`; app no longer shows the missing native module error. |
| Business app event share modal URL | PASS | Existing event `Test event` showed `https://business.usemingla.com/e/leggothis/test-event`. |
| Business app `Copy link` | PASS | Pasteboard changed from sentinel to `https://business.usemingla.com/e/leggothis/test-event`. |
| Business app `Share via...` | PASS | iOS share sheet preview showed `business.usemingla.com`; native Copy produced text plus URL. |
| Public URL reachable | PASS | `curl -I -L https://business.usemingla.com/e/leggothis/test-event` returned `HTTP/2 200`. |
| Public URL renders in Safari | PASS | Safari rendered the public event page on `business.usemingla.com` with event title, brand, venue, description, and free ticket card. |
| Public page modal `Copy link` | PASS | Pasteboard changed to `https://business.usemingla.com/e/leggothis/test-event`. |

## Findings

### P1-001: Public webpage native share sheet Copy omits the URL

- **Steps:** Opened the public event page in Safari, tapped the page share button, tapped `Share via...`, then used iOS native share sheet `Copy`.
- **Expected:** Clipboard contains the SEO public event URL.
- **Actual:** Clipboard contained only `Test Event `.
- **Evidence:** Native share preview showed `business.usemingla.com`, but `xcrun simctl pbpaste` returned only the event text after native Copy.
- **Impact:** A guest or organizer can use the share sheet and end up sharing text without a usable link.

### P1-002: Draft delete confirmation fails with a silent 403

- **Steps:** Opened the QA-created draft, chose `Delete draft`, confirmed `Delete draft`.
- **Expected:** Draft is removed and the modal closes.
- **Actual:** Modal stayed open; draft remained visible.
- **Evidence:** Device log during the tap shows the app made requests and received `status 403`; the UI did not surface the failure.
- **Impact:** Organizers can get stuck with undeletable drafts, and QA cannot clean test data through the UI.

### P2-001: Event creation automation remains brittle

- **Steps:** Attempted to create a new free-ticket event on the signed-in simulator.
- **Actual:** Maestro focus landed in the wrong input and appended description text into the event name.
- **Impact:** This blocked a clean publish/delete end-to-end test run from automation. The corrupted draft is the draft that exposed P1-002 above.
- **Note:** This is not yet proven as a normal-user bug, but the wizard needs stronger accessibility labels/test IDs for reliable device QA.

## Screenshots

- `/tmp/mingla-right-resume.png` - signed-in right simulator.
- `/tmp/mingla-public-link-safari.png` - public URL rendered in Safari.
- `/tmp/mingla-public-native-after-copy.png` - public native share-sheet copy result path.
- `/tmp/mingla-drafts-tab.png` - QA draft visible.
- `/tmp/mingla-delete-draft-confirm.png` - delete confirmation modal.
- `/tmp/mingla-after-long-delete.png` - confirmation still stuck after direct/long press attempts.

## Verdict

FAIL for release. The core business-app share flow is much healthier now, but public-page native sharing and draft deletion still need implementation work before this can be called closed.
