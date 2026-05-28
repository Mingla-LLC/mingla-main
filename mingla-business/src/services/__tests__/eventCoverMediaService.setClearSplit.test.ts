import { beforeEach, describe, expect, jest, test } from "@jest/globals";

import type { EventCoverProviderMetadata } from "../../types/eventCoverProvider";
import { clearEventCover, setEventCover } from "../eventCoverMediaService";
import { supabase } from "../supabase";

jest.mock("../supabase", () => ({
  supabase: {
    from: jest.fn(),
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

type QueryResult = {
  data: unknown;
  error: { message: string } | null;
};
type SelectChain = { maybeSingle: () => Promise<QueryResult> };
type IsChain = { select: (columns: string) => SelectChain };
type EqChain = {
  eq: (column: string, value: string) => EqChain;
  is: (column: string, value: null) => IsChain;
};
type UpdateChain = { eq: (column: string, value: string) => EqChain };

const maybeSingle = jest.fn<() => Promise<QueryResult>>();
const select = jest.fn<(columns: string) => SelectChain>();
const is = jest.fn<(column: string, value: null) => IsChain>();
const eq = jest.fn<(column: string, value: string) => EqChain>();
const update = jest.fn<(payload: Record<string, unknown>) => UpdateChain>();

const mockEventsUpdate = (row: unknown): void => {
  maybeSingle.mockResolvedValue({ data: row, error: null });
  select.mockReturnValue({ maybeSingle });
  is.mockReturnValue({ select });
  eq.mockReturnValue({ eq, is });
  update.mockReturnValue({ eq });
  (supabase.from as jest.Mock).mockReturnValue({ update });
};

describe("eventCoverMediaService set/clear split", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEventsUpdate({
      id: "event-1",
      cover_media_type: "video",
      cover_media_url: "https://cdn.example.com/cover.mp4",
    });
  });

  test("T-AMEND7-01: setEventCover writes all cover columns and verifies round-trip", async () => {
    await expect(
      setEventCover(
        "event-1",
        "https://cdn.example.com/cover.mp4",
        "video",
        metadata,
      ),
    ).resolves.toMatchObject({
      cover_media_type: "video",
      cover_media_url: "https://cdn.example.com/cover.mp4",
      id: "event-1",
    });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        cover_media_alt: "Crowd dancing under warm lights",
        cover_media_credit: "Mingla",
        cover_media_credit_url: "https://source.example.com",
        cover_media_provider: "upload",
        cover_media_source_url: "https://source.example.com/source.mov",
        cover_media_type: "video",
        cover_media_url: "https://cdn.example.com/cover.mp4",
      }),
    );
    expect(update.mock.calls[0][0]).not.toHaveProperty("cover_media_url", null);
    expect(select).toHaveBeenCalledWith("id, cover_media_url, cover_media_type");
  });

  test("T-AMEND7-02: clearEventCover nulls the full cover column set", async () => {
    mockEventsUpdate({ id: "event-1" });

    await expect(clearEventCover("event-1")).resolves.toBeUndefined();

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        cover_media_alt: null,
        cover_media_credit: null,
        cover_media_credit_url: null,
        cover_media_provider: null,
        cover_media_source_url: null,
        cover_media_type: null,
        cover_media_url: null,
      }),
    );
    expect(select).toHaveBeenCalledWith("id");
  });

  test("T-AMEND7-03: setEventCover rejects null mediaUrl at TypeScript level", () => {
    if (false) {
      // @ts-expect-error AMENDMENT 7 requires mediaUrl: string, never null.
      void setEventCover("event-1", null, "video", metadata);
    }

    expect(true).toBe(true);
  });

  test("T-AMEND7-04: setEventCover throws persist_mismatch when the row echoes a different URL", async () => {
    mockEventsUpdate({
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
      ),
    ).rejects.toMatchObject({
      code: "persist_mismatch",
      message: "Save succeeded but the cover did not persist. Refresh and try again.",
      name: "EventCoverMediaError",
    });
  });
});
