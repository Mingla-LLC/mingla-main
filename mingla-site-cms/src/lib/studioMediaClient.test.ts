import { describe, expect, it, vi } from "vitest";
import {
  canSelectStudioMedia,
  STUDIO_MEDIA_MAX_BYTES,
  uploadStudioMedia,
  validateStudioMediaFile,
  type StudioMediaProgress,
} from "./studioMediaClient";

const file = new File([new Uint8Array([1, 2, 3])], "room.webp", {
  type: "image/webp",
});

const response = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("#2830 Studio media client", () => {
  it("uses the exact quarantine grant, completes once, polls boundedly and reaches READY", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(response(200, { ok: true, data: {
        media_id: "media-1", upload_url: "https://quarantine.example/exact",
        required_headers: { "content-type": "image/webp", "x-bound": "one" },
        maximum_bytes: STUDIO_MEDIA_MAX_BYTES,
      } }))
      .mockResolvedValueOnce(response(200, { ok: true, data: {
        media_id: "media-1", state: "PROCESSING", rejection_code: null,
      } }))
      .mockResolvedValueOnce(response(200, { ok: true, data: {
        media_id: "media-1", state: "READY", rejection_code: null,
      } }));
    const put = vi.fn(async () => undefined);
    const states: StudioMediaProgress[] = [];
    const result = await uploadStudioMedia(file, (state) => states.push(state), {
      request,
      put,
      digest: vi.fn(async () => "a".repeat(64)),
      sleep: vi.fn(async () => undefined),
    });
    expect(put).toHaveBeenCalledWith(
      "https://quarantine.example/exact",
      file,
      { "content-type": "image/webp", "x-bound": "one" },
      expect.any(Function),
    );
    expect(request.mock.calls[1][0]).toBe("/api/mingla/media/media-1/complete");
    expect(request.mock.calls[2][0]).toBe("/api/mingla/media/media-1");
    expect(states.map((state) => state.phase)).toContain("processing");
    expect(result.phase).toBe("ready");
  });

  it.each([
    [new File(["x"], "bad.gif", { type: "image/gif" }), "JPEG, PNG or WebP"],
    [{ type: "image/png", size: STUDIO_MEDIA_MAX_BYTES + 1 }, "20 MB"],
  ])("rejects unsupported client input before a grant", (candidate, copy) => {
    expect(validateStudioMediaFile(candidate)).toContain(copy);
  });

  it.each([
    ["UPLOAD_EXPIRED", "expired"],
    ["UPLOAD_FAILED", "retryable_failed"],
  ])("surfaces quarantine PUT %s", async (code, phase) => {
    const result = await uploadStudioMedia(file, vi.fn(), {
      request: vi.fn(async () => response(200, { ok: true, data: {
        media_id: "media-1", upload_url: "https://quarantine.example/exact",
        required_headers: {}, maximum_bytes: STUDIO_MEDIA_MAX_BYTES,
      } })),
      put: vi.fn(async () => { throw new Error(code); }),
      digest: vi.fn(async () => "a".repeat(64)),
      sleep: vi.fn(async () => undefined),
    });
    expect(result.phase).toBe(phase);
  });

  it("surfaces a processing failure after completion without selecting the image", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(response(200, { ok: true, data: {
        media_id: "media-1", upload_url: "https://quarantine.example/exact",
        required_headers: {}, maximum_bytes: STUDIO_MEDIA_MAX_BYTES,
      } }))
      .mockResolvedValueOnce(response(200, { ok: true, data: {
        media_id: "media-1", state: "PROCESSING", rejection_code: null,
      } }))
      .mockResolvedValueOnce(response(200, { ok: true, data: {
        media_id: "media-1", state: "RETRYABLE_FAILED",
        rejection_code: "PROCESSING_FAILED",
      } }));
    const result = await uploadStudioMedia(file, vi.fn(), {
      request,
      put: vi.fn(async () => undefined),
      digest: vi.fn(async () => "a".repeat(64)),
      sleep: vi.fn(async () => undefined),
    });
    expect(result.phase).toBe("retryable_failed");
    expect(canSelectStudioMedia({
      state: "RETRYABLE_FAILED",
      altText: "Dining room",
      decorative: false,
    })).toBe(false);
  });

  it.each([
    ["INVALID_STATE", "replayed"],
    ["MEDIA_REJECTED", "rejected"],
  ])("distinguishes completion %s", async (code, phase) => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(response(200, { ok: true, data: {
        media_id: "media-1", upload_url: "https://quarantine.example/exact",
        required_headers: {}, maximum_bytes: STUDIO_MEDIA_MAX_BYTES,
      } }))
      .mockResolvedValueOnce(response(409, { ok: false, error: { code } }));
    const result = await uploadStudioMedia(file, vi.fn(), {
      request,
      put: vi.fn(async () => undefined),
      digest: vi.fn(async () => "a".repeat(64)),
      sleep: vi.fn(async () => undefined),
    });
    expect(result.phase).toBe(phase);
  });

  it("requires useful alt text or an explicit decorative choice before selection", () => {
    expect(canSelectStudioMedia({ state: "READY", altText: "", decorative: false })).toBe(false);
    expect(canSelectStudioMedia({ state: "READY", altText: "Dining room", decorative: false })).toBe(true);
    expect(canSelectStudioMedia({ state: "READY", altText: "", decorative: true })).toBe(true);
    expect(canSelectStudioMedia({ state: "PROCESSING", altText: "Dining room", decorative: false })).toBe(false);
  });
});
