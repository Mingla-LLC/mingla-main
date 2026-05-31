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
import type { VideoTrimFinishPayload } from "./coverPickerVideoTrimUpload";

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
    let settled = false;
    const settle = (handler: () => void): void => {
      if (settled) return;
      settled = true;
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
