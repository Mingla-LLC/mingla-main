/**
 * Issue #3318 T6 — a failed photo add reaches Sentry and PostHog, tagged with
 * the stage it failed at.
 *
 * The 2026-09-14 failure reached neither: the only record was a toast on one
 * phone. REAL CODE: the real `reportGalleryAddFailure` and the real
 * `reportNonFatal`; only the SDK edges (Sentry shim, PostHog facade, web
 * capture) are mocked.
 *
 * FAILS-ON-REVERT: proven in the #3318 implementation record.
 */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const mockCaptureException = jest.fn<(error: unknown, context?: unknown) => string>(() => "event-id");
const mockAddBreadcrumb = jest.fn<(breadcrumb: unknown) => void>();
const mockNativeCapture = jest.fn<(event: string, properties?: Record<string, unknown>) => void>();
const mockWebCapture = jest.fn<(event: string, properties?: Record<string, unknown>) => void>();

jest.mock("../../../diagnostics/sentry", () => ({
  captureException: (error: unknown, context?: unknown) => mockCaptureException(error, context),
  addBreadcrumb: (breadcrumb: unknown) => mockAddBreadcrumb(breadcrumb),
}));
jest.mock("../../../services/postHogService", () => ({
  postHogService: {
    capture: (event: string, properties?: Record<string, unknown>) => mockNativeCapture(event, properties),
  },
}));
jest.mock("../../../analytics/webAnalytics", () => ({
  captureWeb: (event: string, properties?: Record<string, unknown>) => mockWebCapture(event, properties),
}));

import {
  GALLERY_ADD_FAILED_EVENT,
  GALLERY_ADD_SENTRY_SCOPE,
  reportGalleryAddFailure,
} from "../coverPickerGalleryTelemetry";
import type { GalleryAddFailure } from "../coverPickerGalleryAdd";
import { EventCoverMediaError } from "../../../utils/eventCoverMediaRules";

const failure = (overrides: Partial<GalleryAddFailure>): GalleryAddFailure => ({
  stage: "upload",
  reason: "timeout",
  videoJobActive: true,
  attempt: 1,
  error: new EventCoverMediaError("upload_failed", "Storage upload did not finish within 26 s."),
  ...overrides,
});

beforeEach(() => {
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
  mockCaptureException.mockClear();
  mockAddBreadcrumb.mockClear();
  mockNativeCapture.mockClear();
  mockWebCapture.mockClear();
});

describe("T6 — failures are reported with their stage", () => {
  test("a pipeline failure: breadcrumb + Sentry capture + PostHog, all carrying stage and the video-job flag", () => {
    const reported = failure({});
    reportGalleryAddFailure(reported, "event");

    expect(mockAddBreadcrumb).toHaveBeenCalledTimes(1);
    expect(mockAddBreadcrumb.mock.calls[0][0]).toMatchObject({
      category: "cover.gallery",
      data: { stage: "upload", reason: "timeout", video_job_active: true, attempt: 1, target_kind: "event" },
    });

    expect(mockCaptureException).toHaveBeenCalledTimes(1);
    const [captured, context] = mockCaptureException.mock.calls[0];
    expect(captured).toBe(reported.error);
    expect(context).toMatchObject({
      tags: { scope: GALLERY_ADD_SENTRY_SCOPE },
      extra: { stage: "upload", reason: "timeout", video_job_active: true },
      fingerprint: [GALLERY_ADD_SENTRY_SCOPE, "upload", "timeout"],
    });

    expect(mockNativeCapture).toHaveBeenCalledTimes(1);
    const [event, properties] = mockNativeCapture.mock.calls[0];
    expect(event).toBe(GALLERY_ADD_FAILED_EVENT);
    expect(event).toBe("business_cover_gallery_add_failed");
    expect(properties).toMatchObject({ stage: "upload", reason: "timeout", video_job_active: true, attempt: 1 });
    expect(mockWebCapture).toHaveBeenCalledWith(event, properties);
  });

  test.each(["pick", "read", "upload", "verify"] as const)("stage %s is carried to every sink", (stage) => {
    reportGalleryAddFailure(failure({ stage, reason: "unknown", error: new Error("x") }), "trip");
    expect((mockAddBreadcrumb.mock.calls[0][0] as { data: { stage: string } }).data.stage).toBe(stage);
    expect((mockCaptureException.mock.calls[0][1] as { extra: { stage: string } }).extra.stage).toBe(stage);
    expect(mockNativeCapture.mock.calls[0][1]?.stage).toBe(stage);
  });

  test("the organiser's own outcomes go to PostHog and a breadcrumb, never a Sentry capture", () => {
    for (const reason of ["permission_denied", "unsupported_type", "file_too_large"] as const) {
      reportGalleryAddFailure(failure({ stage: "pick", reason }), "brand");
    }
    expect(mockCaptureException).not.toHaveBeenCalled();
    expect(mockAddBreadcrumb).toHaveBeenCalledTimes(3);
    expect(mockNativeCapture.mock.calls.map((call) => call[1]?.reason)).toEqual([
      "permission_denied",
      "unsupported_type",
      "file_too_large",
    ]);
  });

  test("a non-Error failure is still captured, and properties carry no URL, file name or id", () => {
    reportGalleryAddFailure(
      failure({ reason: "unknown", error: { uri: "file:///IMG_0412.jpg", url: "https://cdn/x.jpg" } }),
      "venue_draft",
    );
    expect(mockCaptureException.mock.calls[0][0]).toBeInstanceOf(Error);
    const properties = mockNativeCapture.mock.calls[0][1] ?? {};
    expect(Object.keys(properties).sort()).toEqual([
      "attempt",
      "platform",
      "reason",
      "stage",
      "target_kind",
      "video_job_active",
    ]);
    expect(JSON.stringify(properties)).not.toMatch(/file:|https?:|IMG_|brand-|event-/);
  });

  test("a throwing SDK never breaks the picker", () => {
    mockAddBreadcrumb.mockImplementationOnce(() => {
      throw new Error("sdk down");
    });
    mockNativeCapture.mockImplementationOnce(() => {
      throw new Error("sdk down");
    });
    expect(() => reportGalleryAddFailure(failure({}), "event")).not.toThrow();
  });
});
