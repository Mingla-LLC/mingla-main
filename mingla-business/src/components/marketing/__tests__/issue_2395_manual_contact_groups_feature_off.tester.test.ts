import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../../../..");
const source = fs.readFileSync(
  path.join(root, "src/components/marketing/AudiencePickerSheet.tsx"),
  "utf8",
);

describe("#2395 tester — feature OFF is exact legacy audience-picker behavior", () => {
  test("keeps the pre-feature explanatory copy", () => {
    expect(source).toMatch(
      /Your Book shows active saved people; buyer lists come from paid\s+orders\./,
    );
  });

  test("keeps the pre-feature row accessibility and buyer metadata when OFF", () => {
    expect(source).toContain("renderLegacyOption");
    expect(source).toMatch(
      /manualGroupsEnabled === true[\s\S]*?: options\.map\(renderLegacyOption\)/,
    );
    expect(source).toContain(
      "`Pick audience ${option.name} with ${option.buyer_count} buyers`",
    );
    expect(source).toContain(
      'option.buyer_count === 1 ? "buyer" : "buyers"',
    );
    expect(source).toMatch(
      /option\.kind === "brand_buyers"[\s\S]*?"Brand rollup"[\s\S]*?: "Event buyers"/,
    );
  });
});
