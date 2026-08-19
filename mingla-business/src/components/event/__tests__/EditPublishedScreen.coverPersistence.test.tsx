import fs from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, jest, test } from "@jest/globals";

import { setEventCover } from "../../../services/eventCoverMediaService";
import { supabase } from "../../../services/supabase";

jest.mock("../../../services/supabase", () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
    functions: { invoke: jest.fn() },
  },
}));

jest.mock("expo-file-system", () => ({
  File: jest.fn(),
}));

const screenPath = path.resolve(__dirname, "..", "EditPublishedScreen.tsx");

const readScreen = (): string => fs.readFileSync(screenPath, "utf8");

const sliceBetween = (
  source: string,
  startNeedle: string,
  endNeedle: string,
): string => {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
};

const rpc = supabase.rpc as unknown as jest.Mock<
  (...args: unknown[]) => Promise<{ data: unknown; error: null }>
>;
const invoke = supabase.functions.invoke as unknown as jest.Mock<
  (...args: unknown[]) => Promise<{ data: unknown; error: null }>
>;

const mockCoverRpcs = (row: unknown): void => {
  invoke.mockResolvedValueOnce({ data: null, error: null });
  rpc.mockResolvedValueOnce({ data: { event: row }, error: null });
};

describe("AMENDMENT 7 published cover persistence", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("T-AMEND7-05: explicit cover set is attested before the atomic save", () => {
    const source = readScreen();
    const coverBlock = sliceBetween(
      source,
      "const explicitCoverSet =",
      "// ORCH-0824 hotfix: unified early-return",
    );

    expect(source).toContain("attestEventCoverSelection,");
    expect(source).not.toContain("updatePublishedEventCoverMedia");
    expect(coverBlock).toContain(
      "patch.coverMediaUrl !== undefined && patch.coverMediaUrl !== null",
    );
    expect(coverBlock).toContain(
      "const mediaUrl = patch.coverMediaUrl as string;",
    );
    expect(coverBlock).toContain(
      "const attested = await attestEventCoverSelection(",
    );
    expect(coverBlock).toContain(
      "atomicPatch.cover = { selectionRef: attested.selectionRef };",
    );
    expect(coverBlock).toContain("await patchPublishedEventAtomically(");
    expect(coverBlock).toContain(
      "if (mediaType === null || mediaType === undefined)",
    );
  });

  test("T-AMEND7-06: metadata-only cover patches fail visibly", () => {
    const source = readScreen();
    const coverBlock = sliceBetween(
      source,
      "const explicitCoverSet =",
      "const taxonomyPatchPresent =",
    );
    const metadataOnlyIndex = coverBlock.indexOf("const metadataOnlyPatch =");
    const errorIndex = coverBlock.indexOf(
      "Choose the cover again so its attribution can be verified.",
    );

    expect(metadataOnlyIndex).toBeGreaterThan(-1);
    expect(errorIndex).toBeGreaterThan(metadataOnlyIndex);
    expect(coverBlock).toContain("patch.coverMediaUrl === undefined");
    expect(coverBlock).toContain("showToast(");
    expect(coverBlock).toContain("return;");
  });

  test("T-AMEND7-07: explicit cover clear rides the atomic save", () => {
    const source = readScreen();
    const coverBlock = sliceBetween(
      source,
      "const explicitCoverSet =",
      "// ORCH-0824 hotfix: unified early-return",
    );
    const explicitClearIndex = coverBlock.indexOf(
      "const explicitCoverClear = patch.coverMediaUrl === null;",
    );
    const clearCallIndex = coverBlock.indexOf(
      "atomicPatch.cover = { clear: true };",
    );
    const setCallIndex = coverBlock.indexOf("await attestEventCoverSelection(");

    expect(source).not.toContain("clearEventCover,");
    expect(explicitClearIndex).toBeGreaterThan(-1);
    expect(clearCallIndex).toBeGreaterThan(explicitClearIndex);
    expect(setCallIndex).toBeGreaterThan(clearCallIndex);
    expect(coverBlock).toContain("} else if (explicitCoverSet) {");
  });

  test("T-AMEND7-08: cover attestation failure surfaces a truthful retry toast", () => {
    const source = readScreen();
    const catchBlock = sliceBetween(
      source,
      "if (error instanceof EventCoverMediaError)",
      "const code =",
    );
    const toastIndex = catchBlock.indexOf("Cover upload failed. Try again.");

    expect(toastIndex).toBeGreaterThan(-1);
    expect(catchBlock).toContain("showToast(");
    expect(catchBlock).toContain("return;");
  });

  test("T-AMEND7-08: mismatched setEventCover echo maps to the same toast contract", async () => {
    mockCoverRpcs({
      id: "event-1",
      cover_media_type: "video",
      cover_media_url: "https://cdn.example.com/other.mp4",
    });

    await expect(
      setEventCover(
        "event-1",
        "https://cdn.example.com/expected.mp4",
        "video",
        {
          alt: "Uploaded video cover",
          credit: null,
          creditUrl: null,
          provider: "upload",
          sourceUrl: "file:///expected.mov",
        },
        // [TEST-MOD-APPROVED #1719] Motion-cover writes now require the stable
        // poster that recipient previews use when video cannot autoplay.
        "https://cdn.example.com/expected-poster.jpg",
      ),
    ).rejects.toMatchObject({
      code: "persist_mismatch",
      message:
        "Save succeeded but the cover did not persist. Refresh and try again.",
    });
    expect(rpc).toHaveBeenNthCalledWith(
      1,
      "business_set_event_cover_media",
      expect.objectContaining({
        p_url: "https://cdn.example.com/expected.mp4",
      }),
    );
  });
});
