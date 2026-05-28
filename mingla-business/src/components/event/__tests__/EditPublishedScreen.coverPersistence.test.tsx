import fs from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, jest, test } from "@jest/globals";

import { setEventCover } from "../../../services/eventCoverMediaService";
import { supabase } from "../../../services/supabase";

jest.mock("../../../services/supabase", () => ({
  supabase: {
    from: jest.fn(),
  },
}));

jest.mock("expo-file-system", () => ({
  File: jest.fn(),
}));

const screenPath = path.resolve(
  __dirname,
  "..",
  "EditPublishedScreen.tsx",
);

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

describe("AMENDMENT 7 published cover persistence", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("T-AMEND7-05: explicit cover set uses setEventCover with a non-null URL", () => {
    const source = readScreen();
    const coverBlock = sliceBetween(
      source,
      "const explicitCoverSet =",
      "// ORCH-0824 hotfix (Option B): if the patch touches",
    );

    expect(source).toContain("setEventCover,");
    expect(source).not.toContain("updatePublishedEventCoverMedia");
    expect(coverBlock).toContain(
      "patch.coverMediaUrl !== undefined && patch.coverMediaUrl !== null",
    );
    expect(coverBlock).toContain("const mediaUrl = patch.coverMediaUrl as string;");
    expect(coverBlock).toContain(
      "await setEventCover(liveEvent.serverEventId, mediaUrl, mediaType, {",
    );
    expect(coverBlock).toContain("if (mediaType === null || mediaType === undefined)");
    expect(coverBlock).toContain("error.code === \"persist_mismatch\"");
    expect(coverBlock).toContain(
      "Save succeeded but the cover did not persist. Refresh and try again.",
    );
  });

  test("T-AMEND7-06: metadata-only cover patches skip the cover service and warn", () => {
    const source = readScreen();
    const coverBlock = sliceBetween(
      source,
      "const explicitCoverSet =",
      "// ORCH-0824 hotfix (Option B): if the patch touches",
    );
    const metadataOnlyIndex = coverBlock.indexOf("const metadataOnlyPatch =");
    const warningIndex = coverBlock.indexOf("metadata-only cover patch skipped");

    expect(metadataOnlyIndex).toBeGreaterThan(-1);
    expect(warningIndex).toBeGreaterThan(metadataOnlyIndex);
    expect(coverBlock).toContain("patch.coverMediaUrl === undefined");
    expect(coverBlock).toContain("console.warn(");
    expect(coverBlock).toContain("\"[ORCH-0978]\"");
    expect(coverBlock).toContain("key.startsWith(\"coverMedia\")");
  });

  test("T-AMEND7-07: explicit cover clear routes only through clearEventCover", () => {
    const source = readScreen();
    const coverBlock = sliceBetween(
      source,
      "const explicitCoverSet =",
      "// ORCH-0824 hotfix (Option B): if the patch touches",
    );
    const explicitClearIndex = coverBlock.indexOf(
      "const explicitCoverClear = patch.coverMediaUrl === null;",
    );
    const clearCallIndex = coverBlock.indexOf(
      "await clearEventCover(liveEvent.serverEventId);",
    );
    const setCallIndex = coverBlock.indexOf(
      "await setEventCover(liveEvent.serverEventId, mediaUrl, mediaType, {",
    );

    expect(source).toContain("clearEventCover,");
    expect(explicitClearIndex).toBeGreaterThan(-1);
    expect(clearCallIndex).toBeGreaterThan(explicitClearIndex);
    expect(setCallIndex).toBeGreaterThan(clearCallIndex);
    expect(coverBlock).toContain("if (explicitCoverClear) {");
    expect(coverBlock).toContain("} else {");
  });

  test("T-AMEND7-08: persist_mismatch surfaces the truthful save-cover toast", () => {
    const source = readScreen();
    const catchBlock = sliceBetween(
      source,
      "} catch (error) {",
      "return;\n        }\n      } else if (metadataOnlyPatch)",
    );
    const persistMismatchIndex = catchBlock.indexOf(
      "error.code === \"persist_mismatch\"",
    );
    const toastIndex = catchBlock.indexOf(
      "Save succeeded but the cover did not persist. Refresh and try again.",
    );

    expect(persistMismatchIndex).toBeGreaterThan(-1);
    expect(toastIndex).toBeGreaterThan(persistMismatchIndex);
    expect(catchBlock).toContain("setSubmitting(false);");
    expect(catchBlock).toContain(
      "setModal((prev) => ({ ...prev, visible: false }));",
    );
    expect(catchBlock).toContain("showToast(");
    expect(catchBlock).toContain("Cover upload failed. Try again.");
    expect(catchBlock).toContain("Could not save cover media. Try again.");
  });

  test("T-AMEND7-08: mismatched setEventCover echo maps to the same toast contract", async () => {
    mockEventsUpdate({
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
      ),
    ).rejects.toMatchObject({
      code: "persist_mismatch",
      message:
        "Save succeeded but the cover did not persist. Refresh and try again.",
    });

    const source = readScreen();
    const catchBlock = sliceBetween(
      source,
      "} catch (error) {",
      "return;\n        }\n      } else if (metadataOnlyPatch)",
    );
    expect(catchBlock).toContain("error.code === \"persist_mismatch\"");
    expect(catchBlock).toContain(
      "Save succeeded but the cover did not persist. Refresh and try again.",
    );
  });
});
