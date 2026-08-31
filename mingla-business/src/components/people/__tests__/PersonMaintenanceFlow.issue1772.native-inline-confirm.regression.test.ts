import { readFileSync } from "node:fs";

const source = readFileSync(
  require.resolve("../PersonMaintenanceFlow"),
  "utf8",
);

describe("#1772 native maintenance confirmation topology", () => {
  test("keeps second-step confirmation inside an already-open native Sheet", () => {
    // [TEST-MOD-APPROVED #1772] UIKit cannot present the sibling ConfirmDialog
    // Modal over the Sheet Modal. Native must always use the in-Sheet path;
    // web keeps its dialog except for compact or 200%-text layouts.
    expect(source).toContain(
      'const inlineConfirmation = Platform.OS !== "web" || stacked;',
    );
    expect(
      source.match(/confirmMerge && inlineConfirmation/g) ?? [],
    ).toHaveLength(3);
    expect(
      source.match(/confirmSplit && inlineConfirmation/g) ?? [],
    ).toHaveLength(3);
    expect(source).toContain("visible={confirmMerge && !inlineConfirmation}");
    expect(source).toContain("visible={confirmSplit && !inlineConfirmation}");
  });
});
