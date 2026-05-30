/**
 * ORCH-1001 [Business web white-page crash] — native-only video trim editor.
 *
 * `react-native-video-trim` ships a TurboModule whose module body runs
 * `TurboModuleRegistry.getEnforcing('VideoTrim')` at import-eval time. On web
 * there is no native runtime, so that call throws synchronously and takes the
 * ENTIRE bundle down before React can mount (blank #root → white page).
 *
 * The fix is a Metro platform split: this `.native.ts` holds the real import
 * and is bundled ONLY for iOS/Android; the `.web.ts` sibling is a no-op stub,
 * so `react-native-video-trim` is never present in the web export. Callers
 * gate on `Platform.OS !== "web"` and only invoke this on native — web uploads
 * the raw clip and the server (Cloudinary) trims to <=29s.
 *
 * Behaviour is byte-for-byte the same as the prior inline implementation that
 * lived in CoverPicker.tsx; only the import boundary changed.
 */
import NativeVideoTrim, {
  showEditor,
  type Spec as VideoTrimSpec,
} from "react-native-video-trim";
import type { VideoTrimFinishPayload } from "./coverPickerVideoTrimUpload";

type VideoTrimSubscription = { remove: () => void };

export const trimVideoWithDedicatedEditor = (
  uri: string,
  maxDurationMs: number,
): Promise<VideoTrimFinishPayload | null> =>
  new Promise((resolve, reject) => {
    const videoTrim = NativeVideoTrim as VideoTrimSpec;
    const subscriptions: VideoTrimSubscription[] = [];
    let settled = false;
    const settle = (handler: () => void): void => {
      if (settled) return;
      settled = true;
      subscriptions.forEach((subscription) => subscription.remove());
      handler();
    };

    subscriptions.push(
      videoTrim.onFinishTrimming((payload: VideoTrimFinishPayload) => {
        settle(() => resolve(payload));
      }) as VideoTrimSubscription,
      videoTrim.onCancelTrimming(() => {
        settle(() => resolve(null));
      }) as VideoTrimSubscription,
      videoTrim.onCancel(() => {
        settle(() => resolve(null));
      }) as VideoTrimSubscription,
      videoTrim.onError(({ message, errorCode }) => {
        settle(() =>
          reject(new Error(`Video trim failed (${errorCode || "unknown"}): ${message}`)),
        );
      }) as VideoTrimSubscription,
    );

    try {
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
