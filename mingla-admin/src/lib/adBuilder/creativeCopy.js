/**
 * ISSUE-995 [Campaign Builder creative] Wave 3 of #977 — the HUMANIZE layer for
 * creative-validation checks (Seth finding #7, mirror of ISSUE-980's
 * preflightCopy translation pattern).
 *
 * The problem (ISSUE-977 Lane F Q1/Q6): StepCreative rendered each matrix check
 * VERBATIM — `image.min_width — This image is 550px wide, Meta's API floor is
 * 600px width [OFFICIAL]` / `image.ratio — Ratio 0.5046 is not one of Meta's
 * 4:5 / 1:1 / 1.91:1 / 9:16 … [OFFICIAL]`. The rule id, the confidence tag, and
 * the API-shaped prose are engineer jargon; a non-engineer can't tell "is this
 * bad?" from "what do I do?".
 *
 * Design (same two tiers as preflightCopy so it stays accurate as the matrix
 * messages drift):
 *   1. RULE_PATTERNS — ordered substring/regex matches on `check.rule`, each
 *      returning plain-English `friendly` + a concrete `action`.
 *   2. BASELINE by tier — a friendly meaning keyed on `check.level` for any
 *      rule no pattern above recognizes, so we always say what KIND of problem
 *      it is.
 * The raw string is NEVER discarded — `technical` carries the verbatim
 * `rule — message [confidence]` for the "Technical details" disclosure.
 */

import { PLATFORM_LABELS } from "./channelPlan.js";

/** Matrix tier → admin Badge variant (badge coloring for the humanized check). */
export const LEVEL_BADGE = {
  pass: "success",
  warn: "warning",
  reject: "error",
  needs_transcode: "warning",
  not_evaluable: "default",
};

/** A one-word status the operator can scan. */
export const LEVEL_LABEL = {
  pass: "Good",
  warn: "Heads up",
  reject: "Blocks this channel",
  needs_transcode: "Needs a crop or variant",
  not_evaluable: "Check by eye",
};

function platformName(platform) {
  return PLATFORM_LABELS[platform] ?? platform;
}

// Ordered — most specific first. `test` runs against the raw `check.rule`.
const RULE_PATTERNS = [
  {
    test: (r) => /audio_required/.test(r),
    friendly: (p) => `This video has no sound, and ${platformName(p)} requires audio.`,
    action: () => "Add a soundtrack or a voiceover and re-upload — a trending sound beats stock music.",
  },
  {
    test: (r) => /thumbnail|poster/.test(r),
    friendly: (p) => `${platformName(p)} needs a poster image for a video ad.`,
    action: () => "Upload a poster image (matching the video's shape) above.",
  },
  {
    test: (r) => /\.ratio$|aspect_ratio|\.ratio_tolerance|\.dims$/.test(r),
    friendly: (p) => `The creative's shape doesn't match ${platformName(p)}'s placements.`,
    action: () => "Crop it to a supported ratio, or add a pre-cropped variant in the slots below — the placement previews show exactly how each crop looks.",
  },
  {
    test: (r) => /min_width|min_resolution|\.resolution$|recommended_res|recommended_resolution/.test(r),
    friendly: (p) => `This is smaller than ${platformName(p)} wants — it'll look soft or get rejected.`,
    action: () => "Export a higher-resolution version and re-upload.",
  },
  {
    test: (r) => /max_bytes/.test(r),
    friendly: (p) => `The file is too large for ${platformName(p)}.`,
    action: () => "Re-export it at a smaller file size, or use a smaller source.",
  },
  {
    test: (r) => /\.mime$|\.container$/.test(r),
    friendly: (p) => `${platformName(p)} doesn't accept this file type.`,
    action: () => "Use JPG or PNG for images (MP4 or MOV for video) and re-upload.",
  },
  {
    test: (r) => /duration/.test(r),
    friendly: (p) => `The video's length is outside ${platformName(p)}'s allowed range.`,
    action: () => "Trim or extend it to fit, then re-upload.",
  },
  {
    test: (r) => /min_bitrate/.test(r),
    friendly: (p) => `The video's quality (bitrate) is below ${platformName(p)}'s minimum.`,
    action: () => "Re-export at a higher bitrate.",
  },
  {
    test: (r) => /safe_zone/.test(r),
    friendly: (p) => `Text or logos may sit under ${platformName(p)}'s own on-screen buttons.`,
    action: () => "Keep key elements away from the top and bottom edges — check the placement preview.",
  },
  {
    test: (r) => /watermark|black_bars/.test(r),
    friendly: (p) => `${platformName(p)} auto-rejects watermarks and letterboxed (black-bar) video.`,
    action: () => "Use a clean, full-frame export and eyeball it before launching.",
  },
  {
    // ISSUE-995 REWORK (tester P2): the raw matrix message says "We'll upload
    // this to YouTube for you" — a promise the system does NOT keep yet (Google
    // video create is unwired, #997). The operator-facing copy must be honest:
    // Google is skipped for video, never a fabricated "we'll handle it".
    test: (r) => /youtube_hosted/.test(r),
    friendly: (p) => `${platformName(p)} only runs YouTube-hosted video, and that isn't available yet.`,
    action: () => "Google is skipped for video ads for now (video ad creation is coming in a follow-up).",
  },
  {
    test: (r) => /codec|loudness|chunked_path|ig_ingestion/.test(r),
    friendly: (p) => `A ${platformName(p)} export detail to double-check.`,
    action: () => "It won't block the build — verify your export settings.",
  },
];

const BASELINE = {
  reject: {
    friendly: (p) => `This blocks ${platformName(p)} — the ad can't be created with it as-is.`,
    action: () => "Fix it and re-validate, or exclude this channel and build the others.",
  },
  needs_transcode: {
    friendly: (p) => `${platformName(p)} needs this creative in a different shape than we can crop for you here.`,
    action: () => "Add a pre-cropped variant in the slots below, or exclude this channel.",
  },
  warn: {
    friendly: (p) => `This works on ${platformName(p)}, with a caveat.`,
    action: () => "No action needed — but see the details if you want the specifics.",
  },
  not_evaluable: {
    friendly: (p) => `We can't check this automatically for ${platformName(p)}.`,
    action: () => "Verify it by eye before launching.",
  },
  pass: {
    friendly: (p) => `Good for ${platformName(p)}.`,
    action: () => null,
  },
};

/**
 * Turn a raw matrix check into operator-facing guidance.
 *
 * @param {object} check  { platform, rule, level, confidence, message }
 * @returns {{ friendly: string, action: string|null, technical: string,
 *   badge: string, statusLabel: string }} `friendly`/`action` are plain
 *   English with ZERO rule ids or confidence tags; `technical` is the verbatim
 *   raw string for the disclosure, never dropped.
 */
export function humanizeCreativeCheck(check) {
  const platform = check?.platform;
  const rule = String(check?.rule ?? "");
  const level = check?.level ?? "warn";

  let friendly;
  let action;
  for (const pattern of RULE_PATTERNS) {
    if (pattern.test(rule)) {
      friendly = pattern.friendly(platform);
      action = pattern.action(platform);
      break;
    }
  }
  if (friendly === undefined) {
    const base = BASELINE[level] ?? BASELINE.warn;
    friendly = base.friendly(platform);
    action = base.action(platform);
  }

  const technical = `${rule} — ${check?.message ?? ""} [${check?.confidence ?? "—"}]`.trim();
  return {
    friendly,
    action: action ?? null,
    technical,
    badge: LEVEL_BADGE[level] ?? "default",
    statusLabel: LEVEL_LABEL[level] ?? level,
  };
}
