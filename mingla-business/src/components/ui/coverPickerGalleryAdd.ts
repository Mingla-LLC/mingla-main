/**
 * coverPickerGalleryAdd — issue #3318 [a picked Additional photo is never lost].
 *
 * On 2026-09-14 an organiser picked a photo under Additional photos. Its upload
 * never reached the server; about 60 s later the add's catch branch showed
 * "Cover upload failed. Try again." and the picked photo was gone: no tile, no
 * retry, nothing reported. The add only put a photo into the gallery AFTER a
 * successful upload, so a failure had nowhere to keep it.
 *
 * This module is the add pipeline, split out of CoverPicker the way
 * `coverPickerGalleryGate.ts` is: CoverPicker pulls in expo-video,
 * expo-image-picker and react-native-video-trim and cannot mount under jest,
 * so logic that must be tested for real lives here, with no React Native import.
 *
 *   - `createGalleryAddController` owns the photos that are uploading or have
 *     failed. A photo is a tile from the moment it is picked (its local file is
 *     the preview). A failure keeps the tile, with Retry (the SAME file, no
 *     re-pick) and Remove. One upload runs at a time; every attempt carries a
 *     token so a result that arrives after its attempt timed out, or after the
 *     tile was removed, is ignored.
 *   - Those tiles live HERE, not in the picker's `gallery` state, so a host
 *     re-seeding the gallery cannot wipe a photo that has not saved yet.
 *   - `commitGalleryWithCover` / `emitCoverWithGallery` are the picker's two
 *     emit paths. Both read the CURRENT refs at the moment they emit, so a cover
 *     video that becomes ready while a photo uploads is carried by the photo's
 *     commit, and the photo is carried by the video's emit.
 *   - `galleryPhotoErrorMessage` is photo copy. It never says "cover" and never
 *     passes a service's own message through (`BrandCoverError` says "cover").
 */

import type { OfferingGalleryImage } from "@mingla/offering-rendering";

import {
  STORAGE_UPLOAD_MAX_TIMEOUT_MS,
  storageUploadTimeoutMs,
  type CoverUploadStage,
} from "../../services/storageUploadWithRetry";

// ----- Stages, reasons, copy -------------------------------------------------

/** `pick` is everything before a file is in hand; the rest are the upload's own. */
export type GalleryAddStage = "pick" | CoverUploadStage;

export type GalleryAddFailureReason =
  | "permission_denied"
  | "unsupported_type"
  | "file_too_large"
  | "missing_server_row"
  | "unreadable"
  | "timeout"
  | "network"
  | "server_rejected"
  | "display_failed"
  | "deadline"
  | "upload_failed"
  | "unknown";

/**
 * Outcomes of the organiser's own choice (a denied permission, a file type or
 * size the product does not take). Reported to product analytics, never to
 * Sentry as an error: they are answers, not faults.
 */
export const GALLERY_ADD_USER_OUTCOME_REASONS: ReadonlySet<GalleryAddFailureReason> = new Set([
  "permission_denied",
  "unsupported_type",
  "file_too_large",
]);

/** Raised by the controller when a whole add outlives its deadline. */
export class GalleryAddDeadlineError extends Error {
  readonly deadlineMs: number;

  constructor(deadlineMs: number) {
    super(`The photo add did not finish within ${Math.round(deadlineMs / 1000)} s.`);
    this.name = "GalleryAddDeadlineError";
    this.deadlineMs = deadlineMs;
  }
}

type NamedFailure = { name?: unknown; code?: unknown; cause?: unknown; retryable?: unknown; timedOut?: unknown };

const asFailure = (error: unknown): NamedFailure | null =>
  error !== null && typeof error === "object" ? (error as NamedFailure) : null;

/** The storage-layer failure a service error was raised from, if any. */
const storageCause = (error: NamedFailure): NamedFailure | null => {
  if (error.name === "StorageUploadError" || error.name === "StorageUploadTimeoutError") return error;
  const cause = asFailure(error.cause);
  if (cause !== null && (cause.name === "StorageUploadError" || cause.name === "StorageUploadTimeoutError")) {
    return cause;
  }
  return null;
};

/**
 * Classifies a failure without `instanceof`, so a duplicated module copy or a
 * plain object thrown across a boundary still classifies the same way.
 */
export const galleryAddFailureReason = (error: unknown): GalleryAddFailureReason => {
  const failure = asFailure(error);
  if (failure === null) return "unknown";
  if (failure.name === "GalleryAddDeadlineError") return "deadline";
  const storage = storageCause(failure);
  if (storage !== null) {
    if (storage.name === "StorageUploadTimeoutError" || storage.timedOut === true) return "timeout";
    return storage.retryable === true ? "network" : "server_rejected";
  }
  if (failure.name === "EventCoverMediaError" || failure.name === "BrandCoverError") {
    switch (failure.code) {
      case "permission_denied":
        return "permission_denied";
      case "unsupported_type":
        return "unsupported_type";
      case "file_too_large":
        return "file_too_large";
      case "missing_server_event_id":
        return "missing_server_row";
      case "empty_local_file":
        return "unreadable";
      case "display_failed":
        return "display_failed";
      case "upload_failed":
      case "persist_mismatch":
        return "upload_failed";
      default:
        return "unknown";
    }
  }
  return "unknown";
};

export type GalleryPhotoCopyOptions = {
  /** The target's photo size limit, for the too-large sentence. */
  maxMegabytes?: number | null;
};

/**
 * The sentence shown for a failed photo. Photo-worded in every branch; each one
 * keeps a word the cover sheet's toast reads as an error ("couldn't", "could
 * not", "too large", "try again", "permission"), so the toast stays red.
 */
export const galleryPhotoErrorMessage = (
  error: unknown,
  stage: GalleryAddStage,
  { maxMegabytes = null }: GalleryPhotoCopyOptions = {},
): string => {
  const reason = galleryAddFailureReason(error);
  switch (reason) {
    case "permission_denied":
      return "Photo library permission is needed to add a photo.";
    case "unsupported_type":
      return "Couldn't add that file. Choose a JPEG, PNG, WebP, or GIF photo.";
    case "file_too_large":
      return typeof maxMegabytes === "number" && maxMegabytes > 0
        ? `That photo is too large. Choose one under ${maxMegabytes} MB.`
        : "That photo is too large. Choose a smaller one.";
    case "missing_server_row":
      return "This draft is still saving. Try again in a moment.";
    case "timeout":
    case "network":
    case "deadline":
      return "Couldn't upload this photo. Check your connection, then tap Retry.";
    case "display_failed":
      return "Uploaded, but this photo could not be displayed. Tap Retry.";
    case "unreadable":
      return "Couldn't read this photo. Tap Retry, or choose another.";
    default:
      break;
  }
  if (stage === "pick") return "Couldn't open that photo. Try again.";
  if (stage === "read") return "Couldn't read this photo. Tap Retry, or choose another.";
  if (stage === "verify") return "Uploaded, but this photo could not be displayed. Tap Retry.";
  if (stage === "upload") return "Couldn't upload this photo. Tap Retry.";
  return "Couldn't add this photo. Tap Retry.";
};

// ----- The controller --------------------------------------------------------

/** The picked file, kept so Retry uploads the same bytes without a re-pick. */
export type GalleryAddAsset = {
  uri: string;
  mimeType?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
  type?: string | null;
  /** Native pickers report these; a wide GIF's poster is resized from them. */
  width?: number | null;
  height?: number | null;
  /**
   * Frees the picked file (a web object URL). Called once, when the photo
   * leaves the controller: saved, removed, or failed and then unmounted. Never
   * while its tile can still preview it or Retry can still read it.
   */
  release?: () => void;
};

/** A photo that is uploading or has failed. Rendered after the saved photos. */
export type GalleryPhotoTile = {
  key: string;
  /** The local file — the tile's preview until the upload saves. */
  localUri: string;
  status: "uploading" | "failed";
  /** Photo copy for a failed tile; null while uploading. */
  message: string | null;
};

export type GalleryAddFailure = {
  stage: GalleryAddStage;
  reason: GalleryAddFailureReason;
  /** A cover video job was in flight when this photo failed. */
  videoJobActive: boolean;
  /** 1 for the first try of this photo, 2 for its first Retry, and so on. */
  attempt: number;
  error: unknown;
};

type Timers = {
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

const defaultTimers: Timers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Read, verify and a GIF poster's own upload, on top of two storage attempts. */
const GALLERY_ADD_OVERHEAD_MS = 60_000;

/**
 * The whole add's deadline: two storage attempts for this file (the first plus
 * the automatic retry) and a minute for reading, verifying and a GIF poster. A
 * file of unknown size gets the storage maximum. Nothing can spin forever.
 */
export const galleryAddDeadlineMs = (fileSize: number | null | undefined): number => {
  const perAttempt = typeof fileSize === "number" && fileSize > 0
    ? storageUploadTimeoutMs(fileSize)
    : STORAGE_UPLOAD_MAX_TIMEOUT_MS;
  return 2 * perAttempt + GALLERY_ADD_OVERHEAD_MS;
};

export type GalleryAddControllerDeps = {
  /** Uploads one asset and resolves to the saved gallery item. */
  upload: (
    asset: GalleryAddAsset,
    onStage: (stage: CoverUploadStage) => void,
  ) => Promise<OfferingGalleryImage>;
  /** Appends a saved item to the CURRENT gallery and emits it to the host. */
  commit: (item: OfferingGalleryImage) => void;
  /** The tiles changed (React mirrors them into state). */
  onTilesChange: (tiles: readonly GalleryPhotoTile[]) => void;
  /** Toast. */
  notify: (message: string) => void;
  report: (failure: GalleryAddFailure) => void;
  isVideoJobActive: () => boolean;
  copy?: GalleryPhotoCopyOptions;
  deadlineMs?: (asset: GalleryAddAsset) => number;
  timers?: Timers;
  makeKey?: () => string;
};

export type GalleryAddController = {
  /** Starts uploading a picked photo. Refused while another photo uploads. */
  add: (asset: GalleryAddAsset) => Promise<void>;
  /** Uploads a failed tile's SAME file again. Refused while another photo uploads. */
  retry: (key: string) => Promise<void>;
  /** Drops a tile. A late result for it is ignored. */
  remove: (key: string) => void;
  /** A failure before a file was in hand (permission, the library picker). */
  failBeforeUpload: (error: unknown) => void;
  tiles: () => readonly GalleryPhotoTile[];
  isUploading: () => boolean;
  /** (Re)starts UI notifications (mount). Safe to call more than once. */
  attach: () => void;
  /** Stops UI notifications (unmount). An in-flight photo still saves if it lands. */
  dispose: () => void;
};

type Entry = {
  key: string;
  asset: GalleryAddAsset;
  status: "uploading" | "failed";
  message: string | null;
  stage: GalleryAddStage;
  attempts: number;
  token: number;
};

export const createGalleryAddController = (deps: GalleryAddControllerDeps): GalleryAddController => {
  const timers = deps.timers ?? defaultTimers;
  const deadlineFor = deps.deadlineMs ?? ((asset: GalleryAddAsset) => galleryAddDeadlineMs(asset.fileSize));
  let sequence = 0;
  const makeKey = deps.makeKey ?? (() => `gallery-add-${Date.now()}-${(sequence += 1)}`);
  let entries: Entry[] = [];
  let disposed = false;
  let nextToken = 1;

  const snapshot = (): GalleryPhotoTile[] =>
    entries.map(({ key, asset, status, message }) => ({ key, localUri: asset.uri, status, message }));

  const emitTiles = (): void => {
    if (!disposed) deps.onTilesChange(snapshot());
  };
  const notify = (message: string): void => {
    if (!disposed) deps.notify(message);
  };
  const isUploading = (): boolean => entries.some((entry) => entry.status === "uploading");
  const release = (entry: Entry): void => {
    try {
      entry.asset.release?.();
    } catch {
      // Freeing a preview must never break an add.
    }
  };
  const live = (entry: Entry, token: number): boolean =>
    entry.token === token && entries.includes(entry) && entry.status === "uploading";

  const fail = (entry: Entry, error: unknown): void => {
    entry.status = "failed";
    entry.token = 0;
    entry.message = galleryPhotoErrorMessage(error, entry.stage, deps.copy);
    deps.report({
      stage: entry.stage,
      reason: galleryAddFailureReason(error),
      videoJobActive: deps.isVideoJobActive(),
      attempt: entry.attempts,
      error,
    });
    notify(entry.message);
    emitTiles();
  };

  const run = async (entry: Entry): Promise<void> => {
    const token = nextToken;
    nextToken += 1;
    entry.token = token;
    entry.status = "uploading";
    entry.message = null;
    entry.stage = "read";
    entry.attempts += 1;
    emitTiles();

    // The upload races the whole-add deadline, so `add` / `retry` resolve when
    // the deadline fires even if the underlying request never settles.
    const deadlineMs = deadlineFor(entry.asset);
    const outcome = await new Promise<
      { ok: true; item: OfferingGalleryImage } | { ok: false; error: unknown }
    >((resolve) => {
      const deadline = timers.setTimeout(
        () => resolve({ ok: false, error: new GalleryAddDeadlineError(deadlineMs) }),
        deadlineMs,
      );
      let upload: Promise<OfferingGalleryImage>;
      try {
        upload = deps.upload(entry.asset, (stage) => {
          if (live(entry, token)) entry.stage = stage;
        });
      } catch (error) {
        upload = Promise.reject(error);
      }
      upload.then(
        (item) => {
          timers.clearTimeout(deadline);
          resolve({ ok: true, item });
        },
        (error: unknown) => {
          timers.clearTimeout(deadline);
          resolve({ ok: false, error });
        },
      );
    });

    if (!live(entry, token)) {
      // Removed while uploading, or failed by an earlier path: nothing to show.
      if (!entries.includes(entry)) release(entry);
      return;
    }
    if (!outcome.ok) {
      fail(entry, outcome.error);
      if (disposed) {
        entries = entries.filter((candidate) => candidate !== entry);
        release(entry);
      }
      return;
    }
    // Commit first, then drop the tile, so no render shows the photo in
    // neither place. `commit` reads the gallery and cover as they are NOW.
    deps.commit(outcome.item);
    entries = entries.filter((candidate) => candidate !== entry);
    release(entry);
    emitTiles();
    notify("Photo added.");
  };

  return {
    add: async (asset) => {
      if (isUploading()) return;
      const entry: Entry = {
        key: makeKey(),
        asset,
        status: "uploading",
        message: null,
        stage: "read",
        attempts: 0,
        token: 0,
      };
      entries = [...entries, entry];
      await run(entry);
    },
    retry: async (key) => {
      if (isUploading()) return;
      const entry = entries.find((candidate) => candidate.key === key);
      if (entry === undefined || entry.status !== "failed") return;
      await run(entry);
    },
    remove: (key) => {
      const entry = entries.find((candidate) => candidate.key === key);
      if (entry === undefined) return;
      entries = entries.filter((candidate) => candidate !== entry);
      // An uploading photo is released when its request settles (its bytes may
      // still be being read); a failed one is released now.
      if (entry.status !== "uploading") release(entry);
      emitTiles();
    },
    failBeforeUpload: (error) => {
      const message = galleryPhotoErrorMessage(error, "pick", deps.copy);
      deps.report({
        stage: "pick",
        reason: galleryAddFailureReason(error),
        videoJobActive: deps.isVideoJobActive(),
        attempt: 1,
        error,
      });
      notify(message);
    },
    tiles: snapshot,
    isUploading,
    attach: () => {
      disposed = false;
    },
    dispose: () => {
      disposed = true;
      const failed = entries.filter((entry) => entry.status === "failed");
      entries = entries.filter((entry) => entry.status !== "failed");
      failed.forEach(release);
    },
  };
};

// ----- The picker's two emit paths ------------------------------------------

type Ref<T> = { current: T };

/** The eight cover fields plus the gallery — structurally `CoverPatch`. */
export type CoverFieldsWithGallery = {
  coverGallery?: OfferingGalleryImage[];
};

export type CoverEmitRefs<Cover extends CoverFieldsWithGallery> = {
  cover: Ref<Cover>;
  gallery: Ref<OfferingGalleryImage[]>;
};

/**
 * A cover change (a picked image, a ready video, Remove). The cover ref moves
 * BEFORE the host hears about it: a gallery commit landing while this emit is
 * in flight re-emits `refs.cover.current`, and must carry the new cover, not
 * revert it (#3280). The emit carries the gallery as it is now.
 */
export const emitCoverWithGallery = async <Cover extends CoverFieldsWithGallery>(
  patch: Cover,
  refs: CoverEmitRefs<Cover>,
  setCover: (patch: Cover) => void,
  onCoverChange: (patch: Cover) => void | Promise<void>,
): Promise<void> => {
  refs.cover.current = patch;
  setCover(patch);
  await onCoverChange({ ...patch, coverGallery: refs.gallery.current });
};

/**
 * A gallery change. The gallery ref moves before the host hears about it, and
 * the emit carries the cover as it is NOW — never a cover captured when a photo
 * was picked, which would undo a video that became ready during the upload.
 */
export const commitGalleryWithCover = <Cover extends CoverFieldsWithGallery>(
  next: OfferingGalleryImage[],
  refs: CoverEmitRefs<Cover>,
  setGallery: (next: OfferingGalleryImage[]) => void,
  onCoverChange: (patch: Cover) => void | Promise<void>,
): void => {
  setGallery(next);
  refs.gallery.current = next;
  void onCoverChange({ ...refs.cover.current, coverGallery: next });
};
