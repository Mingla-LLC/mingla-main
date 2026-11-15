import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..", "..", "..", "..");

// [TEST-MOD-APPROVED #4420] the 80 rail became the grouped 248 sidebar (B6).
// The intent is unchanged: the official logo (never a letter mark), and a
// restrained selected state: a soft `fill.railOn` wash with the orange icon,
// no glow, no hard-coded colours (Graphite tokens only).
describe("BottomNav.web desktop rail polish", () => {
  const source = fs.readFileSync(
    path.join(root, "src/components/ui/BottomNav.web.tsx"),
    "utf8",
  );

  it("uses the official Mingla Host logo instead of a temporary letter mark", () => {
    expect(source).toContain("MINGLA_BUSINESS_LOGO");
    expect(source).toContain("<Image");
    expect(source).not.toContain("LinearGradient");
    expect(source).not.toContain("brandMarkLetter");
  });

  it("keeps the selected rail state restrained and glass-like", () => {
    expect(source).toContain("itemOn: { backgroundColor: color.fill.railOn }");
    expect(source).toContain("color={on ? color.accent : color.text2}");
    expect(source).not.toMatch(/shadowColor|glassChromeActive/);
    expect(source).not.toMatch(/rgba\(|#[0-9a-fA-F]{6}\b/);
  });
});
