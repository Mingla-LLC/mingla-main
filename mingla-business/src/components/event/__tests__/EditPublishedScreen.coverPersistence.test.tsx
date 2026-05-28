import fs from "node:fs";
import path from "node:path";

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

describe("AMENDMENT 7 published cover persistence", () => {
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
});
