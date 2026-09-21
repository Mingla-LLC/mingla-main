/**
 * coverPickerVideoRecheck — issue #3485 ["Processing video…" never settles].
 *
 * Filmed on a Release build (2026-09-20). Server-side the job was finished —
 * `event_cover_video_jobs.status='applied'`, `events.cover_media_type='video'` —
 * and the foregrounded app still rendered "Processing video…" with an elapsed
 * timer at 4758m, over a thumbnail that was already the finished cover. Closing
 * and reopening the sheet did not clear it; only a full app restart did.
 *
 * WHY it could not clear itself. The sheet learns the truth in exactly three
 * ways: `useEventCoverVideoUpload`'s `resume()` when the picker mounts, its live
 * `watch()` poll, and the `checkNow` read behind the "Check now" button — which
 * `CoverPicker` renders ONLY in the `detached` phase. There was no AppState
 * listener anywhere in the cover flow. So a `processing` card whose poll died
 * while the app was suspended had no route back to the server at all, and the
 * elapsed reading went on counting real wall-clock against a finished job.
 *
 * The missing signal is the app coming back. This module is the RULE for when
 * asking again is worth it; `CoverPicker` owns the listener and calls the hook's
 * existing `checkNow` (the same read the button performs, including the apply
 * step for a job that came back `ready`).
 *
 * Deliberately NOT a poller. One read per foreground, one when the sheet lands
 * on a server-owned phase, and never:
 *   - when a read is already in flight,
 *   - twice inside the same short window,
 *   - in a phase where there is nothing to settle or a LOCAL operation is
 *     mid-flight that a settle would race.
 *
 * Lives beside CoverPicker rather than inside it for the reason
 * `coverPickerGalleryGate.ts`, `coverPickerElapsed.ts` and
 * `coverPickerVideoPickGate.ts` do: CoverPicker.tsx pulls in expo-video /
 * expo-image-picker / react-native-video-trim and cannot be mounted under jest,
 * so a rule that must be tested for real is split out. PURE by contract — no
 * React, no React Native, no imports.
 */

/**
 * The phases where asking the server again can only tell us something true.
 *
 * `processing` is the phase the 4758m card was stuck in: the provider owns the
 * outcome and nothing local is in flight. `detached` is the phase we enter when
 * we deliberately stopped watching (the watch deadline, or a transient status
 * failure); its "Check now" button already performs exactly this read, so coming
 * back to the app is the same question asked without a tap.
 *
 * Everything else is excluded on purpose:
 *   - `idle` / `applied` / `error` — terminal, nothing to settle.
 *   - `picking` / `preparing` / `validating` / `compressing` / `intent_pending` —
 *     no server job exists yet, and a read here could only find a PREVIOUS job.
 *   - `uploading` / `ack_pending` / `applying` — a local operation is mid-flight
 *     and a settle must not race it.
 *   - `reattaching` — `resume()` owns that phase, with its own 12s deadline.
 *   - `ready` — the "Retry saving" control owns it.
 */
export const RECHECKABLE_VIDEO_PHASES: readonly string[] = ["processing", "detached"];

/**
 * How long one read holds the window shut. A foreground can arrive twice in a
 * moment (an OS alert dismissing over the app, a share sheet closing, a fast
 * app-switch), and the phase can flap; the card is not so urgent that either
 * deserves its own round trip.
 */
export const VIDEO_RECHECK_MIN_INTERVAL_MS = 5_000;

export type VideoRecheckState = {
  /** The video upload hook's current stage phase. */
  phase: string;
  /** A re-check is already awaiting the server. */
  checkInFlight: boolean;
  /**
   * Milliseconds since the last re-check STARTED, or null when none has run for
   * this picker yet (a freshly opened sheet always gets its read).
   */
  msSinceLastCheck: number | null;
};

/** True iff the cover card should ask the server for the job's truth now. */
export const shouldRecheckCoverVideo = ({
  phase,
  checkInFlight,
  msSinceLastCheck,
}: VideoRecheckState): boolean => {
  if (!RECHECKABLE_VIDEO_PHASES.includes(phase)) return false;
  if (checkInFlight) return false;
  if (msSinceLastCheck !== null && msSinceLastCheck < VIDEO_RECHECK_MIN_INTERVAL_MS) return false;
  return true;
};
