/**
 * coverPickerActionLabels — #3040 B-C15 [A-15] "every button names its outcome".
 *
 * The cover sheet used to offer "Replace" (which always opened the PHOTO
 * picker) and "Video", whatever the cover was. A host with a video cover
 * tapped Replace, got the photo chooser, picked an MP4 and saw "Cover upload
 * failed". The approved concept fixes the words to the picker they open, and
 * reverses the pair for a photo cover:
 *
 *   video cover  →  Replace video (primary) · Use photo instead
 *   photo / GIF  →  Replace photo (primary) · Use video instead
 *   empty        →  Add a video (primary)   · Add a photo        (Seth, Q2)
 *   ad video     →  Add ad video / Replace video (video only)
 *
 * Remove cover stays visible whenever a cover exists — during an upload too —
 * and hides only in the needs-action states (H-12 re-pick, H-19 / AD-05 save
 * failed) and on an empty cover. PURE: no React, no React Native.
 */

import type { CoverKind } from "./coverUploadCardModel";

export type CoverActionOpens = "video" | "image";

export type CoverAction = {
  label: string;
  opens: CoverActionOpens;
  primary: boolean;
  icon: "play" | "upload";
  /** The a11y hint from Appendix A §11. */
  hint: string;
};

export type CoverActionSet = {
  actions: CoverAction[];
  /** The action pair renders (hidden while a video job owns the card). */
  showActions: boolean;
  showRemove: boolean;
  removeLabel: "Remove cover" | "Remove video";
};

export const resolveCoverActions = (
  coverKind: CoverKind,
  jobActive: boolean,
  needsAction: boolean,
  videoOnly = false,
): CoverActionSet => {
  const hasCover = coverKind !== "empty";
  let actions: CoverAction[];
  if (videoOnly) {
    actions = [
      hasCover
        ? { label: "Replace video", opens: "video", primary: true, icon: "play", hint: "Opens your videos. Your current video stays until the new one is ready." }
        : { label: "Add ad video", opens: "video", primary: true, icon: "play", hint: "Opens your videos." },
    ];
  } else if (coverKind === "video") {
    actions = [
      { label: "Replace video", opens: "video", primary: true, icon: "play", hint: "Opens your videos. Your current video stays until the new one is ready." },
      { label: "Use photo instead", opens: "image", primary: false, icon: "upload", hint: "Opens your photos. Your video stays until the photo uploads." },
    ];
  } else if (coverKind === "photo") {
    actions = [
      { label: "Replace photo", opens: "image", primary: true, icon: "upload", hint: "Opens your photos. Your current photo stays until the new one uploads." },
      { label: "Use video instead", opens: "video", primary: false, icon: "play", hint: "Opens your videos. Your photo stays until the video is ready." },
    ];
  } else {
    actions = [
      { label: "Add a video", opens: "video", primary: true, icon: "play", hint: "Opens your videos." },
      { label: "Add a photo", opens: "image", primary: false, icon: "upload", hint: "Opens your photos." },
    ];
  }
  return {
    actions,
    showActions: !jobActive && !needsAction,
    showRemove: hasCover && !needsAction,
    removeLabel: videoOnly ? "Remove video" : "Remove cover",
  };
};

/** The cover's media kind as the sheet shows it. */
export const coverKindOf = (url: string | null, type: string | null): CoverKind =>
  url === null ? "empty" : type === "video" ? "video" : "photo";
