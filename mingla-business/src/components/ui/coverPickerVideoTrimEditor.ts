/**
 * ORCH-1001 [Business web white-page crash] — native-only video trim editor.
 *
 * `react-native-video-trim` ships a TurboModule whose module body runs
 * `TurboModuleRegistry.getEnforcing('VideoTrim')` at import-eval time. On web
 * there is no native runtime, so that call throws synchronously and takes the
 * ENTIRE bundle down before React can mount (blank #root → white page).
 *
 * The web fix is a Metro platform split: this base native file is replaced by
 * the `.web.ts` sibling on web, so `react-native-video-trim` is never present
 * in the web export. Native also loads the package lazily inside trim
 * invocation, because stale dev builds can be missing the VideoTrim TurboModule;
 * that should reject the trim action, not crash the whole app while the bundle
 * loads.
 *
 * When the native module is available, behaviour matches the prior inline
 * implementation that lived in CoverPicker.tsx.
 */
// ORCH-0978 C12 / ORCH-1001: a TYPE-ONLY import keeps the native trim package
// statically discoverable to the invariant gate, while staying fully erased at
// compile time — so it never triggers the TurboModule import-eval that crashes
// the web bundle. The runtime module is still loaded lazily via require() below.
import type ReactNativeVideoTrim from "react-native-video-trim";

import { accent, colors } from "../../constants/designSystem";

import type { VideoTrimFinishPayload } from "./coverPickerVideoTrimUpload";

type _NativeVideoTrimDefault = typeof ReactNativeVideoTrim;

type VideoTrimSubscription = { remove: () => void };

type VideoTrimSpec = {
  onCancel: (callback: () => void) => VideoTrimSubscription;
  onCancelTrimming: (callback: () => void) => VideoTrimSubscription;
  onError: (
    callback: (error: { errorCode?: string | number; message?: string }) => void,
  ) => VideoTrimSubscription;
  onFinishTrimming: (
    callback: (payload: VideoTrimFinishPayload) => void,
  ) => VideoTrimSubscription;
  // issue #1338 — `react-native-video-trim@8.1.0` exposes an `onShow` event
  // (NativeVideoTrim.d.ts:363 `readonly onShow: EventEmitter<void>`) that fires
  // when the trim editor actually presents. Optional here so a stale dev build
  // that predates the event degrades gracefully (watchdog simply stays unarmed).
  onShow?: (callback: () => void) => VideoTrimSubscription;
};

// issue #2968 — every field below is a real `EditorConfig` key on
// `react-native-video-trim@8.1.0`
// (node_modules/react-native-video-trim/lib/typescript/src/NativeVideoTrim.d.ts).
// The colour fields are typed `string` on purpose: the library's JS wrapper
// (`showEditor` in lib/module/index.js) runs `processColor()` on them itself, so
// the public signature takes CSS colour strings, not the numeric processColor
// values the TurboModule spec declares.
type ShowEditorOptions = {
  // Pinned by the orch-0978 C1 strict-grep gate and the #1350 suites — these
  // four are load-bearing and stay REQUIRED.
  cancelButtonText: string;
  enablePreciseTrimming: boolean;
  maxDuration: number;
  saveButtonText: string;
  // issue #2968 presentation/copy fields. Optional, mirroring the library's own
  // `Partial<Omit<EditorConfig, ...>>` signature (index.d.ts:11-17) — the native
  // side falls back to its defaults for anything omitted. Deliberately NOT made
  // required: a required field turns a deleted affordance into a COMPILE error,
  // which would mask the runtime regression test behind a type error instead of
  // letting the assertion that actually describes the user-visible behaviour be
  // the thing that fails. Enforcement lives in
  // `__tests__/coverPickerVideoTrimEditor.windowAffordance.issue2968.test.ts`,
  // which reads the real options object handed to the native `showEditor`.
  cancelDialogCancelText?: string;
  cancelDialogConfirmText?: string;
  cancelDialogMessage?: string;
  cancelDialogTitle?: string;
  cancelTrimmingDialogCancelText?: string;
  cancelTrimmingDialogConfirmText?: string;
  cancelTrimmingDialogMessage?: string;
  cancelTrimmingDialogTitle?: string;
  enableHapticFeedback?: boolean;
  handleIconColor?: string;
  headerText?: string;
  headerTextColor?: string;
  headerTextSize?: number;
  saveDialogCancelText?: string;
  saveDialogConfirmText?: string;
  saveDialogMessage?: string;
  saveDialogTitle?: string;
  trimmerColor?: string;
};

// issue #2968 [trim window affordance] — the trim window IS draggable, but the
// gesture is invisible. Proven by reading the shipped native sources of
// `react-native-video-trim@8.1.0`:
//
//   iOS     VideoTrimmer.swift:470-474
//           "// Range drag: platform-default long press (0.5s hold, 10pt
//            allowable movement)" — rangeDragGestureRecognizer is a
//           UILongPressGestureRecognizer left at its DEFAULT 0.5s press
//           duration, unlike the two edge grabbers which set
//           minimumPressDuration = 0.
//   Android VideoTrimmerView.kt:247-252 — the same range drag is armed from
//           `GestureDetector.SimpleOnGestureListener.onLongPress`.
//
// So on BOTH platforms a plain swipe across the window body does nothing: the
// user must press and HOLD before sliding. The two `❮`/`❯` chevrons, meanwhile,
// respond instantly (minimumPressDuration = 0) and are the only thing on screen
// drawn as a grip — so users grab those first, hit the maxDuration clamp, feel
// nothing move, and conclude the window cannot be repositioned at all.
//
// `EditorConfig` exposes no way to draw a grip on the window body, so the header
// line is the only channel the library gives us to name the gesture. Keep it to
// ONE short line: the native header label is single-line (iOS
// VideoTrimmerViewController.swift:329 `numberOfLines = 1`) inside a horizontal
// scroll view, so anything longer is simply pushed off-screen.
const TRIM_HINT_TEXT_SIZE = 14;

const trimWindowHint = (maxDurationMs: number): string =>
  `${Math.round(maxDurationMs / 1000)}s max · press and hold the box, then slide`;

type NativeVideoTrimModule = {
  default?: VideoTrimSpec;
  showEditor?: (uri: string, options: ShowEditorOptions) => void;
};

const unavailableNativeTrimError = (cause?: unknown): Error => {
  const detail =
    cause instanceof Error ? cause.message : String(cause ?? "unknown error");
  return new Error(
    `Video trimming requires an updated Mingla Host native build with the VideoTrim module installed. ${detail}`,
  );
};

// issue #1338 — bounded watchdog for a trim editor that never presents. On iOS
// New Arch the OS silently refuses to present a 2nd native modal while the cover
// sheet modal is up (root cause proven via idevicesyslog), leaving `showEditor`
// with NO callback → the promise would hang forever and pin the picker's
// `uploading` state. 2.5s comfortably exceeds the OS present transition while
// still failing fast enough to show an actionable in-sheet error.
const PRESENTATION_WATCHDOG_MS = 2500;

const presentationFailedError = (): Error =>
  new Error("The trim screen didn't open. Try again, or pick a shorter clip.");

const loadNativeVideoTrim = (): {
  showEditor: (uri: string, options: ShowEditorOptions) => void;
  videoTrim: VideoTrimSpec;
} => {
  try {
    // Lazy by design: a stale dev build may throw TurboModuleRegistry.getEnforcing
    // here, and that must reject this action instead of crashing bundle load.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const module = require("react-native-video-trim") as NativeVideoTrimModule;
    const videoTrim = module.default;
    const showEditor = module.showEditor;
    if (
      !videoTrim ||
      typeof videoTrim.onFinishTrimming !== "function" ||
      typeof videoTrim.onCancelTrimming !== "function" ||
      typeof videoTrim.onCancel !== "function" ||
      typeof videoTrim.onError !== "function" ||
      typeof showEditor !== "function"
    ) {
      throw new Error("react-native-video-trim loaded without the expected API.");
    }
    return { showEditor, videoTrim };
  } catch (error) {
    throw unavailableNativeTrimError(error);
  }
};

export const trimVideoWithDedicatedEditor = (
  uri: string,
  maxDurationMs: number,
): Promise<VideoTrimFinishPayload | null> =>
  new Promise((resolve, reject) => {
    let nativeVideoTrim: ReturnType<typeof loadNativeVideoTrim>;
    try {
      nativeVideoTrim = loadNativeVideoTrim();
    } catch (error) {
      reject(error);
      return;
    }

    const { showEditor, videoTrim } = nativeVideoTrim;
    const subscriptions: VideoTrimSubscription[] = [];
    // issue #1338 — presentation state + watchdog. `presented` flips true the
    // instant the native editor is visible (onShow); the watchdog only fires
    // when the editor NEVER presents, so a legitimate (arbitrarily long) trim
    // session is never interrupted.
    let presented = false;
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    let settled = false;
    const settle = (handler: () => void): void => {
      if (settled) return;
      settled = true;
      // issue #1338 — a normal outcome (finish/cancel/error) must cancel the
      // watchdog so it can never fire a late spurious reject.
      if (watchdog !== null) {
        clearTimeout(watchdog);
        watchdog = null;
      }
      subscriptions.forEach((subscription) => subscription.remove());
      handler();
    };

    try {
      subscriptions.push(
        videoTrim.onFinishTrimming((payload: VideoTrimFinishPayload) => {
          settle(() => resolve(payload));
        }),
        videoTrim.onCancelTrimming(() => {
          settle(() => resolve(null));
        }),
        videoTrim.onCancel(() => {
          settle(() => resolve(null));
        }),
        videoTrim.onError(({ message, errorCode }) => {
          settle(() =>
            reject(
              new Error(
                `Video trim failed (${errorCode || "unknown"}): ${message ?? "Unknown error"}`,
              ),
            ),
          );
        }),
      );
      // issue #1338 — arm the watchdog ONLY when the build exposes `onShow`.
      // With onShow we can safely disarm the timer once the editor is confirmed
      // visible; without it (stale build), a naive post-showEditor timeout would
      // abort a legitimate trim session, so we fall back to present-after-
      // dismissal (CoverPicker.tsx) alone and leave the watchdog unarmed.
      if (typeof videoTrim.onShow === "function") {
        subscriptions.push(
          videoTrim.onShow(() => {
            presented = true;
            if (watchdog !== null) {
              clearTimeout(watchdog);
              watchdog = null;
            }
          }),
        );
        watchdog = setTimeout(() => {
          if (!presented) {
            settle(() => reject(presentationFailedError()));
          }
        }, PRESENTATION_WATCHDOG_MS);
      }
      // react-native-video-trim docs:
      // https://github.com/maitrungduc1410/react-native-video-trim
      showEditor(uri, {
        maxDuration: maxDurationMs,
        saveButtonText: "Use clip",
        cancelButtonText: "Back",
        // issue #1350 — keyframe stream-copy (-c copy), NOT a frame-accurate
        // re-encode. `true` forces a full h264 re-encode of the whole trimmed
        // span (slow on iOS, and the source of the Android h264_mediacodec
        // "rc 1" export failure). A cover never needs frame-accurate cut points
        // and Bunny re-compresses server-side (I-966), so the re-encode is
        // wasted work. `false` is the library default.
        //
        // issue #2968 CONFIRMED NOT THE CAUSE of the "can't move the window"
        // report: driving a 45s clip (keyframes every 5s) on iOS 26.5 moved the
        // window to 00:21.433 → 00:36.433 — 21.433 is not a keyframe multiple,
        // so stream-copy does NOT coarsen the handle positions. This stays
        // false.
        enablePreciseTrimming: false,
        // issue #2968 — name the hidden press-and-hold gesture (see
        // trimWindowHint above) and the duration cap in the one header line the
        // library gives us. Derived from maxDurationMs so it can never drift
        // from the cap actually enforced by the editor.
        headerText: trimWindowHint(maxDurationMs),
        headerTextSize: TRIM_HINT_TEXT_SIZE,
        headerTextColor: colors.text.inverse,
        // issue #2968 — `trimmerColor` paints the whole window frame (iOS
        // VideoTrimmerThumb.updateTrimmerColor: leading + trailing + top +
        // bottom). Painting it Mingla warm makes the window read as OUR
        // interactive control instead of the library's default #f1d247 chrome,
        // and gives the top/bottom bars — the press-and-hold surface — the same
        // brand weight as the chevrons. `handleIconColor` tints only the two
        // chevron glyphs; Mingla ink on warm keeps them legible.
        trimmerColor: accent.warm,
        handleIconColor: colors.text.primary,
        // issue #2968 — feedback at the cap. Both platforms fire a HEAVY impact
        // haptic on the clamp transition (iOS VideoTrimmer.swift:1019-1022 /
        // 1078-1081 `impactFeedbackGenerator?.impactOccurred()`), which is the
        // only "the handle will not go further" signal the library emits. It is
        // the library default today; pinned explicitly here so a library default
        // change cannot silently take the cap feedback away.
        enableHapticFeedback: true,
        // issue #2968 — the editor's dialogs shipped the library's untranslated
        // defaults ("Confirmation!" / "Are you sure want to save?" / Close /
        // Proceed — lib/module/index.js:79-100), which are ungrammatical and
        // read as a bug. Mingla voice: say what happens next, name the action on
        // the button, never blame the user.
        saveDialogTitle: "Use this clip?",
        saveDialogMessage:
          "We'll cut your video down to the part inside the box and use it as your cover.",
        saveDialogCancelText: "Keep trimming",
        saveDialogConfirmText: "Use clip",
        cancelDialogTitle: "Leave without a cover?",
        cancelDialogMessage:
          "Your trim won't be saved and no video will be added.",
        cancelDialogCancelText: "Keep trimming",
        cancelDialogConfirmText: "Discard",
        cancelTrimmingDialogTitle: "Stop trimming?",
        cancelTrimmingDialogMessage:
          "We'll stop here and come back with no cover video added.",
        cancelTrimmingDialogCancelText: "Keep going",
        cancelTrimmingDialogConfirmText: "Stop",
      });
    } catch (error) {
      settle(() => reject(error));
    }
  });
