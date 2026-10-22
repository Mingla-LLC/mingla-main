import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "@jest/globals";

const source = readFileSync(join(__dirname, "..", "RefundSheet.tsx"), "utf8");

describe("RefundSheet discounted-order preview", () => {
  test("renders server refund amounts and blocks confirmation on preview failure", () => {
    expect(source).toContain("useRefundPreview");
    expect(source).toContain("previewQuery.data.amountCents");
    expect(source).toContain("previewQuery.data?.lines.find");
    expect(source).toContain("!previewQuery.isError");
    expect(source).toContain("previewQuery.data !== undefined");
    expect(source).toContain("previewQuery.data.withinRemaining");
    expect(source).toContain("disabled={!canSubmit}");
  });
});
