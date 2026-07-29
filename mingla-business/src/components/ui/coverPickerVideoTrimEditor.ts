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

type ShowEditorOptions = {
  cancelButtonText: string;
  enablePreciseTrimming: boolean;
  maxDuration: number;
  saveButtonText: string;
};

type NativeVideoTrimModule = {
  default?: VideoTrimSpec;
  showEditor?: (uri: string, options: ShowEditorOptions) => void;
};

const unavailableNativeTrimError = (cause?: unknown): Error => {
  const detail =
    cause instanceof Error ? cause.message : String(cause ?? "unknown error");
  return new Error(
    `Video trimming requires an updated Mingla Business native build with the VideoTrim module installed. ${detail}`,
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
        enablePreciseTrimming: true,
      });
    } catch (error) {
      settle(() => reject(error));
    }
  });
