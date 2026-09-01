import { describe, expect, it, vi } from "vitest";
import {
  isStudioMediaRecoverable,
  restoreStudioMedia,
} from "./studioMediaClient";

const MEDIA_ID = "00000000-0000-4000-8000-000000000103";

describe("#2893 Studio media restore client", () => {
  it("calls only the tenant-authorized fixed restore route", async () => {
    const request = vi.fn().mockResolvedValue(
      Response.json({
        ok: true,
        data: { media_id: MEDIA_ID, state: "READY" },
      }),
    );
    await restoreStudioMedia(MEDIA_ID, { request });
    expect(request).toHaveBeenCalledWith(
      `/api/mingla/media/${MEDIA_ID}/restore`,
      { method: "POST" },
    );

    request.mockClear();
    await expect(
      restoreStudioMedia("../foreign", { request }),
    ).rejects.toThrow("VALIDATION_FAILED");
    expect(request).not.toHaveBeenCalled();
  });

  it("enables recovery only for a finite future server deadline", () => {
    const now = Date.parse("2026-09-01T00:00:00.000Z");
    expect(
      isStudioMediaRecoverable("2026-09-30T00:00:00.000Z", now),
    ).toBe(true);
    for (const value of [
      null,
      "not-a-date",
      "2026-09-01T00:00:00.000Z",
      "2026-08-31T23:59:59.999Z",
    ]) {
      expect(isStudioMediaRecoverable(value, now)).toBe(false);
    }
  });
});
