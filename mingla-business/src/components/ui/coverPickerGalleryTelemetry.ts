/**
 * coverPickerGalleryTelemetry — issue #3318.
 *
 * The 2026-09-14 failure reached neither Sentry nor PostHog: a photo was
 * discarded and the only record was a toast on one phone. Every failed photo
 * add now leaves a trace, tagged with the stage it failed at and whether a
 * cover video job was running (the open question from that investigation).
 *
 *   - Sentry: a breadcrumb for EVERY failure, so a later crash carries the
 *     history; a non-fatal capture for PIPELINE failures only (read, upload,
 *     verify, timeouts, network). A denied permission or a file type/size the
 *     product does not take is the organiser's answer, not a fault, and would
 *     only be noise in Sentry.
 *   - PostHog: `business_cover_gallery_add_failed` for every failure, native
 *     via `postHogService`, web via `captureWeb`, the same pair
 *     `businessAnalyticsEvents.ts` uses.
 *
 * Properties are categorical only: no URL, file name, brand or event id.
 *
 * Imported by CoverPicker alone, which is its own lazy chunk on web, so none
 * of this enters the boot payload.
 */

import { Platform } from "react-native";

import { captureWeb } from "../../analytics/webAnalytics";
import { reportNonFatal } from "../../diagnostics/reportNonFatal";
import { addBreadcrumb } from "../../diagnostics/sentry";
import { postHogService } from "../../services/postHogService";
import type { CoverTarget } from "./coverTarget";
import {
  GALLERY_ADD_USER_OUTCOME_REASONS,
  type GalleryAddFailure,
} from "./coverPickerGalleryAdd";

export const GALLERY_ADD_FAILED_EVENT = "business_cover_gallery_add_failed";
export const GALLERY_ADD_SENTRY_SCOPE = "coverPicker.galleryAdd";

const platform = (): "ios" | "android" | "web" => {
  if (Platform.OS === "web") return "web";
  if (Platform.OS === "android") return "android";
  return "ios";
};

/** Reports one failed photo add. Never throws: telemetry must not break the picker. */
export const reportGalleryAddFailure = (
  failure: GalleryAddFailure,
  targetKind: CoverTarget["kind"],
): void => {
  const properties = {
    stage: failure.stage,
    reason: failure.reason,
    video_job_active: failure.videoJobActive,
    target_kind: targetKind,
    attempt: failure.attempt,
    platform: platform(),
  } as const;
  try {
    addBreadcrumb({
      category: "cover.gallery",
      level: "warning",
      message: "gallery photo add failed",
      data: properties,
    });
  } catch {
    // Silent by design — see the header.
  }
  if (!GALLERY_ADD_USER_OUTCOME_REASONS.has(failure.reason)) {
    const error = failure.error instanceof Error
      ? failure.error
      : new Error(`gallery photo add failed: ${failure.reason}`);
    reportNonFatal(GALLERY_ADD_SENTRY_SCOPE, error, properties, [
      GALLERY_ADD_SENTRY_SCOPE,
      failure.stage,
      failure.reason,
    ]);
  }
  try {
    postHogService.capture(GALLERY_ADD_FAILED_EVENT, properties);
    captureWeb(GALLERY_ADD_FAILED_EVENT, properties);
  } catch {
    // Silent by design — see the header.
  }
};
