import fs from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, jest, test } from "@jest/globals";

import type { EventCoverProviderMetadata } from "../../types/eventCoverProvider";
import { clearEventCover, setEventCover } from "../eventCoverMediaService";
import { supabase } from "../supabase";

jest.mock("../supabase", () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
    functions: { invoke: jest.fn() },
  },
}));

jest.mock("expo-file-system", () => ({
  File: jest.fn(),
}));

const metadata: EventCoverProviderMetadata = {
  provider: "upload",
  sourceUrl: "https://source.example.com/source.mov",
  credit: "Mingla",
  creditUrl: "https://source.example.com",
  alt: "Crowd dancing under warm lights",
};

const rpc = supabase.rpc as unknown as jest.Mock<
  (...args: unknown[]) => Promise<{ data: unknown; error: null }>
>;
const invoke = supabase.functions.invoke as unknown as jest.Mock<
  (...args: unknown[]) => Promise<{ data: unknown; error: null }>
>;
const serviceSource = fs.readFileSync(
  path.resolve(__dirname, "..", "eventCoverMediaService.ts"),
  "utf8",
);

const mockCoverRpcs = (row: unknown): void => {
  invoke.mockResolvedValueOnce({ data: null, error: null });
  rpc.mockResolvedValueOnce({ data: { event: row }, error: null });
};

describe("eventCoverMediaService set/clear split", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("T-AMEND7-01: setEventCover writes all cover columns and verifies round-trip", async () => {
    mockCoverRpcs({
      id: "event-1",
      cover_media_type: "video",
      cover_media_url: "https://cdn.example.com/cover.mp4",
      cover_media_poster_url: "https://cdn.example.com/cover-poster.jpg",
    });
    await expect(
      setEventCover(
        "event-1",
        "https://cdn.example.com/cover.mp4",
        "video",
        metadata,
        "https://cdn.example.com/cover-poster.jpg",
      ),
    ).resolves.toMatchObject({
      cover_media_type: "video",
      cover_media_url: "https://cdn.example.com/cover.mp4",
      id: "event-1",
    });

    expect(rpc).toHaveBeenNthCalledWith(
      1,
      "business_set_event_cover_media",
      expect.objectContaining({
        p_alt: "Crowd dancing under warm lights",
        p_credit: "Mingla",
        p_credit_url: "https://source.example.com",
        p_provider: "upload",
        p_source_url: "https://source.example.com/source.mov",
        p_type: "video",
        p_url: "https://cdn.example.com/cover.mp4",
        p_poster_url: "https://cdn.example.com/cover-poster.jpg",
      }),
    );
    expect(rpc.mock.calls[0][1]).not.toHaveProperty("p_url", null);
    // [TEST-MOD-APPROVED #1972] A trusted Edge verifier now attests provider
    // inventory/storage before SQL creates the one-use selection reference.
    expect(invoke).toHaveBeenNthCalledWith(
      1,
      "event-cover-attest-selection",
      expect.objectContaining({ body: expect.objectContaining({ event_id: "event-1", url: "https://cdn.example.com/cover.mp4" }) }),
    );
    // [TEST-MOD-APPROVED #1972] Fail on revert to the former direct table write.
    const setCoverSource = serviceSource.slice(
      serviceSource.indexOf("export const setEventCover ="),
      serviceSource.indexOf("export const setEventCoverGallery ="),
    );
    expect(setCoverSource).not.toContain('.from("events")');
  });

  test("T-AMEND7-02: clearEventCover nulls the full cover column set", async () => {
    rpc.mockResolvedValueOnce({ data: { event: { id: "event-1" } }, error: null });

    await expect(clearEventCover("event-1")).resolves.toBeUndefined();

    expect(rpc).toHaveBeenNthCalledWith(
      1,
      "business_clear_event_cover_media",
      { p_event_id: "event-1" },
    );
    expect(invoke).not.toHaveBeenCalled();
    const clearCoverSource = serviceSource.slice(
      serviceSource.indexOf("export const clearEventCover ="),
    );
    expect(clearCoverSource).not.toContain('.from("events")');
  });

  test("T-AMEND7-03: setEventCover rejects null mediaUrl at TypeScript level", () => {
    if (false) {
      // @ts-expect-error AMENDMENT 7 requires mediaUrl: string, never null.
      void setEventCover("event-1", null, "video", metadata);
    }

    expect(true).toBe(true);
  });

  test("T-AMEND7-04: setEventCover throws persist_mismatch when the row echoes a different URL", async () => {
    mockCoverRpcs({
      id: "event-1",
      cover_media_type: "video",
      cover_media_url: null,
    });

    await expect(
      setEventCover(
        "event-1",
        "https://cdn.example.com/cover.mp4",
        "video",
        metadata,
        "https://cdn.example.com/cover-poster.jpg",
      ),
    ).rejects.toMatchObject({
      code: "persist_mismatch",
      message: "Save succeeded but the cover did not persist. Refresh and try again.",
      name: "EventCoverMediaError",
    });
  });

  test("#1719 rejects a motion cover before writing when its stable poster is absent", async () => {
    await expect(
      setEventCover(
        "event-1",
        "https://cdn.example.com/cover.mp4",
        "video",
        metadata,
      ),
    ).rejects.toMatchObject({
      code: "upload_failed",
      message: "Cover save failed because its fallback image is missing or invalid.",
    });
    expect(rpc).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });
});
