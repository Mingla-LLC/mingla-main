// issue #868 [cover-gallery] — persistence + INDEPENDENCE regression.
//
// Proves I-PROPOSED-868-GALLERY-ADDITIVE-INDEPENDENT on the write path:
//   • draftToServerUpdate persists cover_media_gallery ADDITIVELY while leaving
//     cover_media_url / cover_media_type BYTE-IDENTICAL — a VIDEO cover + a photo
//     gallery COEXIST (cover_media_type stays "video", gallery non-empty).
//   • setEventCoverGallery writes ONLY cover_media_gallery (never the cover cols).
//
// FAILS-ON-REVERT (proven by TRUE deletion in the implementation report):
//   • Delete `cover_media_gallery: draft.coverGallery ?? []` from
//     draftToServerUpdate → the "additive gallery persisted" assertion FAILS.

import { beforeEach, describe, expect, jest, test } from "@jest/globals";

import { buildDraftEvent } from "../../store/draftEventStore";
import { draftToServerUpdate } from "../../utils/serverDraftEventMapper";
import { setEventCoverGallery } from "../eventCoverMediaService";
import { supabase } from "../supabase";
import type { OfferingGalleryImage } from "@mingla/offering-rendering";

jest.mock("../supabase", () => ({
  supabase: {
    from: jest.fn(),
  },
}));

jest.mock("expo-file-system", () => ({
  File: jest.fn(),
}));

const GALLERY: OfferingGalleryImage[] = [
  { url: "https://cdn.example/a.jpg", type: "image" },
  { url: "https://cdn.example/b.gif", type: "gif" },
];

describe("issue #868 cover_media_gallery persistence + independence", () => {
  test("draftToServerUpdate persists the gallery ADDITIVELY, cover fields UNCHANGED (video cover + photo gallery coexist)", () => {
    const draft = {
      ...buildDraftEvent("brand-1", "d-1"),
      // A VIDEO primary cover.
      coverMediaUrl: "https://cdn.example/cover.mp4",
      coverMediaType: "video" as const,
      // A photo/GIF gallery ALONGSIDE the video cover.
      coverGallery: GALLERY,
    };

    const update = draftToServerUpdate(draft, {});

    // Cover fields byte-identical to the draft (no derive, no null-coupling).
    expect(update.cover_media_url).toBe("https://cdn.example/cover.mp4");
    expect(update.cover_media_type).toBe("video");
    // Gallery persisted additively — the video cover and photo gallery COEXIST.
    expect(update.cover_media_gallery).toEqual(GALLERY);
    expect(update.cover_media_gallery).toHaveLength(2);
  });

  test("draftToServerUpdate keeps the gallery even when there is NO cover (independent columns)", () => {
    const draft = {
      ...buildDraftEvent("brand-1", "d-2"),
      coverMediaUrl: null,
      coverMediaType: null,
      coverGallery: GALLERY,
    };
    const update = draftToServerUpdate(draft, {});
    // Cover-absent branch nulls the cover cols but NEVER the gallery.
    expect(update.cover_media_url).toBeNull();
    expect(update.cover_media_gallery).toEqual(GALLERY);
  });

  describe("setEventCoverGallery", () => {
    const maybeSingle = jest.fn<() => Promise<{ data: unknown; error: null }>>();
    const select = jest.fn();
    const is = jest.fn();
    const eq = jest.fn();
    const update = jest.fn();

    beforeEach(() => {
      jest.clearAllMocks();
      maybeSingle.mockResolvedValue({
        data: { id: "e-1", cover_media_gallery: GALLERY },
        error: null,
      });
      select.mockReturnValue({ maybeSingle });
      is.mockReturnValue({ select });
      eq.mockReturnValue({ eq, is });
      update.mockReturnValue({ eq });
      (supabase.from as jest.Mock).mockReturnValue({ update });
    });

    test("writes ONLY cover_media_gallery (+updated_at) — never the cover columns", async () => {
      await setEventCoverGallery("e-1", GALLERY);

      expect(update).toHaveBeenCalledTimes(1);
      const payload = update.mock.calls[0][0] as Record<string, unknown>;
      expect(payload.cover_media_gallery).toEqual(GALLERY);
      expect(payload).toHaveProperty("updated_at");
      // The cover columns are NOT part of a gallery write (independence).
      expect(payload).not.toHaveProperty("cover_media_url");
      expect(payload).not.toHaveProperty("cover_media_type");
      // Still event-scoped + soft-delete guarded.
      expect(eq).toHaveBeenCalledWith("event_type", "event");
      expect(is).toHaveBeenCalledWith("deleted_at", null);
    });
  });
});
